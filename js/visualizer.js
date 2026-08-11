/* ============================================================
   WAVELENGTH — visualizer.js
   Radial frequency ring drawn around the now-playing artwork.
   Falls back to a gentle idle breathing animation when nothing
   is playing, so the ring never looks broken.
   ============================================================ */
(function (global) {
  "use strict";

  const BARS = 64;
  const INNER_R = 152;
  const MAX_BAR = 62;

  const Visualizer = {
    _raf: null,
    _canvas: null,
    _ctx2d: null,
    _dataArr: null,
    _idlePhase: 0,

    start(canvas) {
      this._canvas = canvas;
      this._ctx2d = canvas.getContext("2d");
      this._loop();
    },
    stop() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
    },

    _loop() {
      this._raf = requestAnimationFrame(() => this._loop());
      const ctx = this._ctx2d;
      if (!ctx || !this._canvas) return;
      const W = this._canvas.width, H = this._canvas.height;
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2;

      const analyser = global.MP.Audio.getAnalyser();
      const playing = global.MP.Audio.isPlaying();
      let values;

      if (analyser && playing) {
        if (!this._dataArr || this._dataArr.length !== analyser.frequencyBinCount) {
          this._dataArr = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(this._dataArr);
        values = this._sample(this._dataArr, BARS);
      } else {
        this._idlePhase += 0.02;
        values = new Array(BARS).fill(0).map((_, i) => 14 + Math.sin(this._idlePhase + i * 0.35) * 8);
      }

      for (let i = 0; i < BARS; i++) {
        const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const amp = playing ? (values[i] / 255) * MAX_BAR : values[i];
        const r0 = INNER_R;
        const r1 = INNER_R + Math.max(3, amp);
        const x0 = cx + Math.cos(angle) * r0, y0 = cy + Math.sin(angle) * r0;
        const x1 = cx + Math.cos(angle) * r1, y1 = cy + Math.sin(angle) * r1;
        const t = i / BARS;
        ctx.strokeStyle = t < 0.5
          ? this._mix("#F5A29C", "#7FD3C6", t * 2)
          : this._mix("#7FD3C6", "#F5A29C", (t - 0.5) * 2);
        ctx.globalAlpha = playing ? 0.85 : 0.35;
        ctx.lineWidth = 2.6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },

    _sample(arr, n) {
      const out = new Array(n);
      const usable = Math.floor(arr.length * 0.75); // low/mid bins carry most visible energy
      const step = usable / n;
      for (let i = 0; i < n; i++) out[i] = arr[Math.min(usable - 1, Math.floor(i * step))];
      return out;
    },

    _mix(hexA, hexB, t) {
      const a = this._hex(hexA), b = this._hex(hexB);
      const r = Math.round(a[0] + (b[0] - a[0]) * t);
      const g = Math.round(a[1] + (b[1] - a[1]) * t);
      const bl = Math.round(a[2] + (b[2] - a[2]) * t);
      return `rgb(${r},${g},${bl})`;
    },
    _hex(h) {
      const v = h.replace("#", "");
      return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
    }
  };

  global.MP = global.MP || {};
  global.MP.Visualizer = Visualizer;
})(window);
