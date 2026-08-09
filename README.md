# Wavelength — a music player for your own songs

A single web app for the music you already have. No install, no
account, no backend to run. It works two ways — pick whichever fits:

- **Locally** — open `index.html` straight from your computer.
- **Hosted on GitHub Pages** — push it to a repo with `music/` and
  `pictures/` folders, and it plays automatically for anyone who
  visits, no button-clicking required. This is the fix for the
  "can't connect to music folder" problem: that error only ever meant
  the app was falling back to the local-file picker, which needs
  re-selecting every visit and was never meant for a hosted site.
  Repo syncing is a separate, proper path built for exactly that case.

## Option A — Host it on GitHub Pages (recommended if you're sharing a link)

1. Create a repo (or use the one you already have) and push these
   files to it, keeping the folder structure intact.
2. Put your songs in the `music/` folder and matching cover art in
   `pictures/` — subfolders are fine, e.g. `music/Artist/Album/Song.mp3`.
3. In the repo's **Settings → Pages**, set it to deploy from your
   default branch (root). The included `.nojekyll` file is important —
   keep it at the repo root. It tells GitHub Pages to serve your files
   as-is instead of running them through Jekyll, which is what
   silently mangles asset folders on plain static sites.
4. Visit `https://<your-username>.github.io/<repo-name>/`. Wavelength
   detects it's running on GitHub Pages, reads your repo's file list,
   and loads every song and matching cover automatically — on every
   visit, for every visitor. Nothing to reconnect, ever, because
   nothing is local — it's all just URLs.
5. Adding more songs later is just: drop files in `music/`/`pictures/`,
   commit, push. Refresh the page and they're there. No rebuild step.

**On a custom domain instead of `*.github.io`?** Auto-detection can't
work off the hostname alone. Click **Sync from GitHub** in the sidebar
and type in the owner and repo name once — it's remembered after that.

**Repo must be public.** The sync uses GitHub's public API, which
doesn't support private repos without a login flow this app doesn't
implement. If your code is currently private, either make it public
or keep the songs in a separate public repo and point Sync at that one.

**Rate limits:** GitHub allows 60 unauthenticated API calls per hour
per visitor IP, and each page load uses 2. This is a non-issue for
normal personal use; if you're testing by refreshing rapidly you can
occasionally hit it — the app just shows a "try again shortly" message
and keeps whatever was already loaded.

## Option B — Run it locally, no hosting at all

1. Open `index.html` in Chrome, Edge, or another Chromium-based
   browser.
2. Click **Add music folder** and choose a folder — e.g. one
   containing a `music/` folder of songs and a `pictures/` folder of
   cover art. Or use **Add files**, or drag audio/image files onto the
   window.
3. Click **Add from link** for anything hosted elsewhere — paste a
   direct audio URL, optionally with a title, artist, and cover URL.

Locally-added files use your browser's file picker, which browsers
don't allow a webpage to keep access to between visits — that's a
deliberate privacy protection, not a bug. Reopen the app and click
**Add music folder** again to reconnect; everything about your
library (titles, play counts, likes, playlists) is preserved and just
re-links to the files. This is *only* true of local files — anything
added by link or synced from GitHub needs no reconnecting, ever.

## Matching cover art to songs

A song and image pair up automatically if they share a file name
(`Sunset Drive.mp3` ↔ `Sunset Drive.jpg`), or if a generically-named
image (`cover.jpg`, `folder.jpg`, `album.jpg`, `artwork.jpg`) sits
next to the song. This works the same way whether the pairing is
between local `music/`+`pictures/` folders or their GitHub-hosted
equivalents. Embedded ID3 cover art is used directly when present.
Anything left over gets a clean, generated cover instead of a broken
image icon.

## Features

- Library, Favorites, Search, Albums, Artists, and custom Playlists
- Queue with reordering (move up/down from a track's menu), "play
  next," shuffle, and repeat (off / all / one)
- A short crossfade between manual track changes — skipping never
  clicks or pops
- A 6-band equalizer with presets (Bass, Vocal, Treble, Rock, Pop,
  Electronic) plus manual bands, saved between sessions
- A radial, audio-reactive visualizer in the expanded Now Playing view
- Per-song lyrics box (typed/pasted, saved locally — Wavelength never
  fetches lyrics from the web)
- Sleep timer, keyboard shortcuts (press **?** in the app), and a
  library export/import (JSON) for backing up playlists and likes

## Browser support

Local folder selection uses the `webkitdirectory` API — Chrome, Edge,
Opera, and Brave support it fully; Firefox and Safari can still add
music via **Add files** or drag-and-drop. GitHub sync just uses
`fetch()` and works everywhere. The equalizer, crossfade, and
visualizer use the Web Audio API, supported by every modern browser.

## Privacy

Everything runs client-side. Local files are never uploaded anywhere.
Network requests are: your two fonts, the GitHub API/raw-content calls
if you use repo sync, and whatever URL you explicitly add under "Add
from link." All fail silently and the app keeps working if you're
offline — the tag-reading library is bundled locally rather than
pulled from a CDN, so even ID3 tag reading works with no internet
connection at all.

## Folder structure

```
wavelength/
├── .nojekyll                  keep this at the repo root for GitHub Pages
├── index.html
├── css/styles.css
├── js/store.js                 persistence + state
├── js/library.js                file & link ingestion, art matching
├── js/repo.js                    GitHub repo auto-discovery & sync
├── js/audio.js                    playback engine, crossfade, equalizer
├── js/visualizer.js                the radial now-playing visualizer
├── js/vendor/jsmediatags.min.js     ID3 tag reading (bundled, not CDN-loaded)
├── js/ui.js                          everything on screen
├── js/app.js                          startup
├── music/                              put your songs here
└── pictures/                            put your cover art here
```

Enjoy.
