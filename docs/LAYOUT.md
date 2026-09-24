# Layout, addresses and the tag contract

Written 2026-09-24. What was decided, what was applied, and what is left.

## The idea behind it

The website is the door; each toy's app sits behind it and is reached by
the toy's NFC tag. Vrooom is the first toy. Others may follow on the same
site — a cooking app, *miam*, where a scan reveals a recipe the way a
Vrooom check-in reveals a badge. So the site belongs to the family of
toys, and each toy gets its own app folder.

## The folders (applied)

```
Vrooom/
├── public/                  ← the ONLY folder uploaded to Netlify
│   ├── index.html           website home
│   ├── connect.html         badge printing page (QR pairing)
│   ├── css/ vendor/ icon.svg    the website's own files
│   ├── shared/              code the website AND an app both use
│   ├── vrooom/              the cars app — a PWA of its own
│   ├── netlify.toml  package.json  netlify/functions/   the badge relay
├── server/php/              the same relay for OVH, not deployed to Netlify
├── tools/                   test pages, never deployed (tools/fixtures: sample data)
├── docs/                    notes and TODOs
└── design/                  source artwork no code uses (badges/*.svg)
```

`public/` keeps the shape the dragged folder always had — `netlify.toml`
with `publish = "."`, `package.json` and `netlify/functions/` at its root —
so the relay function deploys exactly as before.

**Local development:** serve `public/` as the root, like Netlify does:

```
python3 -m http.server 8000 -d public
```

The site is then at `http://localhost:8000/`, the app at
`http://localhost:8000/vrooom/` (`?at=lat,lon` still fakes the position).
Test pages in `tools/` open from the repository root instead;
`tools/viewer-dev.html` carries a `<base href="../public/vrooom/">` so it
loads the real app files.

## Addresses

| Address | What | Who arrives |
|---|---|---|
| `/` | the website | anyone |
| `/connect.html` | badge printing, QR pairing | the parent at a computer |
| `/vrooom/` | the cars app | through the car's NFC tag, or a link on the site |
| `/api/session` | the badge relay | the app and the connect page |
| `/miam/` (future) | the cooking app | its own tags |

Each app folder is its own PWA: its own manifest, service worker, icon on
the phone, offline cache and data. Installing one never touches another.

## `shared/` — kept small on purpose

Holds only what at least two parties use today: `badge-svg.js`, `escape.js`,
`milestones.js`, `config.js` (the relay path). The rule it makes visible:
**touching `shared/` means checking the website and every app.** Nothing
moves there "in case" — every shared file is an obligation to two sides.

## The tag contract (decided, not yet built)

A tag is written into the wood for life, so it carries a promise, not a
path:

```
https://<domain>/vrooom/?car=vroom
```

- `car` is a short stable id (`vroom`, `grree`), never a file path. The
  old Ha-ouais tags carried `?config=conf-vroom.json` — a file name in the
  wood, broken the day that file moves. Not supported: the only tagged car
  is a prototype and will be rewritten.
- The app owns everything behind the id, one folder per model:
  `vrooom/cars/<id>/car.json` plus that car's models and sounds; sounds
  common to all cars in `vrooom/sounds/`. Adding a model = adding a folder.
- On launch the app reads `?car=` and selects that car. The in-app scan
  (Android) reads the same URL and does the same — one mechanism, not two.
- Manual car selection stays in the app for everyone.

## iPhone (decided)

iPhones cannot read NFC from a web page and do not open links in an
installed PWA, and Safari and the installed PWA keep separate storage.
Decision: **iPhone users are invited to install the PWA**, with a short
explanation printed on the car's packaging. The same URL serves every
phone. On iPhone the tag is for discovery and installation; afterwards
the child opens Vrooom from the home screen and picks the car. (These iOS
rules held in recent years — verify against current iOS before relying on
a detail.)

## Deferred

- **A redirect layer for tags** (`/t/vroom` → `/vrooom/?car=vroom` in
  `_redirects`), so tags never contain an app folder name. Right idea, but
  it waits for a fixed domain; during testing tags point straight at the
  app.
- **The domain.** The most permanent decision of all — it is on every tag.
  For a family of toys, a workshop domain with Vrooom and Miam as sections
  outlives a `vrooom.*` one.

## Migration

None. The only user is Gab, who exports his test data and badges, clears
the old site data (or uninstalls the PWA), and starts fresh at `/vrooom/`.
