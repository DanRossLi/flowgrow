# Flowgrow canon

These are the instructions Dan has given for this project, kept in one place. They are settled. **Don't change, undo or "improve" any of them on your own**: if something here seems wrong, or a task would break it, ask Dan first. Add each new instruction here as Dan gives it, and mark one that a later instruction replaces as superseded instead of deleting it.

Flowgrow began on Nov 19, 2026 as a test page inside the Flow Tile repo and moved to this repo on Nov 20 (see "The move to its own repo"). Flow Tile's own canon still holds Dan's instructions for the river game; they don't apply here unless this file repeats them. Everything Dan said about Flowgrow is carried over below.

## How to work

*Carried over from Flow Tile's canon on Nov 20, where these rules governed Flowgrow's work. Only the Linear names changed.*

1. **Source of work:** Linear, workspace *loudega*, initiative **Flowgrow**, project **Flowgrow Prototype**. Read the initiative description first. It holds the game rules and the working rules.
2. **Order:** take the highest-priority unblocked issue, one at a time, strictly in priority order.
3. **Per issue:** follow these steps.
   - Move it to In Progress.
   - Read the issue, its Agent notes and any attached documents.
   - Do the work, commit with the issue ID in the message, and push.
   - Check every "Done when" item.
   - Add the GitHub Pages URL as a link, comment a short summary of what changed, and move the issue to Done.
4. **Pausing between issues:** at first Dan asked to stop and check in before each next issue. Later Dan said "execute overnight" (Nov 10) and then "check linear and do all tickets related to flowtile" (Nov 10). When Dan asks for a batch like that, work through the whole batch without stopping.
5. **Plain HTML/JS, no build step.** No bundlers, no package.json, no SST.
6. **Ask, don't guess.** If anything needs Dan's decision, ask Dan. Examples are making the repo public, gh auth, hosting, or a rule the issue leaves open.
7. **Quick questions first:** when Dan says to ask questions before going to bed, ask them all at once at the start, then work without stopping.
8. **Linear tracking:** make one issue per piece of new work.
   - **Issue limit** (Dan, Nov 11: "Keep using spec issues"): the workspace is at Linear's free-plan issue limit, so don't create new issues. Track each piece of work on the spec or Idea issue it builds (comment, link, status) instead.

## Hosting

- **Repo:** GitHub repo `DanRossLi/flowgrow`, public, with GitHub Pages (Dan, Nov 20: "yes public with pages").
- **Site:** GitHub Pages at https://danrossli.github.io/flowgrow/, from `main`, by the workflow in `.github/workflows/pages.yml`. The game's page is the site's `index.html`.
- **Cache:** bump `VERSION` in `sw.js` whenever cached files change, and add new files to its `LOCAL` list.
- **Nothing from other sites** (LOU-293 in Flow Tile): fonts, scripts and images are all hosted with the game.

## Flowgrow (experimental)

A new test, tracked in Linear under the initiative **Flowgrow**, project **Flowgrow Prototype** (LOU-297 to LOU-299). It is an ecology and nature building game on Flow Tile's hex grid. Tiles arrive in a pile, you place them near your river, two tiles of the same level combine into the next level, and river tiles grow the land you can use. It is not part of the river game: Flow Tile has its own repo and canon.

