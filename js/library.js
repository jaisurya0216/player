/* ============================================================
   WAVELENGTH — library.js
   Turns File objects / URLs into playable track entries.
   Runtime-only resources (object URLs, File refs) live here in
   memory; only durable metadata is handed to Store.
   ============================================================ */
(function (global) {
  "use strict";

  const AUDIO_EXT = ["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus", "weba"];
  const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"];
  // Vendored locally (not loaded from a CDN) so tag reading works offline
  // and doesn't depend on a third party at runtime.
  const TAG_LIB_URL = "js/vendor/jsmediatags.min.js";

  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || "");
    return m ? m[1].toLowerCase() : "";
  }
  function baseName(name) {
    return (name || "").replace(/\.[a-z0-9]+$/i, "").toLowerCase().trim();
  }
  function titleCaseFromFilename(name) {
    const stripped = (name || "").replace(/\.[a-z0-9]+$/i, "").replace(/[_]+/g, " ").trim();
    return stripped || "Untitled";
  }
  function dirOf(relPath) {
    // Strip a "music"/"pictures" classifying segment wherever it appears, and
    // lowercase — so "music/Artist/Song.mp3" and "pictures/Artist/Song.jpg"
    // (or a locally-picked parent folder containing both) resolve to the same
    // directory key and can be paired up.
    const parts = (relPath || "").split("/");
    parts.pop();
    return parts.filter((p) => !/^(music|pictures)$/i.test(p)).join("/").toLowerCase();
  }
  function albumGuessFromRepoPath(path) {
    const parts = (path || "").split("/");
    parts.pop();
    const filtered = parts.filter((p) => !/^(music|pictures)$/i.test(p));
    return filtered.length ? filtered[filtered.length - 1] : "";
  }

  let tagLibPromise = null;
  function ensureTagLibrary() {
    if (global.jsmediatags) return Promise.resolve(true);
    if (tagLibPromise) return tagLibPromise;
    tagLibPromise = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = TAG_LIB_URL;
      s.async = true;
      s.onload = () => resolve(!!global.jsmediatags);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
      setTimeout(() => resolve(!!global.jsmediatags), 6000);
    });
    return tagLibPromise;
  }

  function withTimeout(promise, ms, fallback) {
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
      promise.then((v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } })
        .catch(() => { if (!done) { done = true; clearTimeout(t); resolve(fallback); } });
    });
  }

  function readAudioDuration(objectURL) {
    return withTimeout(new Promise((resolve) => {
      const a = new Audio();
      a.preload = "metadata";
      a.onloadedmetadata = () => resolve(isFinite(a.duration) ? a.duration : 0);
      a.onerror = () => resolve(0);
      a.src = objectURL;
    }), 8000, 0);
  }

  // Deterministic "generated" cover art — a two-tone gradient + initials,
  // used whenever no real artwork is found. Palette stays in the app's
  // own accent family so it never clashes with the UI.
  const GEN_PALETTES = [
    ["#E4A29C", "#9BC2A0"], ["#E8C468", "#E4A29C"], ["#C4B5DC", "#A8C8DC"],
    ["#9BC2A0", "#A8C8DC"], ["#D97E93", "#E8C468"], ["#A8C8DC", "#C4B5DC"]
  ];
  function generatedArt(seed) {
    const h = MP.Store.ids.hashString(seed || "?");
    const n = parseInt(h.slice(0, 4), 36) || 0;
    const pal = GEN_PALETTES[n % GEN_PALETTES.length];
    const angle = (n % 8) * 45;
    const words = (seed || "?").trim().split(/\s+/).filter(Boolean);
    const initials = ((words[0] || "?")[0] + (words[1] ? words[1][0] : "")).toUpperCase();
    return { gradient: `linear-gradient(${angle}deg, ${pal[0]}, ${pal[1]})`, initials };
  }

  const Library = {
    runtime: new Map(),   // trackId -> { objectURL, artObjectURL, file }
    imagePool: [],         // { base, dir, file, objectURL } — for filename-matched art

    /* ---------------- classification ---------------- */
    splitFiles(fileList) {
      const files = Array.from(fileList || []);
      const audio = [], images = [];
      files.forEach((f) => {
        const ext = extOf(f.name);
        if (AUDIO_EXT.includes(ext)) audio.push(f);
        else if (IMAGE_EXT.includes(ext)) images.push(f);
      });
      return { audio, images };
    },

    addImagesToPool(imageFiles) {
      imageFiles.forEach((f) => {
        const rel = f.webkitRelativePath || f.name;
        this.imagePool.push({
          base: baseName(f.name),
          dir: dirOf(rel),
          file: f,
          objectURL: URL.createObjectURL(f)
        });
      });
    },

    findPoolArt(fileBase, fileDir) {
      if (!this.imagePool.length) return null;
      let match = this.imagePool.find((p) => p.base === fileBase && p.dir === fileDir);
      if (match) return match.objectURL;
      match = this.imagePool.find((p) => p.base === fileBase);
      if (match) return match.objectURL;
      const genericNames = ["cover", "folder", "album", "art", "artwork"];
      match = this.imagePool.find((p) => p.dir === fileDir && genericNames.includes(p.base));
      if (match) return match.objectURL;
      return null;
    },

    /* ---------------- ingest local files ---------------- */
    async ingestFiles(fileList, onProgress) {
      const { audio, images } = this.splitFiles(fileList);
      this.addImagesToPool(images);

      const results = [];
      for (let i = 0; i < audio.length; i++) {
        const f = audio[i];
        try {
          const track = await this._ingestOneFile(f);
          if (track) results.push(track);
        } catch (e) {
          console.warn("Wavelength: failed to add", f.name, e);
        }
        if (onProgress) onProgress(i + 1, audio.length);
      }
      return { added: results, imagesFound: images.length, audioFound: audio.length };
    },

    async _ingestOneFile(file) {
      const relPath = file.webkitRelativePath || file.name;
      const id = MP.Store.ids.fileTrackId(relPath, file.size);
      const objectURL = URL.createObjectURL(file);
      const fBase = baseName(file.name);
      const fDir = dirOf(relPath);

      let title = titleCaseFromFilename(file.name);
      let artist = "Unknown Artist";
      const guess = /^(.*?)\s*-\s*(.*)$/.exec(title);
      if (guess && guess[1] && guess[2]) { artist = guess[1].trim(); title = guess[2].trim(); }

      let artURL = this.findPoolArt(fBase, fDir);
      const duration = await readAudioDuration(objectURL);

      const meta = {
        id, title, artist, album: "", duration,
        sourceType: "file", fp: relPath + "|" + file.size, relPath,
        artSource: artURL ? "matched" : "none"
      };
      MP.Store.upsertTrack(meta);
      this.runtime.set(id, { objectURL, artObjectURL: artURL, file });

      // enrich in the background with embedded ID3 tags/art if available
      this._enrichWithTags(id, file, !artURL);
      return meta;
    },

    async _enrichWithTags(id, file, wantEmbeddedArt) {
      const ok = await ensureTagLibrary();
      if (!ok || !global.jsmediatags) return;
      try {
        global.jsmediatags.read(file, {
          onSuccess: (tag) => {
            const t = tag && tag.tags ? tag.tags : {};
            const patch = {};
            if (t.title) patch.title = t.title;
            if (t.artist) patch.artist = t.artist;
            if (t.album) patch.album = t.album;
            if (Object.keys(patch).length) MP.Store.upsertTrack(Object.assign({ id }, patch));

            if (wantEmbeddedArt && t.picture && t.picture.data) {
              try {
                const bytes = new Uint8Array(t.picture.data);
                const blob = new Blob([bytes], { type: t.picture.format || "image/jpeg" });
                const url = URL.createObjectURL(blob);
                const rt = this.runtime.get(id);
                if (rt) rt.artObjectURL = url;
                MP.Store.upsertTrack({ id, artSource: "embedded" });
              } catch (e) { /* corrupt art frame — ignore, keep placeholder */ }
            }
            if (global.MP.UI) global.MP.UI.onTrackEnriched(id);
          },
          onError: () => { /* no tags — filename-derived metadata stands */ }
        });
      } catch (e) { /* library present but read failed — non-fatal */ }
    },

    /* ---------------- ingest URLs ---------------- */
    addFromUrls(rawText, opts) {
      opts = opts || {};
      const lines = (rawText || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const added = [];
      lines.forEach((url) => {
        if (!/^https?:\/\//i.test(url)) return;
        const id = MP.Store.ids.urlTrackId(url);
        let guessTitle = opts.title;
        if (!guessTitle) {
          try {
            const path = decodeURIComponent(new URL(url).pathname.split("/").pop() || "Untitled");
            guessTitle = titleCaseFromFilename(path);
          } catch (e) { guessTitle = "Untitled"; }
        }
        const meta = {
          id, title: guessTitle, artist: opts.artist || "Unknown Artist", album: opts.album || "",
          duration: 0, sourceType: "url", url, artSource: opts.artUrl ? "url" : "none", artUrl: opts.artUrl || ""
        };
        MP.Store.upsertTrack(meta);
        this.runtime.set(id, { objectURL: url, artObjectURL: opts.artUrl || null, file: null });
        added.push(meta);

        // best-effort duration read for remote files (may fail silently due to CORS — fine, playback still works)
        readAudioDuration(url).then((d) => { if (d) MP.Store.upsertTrack({ id, duration: d }); });
      });
      return added;
    },

    /* ---------------- ingest from a hosted repo (GitHub Pages, etc.) ---------------- */
    async ingestFromRepo(syncResult) {
      const { owner, repo, musicFiles, pictureFiles } = syncResult;

      pictureFiles.forEach((f) => {
        const name = f.path.split("/").pop();
        const already = this.imagePool.some((p) => p.objectURL === f.url);
        if (!already) this.imagePool.push({ base: baseName(name), dir: dirOf(f.path), file: null, objectURL: f.url });
      });

      const added = [];
      const currentIds = new Set();
      musicFiles.forEach((f) => {
        const name = f.path.split("/").pop();
        const id = MP.Store.ids.urlTrackId(f.url);
        currentIds.add(id);
        let title = titleCaseFromFilename(name);
        let artist = "Unknown Artist";
        const guess = /^(.*?)\s*-\s*(.*)$/.exec(title);
        if (guess && guess[1] && guess[2]) { artist = guess[1].trim(); title = guess[2].trim(); }

        const artUrl = this.findPoolArt(baseName(name), dirOf(f.path));
        const meta = {
          id, title, artist, album: albumGuessFromRepoPath(f.path), duration: 0,
          sourceType: "repo", url: f.url, repoPath: f.path, repoOwner: owner, repoName: repo,
          artSource: artUrl ? "matched" : "none", artUrl: artUrl || ""
        };
        MP.Store.upsertTrack(meta);
        this.runtime.set(id, { objectURL: f.url, artObjectURL: artUrl, file: null });
        added.push(meta);
      });

      // drop tracks that came from this same repo on a previous sync but were
      // since deleted upstream — otherwise they'd sit in the library as dead links
      let removed = 0;
      MP.Store.state.order.slice().forEach((id) => {
        const t = MP.Store.getTrack(id);
        if (t && t.sourceType === "repo" && t.repoOwner === owner && t.repoName === repo && !currentIds.has(id)) {
          this.forget(id);
          MP.Store.removeTrack(id);
          removed++;
        }
      });

      // pictures may have just arrived for tracks (local or repo) added earlier without art
      MP.Store.state.order.forEach((id) => this.rematchArt(id));
      return { added, removed, audioFound: musicFiles.length, imagesFound: pictureFiles.length };
    },

    /* ---------------- accessors ---------------- */
    getPlayableUrl(id) {
      const rt = this.runtime.get(id);
      return rt ? rt.objectURL : null;
    },
    getArtUrl(id) {
      const rt = this.runtime.get(id);
      if (rt && rt.artObjectURL) return rt.artObjectURL;
      const meta = MP.Store.getTrack(id);
      if (meta && meta.artUrl) return meta.artUrl;
      return null;
    },
    isReconnected(id) { return this.runtime.has(id); },
    generatedArt,

    /** Release blob URLs and drop runtime resources for a track being deleted. */
    forget(id) {
      const rt = this.runtime.get(id);
      if (!rt) return;
      if (rt.objectURL && rt.objectURL.indexOf("blob:") === 0) URL.revokeObjectURL(rt.objectURL);
      if (rt.artObjectURL && rt.artObjectURL.indexOf("blob:") === 0) URL.revokeObjectURL(rt.artObjectURL);
      this.runtime.delete(id);
    },

    /** Re-check pool matches for a track that had no art (after a folder reconnect or repo sync). */
    rematchArt(id) {
      const meta = MP.Store.getTrack(id);
      const rt = this.runtime.get(id);
      if (!meta || !rt || rt.artObjectURL) return;
      const path = meta.relPath || meta.repoPath;
      if (!path) return;
      const name = path.split("/").pop();
      const art = this.findPoolArt(baseName(name), dirOf(path));
      if (art) { rt.artObjectURL = art; MP.Store.upsertTrack({ id, artSource: "matched" }); }
    }
  };

  global.MP = global.MP || {};
  global.MP.Library = Library;
})(window);
