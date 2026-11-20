# Flowgrow

An ecology and nature building game on a hex grid, made for a phone. Tiles arrive in a pile and you place them on an island near your river. Two habitats of the same level combine into the next level, and river tiles let you place tiles further from the river. It began on Nov 19, 2026 as a test inside [Flow Tile](https://github.com/DanRossLi/flowtile) and has had its own repo since Nov 20.

**Play:** https://danrossli.github.io/flowgrow/

Plain HTML/JS, no build step, no framework, and nothing loaded from other sites. It is a quick prototype: what is left out is listed in CANON.md under "Not built yet".

## How to play

- Tiles arrive in a **pile**. The large tile is the one in hand, and the next 3 are shown beside it. Tap the island to place it.
- A **habitat** is planted on empty land within reach of your river (the green land), or put on a habitat of the **same level**, which then goes up one level. A different level is never allowed.
- The seven levels are Sprouts, Meadow, Thicket, Saplings, Grove, Forest and Old forest. A move scores by the level it leaves on the map: 1, 3, 6, 10, 15, 21, 28.
- A **river tile** scores nothing. Put it on empty land that touches the river to make the river longer, or on a level 1 river tile to make it wider. A wider river reaches 2 tiles out instead of 1.
- **Discard** throws the tile in hand away. **Undo** steps back as far as you like. A run has 80 tiles, with no timer and no way to lose.
- **Locking** (LOU-299): every 10 tiles you place earns a lock, and you can hold one. Tap **Lock**, tap a tile and confirm. Each neighbour at that tile's level or below is copied to the back of your pile, and the locked tile can't grow any more. The run ends when the pile is empty and no lock you hold would bank a copy.
- Every number is in `flowgrow.config.js`. Add `?seed=123` to the address to replay the same pile.

## Two looks

- **Simple** (the page opens on it, for piloting): flat hexes seen from above. **Blue** tiles are the river (a darker blue once it is level 2, the widest) and **green** tiles are habitats (darker with each level). Every one carries its level as a **number**. Empty land the river reaches is pale green, land it doesn't reach is off-white, mountains are grey, and the source has a white ring. A locked tile carries a padlock. A gold ring marks a tile you can combine with (and its points), a teal ring a river tile you can widen, and a dashed blue ring land the river can extend onto.
- **Painted:** the first look, a hand-painted tilted island with seven kinds of habitat.

The rules, the pile, locking and the saved run are the same in both. Switch with **Look** in the menu (it remembers your choice, and you can switch in the middle of a run), or add `?look=simple` or `?look=painted` to the address for one visit.

## Run it

Open `index.html` in a browser, or serve the folder to try the service worker too:

```bash
python -m http.server
```

then go to http://localhost:8000/.

## Check it

- `node tools/flowgrow-sim.mjs --test` runs the rule checks. All must pass.
- `node tools/flowgrow-sim.mjs` plays 1,000 runs with the game's own rules. No run may crash, stall or fail to rebuild from its seed and moves. Run it with `lockEnabled=false` and `lockEvery=0` as well, for example `node tools/flowgrow-sim.mjs 300 lockEvery=0`. Any config value can be changed as `key=value`.
- Play one whole run in a browser at 390×844.

## Deploy

GitHub Pages, by the workflow in `.github/workflows/pages.yml`, on every push to `main`. A push isn't live until that run succeeds: check `gh run list --limit 3`, then fetch a live file that the commit changed. If the run fails within seconds with "No artifacts named github-pages were found", `gh run rerun <run id>` fixes it (a glitch on GitHub's side). Bump `VERSION` in `sw.js` whenever a cached file changes, and add new files to its `LOCAL` list.

## Saved data

Flowgrow shares its address (`danrossli.github.io`) with Flow Tile, so everything it keeps is named for it: browser storage keys start with `flowgrow.` (the best score, the run in progress) and its cache is `flowgrow-vN`. It never reads or clears anything of Flow Tile's, apart from carrying a best score and a run in progress saved before the move (`flowtile.flowgrow.`) across once.

## Credits

- Typeface: M PLUS Rounded 1c (latin), by Coji Morishita and the M+ Fonts Project, under the SIL Open Font License 1.1, hosted in `fonts/`.
- The hex grid, the painting, the camera and `play.css` were copied from [Flow Tile](https://github.com/DanRossLi/flowtile). The app icons are Flow Tile's drop, as stand-ins.