- ~~**Standalone:** one page at `/flowgrow/` with its own files: `flowgrow/index.html`, `flowgrow.js`, `flowgrow.css`, `flowgrow.config.js` and `tools/flowgrow-sim.mjs`. It is listed under Test maps on All islands. `/city-test/` only sends visitors to `/flowgrow/`.~~ *Superseded Nov 20 by "The move to its own repo" below: the page is now the site's `index.html` in this repo, and Flow Tile's `/flowgrow/` and `/city-test/` only point on to it.*
- ~~**Don't edit the river game for it** (Dan, Nov 19: "First off we do not want remove the old stuff, this is a new test."): not `play.js`, `play.css`, `paper.css`, `settings.js`, `levels.js`, `solutions.js`, `tools/solve.mjs` or any existing map page. The only shared files it touches are `sw.js` (the `LOCAL` list and `VERSION`), `world/index.html` (the Test maps line), `README.md` and this file. `play.js` starts the river game as soon as it loads, so what the page needs from it is copied into `flowgrow.js`. The page links `play.css` for its bars and sheets.~~ *Superseded Nov 20: Flowgrow has its own repo, so it shares no file with the river game, and Flow Tile's repo holds none of it. Dan's quote stays as the record.*
- **Work rule:** take the issues in Flowgrow Prototype in priority order, and don't create new issues.
- **Rules and placeholders stay apart:** only Dan's quotes below are settled. Everything else fills a gap so the test can be played, and is listed under "Open for Dan".

### Rules Dan has set (Nov 19, in his words)

1. "this is going to be a hex based additive game, we're going to get tiles that need to be placed. for example dorfromantik, there will be a tile queue. players can then add tiles to the map."
2. "Tiles can be "additive" / "combined". only if they're the same level. for example lvl 1 + lvl 1. you cannot add a tile that are different levels."
3. ~~"we want this to be a peaceful city builder."~~ *Superseded the same day:* "just checking, it's not a city game, it's an ecology nature building game."
4. "make the scoring +1, +3, +6, +10....as tiles are added."
5. "Rivers also need to be placed, this expands how far out you can place your tile from your river."
6. "you 'lock a tile', this will add all the tiles that are adjacent to your pile. but afterwards that tile becomes 'locked' and you cannot improve it. Likewise locked tiles cannot be added to your pile when you lock an adjacent tile."
7. "a locked tile can only copy up to that level" and "it's a yes/no on copies, it's not the reduced level"
8. "copies. copies arrive at back of pile"
9. "river tiles can be locked and copied"

Also from Dan: "take the existing hexagon and aesthetics", and "this will be a web based game".

### Other instructions from Dan (Nov 19)

- **No city build:** "ignore that patch, as it's using "city" design rather than our eco/nature design". The first build was a city builder, kept in a patch file. The patch was never applied and LOU-297 was canceled. Flowgrow was built from the build spec directly as a nature game. Nothing man-made is on the page: no buildings, and no city words.
- **The pile is easy to find:** Dan asked "where's the tile pile?" when it was a small row of pictures between the buttons. So the pile now runs across the whole bottom in its own panel, labelled **Your pile**, front to back: the tile in hand (large, ringed, and named: "In hand: Sprouts (level 1)"), the next 3 tiles, a stack with the count still to come ("+76 more"), then the copies banked by locks ("Back of the pile"). Menu, Lock, Discard and Undo sit in a row under it, and Lock, Discard and Undo carry their word.
- **A quick prototype first:** "make the build faster" and "just make a quick MVP to prototype". So the page is a lean build. What it leaves out is listed under "Not built yet". Don't add polish to it unless Dan asks.

### Instructions from Dan (Nov 20)

- **Own repo** (Dan: "make a new repo, call it "flowgrow" this way it doesn't conflict with flowtile (old). move the flowgrow stuff there"): Flowgrow lives in this repo, `DanRossLi/flowgrow`. Flow Tile's repo (`DanRossLi/flowtile`, "flowtile (old)") no longer holds any of it. What the move did is under "The move to its own repo".
- **Simple look for piloting** (Dan: "to pilot/test create a simplier version of the game graphically and just have basic blue tile for water and green tiles, then have a number on them, the locking mechanism. this will let us test the basics"): a second look for the same game, built the same day. See "The simple look, as built". The painted look stays.
- **Pilot pile** (Dan: "make starting tiles only level 1 and have 10 tiles only, which makes the loop the challenge"): the pile is 10 tiles and every tile dealt is level 1, so higher levels can only come from combining and from the copies a lock banks. See "The pilot pile, as built".
- **No lock limit** (Dan: "there is no lock limit, a user can lock as many times as they want"): locks are free and unlimited, so `lockEvery` is 0 in the config. See "No lock limit, as built".
- **Rivers rise downstream** (Dan: "make a new rule such that all river tiles must be equal or greater than the river tile "behind it" i.e. rivers must always be greater on the way down"): `riverMonotone: true` in the config. See "The river rule, as built".

