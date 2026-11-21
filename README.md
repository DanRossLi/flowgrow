# Flowgrow

An ecology and nature building game on a hex grid, made for a phone. Tiles arrive in a pile and you place them on an island near your river. Two habitats of the same level combine into the next level, and river tiles let you place tiles further from the river. It began on Nov 19, 2026 as a test inside [Flow Tile](https://github.com/DanRossLi/flowtile) and has had its own repo since Nov 20.

**Play:** https://danrossli.github.io/flowgrow/

Plain HTML/JS, no build step, no framework, and nothing loaded from other sites. It is a quick prototype: what is left out is listed in CANON.md under "Not built yet".

## How to play

- Tiles arrive in a **pile**. The large tile is the one in hand, and the next 3 are shown beside it. Tap the island to place it.
- A **habitat** is planted on empty land within reach of your river (the green land), or put on a habitat of the **same level**, which then goes up one level. A different level is never allowed. **Bare ground takes level 1 only** (LOU-300; Dan, Nov 20: "let's implement level 1 only on bare ground"): a higher habitat is planted and lands as level 1, scoring 1 (`bareGroundMode: "downgrade"`, the setting since Dan asked to play test it on Nov 20), or it can only combine onto a habitat of its own level, or be discarded (`"refuse"`). Both settings are in `flowgrow.config.js`.
- There are **15 levels** (Dan, Nov 20: "uncap the tiles max to 15"). The first seven are Sprouts, Meadow, Thicket, Saplings, Grove, Forest and Old forest; the rest are just Level 8 to Level 15 until they are named. A move scores by the level it leaves on the map: 1, 3, 6, 10, 15, 21, 28, then 36, 45, 55, 66, 78, 91, 105 and 120.
- There are **three kinds of habitat** to begin with (Dan, Nov 20: "add a yellow tile for "grasslands" and then add a turquoise tile for "marsh""): the original **green** one, **Prairie** (yellow; Dan first said grasslands, then "make yellow like 'prairie'") and **Marsh** (turquoise). All three have the same 15 levels, points and locking, and a habitat is dealt as any of them. A tile only combines with a habitat of its **own kind** and level, and a lock's copies keep the kind of the tile they were copied from. `prairieShare`, `marshShare` and `biomeMatch` in `flowgrow.config.js` set how many are dealt and whether the kind has to match. Each kind has a job (LOU-301). **Marsh must touch the river** (Dan: "turquoise represents marsh and must be adjacent to a river"): it is only planted on empty land that shares an edge with a river tile. **Prairie spreads** (Dan: "Yes, grass can be placed to adjacent grass tiles event if not in the water zone, good idea"): it can also be planted on empty land that shares an edge with another prairie habitat, even outside the river's reach. Green follows the river's reach. `marshNeedsRiver` and `prairieSpreads` switch the two rules. A **fourth kind**, **Trees** (deep green), came with LOU-302 (Dan: "should we have a 'deep green' tile which is trees? And what special should this have?", then "I like overgrow"): a tree is **never planted on bare ground**, and instead **overgrows a habitat of the same level, of any kind**, turning it into a tree habitat one level up (and scoring the points for the new level). The tile loses its old kind, so an overgrown prairie tile no longer lets prairie spread and an overgrown marsh tile is no longer marsh. A tree onto a tree of its own level combines as usual, a locked habitat can't be overgrown, and a tree with nothing to grow over can only be discarded. After the opening (which has no tree), 20% of the dealt habitats are trees (`treeShare`); `overgrow: false` makes trees play like green habitats.
- **Upgrades** (LOU-303, built in three parts; Dan: "Make it level 4", "Let's make it an upgrade...and then also should it be an aesthetic difference as well?"): at level 4 (`upgradeLevel`; 0 for none) a marsh, prairie or trees habitat gains an upgrade, a power that also shows in its look. So far (LOU-304) only the marsh has one, the **reed bed**: a marsh habitat of level 4 or higher counts as river bank, so marsh can also be planted on empty land touching it, one tile further inland (it lands as level 1). It is worked out from the tile's kind and level, so nothing is saved for it, and it is lost if a tree overgrows the tile. A reed bed has a pale rim and three small reeds on it (reeds along its edge in the painted look); tap one that can't take your tile and the toast says what it does. The prairie's and the trees' follow below (LOU-305, LOU-306).
- **The pick** (LOU-305; Dan: "At level 4 one of the upgrades can be \"spreader\"...", "call the ability steppe", "make it \"meadow\" and it adds the score of neighboring marsh and trees as a multiplier"): when a **prairie** habitat reaches level 4 a card asks you to choose **Steppe** (each time it levels up, a free level 1 prairie is planted beside it, `steppePerLevel` of them) or **Meadow** (each time it levels up, the points are multiplied by 1 + the marsh and trees beside it, up to `meadowMax`). You choose before the next move, the choice is permanent and is a move of its own, undo takes it back with the combine that led to it, and a lock's copy keeps it. The steppe has a red-orange rim and a seed-head fan, the meadow a magenta rim and a flower.
- **Trees' roots and pine-oneer** (LOU-306; Dan: "I like roots...put no cap on it, allow chain reaction for combos", "call it pine-oneer....like for pine trees"): a **tree** habitat that reaches level 4 also asks you to choose, **Roots** or **Pine-oneer**. Each time a roots tree levels up, **every lower habitat beside it rises a level for free** and scores like a combine (`rootsPerLevel` limits how many), and a tile that rises counts as levelling up too, so a lifted steppe plants its tile, a lifted meadow multiplies the rise and a lifted roots tree lifts its own neighbours (`rootsChain`): a chain that always ends, since a tile only rises while it is lower than the tree lifting it. **Trees can be planted on empty land next to a pine-oneer**, as level 1, even outside the river's reach. Roots has a tan rim and curling roots, pine-oneer a mint rim and a small pine.
- A **river tile** put on empty land that touches the river makes the river longer (that scores nothing). Put it on a river tile of its **own level** and it raises that tile a level, like a habitat, for the points of the new level (**rivers level up**, Dan, Nov 20: "make rivers also level up, just as points make the "width" max 2"). A river tile can reach level 15, but **the width stops at 2**: level 1 reaches 1 tile out and every level from 2 up reaches 2. `riverMaxLevel` and `riverScore` in `flowgrow.config.js` set the top level and what scores (`2` and `"none"` are the first build's rivers). **Rivers rise downstream** (Dan, Nov 20): a river tile can't be lower than the river tile it flows from, so a river is widened from its end back towards the source. Widen the source first and no later level 1 river tile can go anywhere.
- **Discard** throws the tile in hand away. **Undo** steps back as far as you like. A run has 20 tiles, with no timer and no way to lose.
- **The pilot pile** (Dan, Nov 20): you start with just **20 tiles** (10 until Dan asked to "expand starting tiles to 20" the same day), **all level 1**, and nothing higher is ever dealt. A tile only goes on a habitat of its own level, so the pile alone can take a habitat to level 2 and no further. Level 3 and up come only from the copies a lock banks, so the loop (place, combine, lock, place the copies) is the challenge. The first five tiles are green, green, river, prairie, marsh. After that a tile is a river tile one time in ten, and a habitat is prairie three times in ten, marsh three times in ten and green otherwise. `stackSize: 80`, `levelOdds: 0.5` and `lockEvery: 10` in `flowgrow.config.js` bring back the first build's game.
- **Locking** (LOU-299): there is **no limit on locks** (Dan, Nov 20): lock as many tiles as you like, as often as you like. Tap **Lock**, tap a tile and confirm. Each neighbour at that tile's level or below is copied to the back of your pile, and the locked tile can't grow any more. The run ends when the pile is empty and no lock would bank a copy, or when you tap **End run**.
- Every number is in `flowgrow.config.js`. Add `?seed=123` to the address to replay the same pile.

## Two looks

- **Simple** (the page opens on it, for piloting): flat hexes seen from above. **Blue** tiles are the river and **green**, **yellow** (prairie), **turquoise** (marsh) and **deep green** (trees) tiles are habitats. Every kind gets darker with each level, with a gold rim from level 8 and a second one from level 12. Every one carries its level as a **number**. Empty land the river reaches is pale green, land it doesn't reach is off-white, mountains are grey, and the source has a white ring. A locked tile carries a padlock. A gold ring marks a tile you can combine with (and its points), a teal ring a river tile you can raise a level, and a dashed blue ring land the river can extend onto.
- **Painted:** the first look, a hand-painted tilted island with seven kinds of habitat.

The rules, the pile, locking and the saved run are the same in both. Switch with **Look** in the menu (it remembers your choice, and you can switch in the middle of a run), or add `?look=simple` or `?look=painted` to the address for one visit.

## Run it

Open `index.html` in a browser, or serve the folder to try the service worker too:

```bash
python -m http.server
```

then go to http://localhost:8000/.

## Check it

- `node tools/flowgrow-sim.mjs --test` runs the rule checks. All must pass. They use fixed first-build values (80 tiles, level odds 0.5), so tuning `flowgrow.config.js` never breaks them.
- `node tools/flowgrow-sim.mjs` plays 1,000 runs of the game in `flowgrow.config.js` (the pilot pile with unlimited locks now; add `stackSize=80 levelOdds=0.5 lockEvery=10` for the first build's game), with the game's own rules. No run may crash, stall or fail to rebuild from its seed and moves. With unlimited locks a run is about 300 moves, so the 1,000 runs take a few minutes: ask for fewer (node tools/flowgrow-sim.mjs 200) when you only want a quick check. Run it with `lockEnabled=false` and `lockEvery=0` as well, for example `node tools/flowgrow-sim.mjs 300 lockEvery=0`. Any config value can be changed as `key=value`.
- Play one whole run in a browser at 390×844.

## Search it

Three developer tools (plain Node, no packages) find out how high a set of rules lets scores go, so a rule idea can be tested before it is built into the game:

- `node tools/flowgrow-search.mjs --workers 8 --seconds 300` looks for the highest score on one seed with the game's own rules. Any config value can be changed on the command line as `key=value`, to try a rule without editing the config, for example `node tools/flowgrow-search.mjs maxLevel=7 riverMonotone=false`. It saves the best run to `search-best.json`.
- `node tools/flowgrow-analyze.mjs search-best.json` replays a saved run and says where its points came from (planted or combined, copies or dealt tiles), which tiles were locked and what the island looks like at the end.
- `node --experimental-websocket tools/flowgrow-replay.mjs search-best.json` plays a saved run in the real page (it needs Chrome) and checks that the page scores the same. The page plays by its own rules, so it only accepts runs found under them.

To test a rule: give it a config switch, search with it on and with it off, and compare the best score, where the points come from, and how many locks and moves it takes. The default seed, 495454692, is the run Dan pasted on Nov 20 (47 by hand).

## Deploy

GitHub Pages, by the workflow in `.github/workflows/pages.yml`, on every push to `main`. A push isn't live until that run succeeds: check `gh run list --limit 3`, then fetch a live file that the commit changed. If the run fails within seconds with "No artifacts named github-pages were found", `gh run rerun <run id>` fixes it (a glitch on GitHub's side); if the rerun fails the same way, `gh workflow run "Deploy to GitHub Pages"` starts a fresh run. Bump `VERSION` in `sw.js` whenever a cached file changes, and add new files to its `LOCAL` list.

## Saved data

Flowgrow shares its address (`danrossli.github.io`) with Flow Tile, so everything it keeps is named for it: browser storage keys start with `flowgrow.` (the best score, kept per ruleset, and the run in progress) and its cache is `flowgrow-vN`. It never reads or clears anything of Flow Tile's, apart from carrying a best score and a run in progress saved before the move (`flowtile.flowgrow.`) across once.

## Credits

- Typeface: M PLUS Rounded 1c (latin), by Coji Morishita and the M+ Fonts Project, under the SIL Open Font License 1.1, hosted in `fonts/`.
- The hex grid, the painting, the camera and `play.css` were copied from [Flow Tile](https://github.com/DanRossLi/flowtile). The app icons are Flow Tile's drop, as stand-ins.
