/* ============================================================
   WAVELENGTH — ui.js
   Rendering, view routing, queue/playback control, and all
   interactive wiring (modals, drag & drop, keyboard shortcuts).
   ============================================================ */
(function (global) {
  "use strict";

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + String(s).padStart(2, "0");
  }
  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const UI = {
    els: {},
    view: "home",
    viewCtx: null,
    player: { baseQueue: [], queue: [], index: -1, currentId: null },
    _sleepTimer: null,
    _sleepEndsAt: null,
    _errorSkipCount: 0,
    _modalOnConfirm: null,
    _draggingSeek: false,
    _draggingVol: false,

    /* ================= INIT ================= */
    init() {
      this._cache();
      this._wireNav();
      this._wireAddMusic();
      this._wireTopbar();
      this._wirePlaybar();
      this._wireNowPlaying();
      this._wireModals();
      this._wireGithubSync();
      this._wireDragDrop();
      this._wireKeyboard();
      this._wireContextMenuDismiss();
      this._subscribeAudio();

      const s = MP.Store.state.settings;
      this._setVolumeUI(s.muted ? 0 : s.volume);
      this._setShuffleUI(s.shuffle);
      this._setRepeatUI(s.repeat);
      if (s.sidebarCollapsed) this.els.app.classList.add("sidebar-collapsed");

      MP.Visualizer.start(this.els.npRing);
      this.renderPlaylistSidebar();
      this.renderQueueList();
      this.switchView("home");
      this.refreshCurrentView();
      this._checkEmptyState();
      if (MP.Store.state.order.some((id) => { const t = MP.Store.getTrack(id); return t && t.sourceType === "file"; })) {
        this.els.reconnectBanner.classList.remove("hidden");
      }
      this._trySyncRepo(true);
    },

    _cache() {
      const ids = [
        "sidebar", "btn-new-playlist", "playlist-list", "btn-add-folder", "btn-add-files", "btn-add-url",
        "btn-sync-github", "btn-empty-sync-github", "modal-github", "gh-owner", "gh-repo", "gh-autosync", "gh-status", "btn-gh-sync",
        "input-folder", "input-files", "btn-sidebar-toggle", "global-search", "btn-eq", "btn-export", "btn-import", "input-import",
        "view-scroll", "reconnect-banner", "btn-reconnect", "empty-state", "btn-empty-add-folder", "btn-empty-add-url", "home-content",
        "grid-recent", "row-most-played", "row-albums", "row-artists", "rail-most-played", "rail-albums", "rail-artists",
        "library-count", "btn-shuffle-all", "btn-play-all", "table-library", "table-favorites", "table-search",
        "playlist-hero-art", "playlist-title", "playlist-meta", "btn-play-playlist", "btn-delete-playlist", "table-playlist",
        "album-hero-art", "album-title", "album-meta", "btn-play-album", "table-album",
        "artist-hero-art", "artist-title", "artist-meta", "btn-play-artist", "table-artist",
        "playbar", "playbar-track", "playbar-art", "playbar-title", "playbar-artist", "btn-like-current",
        "btn-shuffle", "btn-prev", "btn-play", "btn-next", "btn-repeat",
        "time-current", "seek-track", "seek-fill", "seek-buffer", "seek-handle", "time-duration",
        "btn-timer", "btn-queue-toggle", "btn-mute", "vol-track", "vol-fill", "vol-handle", "btn-expand",
        "now-playing-overlay", "np-backdrop", "btn-collapse", "np-ring", "np-art", "np-album", "np-title", "np-artist",
        "np-seek-track", "np-seek-fill", "np-seek-handle", "np-time-current", "np-time-duration",
        "np-btn-shuffle", "np-btn-prev", "np-btn-play", "np-btn-next", "np-btn-repeat",
        "queue-list", "lyrics-box", "detail-list",
        "modal-layer", "modal-backdrop", "modal-url", "url-audio", "url-title", "url-artist", "url-art", "btn-url-submit",
        "modal-playlist", "new-playlist-name", "btn-playlist-submit",
        "modal-eq", "eq-presets", "eq-bands", "eq-enabled", "btn-eq-reset",
        "modal-add-to-playlist", "playlist-pick-list", "btn-pick-new-playlist",
        "modal-timer", "timer-options", "timer-status", "btn-timer-cancel",
        "modal-confirm", "confirm-message", "btn-confirm-ok",
        "context-menu", "toast-stack", "dropzone-overlay", "app"
      ];
      ids.forEach((id) => { this.els[this._camel(id)] = $(id); });
      this.els.app = $("app");
      this.els.npRing = $("np-ring");
    },
    _camel(id) { return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); },

    /* ================= NAV / VIEWS ================= */
    _wireNav() {
      document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
        btn.addEventListener("click", () => this.switchView(btn.dataset.view));
      });
      this.els.btnSidebarToggle.addEventListener("click", () => {
        if (window.innerWidth <= 760) {
          this.els.app.classList.toggle("sidebar-open");
        } else {
          const collapsed = this.els.app.classList.toggle("sidebar-collapsed");
          MP.Store.updateSettings({ sidebarCollapsed: collapsed });
        }
      });
    },

    switchView(name, ctx) {
      this.view = name;
      this.viewCtx = ctx || null;
      document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
      document.querySelectorAll(".nav-item[data-view]").forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
      const target = $("view-" + name);
      if (target) target.classList.remove("hidden");
      this.els.viewScroll.scrollTop = 0;
      this.els.app.classList.remove("sidebar-open");
      this.refreshCurrentView();
    },

    refreshCurrentView() {
      switch (this.view) {
        case "home": this.renderHome(); break;
        case "library": this.renderLibrary(); break;
        case "favorites": this.renderFavorites(); break;
        case "search": this.renderSearch(this.els.globalSearch.value); break;
        case "playlist": this.renderPlaylistDetail(this.viewCtx); break;
        case "album": this.renderAlbumDetail(this.viewCtx); break;
        case "artist": this.renderArtistDetail(this.viewCtx); break;
      }
      this._checkEmptyState();
    },

    _checkEmptyState() {
      const has = MP.Store.state.order.length > 0;
      this.els.emptyState.classList.toggle("hidden", has || this.view !== "home");
      this.els.homeContent.classList.toggle("hidden", !has && this.view === "home");
    },

    /* ================= ART HELPERS ================= */
    applyArt(container, trackId, opts) {
      opts = opts || {};
      container.innerHTML = "";
      container.classList.remove("gen-art");
      container.style.backgroundImage = "";
      const url = MP.Library.getArtUrl(trackId);
      if (url) {
        container.style.backgroundImage = `url("${url}")`;
        return url;
      }
      const meta = MP.Store.getTrack(trackId);
      const gen = MP.Library.generatedArt((meta && (meta.title + " " + meta.artist)) || "?");
      container.style.background = gen.gradient;
      container.classList.add("gen-art");
      const span = document.createElement("span");
      span.textContent = gen.initials;
      span.style.fontSize = (opts.big ? "64px" : opts.small ? "13px" : "16px");
      container.appendChild(span);
      return null;
    },

    /* ================= HOME ================= */
    renderHome() {
      const tracks = MP.Store.allTracks();
      const recent = tracks.slice().sort((a, b) => b.dateAdded - a.dateAdded).slice(0, 9);
      this.els.gridRecent.innerHTML = "";
      recent.forEach((t) => {
        const item = el("button", "bento-item");
        const art = el("div", "bento-art");
        this.applyArt(art, t.id, { small: true });
        const meta = el("div", "bento-meta", `<div class="bento-title">${escapeHtml(t.title)}</div><div class="bento-sub">${escapeHtml(t.artist)}</div>`);
        item.appendChild(art); item.appendChild(meta);
        item.addEventListener("click", () => this.playContext(recent.map((x) => x.id), t.id));
        this.els.gridRecent.appendChild(item);
      });

      const mostPlayed = tracks.filter((t) => t.playCount > 0).sort((a, b) => b.playCount - a.playCount).slice(0, 10);
      this.els.railMostPlayed.classList.toggle("hidden", mostPlayed.length === 0);
      this.els.rowMostPlayed.innerHTML = "";
      mostPlayed.forEach((t) => this.els.rowMostPlayed.appendChild(this._trackCard(t, mostPlayed.map((x) => x.id))));

      const albumMap = this._groupBy(tracks, (t) => t.album && t.album.trim());
      const albumNames = Object.keys(albumMap).slice(0, 12);
      this.els.railAlbums.classList.toggle("hidden", albumNames.length === 0);
      this.els.rowAlbums.innerHTML = "";
      albumNames.forEach((name) => {
        const list = albumMap[name];
        const card = this._entityCard(name, list[0].artist, list[0].id, () => this.openAlbum(name));
        this.els.rowAlbums.appendChild(card);
      });

      const artistMap = this._groupBy(tracks, (t) => t.artist || "Unknown Artist");
      const artistNames = Object.keys(artistMap).slice(0, 12);
      this.els.railArtists.classList.toggle("hidden", artistNames.length === 0);
      this.els.rowArtists.innerHTML = "";
      artistNames.forEach((name) => {
        const list = artistMap[name];
        const card = this._entityCard(name, list.length + (list.length === 1 ? " song" : " songs"), list[0].id, () => this.openArtist(name), true);
        this.els.rowArtists.appendChild(card);
      });
    },

    _groupBy(tracks, keyFn) {
      const map = {};
      tracks.forEach((t) => {
        const k = keyFn(t);
        if (!k) return;
        (map[k] = map[k] || []).push(t);
      });
      return map;
    },

    _trackCard(t, ctxIds) {
      const card = el("div", "card");
      const art = el("div", "card-art");
      this.applyArt(art, t.id);
      const play = el("button", "card-play"); play.innerHTML = '<svg width="14" height="14"><use href="#i-play"/></svg>'; play.setAttribute("aria-label", "Play " + t.title);
      play.addEventListener("click", (e) => { e.stopPropagation(); this.playContext(ctxIds, t.id); });
      art.appendChild(play);
      const title = el("div", "card-title", escapeHtml(t.title));
      const sub = el("div", "card-sub", escapeHtml(t.artist));
      card.appendChild(art); card.appendChild(title); card.appendChild(sub);
      card.addEventListener("click", () => this.playContext(ctxIds, t.id));
      return card;
    },

    _entityCard(title, sub, artTrackId, onClick, round) {
      const card = el("div", "card");
      const art = el("div", "card-art" + (round ? " card-art--round" : ""));
      this.applyArt(art, artTrackId, { small: true });
      const titleEl = el("div", "card-title", escapeHtml(title));
      const subEl = el("div", "card-sub", escapeHtml(sub));
      card.appendChild(art); card.appendChild(titleEl); card.appendChild(subEl);
      card.addEventListener("click", onClick);
      return card;
    },

    /* ================= TRACK TABLES ================= */
    _rowHeadHtml() {
      return `<div class="track-row-head"><span></span><span></span><span>Title</span><span>Album</span><span>Time</span><span></span></div>`;
    },

    renderTable(container, ids, opts) {
      opts = opts || {};
      container.innerHTML = "";
      if (!ids.length) {
        container.innerHTML = `<div class="track-empty">${opts.emptyText || "Nothing here yet."}</div>`;
        return;
      }
      container.insertAdjacentHTML("beforeend", this._rowHeadHtml());
      ids.forEach((id, i) => {
        const t = MP.Store.getTrack(id);
        if (!t) return;
        container.appendChild(this._trackRow(t, i, ids, opts));
      });
    },

    _trackRow(t, index, ctxIds, opts) {
      const row = el("div", "track-row");
      row.dataset.id = t.id;
      const isCurrent = this.player.currentId === t.id;
      row.classList.toggle("is-playing", isCurrent);
      row.classList.toggle("is-paused", isCurrent && !MP.Audio.isPlaying());

      const idx = el("div", "track-idx", `<span class="track-num">${index + 1}</span><span class="eq-bars"><span></span><span></span><span></span></span>`);
      const art = el("div", "track-art");
      this.applyArt(art, t.id, { small: true });
      const main = el("div", "track-main", `<span class="track-title">${escapeHtml(t.title)}</span><span class="track-artist">${escapeHtml(t.artist)}</span>`);
      const album = el("div", "track-album", escapeHtml(t.album || "—"));
      const dur = el("div", "track-dur", t.duration ? formatTime(t.duration) : "—");
      const actions = el("div", "track-actions");
      const likeBtn = el("button", "track-like" + (MP.Store.isLiked(t.id) ? " is-liked" : ""));
      likeBtn.innerHTML = `<svg width="15" height="15"><use href="#${MP.Store.isLiked(t.id) ? "i-heart-fill" : "i-heart"}"/></svg>`;
      likeBtn.setAttribute("aria-label", "Like");
      likeBtn.addEventListener("click", (e) => { e.stopPropagation(); this.toggleLike(t.id); });
      const moreBtn = el("button", "track-more");
      moreBtn.innerHTML = '<svg width="16" height="16"><use href="#i-more"/></svg>';
      moreBtn.setAttribute("aria-label", "More");
      moreBtn.addEventListener("click", (e) => { e.stopPropagation(); this.openTrackMenu(e, t.id, opts.playlistId); });
      actions.appendChild(likeBtn); actions.appendChild(moreBtn);

      row.appendChild(idx); row.appendChild(art); row.appendChild(main); row.appendChild(album); row.appendChild(dur); row.appendChild(actions);
      row.addEventListener("click", () => this.playContext(ctxIds, t.id));
      row.addEventListener("contextmenu", (e) => { e.preventDefault(); this.openTrackMenu(e, t.id, opts.playlistId); });
      return row;
    },

    renderLibrary() {
      const ids = MP.Store.state.order.slice();
      this.els.libraryCount.textContent = ids.length + (ids.length === 1 ? " song" : " songs");
      this.renderTable(this.els.tableLibrary, ids, { emptyText: "No songs yet — add a folder, files, or a link to begin." });
    },
    renderFavorites() {
      const ids = MP.Store.state.likedIds.slice();
      this.renderTable(this.els.tableFavorites, ids, { emptyText: "Tap the heart on any song to save it here." });
    },
    renderSearch(query) {
      query = (query || "").trim().toLowerCase();
      if (!query) { this.els.tableSearch.innerHTML = `<div class="track-empty">Start typing to search your library.</div>`; return; }
      const ids = MP.Store.allTracks()
        .filter((t) => (t.title + " " + t.artist + " " + t.album).toLowerCase().includes(query))
        .map((t) => t.id);
      this.renderTable(this.els.tableSearch, ids, { emptyText: `No matches for "${escapeHtml(query)}".` });
    },

    /* ================= PLAYLISTS ================= */
    renderPlaylistSidebar() {
      const list = this.els.playlistList;
      list.innerHTML = "";
      if (!MP.Store.state.playlistOrder.length) {
        list.innerHTML = `<div class="playlist-list-empty">No playlists yet — tap + to start one.</div>`;
        return;
      }
      MP.Store.state.playlistOrder.forEach((id) => {
        const p = MP.Store.state.playlists[id];
        if (!p) return;
        const item = el("button", "playlist-item");
        item.classList.toggle("is-active", this.view === "playlist" && this.viewCtx === id);
        const swatch = el("div", "playlist-swatch");
        if (p.trackIds[0]) this.applyArt(swatch, p.trackIds[0], { small: true });
        else swatch.innerHTML = '<svg width="14" height="14"><use href="#i-note"/></svg>';
        const name = el("span", "playlist-item-name", escapeHtml(p.name));
        item.appendChild(swatch); item.appendChild(name);
        item.addEventListener("click", () => this.openPlaylist(id));
        list.appendChild(item);
      });
    },

    openPlaylist(id) {
      const p = MP.Store.state.playlists[id];
      if (!p) return;
      this.switchView("playlist", id);
      this.renderPlaylistSidebar();
    },
    renderPlaylistDetail(id) {
      const p = MP.Store.state.playlists[id];
      if (!p) return;
      this.els.playlistTitle.textContent = p.name;
      this.els.playlistMeta.textContent = p.trackIds.length + (p.trackIds.length === 1 ? " song" : " songs");
      if (p.trackIds[0]) this.applyArt(this.els.playlistHeroArt, p.trackIds[0], { big: true });
      else { this.els.playlistHeroArt.style.background = "var(--bg-elev-3)"; this.els.playlistHeroArt.innerHTML = '<svg width="40" height="40" style="margin:64px auto;display:block;color:var(--text-faint)"><use href="#i-note"/></svg>'; }
      this.renderTable(this.els.tablePlaylist, p.trackIds, { emptyText: "This playlist is empty — add songs from anywhere in your library.", playlistId: id });
    },

    createPlaylistFlow(name) {
      const p = MP.Store.createPlaylist(name);
      this.renderPlaylistSidebar();
      this.toast(`Created "${p.name}"`, "success");
      return p;
    },

    /* ================= ALBUM / ARTIST ================= */
    openAlbum(name) { this.switchView("album", name); }
    ,
    renderAlbumDetail(name) {
      const ids = MP.Store.allTracks().filter((t) => (t.album || "").trim() === name).map((t) => t.id);
      this.els.albumTitle.textContent = name || "Unknown Album";
      const artist = ids.length ? MP.Store.getTrack(ids[0]).artist : "";
      this.els.albumMeta.textContent = artist + " · " + ids.length + (ids.length === 1 ? " song" : " songs");
      if (ids[0]) this.applyArt(this.els.albumHeroArt, ids[0], { big: true });
      else { this.els.albumHeroArt.style.background = "var(--bg-elev-3)"; this.els.albumHeroArt.innerHTML = ""; }
      this.renderTable(this.els.tableAlbum, ids, { emptyText: "No songs found for this album." });
    },
    openArtist(name) { this.switchView("artist", name); },
    renderArtistDetail(name) {
      const ids = MP.Store.allTracks().filter((t) => (t.artist || "Unknown Artist") === name).map((t) => t.id);
      this.els.artistTitle.textContent = name;
      this.els.artistMeta.textContent = ids.length + (ids.length === 1 ? " song" : " songs");
      if (ids[0]) this.applyArt(this.els.artistHeroArt, ids[0], { big: true });
      else { this.els.artistHeroArt.style.background = "var(--bg-elev-3)"; this.els.artistHeroArt.innerHTML = ""; }
      this.renderTable(this.els.tableArtist, ids, { emptyText: "No songs found for this artist." });
    },

    /* ================= PLAYER / QUEUE ================= */
    playContext(ids, startId) {
      ids = ids.filter((id) => MP.Store.getTrack(id));
      if (!ids.length) return;
      this.player.baseQueue = ids.slice();
      this.player.queue = MP.Store.state.settings.shuffle ? this._shuffleKeeping(ids, startId) : ids.slice();
      const idx = startId ? this.player.queue.indexOf(startId) : 0;
      this.playTrackAt(idx < 0 ? 0 : idx);
    },
    _shuffleKeeping(ids, keepId) {
      if (!keepId) return shuffleArray(ids);
      const rest = ids.filter((id) => id !== keepId);
      return [keepId, ...shuffleArray(rest)];
    },

    playTrackAt(index) {
      const q = this.player.queue;
      if (index < 0 || index >= q.length) return;
      const id = q[index];
      const track = MP.Store.getTrack(id);
      const disconnected = track && track.sourceType === "file" && !MP.Library.isReconnected(id);
      const url = disconnected ? null : MP.Library.getPlayableUrl(id);

      if (!url) {
        this._errorSkipCount++;
        if (this._errorSkipCount === 1) {
          this.toast(disconnected
            ? "Some songs aren't connected — reconnect your music folder to play them."
            : "Couldn't find a playable source for that track.", "error");
          if (disconnected) this.els.reconnectBanner.classList.remove("hidden");
        }
        if (this._errorSkipCount <= 8 && index + 1 < q.length) this.playTrackAt(index + 1);
        else this._errorSkipCount = 0;
        return;
      }

      this.player.index = index;
      this.player.currentId = id;
      this._errorSkipCount = 0;
      MP.Audio.loadTrack(id, url, { autoplay: true });
      MP.Store.incrementPlayCount(id);
      this.updateNowPlayingUI();
      this.renderQueueList();
      this._refreshPlayingRows();
    },

    next(explicit) {
      const q = this.player.queue;
      if (!q.length) return;
      let idx = this.player.index + 1;
      if (idx >= q.length) {
        if (MP.Store.state.settings.repeat === "all") idx = 0;
        else { MP.Audio.pause(); return; }
      }
      this.playTrackAt(idx);
    },
    prev() {
      if (MP.Audio.getCurrentTime() > 3) { MP.Audio.seek(0); return; }
      let idx = this.player.index - 1;
      if (idx < 0) {
        if (MP.Store.state.settings.repeat === "all") idx = this.player.queue.length - 1;
        else { MP.Audio.seek(0); return; }
      }
      this.playTrackAt(idx);
    },
    toggleShuffle() {
      const s = MP.Store.state.settings;
      const enable = !s.shuffle;
      MP.Store.updateSettings({ shuffle: enable });
      if (enable) {
        this.player.queue = this._shuffleKeeping(this.player.baseQueue, this.player.currentId);
      } else {
        this.player.queue = this.player.baseQueue.slice();
      }
      this.player.index = this.player.queue.indexOf(this.player.currentId);
      this._setShuffleUI(enable);
      this.renderQueueList();
      this.toast(enable ? "Shuffle on" : "Shuffle off");
    },
    cycleRepeat() {
      const order = ["off", "all", "one"];
      const cur = MP.Store.state.settings.repeat;
      const next = order[(order.indexOf(cur) + 1) % order.length];
      MP.Store.updateSettings({ repeat: next });
      this._setRepeatUI(next);
    },
    _setShuffleUI(on) {
      [this.els.btnShuffle, this.els.npBtnShuffle].forEach((b) => b && b.classList.toggle("is-on", on));
    },
    _setRepeatUI(mode) {
      const icon = mode === "one" ? "i-repeat-one" : "i-repeat";
      [this.els.btnRepeat, this.els.npBtnRepeat].forEach((b) => {
        if (!b) return;
        b.classList.toggle("is-on", mode !== "off");
        b.querySelector("use").setAttribute("href", "#" + icon);
      });
    },

    playNext(trackId) {
      if (!this.player.queue.length) { this.playContext([trackId], trackId); return; }
      this.player.queue.splice(this.player.index + 1, 0, trackId);
      if (!this.player.baseQueue.includes(trackId)) this.player.baseQueue.push(trackId);
      this.renderQueueList();
      this.toast("Added to up next");
    },
    removeFromQueueAt(i) {
      if (i === this.player.index) return;
      this.player.queue.splice(i, 1);
      if (i < this.player.index) this.player.index--;
      this.renderQueueList();
    },

    toggleLike(id) {
      const liked = MP.Store.toggleLike(id);
      this._refreshPlayingRows();
      if (id === this.player.currentId) this._setLikeCurrentUI(liked);
      return liked;
    },
    toggleLikeCurrent() {
      if (!this.player.currentId) return;
      this.toggleLike(this.player.currentId);
    },
    _setLikeCurrentUI(liked) {
      this.els.btnLikeCurrent.classList.toggle("is-liked", liked);
      this.els.btnLikeCurrent.querySelector("use").setAttribute("href", "#" + (liked ? "i-heart-fill" : "i-heart"));
    },

    _refreshPlayingRows() {
      document.querySelectorAll(".track-row").forEach((row) => {
        const id = row.dataset.id;
        const isCurrent = id === this.player.currentId;
        row.classList.toggle("is-playing", isCurrent);
        row.classList.toggle("is-paused", isCurrent && !MP.Audio.isPlaying());
        const likeBtn = row.querySelector(".track-like");
        if (likeBtn) {
          const liked = MP.Store.isLiked(id);
          likeBtn.classList.toggle("is-liked", liked);
          likeBtn.querySelector("use").setAttribute("href", "#" + (liked ? "i-heart-fill" : "i-heart"));
        }
      });
    },

    /* ================= NOW PLAYING UI ================= */
    updateNowPlayingUI() {
      const id = this.player.currentId;
      const t = MP.Store.getTrack(id);
      if (!t) return;
      document.title = t.title + " — " + t.artist + " · Wavelength";

      this.applyArt(this.els.playbarArt, id, { small: true });
      this.els.playbarTitle.textContent = t.title;
      this.els.playbarArtist.textContent = t.artist;
      this._setLikeCurrentUI(MP.Store.isLiked(id));

      this.applyArt(this.els.npArt, id, { big: true });
      this.els.npTitle.textContent = t.title;
      this.els.npArtist.textContent = t.artist;
      this.els.npAlbum.textContent = t.album || (t.sourceType === "url" ? "From a link" : "Single");
      const artUrl = MP.Library.getArtUrl(id);
      this.els.npBackdrop.style.backgroundImage = artUrl ? `url("${artUrl}")` : "none";
      this.els.npBackdrop.style.backgroundColor = artUrl ? "" : "#0a0e13";

      this.els.lyricsBox.value = MP.Store.getLyrics(id);
      this._renderDetails(t);
      this.renderQueueList();
    },

    _renderDetails(t) {
      const rows = [
        ["Title", t.title], ["Artist", t.artist], ["Album", t.album || "—"],
        ["Duration", t.duration ? formatTime(t.duration) : "—"],
        ["Source", t.sourceType === "url" ? "Link" : "Local file"],
        ["Plays", String(t.playCount || 0)]
      ];
      this.els.detailList.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`).join("");
    },

    renderQueueList() {
      const list = this.els.queueList;
      list.innerHTML = "";
      const upcoming = this.player.queue.slice(this.player.index + 1);
      if (!upcoming.length) { list.innerHTML = `<div class="queue-empty">Nothing queued next — songs from this list will play in order.</div>`; return; }
      upcoming.forEach((id, i) => {
        const t = MP.Store.getTrack(id);
        if (!t) return;
        const row = el("div", "queue-row");
        const art = el("div", "track-art");
        this.applyArt(art, id, { small: true });
        const meta = el("div", "queue-row-meta", `<span class="queue-row-title">${escapeHtml(t.title)}</span><span class="queue-row-artist">${escapeHtml(t.artist)}</span>`);
        const rm = el("button", "queue-row-remove"); rm.innerHTML = '<svg width="14" height="14"><use href="#i-x"/></svg>'; rm.setAttribute("aria-label", "Remove from queue");
        rm.addEventListener("click", (e) => { e.stopPropagation(); this.removeFromQueueAt(this.player.index + 1 + i); });
        row.appendChild(art); row.appendChild(meta); row.appendChild(rm);
        row.addEventListener("click", () => this.playTrackAt(this.player.index + 1 + i));
        list.appendChild(row);
      });
    },

    _setPlayIcon(playing) {
      const href = "#" + (playing ? "i-pause" : "i-play");
      [this.els.btnPlay, this.els.npBtnPlay].forEach((b) => b.querySelector("use").setAttribute("href", href));
      this._refreshPlayingRows();
    },

    _setVolumeUI(v) {
      const pct = Math.round(v * 100) + "%";
      this.els.volFill.style.width = pct;
      this.els.volHandle.style.left = pct;
      this.els.btnMute.querySelector("use").setAttribute("href", "#" + (v <= 0.001 ? "i-vol-mute" : "i-vol-high"));
    },

    /* ================= AUDIO EVENT SUBSCRIPTIONS ================= */
    _subscribeAudio() {
      const A = MP.Audio;
      A.on("timeupdate", ({ current, duration }) => {
        if (!this._draggingSeek) {
          const pct = duration ? (current / duration) * 100 : 0;
          this.els.seekFill.style.width = pct + "%";
          this.els.seekHandle.style.left = pct + "%";
          this.els.npSeekFill.style.width = pct + "%";
          this.els.npSeekHandle.style.left = pct + "%";
          this.els.timeCurrent.textContent = formatTime(current);
          this.els.npTimeCurrent.textContent = formatTime(current);
        }
        if (duration) {
          this.els.timeDuration.textContent = formatTime(duration);
          this.els.npTimeDuration.textContent = formatTime(duration);
        }
      });
      A.on("playstate", (playing) => this._setPlayIcon(playing));
      A.on("ended", () => {
        if (MP.Store.state.settings.repeat === "one") { this.playTrackAt(this.player.index); return; }
        this.next(false);
      });
      A.on("error", ({ message }) => {
        this.toast(message, "error");
        this._errorSkipCount++;
        if (this._errorSkipCount <= 5 && this.player.index + 1 < this.player.queue.length) this.next(false);
      });
      A.on("trackchange", () => { this._refreshPlayingRows(); });
    },

    /* ================= PLAYBAR WIRING ================= */
    _wirePlaybar() {
      this.els.btnPlay.addEventListener("click", () => MP.Audio.toggle());
      this.els.npBtnPlay.addEventListener("click", () => MP.Audio.toggle());
      this.els.btnNext.addEventListener("click", () => this.next(true));
      this.els.npBtnNext.addEventListener("click", () => this.next(true));
      this.els.btnPrev.addEventListener("click", () => this.prev());
      this.els.npBtnPrev.addEventListener("click", () => this.prev());
      this.els.btnShuffle.addEventListener("click", () => this.toggleShuffle());
      this.els.npBtnShuffle.addEventListener("click", () => this.toggleShuffle());
      this.els.btnRepeat.addEventListener("click", () => this.cycleRepeat());
      this.els.npBtnRepeat.addEventListener("click", () => this.cycleRepeat());
      this.els.btnLikeCurrent.addEventListener("click", () => this.toggleLikeCurrent());

      this._wireSeek(this.els.seekTrack, this.els.seekFill, this.els.seekHandle);
      this._wireSeek(this.els.npSeekTrack, this.els.npSeekFill, this.els.npSeekHandle);
      this._wireVolume();

      this.els.btnMute.addEventListener("click", () => {
        const s = MP.Store.state.settings;
        MP.Audio.setMuted(!s.muted);
        this._setVolumeUI(s.muted ? MP.Store.state.settings.volume : 0);
      });

      this.els.btnExpand.addEventListener("click", () => this.openNowPlaying());
      this.els.btnCollapse.addEventListener("click", () => this.closeNowPlaying());
      this.els.playbarTrack.addEventListener("click", () => this.openNowPlaying());

      this.els.btnQueueToggle.addEventListener("click", () => { this.openNowPlaying(); this._setTab("queue"); });
      this.els.btnTimer.addEventListener("click", () => this.openModal("modal-timer"));
    },

    _wireSeek(track, fill, handle) {
      const dur = () => MP.Audio.getDuration();
      const setFromEvent = (e, commit) => {
        const rect = track.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        fill.style.width = ratio * 100 + "%";
        handle.style.left = ratio * 100 + "%";
        if (commit && dur()) MP.Audio.seek(ratio * dur());
        return ratio;
      };
      track.addEventListener("pointerdown", (e) => {
        this._draggingSeek = true;
        track.classList.add("is-dragging");
        setFromEvent(e, false);
        const move = (ev) => setFromEvent(ev, false);
        const up = (ev) => {
          setFromEvent(ev, true);
          this._draggingSeek = false;
          track.classList.remove("is-dragging");
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
    },

    _wireVolume() {
      const track = this.els.volTrack;
      const setFromEvent = (e) => {
        const rect = track.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this._setVolumeUI(ratio);
        MP.Audio.setVolume(ratio);
      };
      track.addEventListener("pointerdown", (e) => {
        this._draggingVol = true;
        track.classList.add("is-dragging");
        setFromEvent(e);
        const move = (ev) => setFromEvent(ev);
        const up = () => {
          this._draggingVol = false;
          track.classList.remove("is-dragging");
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
    },

    /* ================= NOW PLAYING OVERLAY ================= */
    openNowPlaying() { this.els.nowPlayingOverlay.classList.remove("hidden"); },
    closeNowPlaying() { this.els.nowPlayingOverlay.classList.add("hidden"); },
    _wireNowPlaying() {
      document.querySelectorAll(".np-tab").forEach((tab) => {
        tab.addEventListener("click", () => this._setTab(tab.dataset.tab));
      });
      this.els.lyricsBox.addEventListener("change", () => {
        if (this.player.currentId) MP.Store.setLyrics(this.player.currentId, this.els.lyricsBox.value);
      });
      this.els.npBackdrop.parentElement.addEventListener("click", (e) => {
        if (e.target === this.els.npBackdrop || e.target.id === "now-playing-overlay") this.closeNowPlaying();
      });
    },
    _setTab(name) {
      document.querySelectorAll(".np-tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
      ["queue", "lyrics", "details"].forEach((n) => {
        const panel = $("np-panel-" + n);
        if (panel) panel.classList.toggle("hidden", n !== name);
      });
    },

    /* ================= GITHUB SYNC ================= */
    _wireGithubSync() {
      const openGithubModal = () => {
        const target = MP.RepoSync.activeTarget();
        this.els.ghOwner.value = (target && target.owner) || "";
        this.els.ghRepo.value = (target && target.repo) || "";
        this.els.ghAutosync.checked = MP.Store.state.settings.githubAutoSync !== false;
        this.openModal("modal-github");
      };
      this.els.btnSyncGithub.addEventListener("click", openGithubModal);
      this.els.btnEmptySyncGithub.addEventListener("click", openGithubModal);

      this.els.ghAutosync.addEventListener("change", () => {
        MP.Store.updateSettings({ githubAutoSync: this.els.ghAutosync.checked });
      });

      this.els.btnGhSync.addEventListener("click", () => {
        const owner = this.els.ghOwner.value.trim();
        const repo = this.els.ghRepo.value.trim();
        if (!owner || !repo) { this.els.ghStatus.textContent = "Enter both an owner and a repository name."; return; }
        MP.Store.updateSettings({ githubRepo: { owner, repo } });
        this._trySyncRepo(false, { owner, repo });
      });
    },

    async _trySyncRepo(silent, explicitTarget) {
      const target = explicitTarget || MP.RepoSync.activeTarget();
      if (!target) return; // not hosted on github.io and nothing configured — nothing to do
      if (silent && MP.Store.state.settings.githubAutoSync === false) return;

      if (this.els.ghStatus) this.els.ghStatus.textContent = `Syncing from ${target.owner}/${target.repo}…`;
      const checkingToast = !silent ? this.toast("Checking your repository…", "success", true) : null;

      try {
        const tree = await MP.RepoSync.fetchTree(target.owner, target.repo);
        const result = await MP.Library.ingestFromRepo(tree);
        if (checkingToast) this._dismissToast(checkingToast);

        if (result.audioFound === 0) {
          const msg = `No audio files found in ${target.owner}/${target.repo}/music. Push some, then sync again.`;
          if (this.els.ghStatus) this.els.ghStatus.textContent = msg;
          if (!silent) this.toast(msg, "error");
        } else {
          const msg = `Synced ${result.audioFound} song${result.audioFound === 1 ? "" : "s"} from ${target.owner}/${target.repo}`;
          let detail = "";
          if (result.imagesFound) detail += ` (+ ${result.imagesFound} cover image${result.imagesFound === 1 ? "" : "s"})`;
          if (result.removed) detail += ` · removed ${result.removed} no-longer-present track${result.removed === 1 ? "" : "s"}`;
          if (this.els.ghStatus) this.els.ghStatus.textContent = msg + detail + ".";
          this.toast(msg, "success");
          MP.Store.updateSettings({ githubRepo: { owner: target.owner, repo: target.repo } });
        }
        this.renderPlaylistSidebar();
        this.refreshCurrentView();
        this._refreshPlayingRows();
      } catch (e) {
        if (checkingToast) this._dismissToast(checkingToast);
        const msg = e && e.message ? e.message : "Couldn't sync from GitHub.";
        if (this.els.ghStatus) this.els.ghStatus.textContent = msg;
        if (!silent) this.toast(msg, "error");
        else console.warn("Wavelength: background GitHub sync failed —", msg);
      }
    },

    /* ================= ADD MUSIC ================= */
    _wireAddMusic() {
      this.els.btnAddFolder.addEventListener("click", () => this.els.inputFolder.click());
      this.els.btnEmptyAddFolder.addEventListener("click", () => this.els.inputFolder.click());
      this.els.btnReconnect.addEventListener("click", () => this.els.inputFolder.click());
      this.els.btnAddFiles.addEventListener("click", () => this.els.inputFiles.click());
      this.els.btnAddUrl.addEventListener("click", () => this.openModal("modal-url"));
      this.els.btnEmptyAddUrl.addEventListener("click", () => this.openModal("modal-url"));

      this.els.inputFolder.addEventListener("change", (e) => this._handleFileIngest(e.target.files));
      this.els.inputFiles.addEventListener("change", (e) => this._handleFileIngest(e.target.files));
    },

    async _handleFileIngest(fileList) {
      if (!fileList || !fileList.length) return;
      const t = this.toast("Adding songs…", "success", true);
      const before = new Set(MP.Store.state.order);
      const result = await MP.Library.ingestFiles(fileList);
      // reconnect: rematch art for previously-added file tracks now that images may be present
      MP.Store.state.order.forEach((id) => MP.Library.rematchArt(id));
      this._dismissToast(t);
      const newCount = result.added.filter((m) => !before.has(m.id)).length;
      const reconnectedCount = result.added.length - newCount;
      if (newCount || reconnectedCount) {
        let msg = "";
        if (newCount) msg += `Added ${newCount} song${newCount === 1 ? "" : "s"}`;
        if (reconnectedCount) msg += (msg ? " · " : "") + `reconnected ${reconnectedCount}`;
        this.toast(msg, "success");
      } else if (result.audioFound === 0) {
        this.toast("No audio files found in that selection.", "error");
      }
      this.els.reconnectBanner.classList.add("hidden");
      this.renderPlaylistSidebar();
      this.refreshCurrentView();
      this._refreshPlayingRows();
    },

    /* ================= TOPBAR ================= */
    _wireTopbar() {
      let searchTimer = null;
      this.els.globalSearch.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          if (this.view !== "search") this.switchView("search");
          else this.renderSearch(this.els.globalSearch.value);
        }, 150);
      });
      this.els.globalSearch.addEventListener("focus", () => { if (this.view !== "search" && this.els.globalSearch.value) this.switchView("search"); });

      this.els.btnEq.addEventListener("click", () => { this.renderEq(); this.openModal("modal-eq"); });
      this.els.btnNewPlaylist.addEventListener("click", () => { $("new-playlist-name").value = ""; this.openModal("modal-playlist"); });

      this.els.btnExport.addEventListener("click", () => this.exportLibrary());
      this.els.btnImport.addEventListener("click", () => this.els.inputImport.click());
      this.els.inputImport.addEventListener("change", (e) => this.importLibrary(e.target.files[0]));

      this.els.btnShuffleAll.addEventListener("click", () => {
        if (!MP.Store.state.settings.shuffle) this.toggleShuffle();
        this.playContext(MP.Store.state.order.slice(), null);
      });
      this.els.btnPlayAll.addEventListener("click", () => this.playContext(MP.Store.state.order.slice(), MP.Store.state.order[0]));
      this.els.btnPlayPlaylist.addEventListener("click", () => {
        const p = MP.Store.state.playlists[this.viewCtx];
        if (p && p.trackIds.length) this.playContext(p.trackIds.slice(), p.trackIds[0]);
      });
      this.els.btnDeletePlaylist.addEventListener("click", () => {
        const p = MP.Store.state.playlists[this.viewCtx];
        if (!p) return;
        this.confirm(`Delete "${p.name}"? This can't be undone.`, () => {
          MP.Store.deletePlaylist(p.id);
          this.renderPlaylistSidebar();
          this.switchView("home");
          this.toast("Playlist deleted");
        });
      });
      this.els.playlistTitle.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); this.els.playlistTitle.blur(); } });
      this.els.playlistTitle.addEventListener("blur", () => {
        const p = MP.Store.state.playlists[this.viewCtx];
        if (p) { MP.Store.renamePlaylist(p.id, this.els.playlistTitle.textContent); this.renderPlaylistSidebar(); }
      });
      this.els.btnPlayAlbum.addEventListener("click", () => {
        const ids = MP.Store.allTracks().filter((t) => (t.album || "").trim() === this.viewCtx).map((t) => t.id);
        if (ids.length) this.playContext(ids, ids[0]);
      });
      this.els.btnPlayArtist.addEventListener("click", () => {
        const ids = MP.Store.allTracks().filter((t) => (t.artist || "Unknown Artist") === this.viewCtx).map((t) => t.id);
        if (ids.length) this.playContext(ids, ids[0]);
      });
    },

    exportLibrary() {
      const blob = new Blob([MP.Store.exportJSON()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "wavelength-library.json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      this.toast("Library exported");
    },
    importLibrary(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          MP.Store.importJSON(reader.result);
          this.renderPlaylistSidebar();
          this.refreshCurrentView();
          this.toast("Library imported — reconnect your music folder to resume playback.", "success");
          this.els.reconnectBanner.classList.remove("hidden");
        } catch (e) { this.toast(e.message || "Couldn't import that file.", "error"); }
      };
      reader.readAsText(file);
    },

    /* ================= EQUALIZER ================= */
    renderEq() {
      const eq = MP.Store.state.settings.eq;
      this.els.eqEnabled.checked = eq.enabled;
      this.els.eqPresets.innerHTML = "";
      Object.keys(MP.Audio.presets).forEach((name) => {
        const chip = el("button", "chip" + (eq.preset === name ? " is-active" : ""), name.charAt(0).toUpperCase() + name.slice(1));
        chip.addEventListener("click", () => { MP.Audio.applyPreset(name); this.renderEq(); });
        this.els.eqPresets.appendChild(chip);
      });
      this.els.eqBands.innerHTML = "";
      MP.Audio.freqs.forEach((freq, i) => {
        const wrap = el("div", "eq-band");
        const val = el("span", "eq-band-val", (eq.bands[i] > 0 ? "+" : "") + eq.bands[i].toFixed(0));
        const input = document.createElement("input");
        input.type = "range"; input.min = -12; input.max = 12; input.step = 0.5; input.value = eq.bands[i];
        input.addEventListener("input", () => {
          const bands = MP.Store.state.settings.eq.bands.slice();
          bands[i] = parseFloat(input.value);
          MP.Audio.setEqBands(bands);
          val.textContent = (bands[i] > 0 ? "+" : "") + bands[i].toFixed(0);
          this._activePresetChipsOff();
        });
        const label = el("span", "eq-band-label", freq >= 1000 ? (freq / 1000) + "k" : freq);
        wrap.appendChild(val); wrap.appendChild(input); wrap.appendChild(label);
        this.els.eqBands.appendChild(wrap);
      });
    },
    _activePresetChipsOff() { this.els.eqPresets.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-active")); },

    /* ================= MODALS ================= */
    _wireModals() {
      this.els.modalBackdrop.addEventListener("click", () => this.closeModal());
      document.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", () => this.closeModal()));

      this.els.btnUrlSubmit.addEventListener("click", () => {
        const added = MP.Library.addFromUrls(this.els.urlAudio.value, {
          title: this.els.urlTitle.value.trim(), artist: this.els.urlArtist.value.trim(), artUrl: this.els.urlArt.value.trim()
        });
        if (added.length) {
          this.toast(`Added ${added.length} link${added.length === 1 ? "" : "s"}`, "success");
          ["urlAudio", "urlTitle", "urlArtist", "urlArt"].forEach((k) => (this.els[k].value = ""));
          this.closeModal();
          this.renderPlaylistSidebar();
          this.refreshCurrentView();
        } else {
          this.toast("Paste at least one valid http(s) link.", "error");
        }
      });

      this.els.btnPlaylistSubmit.addEventListener("click", () => {
        const name = this.els.newPlaylistName.value.trim();
        if (!name) { this.toast("Give the playlist a name.", "error"); return; }
        this.createPlaylistFlow(name);
        this.closeModal();
      });
      this.els.newPlaylistName.addEventListener("keydown", (e) => { if (e.key === "Enter") this.els.btnPlaylistSubmit.click(); });

      this.els.eqEnabled.addEventListener("change", () => MP.Audio.setEqEnabled(this.els.eqEnabled.checked));
      this.els.btnEqReset.addEventListener("click", () => { MP.Audio.applyPreset("flat"); this.renderEq(); });

      this.els.timerOptions.querySelectorAll(".chip").forEach((chip) => {
        chip.addEventListener("click", () => this.setSleepTimer(parseInt(chip.dataset.mins, 10)));
      });
      this.els.btnTimerCancel.addEventListener("click", () => this.clearSleepTimer());

      this.els.btnPickNewPlaylist.addEventListener("click", () => {
        this.closeModal();
        $("new-playlist-name").value = "";
        this.openModal("modal-playlist");
      });
    },

    openModal(id) {
      this.els.modalLayer.classList.remove("hidden");
      document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden"));
      $(id).classList.remove("hidden");
    },
    closeModal() { this.els.modalLayer.classList.add("hidden"); },

    confirm(message, onConfirm) {
      this.els.confirmMessage.textContent = message;
      this._modalOnConfirm = onConfirm;
      this.openModal("modal-confirm");
      this.els.btnConfirmOk.onclick = () => { this.closeModal(); if (this._modalOnConfirm) this._modalOnConfirm(); };
    },

    openAddToPlaylistModal(trackId) {
      const list = this.els.playlistPickList;
      list.innerHTML = "";
      if (!MP.Store.state.playlistOrder.length) {
        list.innerHTML = `<div class="queue-empty">No playlists yet — create one to get started.</div>`;
      }
      MP.Store.state.playlistOrder.forEach((id) => {
        const p = MP.Store.state.playlists[id];
        const row = el("div", "playlist-pick-row" + (p.trackIds.includes(trackId) ? " is-in" : ""));
        row.innerHTML = `<span>${escapeHtml(p.name)}</span><span class="check"><svg width="15" height="15"><use href="#i-check"/></svg></span>`;
        row.addEventListener("click", () => {
          if (p.trackIds.includes(trackId)) MP.Store.removeFromPlaylist(p.id, trackId);
          else MP.Store.addToPlaylist(p.id, trackId);
          this.openAddToPlaylistModal(trackId);
          this.renderPlaylistSidebar();
          if (this.view === "playlist") this.renderPlaylistDetail(this.viewCtx);
        });
        list.appendChild(row);
      });
      this.openModal("modal-add-to-playlist");
    },

    /* ================= SLEEP TIMER ================= */
    setSleepTimer(mins) {
      this.clearSleepTimer(true);
      this.els.timerOptions.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-active", parseInt(c.dataset.mins, 10) === mins));
      if (mins === 0) {
        this._sleepEndOfTrack = true;
        this.els.timerStatus.textContent = "Playback will stop at the end of this track.";
        return;
      }
      this._sleepEndsAt = Date.now() + mins * 60000;
      this._sleepTimer = setTimeout(() => { MP.Audio.pause(); this.toast("Sleep timer ended playback"); this.clearSleepTimer(); }, mins * 60000);
      this._tickSleepStatus();
    },
    _tickSleepStatus() {
      if (!this._sleepEndsAt) return;
      const remain = Math.max(0, this._sleepEndsAt - Date.now());
      if (remain <= 0) return;
      this.els.timerStatus.textContent = `Playback stops in ${Math.ceil(remain / 60000)} min.`;
      setTimeout(() => this._tickSleepStatus(), 15000);
    },
    clearSleepTimer(silent) {
      if (this._sleepTimer) clearTimeout(this._sleepTimer);
      this._sleepTimer = null; this._sleepEndsAt = null; this._sleepEndOfTrack = false;
      this.els.timerOptions.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-active"));
      if (!silent) this.els.timerStatus.textContent = "No timer set.";
    },

    moveInPlaylist(playlistId, trackId, dir) {
      const p = MP.Store.state.playlists[playlistId];
      if (!p) return;
      const idx = p.trackIds.indexOf(trackId);
      const newIdx = idx + dir;
      if (idx < 0 || newIdx < 0 || newIdx >= p.trackIds.length) return;
      const ids = p.trackIds.slice();
      const tmp = ids[idx]; ids[idx] = ids[newIdx]; ids[newIdx] = tmp;
      MP.Store.reorderPlaylist(playlistId, ids);
      this.renderPlaylistDetail(playlistId);
    },

    /* ================= CONTEXT MENU ================= */
    openTrackMenu(evt, trackId, playlistId) {
      evt.stopPropagation();
      const t = MP.Store.getTrack(trackId);
      if (!t) return;
      const liked = MP.Store.isLiked(trackId);
      const items = [
        { label: "Play", icon: "i-play", onClick: () => this.playContext([trackId], trackId) },
        { label: "Play next", icon: "i-queue", onClick: () => this.playNext(trackId) },
        { label: liked ? "Remove from Favorites" : "Add to Favorites", icon: liked ? "i-heart-fill" : "i-heart", onClick: () => this.toggleLike(trackId) },
        { label: "Add to playlist", icon: "i-plus", onClick: () => this.openAddToPlaylistModal(trackId) }
      ];
      if (t.album) items.push({ label: "Go to album", icon: "i-note", onClick: () => this.openAlbum(t.album) });
      items.push({ label: "Go to artist", icon: "i-note", onClick: () => this.openArtist(t.artist) });
      if (playlistId) {
        items.push({ label: "Move up", icon: "i-chev-up", onClick: () => this.moveInPlaylist(playlistId, trackId, -1) });
        items.push({ label: "Move down", icon: "i-chev-down", onClick: () => this.moveInPlaylist(playlistId, trackId, 1) });
        items.push({ label: "Remove from playlist", icon: "i-x", onClick: () => { MP.Store.removeFromPlaylist(playlistId, trackId); this.renderPlaylistDetail(playlistId); this.renderPlaylistSidebar(); } });
      }
      items.push({ sep: true });
      items.push({
        label: "Delete from library", icon: "i-trash", danger: true, onClick: () => {
          this.confirm(`Remove "${t.title}" from your library?`, () => {
            const wasCurrent = trackId === this.player.currentId;
            MP.Library.forget(trackId);
            MP.Store.removeTrack(trackId);
            this.player.baseQueue = this.player.baseQueue.filter((id) => id !== trackId);
            this.player.queue = this.player.queue.filter((id) => id !== trackId);
            if (wasCurrent) { MP.Audio.pause(); this.player.currentId = null; }
            this.player.index = this.player.queue.indexOf(this.player.currentId);
            this.refreshCurrentView();
            this.renderPlaylistSidebar();
            this.renderQueueList();
            this.toast("Removed from library");
          });
        }
      });
      this._buildContextMenu(evt.clientX, evt.clientY, items);
    },

    _buildContextMenu(x, y, items) {
      const menu = this.els.contextMenu;
      menu.innerHTML = "";
      items.forEach((it) => {
        if (it.sep) { menu.appendChild(el("div", "ctx-sep")); return; }
        const btn = el("button", "ctx-item" + (it.danger ? " danger" : ""));
        btn.innerHTML = `<svg width="15" height="15"><use href="#${it.icon}"/></svg><span>${escapeHtml(it.label)}</span>`;
        btn.addEventListener("click", () => { this._hideContextMenu(); it.onClick(); });
        menu.appendChild(btn);
      });
      menu.classList.remove("hidden");
      const vw = window.innerWidth, vh = window.innerHeight;
      requestAnimationFrame(() => {
        const r = menu.getBoundingClientRect();
        menu.style.left = Math.min(x, vw - r.width - 10) + "px";
        menu.style.top = Math.min(y, vh - r.height - 10) + "px";
      });
    },
    _hideContextMenu() { this.els.contextMenu.classList.add("hidden"); },
    _wireContextMenuDismiss() {
      document.addEventListener("click", (e) => { if (!this.els.contextMenu.contains(e.target)) this._hideContextMenu(); });
      document.addEventListener("scroll", () => this._hideContextMenu(), true);
    },

    /* ================= TOASTS ================= */
    toast(message, type, sticky) {
      const t = el("div", "toast" + (type === "error" ? " toast--error" : " toast--success"));
      const icon = type === "error" ? "i-x" : "i-check";
      t.innerHTML = `<svg width="15" height="15"><use href="#${icon}"/></svg><span>${escapeHtml(message)}</span>`;
      this.els.toastStack.appendChild(t);
      if (!sticky) setTimeout(() => this._dismissToast(t), 3200);
      return t;
    },
    _dismissToast(t) { if (t && t.parentElement) t.parentElement.removeChild(t); },

    /* ================= DRAG & DROP ================= */
    _wireDragDrop() {
      let depth = 0;
      window.addEventListener("dragenter", (e) => {
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
        depth++; this.els.dropzoneOverlay.classList.remove("hidden");
      });
      window.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (depth === 0) this.els.dropzoneOverlay.classList.add("hidden"); });
      window.addEventListener("dragover", (e) => e.preventDefault());
      window.addEventListener("drop", async (e) => {
        e.preventDefault();
        depth = 0;
        this.els.dropzoneOverlay.classList.add("hidden");
        if (!e.dataTransfer) return;
        const files = await this._filesFromDataTransfer(e.dataTransfer);
        if (files.length) this._handleFileIngest(files);
      });
    },
    async _filesFromDataTransfer(dt) {
      const items = dt.items ? Array.from(dt.items) : null;
      if (!items || !items[0] || !items[0].webkitGetAsEntry) return Array.from(dt.files || []);
      const entries = items.map((it) => it.webkitGetAsEntry()).filter(Boolean);
      if (!entries.length) return Array.from(dt.files || []);
      const out = [];
      const walk = (entry, path) => new Promise((resolve) => {
        if (entry.isFile) {
          entry.file((f) => { try { Object.defineProperty(f, "webkitRelativePath", { value: path + f.name }); } catch (e) {} out.push(f); resolve(); }, () => resolve());
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          reader.readEntries((ents) => Promise.all(ents.map((en) => walk(en, path + entry.name + "/"))).then(resolve), () => resolve());
        } else resolve();
      });
      await Promise.all(entries.map((en) => walk(en, "")));
      return out.length ? out : Array.from(dt.files || []);
    },

    /* ================= KEYBOARD ================= */
    _wireKeyboard() {
      document.addEventListener("keydown", (e) => {
        const tag = (e.target && e.target.tagName || "").toLowerCase();
        const typing = tag === "input" || tag === "textarea" || e.target.isContentEditable;
        if (e.key === "?" && !typing) { e.preventDefault(); this.openModal("modal-shortcuts"); return; }
        if (typing) return;
        switch (e.key) {
          case " ": e.preventDefault(); MP.Audio.toggle(); break;
          case "ArrowLeft": MP.Audio.seekBy(-5); break;
          case "ArrowRight": MP.Audio.seekBy(5); break;
          case "ArrowUp": e.preventDefault(); this._nudgeVolume(0.05); break;
          case "ArrowDown": e.preventDefault(); this._nudgeVolume(-0.05); break;
          case "n": case "N": this.next(true); break;
          case "p": case "P": this.prev(); break;
          case "s": case "S": this.toggleShuffle(); break;
          case "r": case "R": this.cycleRepeat(); break;
          case "l": case "L": this.toggleLikeCurrent(); break;
          case "/": e.preventDefault(); this.els.globalSearch.focus(); break;
          case "Escape": this.closeNowPlaying(); this.closeModal(); this._hideContextMenu(); break;
        }
      });
    },
    _nudgeVolume(delta) {
      const cur = MP.Store.state.settings.muted ? 0 : MP.Store.state.settings.volume;
      const next = Math.max(0, Math.min(1, cur + delta));
      MP.Audio.setVolume(next);
      this._setVolumeUI(next);
    },

    /* ================= ENRICHMENT CALLBACK ================= */
    onTrackEnriched(id) {
      this._refreshPlayingRows();
      if (id === this.player.currentId) this.updateNowPlayingUI();
      // lightweight re-render of any view showing this track's text/art
      this.refreshCurrentView();
      this.renderPlaylistSidebar();
    }
  };

  global.MP = global.MP || {};
  global.MP.UI = UI;
})(window);