### The move to its own repo (Nov 20)

- **Where things are now:** the page is the site's `index.html` (https://danrossli.github.io/flowgrow/). `flowgrow.js`, `flowgrow.css` and `flowgrow.config.js` sit beside it, the simulator is `tools/flowgrow-sim.mjs`, and the check screenshots are in `tools/checks/`.
- **Copies from Flow Tile,** because the page uses them: `play.css` (whole, with a header saying where it is from), `fonts/` and the three icons. Nothing else.
- **Nothing is shared with Flow Tile any more:** this repo has its own `manifest.webmanifest`, its own `sw.js` (caches named `flowgrow-vN`; it only ever deletes caches that start with `flowgrow-`) and its own saved data (keys start with `flowgrow.`: the best score and the run in progress). Both sites share one address (`danrossli.github.io`), which is why the names matter. On first load the game carries across a best score and a run in progress saved before the move (`flowtile.flowgrow.`), once.
- **What Flow Tile keeps:** `/flowgrow/` and `/city-test/` there are pages that point on to the new site. Its CANON.md marks its Flowgrow section as moved and keeps it as the record. Its README and Test maps line no longer list Flowgrow.
- **History:** this repo starts with one commit, the Flowgrow files as they were in Flow Tile at `7f58a99`, with only the changes the move needs (paths, no links to Flow Tile's home, the saved-data names). The earlier history (`5c6477f`, `efcac91`, `b4518f9`, `7f58a99`) stays in Flow Tile's git log.

### The simple look, as built (Nov 20)

- **What it shows:** flat hexes seen from above. A **blue** tile is a river tile (the source too) and a **green** tile is a habitat, and each carries its level as a **number**. A river tile is level 1, or the darker blue level 2; habitat levels 1 to 7 run from light to dark green. **The locking mechanism is all there:** the Lock button, lock mode with the copies each tile would bank, the confirm card, a padlock on every locked tile, and the banked copies at the back of the pile, drawn in the same blue and green.
- **Everything else is the same game:** the rules, the pile, the buttons, scoring, undo, saving and the seeded piles. Part 1 of `flowgrow.js` (the rules) was not edited. Only the picture of the island, the pictures of tiles in the pile and the menu's seven levels, the tap-to-tile maths and the camera's bounds know about the look. The painted look is unchanged and is still in the game.
- **Choosing a look:** the page opens on the simple look. The menu's Look row switches to the painted look and back, in the middle of a run, and remembers the choice on the device; `?look=painted` or `?look=simple` picks one for a single visit.

### The pilot pile, as built (Nov 20)

- **What changed:** two numbers in `flowgrow.config.js`: `stackSize` 80 to 10 and `levelOdds` 0.5 to 0. With `levelOdds: 0` the deal only ever picks level 1, whatever is on the map. Nothing else in the rules changed, and the first build's game is a few values away: `stackSize: 80`, `levelOdds: 0.5` and, since Nov 20, `lockEvery: 10` (the simulator takes them as `stackSize=80 levelOdds=0.5 lockEvery=10` and gives the first build's numbers exactly).
- **The pile:** 10 tiles, all level 1. The first three are always habitat 1, habitat 1, river, and each of the other seven is a river tile one time in ten (a river tile always arrives at level 1 too).
- **Why the loop is the challenge:** a tile only goes on a habitat of its own level, so with only level 1 dealt the pile can take a habitat from level 1 to level 2 and no further. Level 3 and up can only come from the copies a lock banks.
- **The best score is kept per ruleset** (every number that changes how a run plays: the map, the pile, the odds, the lock values), so scores from different rules never meet (it was per pile until Nov 20). A run saved before a change is replayed under the new rules, or dropped if its moves no longer fit.

