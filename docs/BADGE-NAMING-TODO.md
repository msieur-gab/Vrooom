# Badge naming & place identity — open task

Logged 2026-09-22. Not blocking the print/sync work, but it shapes what the print
sheet can show.

## Symptom

Many badges are captioned `Playground` / `Park` / `Swimming Pool` instead of a real
name, so several distinct badges look identical on the printed sheet.

## Cause 1 — no name in OSM, and no fallback is attempted

`js/services/checkin.js:137`

```js
const displayName = place.name || friendlyType(place.type);
```

The only source is OSM `tags.name`. Most `leisure=playground` elements are unnamed,
so the generic string is the common case, not an edge case. Nothing else is tried —
`operator`, `addr:street`, or the name of an enclosing park are all available in
Overpass and currently ignored.

## Cause 2 — the name is frozen at first visit

The display name is snapshotted into the `check_ins` row at check-in time.
`js/services/badge.js:80` resolves a badge title via `checkIns.find(...)`, i.e. the
first matching visit. If OSM later gains a name, existing badges keep the old
generic one. Any fix must decide: repair history, or apply going forward only?

## Cause 3 — place identity is a coarse coordinate grid (this one is a bug)

`js/services/checkin.js:25`

```js
function placeKey(type, lat, lon) {
  return `${type}_${lat.toFixed(3)}_${lon.toFixed(3)}`;
}
```

Three decimals is a cell of roughly 110 m x 75 m at mid-latitudes.

- **Merge:** two different playgrounds in the same cell collapse into one badge.
  Plausible spacing in a dense city.
- **Split (worse):** the key is derived from the OSM element centroid. If a park's
  polygon is edited in OSM and the centroid crosses a rounding boundary, the
  placeKey changes, the same park becomes a *second* badge, and the visit history
  is split across both — which also silently breaks the 10x regular-visitor badge.

## Strategy options (undecided)

- **The kid names the place.** When OSM has no name, ask once at check-in. Better
  names than OSM, and an invented name is not a lookup key, so it sidesteps the
  fingerprinting concern. Cost: a prompt at exactly the moment the phone should go
  back in the pocket.
- **Blank write-in caption.** Badge prints with a dotted line; the place is written
  by hand into the passport. Zero transmission, zero prompt, works regardless of
  OSM coverage.
- **Exhaust OSM first.** Fall back through `name` -> enclosing park name ->
  `operator` -> `addr:street` before the generic string.
- **Date anchor.** "Playground, 12 July" — distinguishes badges and anchors a
  memory without naming a location.

Independently of the choice above, Cause 3 should be fixed: place identity wants a
stable id (OSM `type/id`, e.g. `way/12345`) rather than rounded coordinates, with a
migration for existing keys.
