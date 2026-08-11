/* ============================================================
   WAVELENGTH — audio.js
   Playback engine. Two <audio> elements let manual skips
   crossfade instead of clicking; a small Web Audio graph adds
   a 6-band EQ and an analyser for the visualizer.
   ============================================================ */
(function (global) {
  "use strict";

  const EQ_FREQS = [60, 170, 350, 1000, 3500, 10000];
  const EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0, 0],
    bass: [6, 4.5, 2, 0, -0.5, -1],
    vocal: [-2, -1, 1.5, 4, 3, 0.5],
    treble: [-1, -0.5, 0, 2, 4.5, 6],
    rock: [4, 2.5, -1, -1, 2, 4],
    pop: [-1, 1.5, 3, 3, 1, -1.5],
    electronic: [5, 3.5, 0, -1.5, 2, 4.5]
  };
  const CROSSFADE_MS = 260;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  const Engine = {
    ctx: null,
    master: null,
    slots: [],       // [{el, source, fadeGain, filters[], analyser, ready}]
    active: 0,
    _currentId: null,
    _listeners: {},
    _endedHandled: false,

    on(evt, fn) { (this._listeners[evt] = this._listeners[evt] || []).push(fn); },
    _emit(evt, data) { (this._listeners[evt] || []).forEach((fn) => { try { fn(data); } catch (e) { /* noop */ } }); },

    _ensureContext() {
      if (this.ctx) return;
      const Ctx = global.AudioContext || global.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = MP.Store.state.settings.muted ? 0 : MP.Store.state.settings.volume;
      this.master.connect(this.ctx.destination);
      this.slots = [this._buildSlot(), this._buildSlot()];
      this.applyEq(); // restore any equalizer settings saved from a previous session
    },

    _buildSlot() {
      const el = new Audio();
      el.crossOrigin = "anonymous";
      el.preload = "auto";
      let source;
      try { source = this.ctx.createMediaElementSource(el); }
      catch (e) { source = null; }

      const fadeGain = this.ctx.createGain();
      fadeGain.gain.value = 0;

      const filters = EQ_FREQS.map((freq, i) => {
        const f = this.ctx.createBiquadFilter();
        f.frequency.value = freq;
        if (i === 0) f.type = "lowshelf";
        else if (i === EQ_FREQS.length - 1) f.type = "highshelf";
        else { f.type = "peaking"; f.Q.value = 1.0; }
        f.gain.value = 0;
        return f;
      });

      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;

      if (source) {
        let node = source;
        node.connect(fadeGain);
        node = fadeGain;
        filters.forEach((f) => { node.connect(f); node = f; });
        node.connect(analyser);
        analyser.connect(this.master);
      }

      el.addEventListener("timeupdate", () => this._onTimeUpdate(el));
      el.addEventListener("ended", () => this._onEnded(el));
      el.addEventListener("error", () => this._onError(el));
      el.addEventListener("waiting", () => this._emit("buffering", true));
      el.addEventListener("canplay", () => this._emit("buffering", false));

      return { el, source, fadeGain, filters, analyser, ready: !!source };
    },

    /* ---------------- loading / switching ---------------- */
    loadTrack(id, url, opts) {
      this._ensureContext();
      opts = opts || {};
      const wasPlaying = this.isPlaying();
      this._currentId = id;
      this._endedHandled = false;

      if (wasPlaying && this.slots[this.active].ready) {
        this._crossfadeTo(url, opts.autoplay !== false);
      } else {
        const slot = this.slots[this.active];
        slot.el.src = url;
        slot.fadeGain.gain.cancelScheduledValues(this.ctx.currentTime);
        slot.fadeGain.gain.value = 1;
        if (opts.autoplay) this.play();
      }
      this._emit("trackchange", id);
    },

    _crossfadeTo(url, autoplay) {
      const ctx = this.ctx;
      const oldSlot = this.slots[this.active];
      const newIndex = 1 - this.active;
      const newSlot = this.slots[newIndex];

      newSlot.el.src = url;
      newSlot.fadeGain.gain.cancelScheduledValues(ctx.currentTime);
      newSlot.fadeGain.gain.setValueAtTime(0, ctx.currentTime);

      const startNew = () => {
        const p = newSlot.el.play();
        if (p && p.catch) p.catch(() => this._emit("error", { message: "This track couldn't be played — the file or link may be missing." }));
        const now = ctx.currentTime;
        newSlot.fadeGain.gain.linearRampToValueAtTime(1, now + CROSSFADE_MS / 1000);
        oldSlot.fadeGain.gain.cancelScheduledValues(now);
        oldSlot.fadeGain.gain.setValueAtTime(oldSlot.fadeGain.gain.value, now);
        oldSlot.fadeGain.gain.linearRampToValueAtTime(0, now + CROSSFADE_MS / 1000);
        setTimeout(() => { try { oldSlot.el.pause(); oldSlot.el.removeAttribute("src"); oldSlot.el.load(); } catch (e) {} }, CROSSFADE_MS + 60);
        this.active = newIndex;
      };
      if (autoplay === false) {
        newSlot.fadeGain.gain.value = 1;
        oldSlot.fadeGain.gain.value = 0;
        try { oldSlot.el.pause(); } catch (e) {}
        this.active = newIndex;
      } else {
        startNew();
      }
    },

    /* ---------------- transport ---------------- */
    play() {
      this._ensureContext();
      if (this.ctx.state === "suspended") this.ctx.resume();
      const slot = this.slots[this.active];
      if (!slot.el.src) return;
      const p = slot.el.play();
      if (p && p.catch) p.catch((e) => this._emit("error", { message: "Playback was blocked or failed to start." }));
      slot.fadeGain.gain.cancelScheduledValues(this.ctx.currentTime);
      slot.fadeGain.gain.value = 1;
      this._emit("playstate", true);
    },
    pause() {
      if (!this.ctx) return;
      this.slots[this.active].el.pause();
      this._emit("playstate", false);
    },
    toggle() { this.isPlaying() ? this.pause() : this.play(); },
    isPlaying() {
      if (!this.ctx) return false;
      const el = this.slots[this.active].el;
      return !!(el.src && !el.paused && !el.ended);
    },
    seek(seconds) {
      const el = this.slots[this.active].el;
      if (!el.src || !isFinite(el.duration)) return;
      el.currentTime = clamp(seconds, 0, el.duration || 0);
    },
    seekBy(delta) { const el = this.slots[this.active].el; this.seek((el.currentTime || 0) + delta); },
    getCurrentTime() { const el = this.slots[this.active] && this.slots[this.active].el; return el ? el.currentTime || 0 : 0; },
    getDuration() { const el = this.slots[this.active] && this.slots[this.active].el; return el && isFinite(el.duration) ? el.duration : 0; },

    setVolume(v) {
      this._ensureContext();
      const vol = clamp(v, 0, 1);
      MP.Store.updateSettings({ volume: vol, muted: false });
      this.master.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.01);
      this._applyFallbackVolume(vol);
    },
    setMuted(m) {
      this._ensureContext();
      MP.Store.updateSettings({ muted: m });
      const vol = m ? 0 : MP.Store.state.settings.volume;
      this.master.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.01);
      this._applyFallbackVolume(vol);
    },
    // If a slot's MediaElementSource never connected (rare browser/CORS edge
    // case), its audio still plays through the element directly — in that
    // case the element's native volume is the only control we have.
    _applyFallbackVolume(vol) {
      this.slots.forEach((slot) => { if (!slot.ready) slot.el.volume = vol; });
    },

    /* ---------------- equalizer ---------------- */
    setEqEnabled(enabled) {
      MP.Store.updateEq({ enabled });
      this.applyEq();
    },
    setEqBands(bands) {
      MP.Store.updateEq({ bands, preset: "custom" });
      this.applyEq();
    },
    applyPreset(name) {
      const bands = EQ_PRESETS[name] || EQ_PRESETS.flat;
      MP.Store.updateEq({ bands: bands.slice(), preset: name });
      this.applyEq();
    },
    applyEq() {
      if (!this.ctx) return;
      const eq = MP.Store.state.settings.eq;
      const bands = eq.enabled ? eq.bands : EQ_PRESETS.flat;
      this.slots.forEach((slot) => {
        slot.filters.forEach((f, i) => f.gain.setTargetAtTime(bands[i] || 0, this.ctx.currentTime, 0.01));
      });
    },
    presets: EQ_PRESETS,
    freqs: EQ_FREQS,

    /* ---------------- analyser for visualizer ---------------- */
    getAnalyser() {
      if (!this.ctx) return null;
      return this.slots[this.active].analyser;
    },

    /* ---------------- internal events ---------------- */
    _onTimeUpdate(el) {
      if (el !== this.slots[this.active].el) return;
      this._emit("timeupdate", { current: el.currentTime || 0, duration: isFinite(el.duration) ? el.duration : 0 });
    },
    _onEnded(el) {
      if (el !== this.slots[this.active].el || this._endedHandled) return;
      this._endedHandled = true;
      this._emit("ended", { id: this._currentId });
    },
    _onError(el) {
      if (el !== this.slots[this.active].el) return;
      this._emit("error", { message: "This track couldn't be played — the file or link may be missing." });
    }
  };

  global.MP = global.MP || {};
  global.MP.Audio = Engine;
})(window);