### No lock limit, as built (Nov 20)

- **What changed:** `lockEvery` 10 to 0 in `flowgrow.config.js`. A lock is always at hand, the Lock button shows ∞ and no "next in", and `lockHold` is not used. The first build's pacing is one value away: `lockEvery: 10` with `lockHold: 1`.
- **What still limits the loop:** a tile can be locked once, and a locked tile can't be copied, combined onto, widened or locked again, so the loop runs out when no unlocked tile has a copyable neighbour. The run then ends by itself, or when you tap **End run**.
- **What it does:** `node tools/flowgrow-sim.mjs` reported about 47 points for its simple player (before the river rule) over about 300 moves and 77 locks. That player locks whichever tile banks the most copies, river tiles included, so the river spreads over most of the island and scores nothing. A player who locks only habitats stops by itself after 2 to 3 locks and about 20 moves, with 47 to 57 points (best 64), against 29 to 35 with one lock.

### The river rule, as built (Nov 20)

- **The rule:** a river tile can't be lower than the river tile behind it, the one it flows from (the one it is drawn joined to). So a new river tile must be at least as high as the tile it joins, and a tile can only be widened once every tile that joins it is already that high. Equal is allowed, and each branch is checked against its own tile. River copies from locks follow the same rule.
- **What it means in play:** a river is widened from its end back towards the source, never the other way round. If the source is widened first, every later level 1 river tile has no move at all (nothing can follow a level 2 tile at level 1, and no level 1 tile is left to widen), so they are only good for the discard button.
- **Where it is:** `riverMonotone` in `flowgrow.config.js` (`false` is the first build's rule). In the rules part of `flowgrow.js`: `options()` decides what can go where and `why()` gives the reason when a tile can't. The simulator's rule checks stay on the first build's values (`riverMonotone: false`), and 8 new checks cover the rule.

### What is built (LOU-298)

- **Words:** a tile is a **habitat** or a **river tile**. Putting a habitat on empty land is **planting**. Two habitats of the same level **combine**. A river tile **extends** the river or **widens** it. The **pile** is the tiles still to come, and the large one is the tile **in hand**.
- **A turn:** tap a tile on the island and the tile in hand goes there. One tap, no confirm. A tile that can't go there gets a one-line message that says why.
- **Screen:** Score, Tiles left and Top level at the top. ~~Menu, the pile (the tile in hand large, the next 3 small), Discard and Undo at the bottom.~~ *Changed Nov 19, see "The pile is easy to find" below.* Land the tile in hand can be planted on has a faint outline. A habitat it can combine with has a ring and its points ("+6"). A river tile it can widen has a ring that says "wider".
- **The seven levels** are painted with the river game's own tree, shrub and flower painters, each bigger and taller than the one before. Every habitat carries a white pill with its level, on the island and in the pile.
- **The land shows reach:** land within reach of the river is grass, and land outside it is bare ground.
- **A run** is its seed and its moves. Undo, saving and reload all rebuild it from those, so a tile is never re-rolled. A finished run is never restored, and a run older than 12 hours starts fresh. Add `?seed=123` to the address to replay the same pile.
- **The rules sit apart from the page:** part 1 of `flowgrow.js` is plain functions that never touch the page, and `tools/flowgrow-sim.mjs` loads that same file in Node.

### Locking, as built (LOU-299)

- **What can be locked:** any unlocked habitat or river tile, the source included (it counts as a level 1 river tile).
- **What a lock copies:** each neighbour that is an unlocked habitat or river tile at or below the locked tile's level. A higher neighbour gives nothing ("it's a yes/no on copies"). Empty land, mountains and locked tiles give nothing. A copy is exact: the neighbour's kind at its full level. The original stays on the map.
- **Where copies go:** to the back of the pile, behind every tile still to be dealt and behind copies banked earlier. They are kept as their own list, and "Tiles left" counts them.
- **A locked tile** can't be combined onto, widened, locked again or copied. It keeps its score and still counts as the top level for dealing.
- **Copies play like dealt tiles,** with the same rules and the same scoring. A level 2 river copy can only extend, and it reaches 2 tiles out.
- **Screen:** a **Lock** button in the bottom bar shows the locks held and the tiles until the next one (since Nov 20 there is no lock limit, so it shows ∞). Tapping it turns lock mode on, and tapping it again turns it off. In lock mode every lockable tile shows how many copies it would bank. Tapping one marks each copy on its neighbour, marks neighbours that are too high, and a card above the bar asks to confirm ("Lock this thicket?"). A locked habitat gets a padlock on its level pill and is painted a little muted. At the back of the pile panel, **Back of the pile** lists the banked copies in order.
- **A lock is a move:** it can be undone, it is saved, and it has a line in the run log. The log marks each placed tile as dealt or copy. The result adds locks used and lost, and copies banked, placed and discarded, with the points from copies.
- **The six lock values** are in `flowgrow.config.js`: `lockEnabled`, `lockLevelCap`, `lockCopiesGo`, `lockRivers`, `lockEvery`, `lockHold`. With `lockEnabled: false` the game plays exactly as it did before locking.

### Open for Dan (placeholders, not rules)

- ~~**Lock pacing:** one lock for every 10 tiles placed (planted, combined, extended or widened; discards don't count), and only one can be held. A lock earned while holding one is lost.~~ *Superseded Nov 20: Dan said there is no lock limit (see "No lock limit, as built"). It is still how `lockEvery: 10` and `lockHold: 1` work, if either comes back.*
- **A lock doesn't use the tile in hand.**
- **Order of copies from one lock:** river tiles first, then habitats from the lowest level to the highest.
- **A locked river tile** still reaches land, and the river can still be extended from it. It is marked with a padlock pill on the tile.
- **End of a run with locking:** it no longer ends when the pile's tiles are used up (80 in the first build, 10 now). It ends when the pile is empty and no lock you hold would bank a copy, or when you tap **End run** (shown once the pile is empty).
- **An endless pile has no back,** so with `stackSize: 0` copies become the next tiles instead.
- ~~**With no lock held,** the Lock button only says when the next one comes ("No lock yet. Next one in 4 tiles.").~~ *Moot since Nov 20: with no lock limit there is always a lock to use.*
- **With the pile empty and a lock in hand,** lock mode turns on by itself.

- **Score by level:** a move scores by the level of the habitat it leaves on the map: 1, 3, 6, 10, 15, 21, 28. So a level 1 tile put on a level 1 habitat scores 3. River tiles score nothing.
- **Where higher levels come from:** ~~the pile deals them. A habitat's level is rolled from 1 up to the highest level on the map at that moment, and each level is half as likely as the one below.~~ *Superseded Nov 20 by Dan's pilot pile: the pile only deals level 1, so higher levels come only from combining and from lock copies.* One tile in ten is a river tile. The first three tiles are always habitat 1, habitat 1, river.
- **One kind of habitat,** levels 1 to 7: Sprouts, Meadow, Thicket, Saplings, Grove, Forest, Old forest. The names, and the words "habitat" and "plant", are placeholders.
- **Plant and combine:** a habitat goes on any empty land within reach of the river, or on a habitat of the same level. A level 7 habitat can't be combined.
- **River:** the source counts as a level 1 river tile, and a river tile always arrives at level 1. Extend: put it on empty land that touches the river. Branches are allowed. Widen: put it on a level 1 river tile to make it level 2, the widest. A level 1 river tile reaches 1 tile out and a level 2 river tile reaches 2. Mountains don't block reach.
- **Discard** scores nothing and still uses up the tile. **Undo** is unlimited.
- **A run:** ~~80 tiles~~ *(10 tiles since Nov 20, Dan's pilot pile)*, no timer and no way to lose. The result shows the score, the best score on the device, the top level and what was planted, combined and discarded.
- **The island:** 13×9, all bare ground, the source in the middle and 8 mountains in three small groups. No sea tiles.
- **Opening view:** centred on the source, with about 5 tiles across a phone.
- **Score is called Score,** not Life as on the Weather test.
- **The move** (chosen Nov 20 so the move could be done, not set by Dan): the page's title is just "Flowgrow"; the Home links to Flow Tile's home page are gone (Flowgrow has no home page of its own yet); the app icons are Flow Tile's drop, as stand-ins; `play.css` is copied whole and not trimmed; Flow Tile keeps pointer pages for `/flowgrow/` and `/city-test/`; the old history was not carried across.
- **The simple look** (chosen Nov 20, not set by Dan): it is the default look; the island is flat from above instead of tilted; river tiles carry their level (1 or 2) as well as habitats; empty land is pale green where the river reaches and off-white where it doesn't; mountains are grey with a triangle; the source has a white ring; the colours, and the gold, teal and dashed-blue rings that mark what the tile in hand can do, are placeholders.
- ~~**The pilot pile** (found while building it, not set by Dan): lock pacing is still one lock per 10 tiles placed, so a 10-tile pile earns exactly one lock, with the 10th placement, and a discarded tile means no lock at all. In 1,000 simulated runs a simple player averages 29 points with 4 copies banked (16 points with locking off), so the loop runs once. A lock every 5 tiles runs it about 3 times and averages 43. The 7 dealt tiles are each a river tile one time in ten, so runs differ a little; with `riverShare: 0` every run is the same 10 tiles.~~ *Resolved Nov 20: Dan said there is no lock limit, so the loop is no longer held to one lock.*
- **The river rule** (my reading of it, not set by Dan): "behind it" is the tile it flows from, which is the one it is drawn joined to (the river's end if it touches one, otherwise the newest river tile it touches). Equal is allowed. The source has nothing behind it. If a new tile touches two river tiles, only the one it joins counts.
- **How high scores go** (found by search on seed 495454692, before the river rule; not a rule): a tuned search reached 918 points (top level 6, 38 locks, 183 moves) and 914 with a level 7, against 47 by hand. With free copies, no lock limit and no move limit, a score is limited by how many neighbouring tile pairs the island has, not by how well you play. The best runs open with four level 2 meadows, then use the copies to grow a block of level 4 tiles and plant level 4 copies on empty land.

### Not built yet

Left out to get a prototype quickly. None of it is a decision against the thing itself.

- The Tuning panel. Every number, the six lock values included, is still in `flowgrow.config.js`, and the simulator takes any of them (`node tools/flowgrow-sim.mjs 500 riverShare=0.15`, `lockEnabled=false`, `lockEvery=0`).
- Sound, haptics and the Settings sheet.
- The painterly extras of the river game: clouds, the smooth river bends, swaying trees, the level banner and the error card.
- Picking from the first few tiles (`pickFrom` above 1). The rule is written and tested, but the page has no buttons for it.
- Taps are matched to the ground tile, not to the picture standing on it. So to pick a tile behind a tall tree, tap its ground.

### Check after any change to it

- `node tools/flowgrow-sim.mjs --test` passes, and `node tools/flowgrow-sim.mjs` reports that no run crashed or stalled and every run rebuilt exactly from its seed and moves. Run it with `lockEnabled=false` and `lockEvery=0` as well.
- ~~`node tools/solve.mjs` gives the same result as before (no other page changes).~~ *Superseded Nov 20: the river game's solver stays in Flow Tile's repo; this repo has none.*
- One whole run plays in a browser at 390×844.
