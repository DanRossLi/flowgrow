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
  stackSize: 10,            // tiles in a run (0: endless). 10 for the pilot (Dan, Nov 20); 80 in the first build
  queueShown: 3,            // tiles shown after the tile in hand
  pickFrom: 1,              // 1: you must place the tile in hand. 3: tap any of the first 3 to take it instead
  riverShare: 0.10,         // chance a dealt tile is a river tile
  opening: ["habitat 1", "habitat 1", "river"], // the first tiles of every run, in order
  maxLevel: 7,              // the highest level a habitat can reach
  levelOdds: 0,             // each level is this many times as likely as the one below. 0: only level 1 is ever dealt (Dan, Nov 20), so higher levels
                            // come only from combining and from the copies a lock banks. 0.5 in the first build

  // Score: a move scores by the level of the habitat it leaves on the map (Dan: "+1, +3, +6, +10....")
  scoreByLevel: [1, 3, 6, 10, 15, 21, 28],

  // River: how many tiles out a level 1 and a level 2 river tile reach. Its length is also the widest a river tile can get.
  riverReach: [1, 2],
  riverMonotone: true,      // rivers rise downstream (Dan, Nov 20): a river tile can't be lower than the one it flows from, so a river is widened from its end back towards the source. false: the first build's rule

  tilesAcross: 5,           // opening zoom: about this many tiles fit across a phone

  // The seven levels, lowest first: how land grows back
  levelNames: ["Sprouts", "Meadow", "Thicket", "Saplings", "Grove", "Forest", "Old forest"],

  // Locking (LOU-299): lock a tile to copy its neighbours into the back of your pile
  lockEnabled: true,        // false: Flowgrow without locking
  lockLevelCap: true,       // false: every unlocked neighbour is copied, whatever its level
  lockCopiesGo: "back",     // "back": the end of the pile. "front": the next tiles
  lockRivers: true,         // false: river tiles can't be locked or copied
  lockEvery: 0,             // tiles placed per lock earned. 0: locks are free and unlimited (Dan, Nov 20: "there is no lock limit"). 10 in the first build
  lockHold: 1,              // locks the player can hold (not used while locks are unlimited)
};
