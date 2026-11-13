# Dr. Deas Virtual Library

A walk-through library for the [reading log](https://github.com/DrDeas/DrDeasBookLog): 1,000 books in 1,000 weeks.

The building is a round tower with a ramp spiralling up its wall. Books stand face-out along the ramp in the order they were read, fifteen to a bay, so walking up is walking forward in time. The tower is sized for all 1,000 books; the bays past the latest one are empty and waiting.

Open `index.html` through GitHub Pages (or any web server — it will not run from a `file://` path).

## Adding books

Nothing needs doing here. The library reads `data.js` straight from the DrDeasBookLog repository each time it opens, so a book added to the log appears on the wall automatically, along with its cover.

Optionally, after adding a batch of books, refresh the saved copies so the first load stays fast:

```bash
cd tools
```

```bash
npm install
```

```bash
npm run sync
```

That rewrites three things, which you then commit:

- `data.js` – the copy of the book list used only if the log cannot be reached
- `covers/atlas-*.webp` – sheets of cover thumbnails (70 per sheet), so 400 covers arrive in six requests rather than 400
- `covers/atlas.json` – the index of which cover is where

Books that are not on a sheet yet are fetched one at a time when the page opens, so skipping this step only costs a little loading time for the newest books.

## Getting around

| | |
|---|---|
| Look | drag |
| Walk | `W` `A` `S` `D` or arrow keys; `Shift` to hurry |
| Follow the ramp | hold `Space` (up) or `C` (down) |
| Open a book | click its cover; `←` `→` step through the log, `Esc` closes |
| Jump | search box, or click the bar along the bottom |
| Back to the entrance | `R` |

Phones get an on-screen stick and ramp buttons. Headsets get an **Enter VR** button: left stick walks, right stick turns and follows the ramp, trigger opens the book you point at.

Two address-bar options are handy for trying things out: `?hour=21` sets the time of day (the sky otherwise follows your clock), and `?quality=low` or `?quality=high` overrides the automatic choice between the full and the lighter version.

## Where things are

| | |
|---|---|
| `index.html`, `styles.css` | the page and its interface |
| `js/config.js` | the tower's dimensions and the challenge dates |
| `js/architecture.js`, `js/garden.js`, `js/sky.js` | the building, the atrium garden, the sky |
| `js/bookwall.js` | the covers on the wall |
| `js/signage.js` | challenge tracker, clock, quotations, year markers |
| `js/player.js`, `js/ui.js`, `js/xr.js` | movement, interface, headset support |
| `vendor/three/` | [three.js](https://threejs.org) r187 (MIT), bundled so the site has no outside dependencies |
| `tools/` | the sync script described above |
