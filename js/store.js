/* ============================================================
   WAVELENGTH — store.js
   Central state + localStorage persistence. Holds only metadata
   that can survive a reload (never File objects or blob URLs —
   those live in Library's in-memory runtime map).
   ============================================================ */
(function (global) {
  "use strict";

  const STORAGE_KEY = "wavelength:v1";
  const SAVE_DEBOUNCE_MS = 400;

  function hashString(str) {
    // FNV-1a, stable across sessions — used so re-adding the same
    // file path or URL resolves to the same track id.
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(36);
  }

  function fileTrackId(relPath, size) {
    return "f_" + hashString(relPath + "|" + size);
  }
  function urlTrackId(url) {
    return "u_" + hashString(url);
  }
  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaultState() {
    return {
      version: 1,
      tracks: {},        // id -> track meta
      order: [],          // insertion order of ids
      playlists: {},      // id -> { id, name, trackIds: [], dateCreated }
      playlistOrder: [],
      likedIds: [],
      recentIds: [],       // most-recent-first, capped
      lyrics: {},          // trackId -> text
      settings: {
        volume: 0.85,
        muted: false,
        shuffle: false,
        repeat: "off",     // off | all | one
        sidebarCollapsed: false,
        eq: { enabled: false, preset: "flat", bands: [0, 0, 0, 0, 0, 0] },
        githubRepo: null,   // { owner, repo } — explicit override for repo auto-sync
        githubAutoSync: true
      }
    };
  }

  function safeParse(json) {
    try { return JSON.parse(json); } catch (e) { return null; }
  }

  const Store = {
    state: null,
    _saveTimer: null,
    _listeners: [],

    init() {
      const raw = global.localStorage ? global.localStorage.getItem(STORAGE_KEY) : null;
      const parsed = raw ? safeParse(raw) : null;
      const base = defaultState();
      if (parsed && typeof parsed === "object") {
        this.state = Object.assign(base, parsed);
        this.state.settings = Object.assign(base.settings, parsed.settings || {});
        this.state.settings.eq = Object.assign(base.settings.eq, (parsed.settings && parsed.settings.eq) || {});
        this.state.tracks = parsed.tracks || {};
        this.state.playlists = parsed.playlists || {};
        this.state.lyrics = parsed.lyrics || {};
      } else {
        this.state = base;
      }
      return this.state;
    },

    onChange(fn) { this._listeners.push(fn); },
    _notify() { this._listeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore listener errors */ } }); },

    save(immediate) {
      if (!global.localStorage) return;
      if (this._saveTimer) clearTimeout(this._saveTimer);
      const doSave = () => {
        try {
          global.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        } catch (e) {
          console.warn("Wavelength: could not persist library (storage full or unavailable).", e);
        }
      };
      if (immediate) doSave();
      else this._saveTimer = setTimeout(doSave, SAVE_DEBOUNCE_MS);
      this._notify();
    },

    /* ---------------- Tracks ---------------- */
    getTrack(id) { return this.state.tracks[id] || null; },
    allTracks() { return this.state.order.map((id) => this.state.tracks[id]).filter(Boolean); },

    /** Insert or merge track metadata. Preserves like/play/lyrics history across re-adds. */
    upsertTrack(meta) {
      const existing = this.state.tracks[meta.id];
      const merged = Object.assign(
        { playCount: 0, dateAdded: Date.now(), liked: false },
        existing || {},
        meta
      );
      this.state.tracks[meta.id] = merged;
      if (!existing) this.state.order.push(meta.id);
      this.save();
      return merged;
    },

    removeTrack(id) {
      delete this.state.tracks[id];
      this.state.order = this.state.order.filter((x) => x !== id);
      this.state.likedIds = this.state.likedIds.filter((x) => x !== id);
      this.state.recentIds = this.state.recentIds.filter((x) => x !== id);
      Object.values(this.state.playlists).forEach((p) => {
        p.trackIds = p.trackIds.filter((x) => x !== id);
      });
      delete this.state.lyrics[id];
      this.save();
    },

    toggleLike(id) {
      const t = this.state.tracks[id];
      if (!t) return false;
      t.liked = !t.liked;
      if (t.liked) { if (!this.state.likedIds.includes(id)) this.state.likedIds.push(id); }
      else { this.state.likedIds = this.state.likedIds.filter((x) => x !== id); }
      this.save();
      return t.liked;
    },
    isLiked(id) { return !!(this.state.tracks[id] && this.state.tracks[id].liked); },

    incrementPlayCount(id) {
      const t = this.state.tracks[id];
      if (!t) return;
      t.playCount = (t.playCount || 0) + 1;
      t.lastPlayed = Date.now();
      this.state.recentIds = [id, ...this.state.recentIds.filter((x) => x !== id)].slice(0, 60);
      this.save();
    },

    setLyrics(id, text) { this.state.lyrics[id] = text; this.save(); },
    getLyrics(id) { return this.state.lyrics[id] || ""; },

    /* ---------------- Playlists ---------------- */
    createPlaylist(name) {
      const id = uid("pl");
      this.state.playlists[id] = { id, name: name || "New Playlist", trackIds: [], dateCreated: Date.now() };
      this.state.playlistOrder.push(id);
      this.save(true);
      return this.state.playlists[id];
    },
    renamePlaylist(id, name) {
      const p = this.state.playlists[id];
      if (!p) return;
      p.name = (name || "").trim() || p.name;
      this.save();
    },
    deletePlaylist(id) {
      delete this.state.playlists[id];
      this.state.playlistOrder = this.state.playlistOrder.filter((x) => x !== id);
      this.save(true);
    },
    addToPlaylist(playlistId, trackId) {
      const p = this.state.playlists[playlistId];
      if (!p || p.trackIds.includes(trackId)) return false;
      p.trackIds.push(trackId);
      this.save();
      return true;
    },
    removeFromPlaylist(playlistId, trackId) {
      const p = this.state.playlists[playlistId];
      if (!p) return;
      p.trackIds = p.trackIds.filter((x) => x !== trackId);
      this.save();
    },
    reorderPlaylist(playlistId, orderedIds) {
      const p = this.state.playlists[playlistId];
      if (!p) return;
      p.trackIds = orderedIds.slice();
      this.save();
    },

    /* ---------------- Settings ---------------- */
    updateSettings(patch) {
      Object.assign(this.state.settings, patch);
      this.save();
    },
    updateEq(patch) {
      Object.assign(this.state.settings.eq, patch);
      this.save();
    },

    /* ---------------- Import / export ---------------- */
    exportJSON() {
      return JSON.stringify(this.state, null, 2);
    },
    importJSON(json) {
      const parsed = safeParse(json);
      if (!parsed || typeof parsed !== "object") throw new Error("That file doesn't look like a Wavelength library export.");
      const base = defaultState();
      this.state = Object.assign(base, parsed);
      this.state.settings = Object.assign(base.settings, parsed.settings || {});
      this.save(true);
    },

    ids: { fileTrackId, urlTrackId, hashString }
  };

  global.MP = global.MP || {};
  global.MP.Store = Store;
})(window);
