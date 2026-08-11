/* ============================================================
   WAVELENGTH — repo.js
   For sites hosted straight from a GitHub repo (GitHub Pages or
   otherwise): finds music/ and pictures/ in the repo's file tree
   via the GitHub API and turns them into playable tracks served
   from raw.githubusercontent.com — plain URLs that work on every
   visit for every visitor, no local file picking or "reconnect"
   step required.
   ============================================================ */
(function (global) {
  "use strict";

  const AUDIO_RE = /^music\/.+\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i;
  const IMAGE_RE = /^pictures\/.+\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i;

  async function fetchJson(url) {
    const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) {
      const err = new Error(
        res.status === 403 ? "GitHub API rate limit reached — try again in a bit."
        : res.status === 404 ? "Repository or branch not found."
        : "GitHub API error (" + res.status + ")."
      );
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  const RepoSync = {
    /** Best-effort guess of {owner, repo} from a *.github.io URL. Null if not applicable. */
    detectFromLocation() {
      const host = global.location.hostname;
      const m = /^([a-z0-9-]+)\.github\.io$/i.exec(host);
      if (!m) return null;
      const owner = m[1];
      const segments = global.location.pathname.split("/").filter(Boolean);
      // Project pages (owner.github.io/repo/...) put the repo name first in the path;
      // user/org pages (owner.github.io) serve straight from the owner.github.io repo.
      const repo = segments.length ? segments[0] : (owner + ".github.io");
      return { owner, repo };
    },

    /** owner/repo the app should sync from: an explicit saved choice wins over auto-detection. */
    activeTarget() {
      const saved = MP.Store.state.settings.githubRepo;
      if (saved && saved.owner && saved.repo) return saved;
      return this.detectFromLocation();
    },

    /** Fetches the repo's full file tree and returns music/picture entries with playable raw URLs. */
    async fetchTree(owner, repo) {
      const repoInfo = await fetchJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
      const branch = repoInfo.default_branch || "main";
      const treeRes = await fetchJson(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`
      );
      const entries = (treeRes.tree || []).filter((e) => e.type === "blob");
      const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/`;
      const musicFiles = entries.filter((e) => AUDIO_RE.test(e.path)).map((e) => ({ path: e.path, url: rawBase + e.path.split("/").map(encodeURIComponent).join("/") }));
      const pictureFiles = entries.filter((e) => IMAGE_RE.test(e.path)).map((e) => ({ path: e.path, url: rawBase + e.path.split("/").map(encodeURIComponent).join("/") }));
      if (treeRes.truncated) console.warn("Wavelength: this repository's file list is very large — some files may have been skipped.");
      return { owner, repo, branch, musicFiles, pictureFiles };
    }
  };

  global.MP = global.MP || {};
  global.MP.RepoSync = RepoSync;
})(window);
