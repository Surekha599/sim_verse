# SimVerse

> **Every simulation your syllabus needs — in one place.**

SimVerse is a single, curated index of interactive simulations for **Class 9–12
Physics, Chemistry, Mathematics and Biology**. Instead of hunting across many
websites, a teacher or student picks **Class → Subject → Chapter → Topic** and
opens the exact simulation — each link opens on the original platform
(PhET, OLabs, DIKSHA, LabXchange, GeoGebra, CK‑12, JavLab, Concord, Khan Academy, …).

Built as a pure front-end platform: no server, no database, no build step needed
to run it. The entire library is compiled into one `data.js` that the app ships
with, so it works offline, on GitHub Pages, Netlify, Vercel, a school intranet —
anywhere static files can live.

---

## What's inside

| | |
|---|---|
| **Grades** | Class 9, 10, 11, 12 |
| **Subjects** | Physics · Chemistry · Mathematics · Biology |
| **Chapters** | 170 (kept in syllabus order) |
| **Topics** | 1,370 |
| **Simulation links** | 1,163 across 14 platforms |
| **Coming soon** | 641 topics without a good simulation yet — shown with an honest "we're working on it" state plus a rotating quote |

### Features

- **Guided navigation** — Class → Subject → Chapter → Topic, exactly as you described.
- **Platform labelling** — every simulation chip shows the platform it opens on; links open in a new tab on the original site.
- **Global search** — `Ctrl+K` (or `/`) command palette with ranked, highlighted results across every class and subject, plus deep links like `#/class/10/physics/0?t=3`.
- **Coverage at a glance** — each class/subject/chapter card shows how many topics already have a simulation.
- **Coming-soon states** — topics without a simulation get a warm, designed "we're on it" panel, and every chapter ends with a rotating motivational quote.
- **Progress tracking** — every simulation you open is recorded *in your browser only* (localStorage), with a per-subject progress dashboard and a "recently opened" list.
- **Filters** — on any chapter: *All topics / Has simulation / Coming soon*.
- **Platforms directory** — all 14 sources with link counts.
- Fully responsive, keyboard friendly, zero runtime dependencies.

---

## Run it

```bash
# from the simverse/ folder
python3 -m http.server 8000
# open http://localhost:8000
```

Or just double-click **`standalone/simverse.html`** — a single self-contained
file (~470 KB) with the app + full dataset baked in.

To host online, upload the folder (or the standalone file) to GitHub Pages,
Netlify, Vercel, or any static host.

## Project layout

```
simverse/
├── index.html            # app shell
├── css/styles.css        # design system (dark science-tech, glass panels)
├── js/app.js             # router, search, views, progress, palette
├── js/quotes.js          # the "we're working on it" quote bank (edit freely)
├── data/data.js          # generated dataset (do not edit by hand)
├── build/
│   ├── etl.py            # spreadsheet → data.js compiler
│   ├── bundle.py         # builds standalone/simverse.html
│   ├── e2e.py            # headless-browser smoke test (191 routes)
│   └── *.xlsx            # the four source sheets (frozen copies)
└── standalone/simverse.html
```

## Refreshing the library from your Google Sheets

`build/etl.py` reads the four source workbooks (kept as `.xlsx` copies in
`build/`). To pull fresh data:

```bash
# 1. re-download each sheet (File → Download → .xlsx), replacing the files in build/
#    physics.xlsx chemistry.xlsx maths.xlsx biology.xlsx
# 2. rebuild the dataset + the single-file build
python3 build/etl.py && python3 build/bundle.py
```

The ETL normalises everything the source sheets contain:
per-tab platform columns, hidden hyperlinked cells, merged chapter cells,
scheme-less URLs, note-only entries ("app based only", "only for ipad"), and the
Chemistry `Activity` numbering (kept as small topic codes).

## Put it on GitHub (2 minutes)

1. On github.com click **New repository**, name it `simverse`, tick *Add a README* **off**, click *Create repository*.
2. On the empty-repo page click **uploading an existing file**, drop in everything from this folder (or unzip `SimVerse-GitHub.zip` first), then *Commit changes*.
3. Optional — free hosting: **Settings → Pages → Deploy from a branch → `main` / root → Save**.
   Your site then lives at `https://<your-username>.github.io/simverse/`.

## Tests

```bash
python3 -m http.server 8791 --bind 127.0.0.1 &   # one-time
python3 build/e2e.py          # walks all 191 routes in real Chromium
```

---

All simulation content belongs to its original creators; SimVerse only indexes
and organises the links.
