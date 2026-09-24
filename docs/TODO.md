# TODO

Parked 2026-09-24. Each item says why it matters and what is already known.

## Map and places (OpenFreeMap)

- **Fallback to VersaTiles when OpenFreeMap is down.** OpenFreeMap is one
  person on donations. VersaTiles (European, NLnet-funded) carries the same
  places with the same OSM ids — measured: the same 23 playgrounds within
  1 km of the Munich test point — so badges keep matching. Needs a second
  style URL and a small adapter in `placesInView`: layer `pois` instead of
  `poi`, field `leisure` instead of `class`. Colours to retune to match the
  green Positron.
- **Cap the tile cache.** The service worker keeps every tile it sees, with
  no limit. A dense-city vector tile is about 130 KB, so months of use can
  reach tens of MB on the phone. Cap by count or age.
- **Vendor MapLibre and the Leaflet plugin** (and Leaflet itself) instead
  of loading them from unpkg on every launch — an outside dependency for an
  app meant to work offline.
- **Private playgrounds.** The tiles carry no `access` tag, so private
  playgrounds are shown. Options: sort by logic (a playground inside a
  school, Kita or hospital area caught 3 of 8 in the test), user
  contribution, and fixing the tags in OSM itself.

## Sounds

- **Preload or not.** A sound plays offline once it has been played online.
  Preloading the 8 sounds the two cars use would cost about 1.8 MB at
  install — against the cheapest-phone principle. Decide.
- **Sound size.** `motor-v8-dodge-charger-243223.mp3` alone is 762 KB.
  Shorter clips or a lower bitrate would cut most of it.

## Cars and tags (see LAYOUT.md)

- One folder per car model: `public/vrooom/cars/<id>/car.json` plus its
  files.
- Read `?car=<id>` on launch and select that car; make the in-app scan use
  the same path.
- Rewrite the prototype tag (it still points to Ha-ouais with
  `?config=conf-vroom.json`).
- Installation explanation for the packaging (iPhone especially).

## Routing

- "Walk there" uses the Valhalla demo server at `valhalla1.openstreetmap.de`,
  which receives the exact position and destination, and is meant for light
  use. Needs a decision like the one made for places.
