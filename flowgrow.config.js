// Flowgrow (LOU-298, LOU-299): every number the test uses, in one place. Flowgrow is an experiment; the game's page is the
// only page that reads this file.
// The Tuning panel (menu > Tuning, on the Flowgrow page) changes these for one device, from the next run on. Reset goes back
// to this file. Only the rules Dan has set are settled (see CANON.md); every value here is a placeholder to tune.
window.FLOWGROW = {
  // The island, in the usual map codes: T source, _ bare ground, B mountain. 13×9, the source in the middle, 8 mountains in
  // three small groups, none within 2 tiles of the source. No sea tiles: there is nowhere to reach.
  map: ["_____________",
        "_BB__________",
        "__B_______B__",
        "__________BB_",
        "______T______",
        "_____________",
        "___BB________",
        "_____________",
        "_____________"],

  // The pile
  stackSize: 20,            // tiles in a run (0: endless). 20 (Dan, Nov 20: "expand starting tiles to 20"); 10 for the pilot; 80 in the first build
  queueShown: 3,            // tiles shown after the tile in hand
  pickFrom: 1,              // 1: you must place the tile in hand. 3: tap any of the first 3 to take it instead
  riverShare: 0.10,         // chance a dealt tile is a river tile
  opening: ["river", "river", "river", "river", "habitat 1", "habitat 1", "prairie 1", "marsh 1"], // the first tiles of every run, in order. Four river tiles first (Dan, Nov 21: "have it start with 4 water tiles, that way I can build my stream"), then green, green, prairie and marsh, so every kind shows by the eighth tile. After the opening a tile is a river tile riverShare of the time
  prairieShare: 0.3,        // of the dealt habitats, the share that are prairie, the yellow tile (Dan, Nov 20: "add a yellow tile for grasslands", then "make yellow like 'prairie'"). 0: none
  marshShare: 0.3,          // and the share that are marsh, the turquoise tile ("add a turquoise tile for marsh"). The rest are the original green. Together at most 1
  biomeMatch: true,         // true: a tile only combines with a habitat of its own kind and level. false: any kind combines
  marshNeedsRiver: true,    // Dan, Nov 20: "turquoise represents marsh and must be adjacent to a river". true: marsh is planted only on empty land that shares an edge with a river tile (the source and locked river tiles count). false: marsh plants wherever green does
  marshRiverMultiplier: true,  // Dan, Nov 21 (LOU-309): "let's do a marsh bonus that for each "additional" river tile, it's a score multiple. 1 river = x1 (normal), 2 river = 2x...3x, 4x, 5x....". true: every score a marsh tile earns (planted, combined onto, levelled, lifted by roots) is multiplied by a number that grows with the river tiles that share an edge with it (marshRiverRamp, next line), at least x1, the source and locked river tiles included. false: marsh scores like the other kinds. It was off until Dan had seen the numbers; then he said "Turn it on", so it is on. ?marshRiverMultiplier=false plays the game without it
  marshRiverRamp: [1, 1.5, 2, 2.5, 3, 3.5], // Dan, Nov 21: "make the marsh multiplier 1, 1.5, 2, 2.5, 3, 3.5 instead" (it was 1, 2, 3, 4, 5, 6: the count itself). The multiplier for a marsh tile touching 1, 2, 3 ... river tiles, one number each, and the last number for any more. Touching none is x1. Scores can end in .5. ?marshRiverRamp=1,2,3,4,5,6 plays the first ramp
  prairieSpreads: true,     // Dan, Nov 20: "Yes, grass can be placed to adjacent grass tiles event if not in the water zone, good idea". true: prairie can also be planted on empty land that shares an edge with another prairie habitat, even outside the river's reach. false: prairie plants only inside reach
  treeShare: 0.2,           // Dan, Nov 20: "should we have a 'deep green' tile which is trees?". The share of the habitats dealt after the opening that are trees (deep green); the rest keep the 40/30/30 split of green, prairie and marsh. 0: no trees. A placeholder. Since LOU-314 (Dan, Nov 22: "just make trees a regular tile that needs addition") a tree is an ordinary habitat: it plants as level 1 on empty land within the river's reach, like green (or beside a pine-oneer, even outside it), and only combines with a tree of its own level. The first rule, where a tree grew over a same-level habitat and was never planted on bare ground, was removed
  upgradeLevel: 4,          // Dan, Nov 20: "Make it level 4", "Let's make it an upgrade...and then also should it be an aesthetic difference as well?", "There's no need for protection...it's not a combat game". The level at which a marsh, prairie or trees habitat gains its upgrade, a power of its own that shows in its look. So far only the marsh's reed bed (LOU-304): a marsh habitat of this level or higher counts as river bank, so marsh can also be planted on empty land that touches it. 0: no upgrades
  steppePerLevel: 1,        // Dan, Nov 20 to 21: "At level 4 one of the upgrades can be "spreader", where every time that tile levels up, it plants a free level 1 prairie adjacent to it until no more slots available", "Also instead of spreader call the ability steppe". How many free level 1 prairies a steppe (a prairie upgrade, picked at the upgrade level) plants beside it each time it levels up, on the first free tiles clockwise from the top right. Dan's words could mean one or all of the free slots: 1 is one a level-up, 6 is every free slot. 0: none
  meadowMax: 4,             // Dan, Nov 20 to 21: "instead of Bloom, make it "meadow" and it adds the score of neighboring marsh and trees as a multiplier". A meadow (the prairie's other upgrade) multiplies the points of its level-ups by 1 + the marsh and trees habitats beside it, up to this. 1: meadow gives nothing
  rootsPerLevel: 6,         // Dan, Nov 20 to 21: "I like roots...put no cap on it, allow chain reaction for combos". Each time a roots tree (a trees upgrade, picked at the upgrade level) levels up, this many of the lower habitats beside it rise a level for free, the lowest first. 6: all of them, no cap. 1: only the lowest. 0: none
  rootsChain: true,         // true: a tile that rises counts as having levelled up, so its own upgrade fires (a steppe plants its tile, a meadow multiplies the points of the rise, a roots tree lifts its own lower neighbours). false: it only rises and scores
  maxLevel: 15,             // the highest level a habitat can reach (Dan, Nov 20: "uncap the tiles max to 15"). 7 in the first build
  bareGroundMaxLevel: 1,    // the highest level a habitat can have when planted on empty land (LOU-300; Dan, Nov 20: "level 1 only on bare ground"). 15 (the top level) is the old rule: any level plants. 2 is the softer version
  bareGroundMode: "downgrade", // what a habitat above that level does on empty land. "downgrade": it plants as a level 1 habitat and scores 1 (Dan, Nov 20: "put downgrade in the game and let me play test"). "refuse": it can't be planted, only combined onto a habitat of its own level or discarded
  levelOdds: 0,             // each level is this many times as likely as the one below. 0: only level 1 is ever dealt (Dan, Nov 20), so higher levels
                            // come only from combining and from the copies a lock banks. 0.5 in the first build

  // Score: a move scores by the level of the habitat it leaves on the map (Dan: "+1, +3, +6, +10....")
  scoreByLevel: [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78, 91, 105, 120],

  // River: how many tiles out a level 1 and a level 2 river tile reach. A river tile of a higher level reaches as far as the last: the width stops growing at 2.
  riverReach: [1, 2],
  riverMaxLevel: 15,        // the highest level a river tile can reach (Dan, Nov 20: "make rivers also level up, just as points make the "width" max 2"). A river tile put on one of its own level raises it, like habitats; only the first two levels widen it. 2: the first build, where level 2 was the top
  riverScore: "levels",     // what a river tile scores. "levels": raising a river tile a level scores the points for the level it reaches, as for habitats; extending the river scores nothing. "all": every river move scores like a habitat of its level. "none": rivers score nothing (the first build)
  riverMonotone: true,      // rivers rise downstream (Dan, Nov 20): a river tile can't be lower than the one it flows from, so a river is widened from its end back towards the source. false: the first build's rule
  riverRaiseGuard: true,    // Dan, Nov 21: "fix the opening trap". The pile opens with four river tiles, and raising the source with the first one leaves the other three nowhere to go (a level 1 river tile can't be lower than the source). true: a river tile can't raise a river tile when that would leave a river tile waiting in the pile with no legal move. false: it can

  // Elevation (LOU-310; Dan, Nov 21: "create a ticket for "elevation" such that there is a "step down" on the tiles, this creates a water fall. what we'll do is that river tiles can 'step down" but for the land tiles
  // there is no adjacency bonus on the step down. Rivers can never "go up"."). Off here: the usual game is flat. Dan then asked for it as separate maps with 2 or 3 variations ("do LOU-310 but make it a separate map"),
  // so the maps at /elevation/foothills/, /ridges/ and /terraces/ switch it on for themselves, and nothing in the usual game changes.
  elevation: false,         // true: land has heights, a river tile can't be put on land higher than the river tile behind it (a step down is a waterfall), and land bonuses stop at a step. false: flat
  elevationLevels: 3,       // the highest height: land runs from 0 to this (neighbouring land differs by at most 1; the source is on the highest ground)
  elevationShape: "foothills", // how the land is shaped, from the seed: "foothills" (rings falling away from the source, with bumps), "ridges" (ridges run out from the source, lower land between) or "terraces" (broad flat tiers falling away in one direction)
  stepAdjacency: "score",   // what a step stops counting as a neighbour: "score" (only Meadow's multiplier), "all" (Roots, Steppe, lock copies, prairie spread, reed beds and pine-oneers too) or "none"

  tilesAcross: 5,           // opening zoom: about this many tiles fit across a phone

  // The names of the first seven levels, lowest first: how land grows back. Levels past the list are just called Level 8, Level 9 and so on until they are named
  levelNames: ["Sprouts", "Meadow", "Thicket", "Saplings", "Grove", "Forest", "Old forest"],

  // Locking (LOU-299): lock a tile to copy its neighbours into the back of your pile
  lockEnabled: true,        // false: Flowgrow without locking
  lockLevelCap: true,       // false: every unlocked neighbour is copied, whatever its level
  lockCopiesGo: "back",     // "back": the end of the pile. "front": the next tiles
  lockRivers: true,         // false: river tiles can't be locked or copied
  lockEvery: 0,             // tiles placed per lock earned. 0: locks are free and unlimited (Dan, Nov 20: "there is no lock limit"). 10 in the first build
  lockHold: 1,              // locks the player can hold (not used while locks are unlimited)

  // The 3D look (LOU-311; Dan, Nov 22: "this looks good, can you provide very detailed instructions in linear to make it for flowgrow. some changes, you do not need the rotation. include day/night cycles.
  // everything else looks great."). ?look=3d draws the same game as a small living island from a fixed angle (flowgrow.look3d.js, loaded only when it is asked for). It is cosmetic: it reads the game and never
  // changes a rule, a score, a save or a tap. Every number of the look is in this one block, and none of it is a rule (it is not part of the ruleset key).
  look3d: {
    quality: "auto",        // "low", "med", "high", or "auto" (picked from a short frame-time probe when the look starts). ?q=low|med|high picks one for a visit
    dayNight: "cycle",      // "cycle": the clock below runs (Dan, Nov 22: the clock is the default for now). "progress": the pile is the day, morning at the first tile and night when it is empty. "fixed:day", "fixed:gold", "fixed:night": hold one moment. ?time=night|gold|day|cycle|progress
    dayLength: 240,         // seconds for a whole day: dawn, day, golden hour, dusk, night
    startPhase: 0.20,       // where the clock starts (0.20 is morning)
    azimuth: 0.62,          // the camera angle never changes (nothing rotates it): the fixed azimuth and polar angle, in radians
    polar: 0.98,
    fov: 30,
    nearTilesAcross: 4,     // the closest zoom shows about this many tiles across; the farthest shows the whole island (the opening view, Dan: "Follow the spec")
    budget: {triangles: 250000, drawCalls: 150, fps: 30},   // what the build aims for at 390x844 on q=med: the triangles drawn (the main pass plus the shadow pass) with the whole island in view. If a late game would pass it, the plants and grass are thinned (never below 30 per cent)
    budgetScale: {low: 0.5, med: 1, high: 2.2},             // the budget's multiple for each tier (the high tier is for a desktop)
    shadowMap: {low: 0, med: 1024, high: 2048},             // shadow map size by quality (0: no shadows)
    pixelRatio: {touch: 1.5, other: 2},                      // the highest pixel ratio drawn
    // The level number of a tile (LOU-313, Dan, Nov 22: "have a way such that the level numbers 'blend in' rather than stick out with the pill"): a pale numeral pressed into the ground at the front of the
    // tile, in place of the white pill. x, z: where it lies in the tile's own coordinates (the tile's circumradius is 1, z towards the camera); width: how wide the picture is; stretch: how much taller than wide it
    // is drawn on the ground (1 is square; the camera looks down at the ground from about 34 degrees, so a stretch above 1 makes the number read as upright); lift: how far above the ground; clear: the radius round
    // it where no plant, stone or grass grows; grow: how many times larger it is drawn with the whole island in view (1 is its true size, the size it has zoomed in); glow: how much it lights itself at night.
    // Placeholders, see Linear: CANON.md wins wherever it disagrees.
    numeral: {x: 0.02, z: 0.74, width: 0.62, stretch: 1.5, lift: 0.034, clear: 0.36, grow: 2, glow: 0.5}
  },
};
