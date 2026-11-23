// Flowgrow (LOU-298, LOU-299): an ecology and nature building game on Flow Tile's hex grid, in Flow Tile's look.
// It began as a standalone test page inside Flow Tile and has had its own repo since Nov 20, 2026. play.js is not loaded, and
// what this page needs from it (the hex maths, the camera, the painting and the sound) is copied here. Each copied part
// says where it came from.
//
// The rules Dan has set (Nov 19), in his words. Everything else is a placeholder (see "Open for Dan" in CANON.md):
//   1. "this is going to be a hex based additive game, we're going to get tiles that need to be placed. for example
//      dorfromantik, there will be a tile queue. players can then add tiles to the map."
//   2. "Tiles can be "additive" / "combined". only if they're the same level. for example lvl 1 + lvl 1. you cannot add a
//      tile that are different levels."
//   3. "it's not a city game, it's an ecology nature building game."
//   4. "make the scoring +1, +3, +6, +10....as tiles are added."
//   5. "Rivers also need to be placed, this expands how far out you can place your tile from your river."
//   6. "you 'lock a tile', this will add all the tiles that are adjacent to your pile. but afterwards that tile becomes
//      'locked' and you cannot improve it. Likewise locked tiles cannot be added to your pile when you lock an adjacent tile."
//   7. "a locked tile can only copy up to that level" and "it's a yes/no on copies, it's not the reduced level"
//   8. "copies. copies arrive at back of pile"
//   9. "river tiles can be locked and copied"
//
// Words: a tile is a habitat or a river tile. Putting a habitat on empty land is planting. Two habitats of the same level
// combine into one habitat of the next level. A river tile extends the river or widens it. The pile is the tiles still to come.
//
// The file has two parts. Part 1 is the rules: plain functions on plain data that never touch the page, so
// tools/flowgrow-sim.mjs loads this same file in Node and the simulator and the game can't drift apart. Part 2 is the page.
(() => {
const G = typeof window !== "undefined" ? window : globalThis;

// ====================================================================================================================
// Part 1: the rules
// ====================================================================================================================
// A run is plain data:
//   cfg      the config the run started with (a Tuning change applies from the next run)
//   seed     the number the pile is dealt from; rs is the state of the random numbers
//   h        habitats, {"x,y": level}; hb: the kind of each habitat that isn't the original green one, {"x,y": "p" (prairie), "m" (marsh) or "t" (trees)}
//   r        river tiles, {"x,y": {l: level, from: the river tile it joins (only for drawing), n: the order it was laid}}
//   q        the front of the pile: q[0] is the tile in hand, the rest are the next tiles shown
//   dealt    tiles dealt into q so far; used: tiles placed or discarded
//   score, top (the highest habitat level on the map), planted, combined, extended, widened, discarded
//   moves    every move so far: {a:"p", i, x, y} put tile i of q on x,y · {a:"d", i} discarded it · {a:"l", x, y} locked
//            the tile at x,y · {a:"e"} ended the run
//   log      one entry per move, for the run log
//   over     true once the run has ended
//   lk       locked tiles, {"x,y": 1}; bank: the copies waiting at the back of the pile, in order
//   locks    locks held; toLock: tiles placed since the last lock was earned
//   lockUsed, lockLost, copyBanked, copyPlaced, copyDiscarded, copyPoints
// A tile is {k: "h" (habitat) or "r" (river), l: level}. A copy banked by a lock also has c: 1. A habitat of the yellow, turquoise or deep green kind also has
// b: "p" (prairie), "m" (marsh) or "t" (trees); the original green one has no b.
// A run is its config, its seed and its moves: replay() rebuilds it from those three, and undo, saving and reload all use it.

// Hex grid, copied from play.js: pointy-top hexes in "odd-r" offset rows (odd rows sit half a tile right). Six faces,
// 0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE.
const HEX = [[[1,0],[0,-1],[-1,-1],[-1,0],[-1,1],[0,1]], [[1,0],[1,-1],[0,-1],[-1,0],[0,1],[1,1]]];
const step = ([x, y], d) => { const o = HEX[y & 1][((d % 6) + 6) % 6]; return [x + o[0], y + o[1]] };
const hexDist = (a, b) => { const dq = (a[0] - (a[1] - (a[1] & 1)) / 2) - (b[0] - (b[1] - (b[1] & 1)) / 2), dr = a[1] - b[1]; return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2 };
const key = p => p[0] + "," + p[1], unkey = k => k.split(",").map(Number);

// ---------- the config: every value, how it is checked, and what the Tuning panel calls it
const asNum = v => typeof v === "string" && v.trim() !== "" ? Number(v) : v;
const whole = (lo, hi) => v => { const n = asNum(v); return typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : undefined };
const real = (lo, hi) => v => { const n = asNum(v); return typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi ? n : undefined };
const bool = v => v === true || v === false ? v : /^(true|1|on|yes)$/i.test(String(v).trim()) ? true : /^(false|0|off|no)$/i.test(String(v).trim()) ? false : undefined;
const oneOf = (...opts) => v => opts.includes(String(v).trim()) ? String(v).trim() : undefined;
const listOf = (item, min, max) => v => { const a = typeof v === "string" ? v.split(/[,\n]/).map(s => s.trim()).filter(Boolean) : v;
  if (!Array.isArray(a) || a.length < min || a.length > max) return undefined; const out = a.map(item); return out.some(x => x === undefined) ? undefined : out };
// The island: rows of equal length in the usual map codes (T source, _ bare ground, B mountain), with exactly one source.
function mapOf(v) { const rows = (typeof v === "string" ? v.split(/[\s,]+/) : Array.isArray(v) ? v.map(String) : []).map(s => s.trim()).filter(Boolean);
  if (rows.length < 3 || rows.length > 24) return undefined; const w = rows[0].length; if (w < 3 || w > 24) return undefined;
  let src = 0; for (const r of rows) { if (r.length !== w || /[^T_B]/.test(r)) return undefined; src += r.split("T").length - 1 }
  return src === 1 ? rows : undefined }
// A tile written in words, as in the config's opening list: "habitat 3", "prairie 2", "marsh 1", "trees 2", "river" (level 1) or "river 2". "habitat" is the
// original green kind. Prairie (yellow), marsh (turquoise) and trees (deep green) are habitats of kinds of their own, written b "p", "m" and "t" on a tile
// (green has no b). (Dan, Nov 20, "make yellow like 'prairie'": the yellow kind is Prairie, not Grasslands.)
const BIOME_NAME = {p:"Prairie", m:"Marsh", t:"Trees"}, BIOME_OF = {prairie:"p", marsh:"m", trees:"t"};
function parseTile(s) { const m = /^\s*(habitat|prairie|marsh|trees|river)(?:\s+(\d+))?\s*$/i.exec(String(s)); if (!m) return null;
  const w = m[1].toLowerCase(), k = w === "river" ? "r" : "h", l = m[2] ? +m[2] : 1; if (!(l >= 1 && l <= 24 && (k === "r" || m[2]))) return null;
  return BIOME_OF[w] ? {k, l, b:BIOME_OF[w]} : {k, l} }
const tileWord = t => t.k === "r" ? (t.l > 1 ? "river " + t.l : "river") : (t.b ? BIOME_NAME[t.b].toLowerCase() : "habitat") + " " + t.l;
// [key, check, name in Tuning, note, kind of field]
const KEYS = [
  ["map", mapOf, "Island", "rows of T (source), _ (land) and B (mountain)", "rows"],
  ["stackSize", whole(0, 2000), "Tiles in a run", "0: endless", "int"],
  ["queueShown", whole(0, 6), "Next tiles shown", "after the tile in hand", "int"],
  ["pickFrom", whole(1, 7), "Pick from", "1: only the tile in hand", "int"],
  ["riverShare", real(0, 1), "River tile chance", "0 to 1", "num"],
  ["opening", listOf(s => { const t = parseTile(s); return t ? tileWord(t) : undefined }, 0, 40), "First tiles", "such as habitat 1, prairie 1, marsh 1, trees 1, river", "list"],
  ["prairieShare", real(0, 1), "Prairie tiles", "the share of dealt habitats that are prairie (yellow); with marsh, at most 1", "num"],
  ["marshShare", real(0, 1), "Marsh tiles", "the share of dealt habitats that are marsh (turquoise)", "num"],
  ["biomeMatch", bool, "Same kind to combine", "on: a tile only combines with a habitat of its own kind and level. off: any kind", "bool"],
  ["marshNeedsRiver", bool, "Marsh needs the river", "on: marsh can only be planted on empty land that shares an edge with a river tile. off: marsh plants wherever green does", "bool"],
  ["marshRiverMultiplier", bool, "Marsh river multiplier", "on: every score a marsh tile earns is multiplied by a number that grows with the river tiles that share an edge with it (the ramp below, at least x1). off: marsh scores like the other kinds", "bool"],
  ["marshRiverRamp", listOf(real(1, 100), 1, 6), "Marsh multiplier by river tiles", "the multiplier for a marsh tile touching 1, 2, 3 ... river tiles, one number each: 1, 1.5, 2, 2.5, 3, 3.5 (half a step for each river tile after the first; Dan, Nov 21) or 1, 2, 3, 4, 5, 6 (a whole step, the first build). A tile touching more river tiles than the list has gets the last number. Touching none is x1. Only used with the multiplier on", "list"],
  ["prairieSpreads", bool, "Prairie spreads", "on: prairie can also be planted on empty land that shares an edge with another prairie habitat, even outside the river's reach. off: prairie plants only inside reach", "bool"],
  ["mode", oneOf("free", "daily", "challenge"), "Mode", "free: the game as it is. daily and challenge are for later (LOU-316) and change nothing yet", "choice"],
  ["treeShare", real(0, 1), "Trees tiles", "the share of dealt habitats after the opening that are trees (deep green). 0: no trees", "num"],
  ["upgradeLevel", whole(0, 24), "Upgrade level", "the level at which a marsh, prairie or trees habitat gains its upgrade. 0: no upgrades", "int"],
  ["steppePerLevel", whole(0, 6), "Steppe: free prairies a level-up", "how many free level 1 prairies a steppe plants each time it levels up. 6: every free slot beside it. 0: none", "int"],
  ["meadowMax", whole(1, 12), "Meadow: top multiplier", "the highest multiplier a meadow's level-up can get (1 + the marsh and trees beside it). 1: meadow gives nothing", "int"],
  ["rootsPerLevel", whole(0, 6), "Roots: tiles lifted a level-up", "how many lower neighbours a roots tree lifts each time it levels up (the lowest first). 6: all of them, no cap. 1: only the lowest. 0: none", "int"],
  ["rootsChain", bool, "Roots: chain reactions", "on: a tile that rises counts as having levelled up, so its own upgrade fires. off: it only rises and scores", "bool"],
  ["maxLevel", whole(1, 24), "Top level", "the highest a habitat can reach", "int"],
  ["bareGroundMaxLevel", whole(1, 24), "Bare ground takes up to level", "the highest level a habitat can be planted at on empty land", "int"],
  ["bareGroundMode", oneOf("refuse", "downgrade"), "Above that level", "refuse: it can't be planted, only combined or discarded. downgrade: it plants as level 1", "choice"],
  ["levelOdds", real(0, 4), "Level odds", "each level is this many times as likely as the one below. 0: only level 1 is ever dealt", "num"],
  ["scoreByLevel", listOf(real(0, 100000), 1, 24), "Points by level", "level 1 first", "list"],
  ["riverReach", listOf(whole(0, 12), 1, 4), "River reach", "tiles out, by river level. A river tile past the last level reaches as far as the last: the width stops growing there", "list"],
  ["riverMaxLevel", whole(1, 24), "River top level", "the highest a river tile can reach. Only the River reach levels widen it (2 in the first build, which was also its top)", "int"],
  ["riverScore", oneOf("all", "levels", "none"), "River points", "levels: only raising a river tile a level scores. all: every river move scores like a habitat of its level. none: rivers score nothing", "choice"],
  ["riverMonotone", bool, "Rivers rise downstream", "on: a river tile can't be lower than the one it flows from", "bool"],
  ["riverRaiseGuard", bool, "Don't strand river tiles", "on: a river tile can't raise a river tile when that would leave a river tile waiting in the pile with no legal move (the first of four river tiles on the source, for one). off: it can", "bool"],
  ["elevation", bool, "Elevation", "on: land has heights, a river tile can't be put on land higher than the river tile behind it, and a step down is a waterfall (LOU-310). off: the island is flat", "bool"],
  ["elevationLevels", whole(1, 6), "Highest elevation", "land runs from 0 to this; the river's source is on the highest ground and neighbouring land differs by at most 1. Only used with elevation on", "int"],
  ["elevationShape", oneOf("foothills", "ridges", "terraces"), "Elevation shape", "foothills: the land falls away from the source in rings, with some bumps. ridges: ridges run out from the source and the land between them is lower. terraces: broad flat tiers with sharp steps, falling away in one direction. Only used with elevation on", "choice"],
  ["stepAdjacency", oneOf("score", "all", "none"), "Across a step", "score: Meadow's multiplier ignores marsh and trees across a step. all: Roots, Steppe, lock copies, prairie spread, reed beds and pine-oneers do too. none: a step changes nothing here. Only used with elevation on", "choice"],
  ["tilesAcross", real(2, 16), "Tiles across", "opening zoom on a phone", "num"],
  ["levelNames", listOf(s => { const t = String(s).trim().slice(0, 24); return t ? t : undefined }, 1, 24), "Level names", "level 1 first", "list"],
  ["lockEnabled", bool, "Locking", "off: Flowgrow without locking", "bool"],
  ["lockLevelCap", bool, "Lock level cap", "off: every unlocked neighbour is copied, whatever its level", "bool"],
  ["lockCopiesGo", oneOf("back", "front"), "Copies go to", "back: the end of the pile. front: the next tiles", "choice"],
  ["lockRivers", bool, "Lock river tiles", "off: river tiles can't be locked or copied", "bool"],
  ["lockEvery", whole(0, 500), "Tiles per lock", "0: locks are free and unlimited", "int"],
  ["lockHold", whole(1, 50), "Locks you can hold", "", "int"],
];
// Check a config. Every value that passes is kept; a value that doesn't is refused and the one from `base` stands.
function tidy(raw, base) { const cfg = {}, bad = [];
  for (const [k, check] of KEYS) { let v = raw && raw[k] !== undefined ? check(raw[k]) : undefined;
    if (v === undefined) { if (raw && raw[k] !== undefined) bad.push(k); v = base ? base[k] : undefined }
    if (v === undefined) throw new Error("Flowgrow: the config has no usable value for " + k); cfg[k] = v }
  if (cfg.prairieShare + cfg.marshShare > 1) for (const k of ["prairieShare", "marshShare"]) { if (!bad.includes(k)) bad.push(k); cfg[k] = base && base.prairieShare + base.marshShare <= 1 ? base[k] : 0 } // together they can't pass 1
  return {cfg, bad} }

// ---------- the island. What never changes for a config (its tiles, their neighbours, which of them are land) is worked out once.
const inside = (c, p) => p[0] >= 0 && p[1] >= 0 && p[1] < c.map.length && p[0] < c.map[0].length;
const codeAt = (c, p) => inside(c, p) ? c.map[p[1]][p[0]] : "";
const nbrs = (c, p) => [0, 1, 2, 3, 4, 5].map(d => step(p, d)).filter(q => inside(c, q));
const GRIDS = new WeakMap();
function grid(c) { let g = GRIDS.get(c); if (g) return g; g = {land:[], bare:new Set(), nb:{}, at:{}}; // land: the bare ground tiles in reading order
  c.map.forEach((row, y) => [...row].forEach((ch, x) => { const k = x + "," + y; g.at[k] = [x, y]; g.nb[k] = nbrs(c, [x, y]).map(key); if (ch === "_") { g.land.push(k); g.bare.add(k) } }));
  GRIDS.set(c, g); return g }
// empty land: bare ground with no habitat and no river on it
const openKey = (S, k) => grid(S.cfg).bare.has(k) && !(k in S.h) && !(k in S.r), isOpen = (S, p) => openKey(S, key(p));

// ---------- levels and points
const levelName = (c, l) => c.levelNames[l - 1] || "Level " + l;
// Points for leaving a habitat of this level on the map. Past the end of the table the pattern carries on (36, 45 …).
function scoreOf(c, l) { const t = c.scoreByLevel; if (l <= t.length) return t[l - 1];
  let v = t[t.length - 1], d = t.length > 1 ? v - t[t.length - 2] : v; for (let i = t.length; i < l; i++) { d += 1; v += d } return v }
const riverTop = c => c.riverMaxLevel;                                      // the highest level a river tile can reach
const widthTop = c => c.riverReach.length;                                  // the level past which a river tile reaches no further: the width stops growing there
// What a river move scores (riverScore). "all": the level it leaves on the map, like a habitat. "levels": only raising a river tile a level scores, the points for the
// level it reaches. "none": rivers score nothing (the first build).
const riverPts = (c, l, levelUp) => c.riverScore === "all" || (c.riverScore === "levels" && levelUp) ? scoreOf(c, l) : 0;
const reachAt = (c, l) => c.riverReach[Math.min(l, c.riverReach.length) - 1] || 0;
// The level a habitat of level l lands as when it is planted on empty land, or 0 if it can't be planted there (LOU-300; Dan, Nov 20:
// "level 1 only on bare ground"). Bare ground takes a habitat up to bareGroundMaxLevel as it is. Above that, "refuse" doesn't offer the
// move (the tile can only combine onto a habitat of its own level, or be discarded) and "downgrade" plants it as a level 1 habitat.
// Combining is never changed, and neither is a tile's kind: a downgraded tile is still a habitat.
const plantLevel = (c, l) => l <= c.bareGroundMaxLevel ? l : c.bareGroundMode === "downgrade" ? 1 : 0;

// ---------- dealing. Seeded, so a run can be replayed: the same seed and the same moves always give the same pile.
const seedOf = v => { const n = Number(v); if (v !== "" && v != null && Number.isFinite(n)) return Math.abs(Math.floor(n)) % 4294967296;
  let h = 2166136261; for (const ch of String(v)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0 };
// A short name for the rules a run is played under: every config value that changes how a run plays (not names or zoom).
// The best score is kept per ruleset, so scores from different rules never meet.
const RULE_KEYS = ["map", "stackSize", "queueShown", "pickFrom", "riverShare", "opening", "prairieShare", "marshShare", "biomeMatch", "marshNeedsRiver", "marshRiverMultiplier", "marshRiverRamp", "prairieSpreads", "treeShare", "upgradeLevel", "steppePerLevel", "meadowMax", "rootsPerLevel", "rootsChain", "maxLevel", "bareGroundMaxLevel", "bareGroundMode", "levelOdds", "scoreByLevel", "riverReach", "riverMaxLevel", "riverScore", "riverMonotone", "riverRaiseGuard", "lockEnabled", "lockLevelCap", "lockCopiesGo", "lockRivers", "lockEvery", "lockHold"];
// The elevation values join the key only when elevation is on (they change nothing when it is off), so the usual game's key, and its best score, don't change when elevation was added.
const rulesKey = c => seedOf(JSON.stringify(RULE_KEYS.map(k => c[k]).concat(c.elevation ? [c.elevationLevels, c.elevationShape, c.stepAdjacency] : []))).toString(36);
function rand(S) { let t = (S.rs = (S.rs + 0x6D2B79F5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
// One new tile. The first tiles of a run are fixed (cfg.opening). After that a tile is a river tile riverShare of the time;
// otherwise a habitat whose level is rolled from 1 up to the highest habitat level on the map right now, each level
// levelOdds times as likely as the one below. With levelOdds 0 only level 1 is ever dealt (the pilot, Dan, Nov 20: "make
// starting tiles only level 1"): higher levels then come only from combining and from the copies a lock banks.
// A dealt habitat is prairie prairieShare of the time, marsh marshShare of the time, and otherwise the original green kind. With neither
// dealt no random number is used for the kind, so a run without them is dealt exactly as it was before they existed.
function roll(S) { const c = S.cfg;
  if (S.dealt < c.opening.length) { const t = parseTile(c.opening[S.dealt]); return {k:t.k, l:Math.min(t.l, t.k === "r" ? riverTop(c) : c.maxLevel), ...(t.b ? {b:t.b} : {})} }
  if (rand(S) < c.riverShare) return {k:"r", l:1};
  const top = Math.max(1, Math.min(c.maxLevel, S.top)); let total = 0; for (let l = 1; l <= top; l++) total += Math.pow(c.levelOdds, l - 1);
  let x = rand(S) * total, lv = top; for (let l = 1; l <= top; l++) { x -= Math.pow(c.levelOdds, l - 1); if (x < 0) { lv = l; break } }
  if (c.treeShare > 0 && rand(S) < c.treeShare) return {k:"h", l:lv, b:"t"};   // trees (LOU-302): treeShare of the habitats dealt after the opening, and the rest keep their split. With 0 no random number is used (a tree is an ordinary habitat since LOU-314)
  const g = c.prairieShare, m = c.marshShare; if (g + m > 0) { const y = rand(S); if (y < g) return {k:"h", l:lv, b:"p"}; if (y < g + m) return {k:"h", l:lv, b:"m"} }
  return {k:"h", l:lv} }
// Top the pile's front up. A tile is rolled when it enters q, and q and rs are part of the run, so undo and reload never re-roll.
// Banked copies come in only once the dealt stack is used up, so banking a copy never changes what the dealt tiles roll.
// The run ends when the pile is empty and no lock the player holds would bank a copy.
function fill(S) { const c = S.cfg;
  while (S.q.length < 1 + c.queueShown) { if (c.stackSize === 0 || S.dealt < c.stackSize) { S.q.push(roll(S)); S.dealt++ } else if (S.bank.length) S.q.push(S.bank.shift()); else break }
  if (!S.q.length) S.over = !S.pend.length && !lockWouldCopy(S) }   // a pick still to make (LOU-305) keeps the run going
// Tiles left to use: the ones shown, the rest of the stack and the banked copies (Infinity when the stack is endless).
const left = S => S.cfg.stackSize === 0 ? Infinity : S.q.length + S.cfg.stackSize - S.dealt + S.bank.length;

function fresh(cfg, seed) { seed = seedOf(seed);
  const S = {cfg, seed, rs:(Math.imul(seed ^ 0x9E3779B9, 0x85EBCA6B) ^ 0x5bd1e995) >>> 0, h:{}, hb:{}, r:{}, rn:1, q:[], dealt:0, used:0, score:0, top:0,
    planted:0, combined:0, extended:0, widened:0, discarded:0, hf:{}, pend:[], free:0, lifted:0, moves:[], log:[], over:false,
    lk:{}, bank:[], locks:0, toLock:0, lockUsed:0, lockLost:0, copyBanked:0, copyPlaced:0, copyDiscarded:0, copyPoints:0};
  cfg.map.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === "T") S.r[key([x, y])] = {l:1, from:null, n:0} })); // the source counts as a level 1 river tile
  fill(S); return S }

// ---------- elevation (LOU-310; Dan, Nov 21: "create a ticket for "elevation" such that there is a "step down" on the tiles, this creates a water fall. what we'll do is that river tiles can 'step down" but for the land
// tiles there is no adjacency bonus on the step down. Rivers can never "go up"."). Every land cell (bare ground, and the source's) has a height from 0 to elevationLevels. It is worked out from the run's seed alone,
// with a random stream of its own (so the pile is dealt exactly as it is with elevation off), and nothing about it is saved: elevOf(c, seed) rebuilds it and keeps the last few. The source is on the highest ground,
// mountains count as the top height (the river never enters them) and neighbouring land cells differ by at most 1, so a step is always one level. How the land is shaped is a placeholder (elevationShape).
const prng = s => () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
function makeElevation(c, seed) { const g = grid(c), L = c.elevationLevels, rnd = prng(seedOf(seed + "|elevation")), out = {}, h = {}, nbr = k => g.nb[k] || [];
  const src = Object.keys(g.at).find(k => codeAt(c, g.at[k]) === "T"), land = [src, ...g.land], isLand = new Set(land);
  // distance from the source through land (a mountain blocks it), with a parent for each cell: the neighbours are tried in a seeded order, so the parents give the seeded paths the ridges follow
  const dist = {[src]:0}, par = {}, q = [src];
  for (let i = 0; i < q.length; i++) { const k = q[i], ns = nbr(k).filter(n => isLand.has(n)); for (let j = ns.length - 1; j > 0; j--) { const r = Math.floor(rnd() * (j + 1)); [ns[j], ns[r]] = [ns[r], ns[j]] }
    for (const n of ns) if (!(n in dist)) { dist[n] = dist[k] + 1; par[n] = k; q.push(n) } }
  const maxd = Math.max(1, ...Object.values(dist)), far = k => k in dist ? dist[k] : maxd, band = d => Math.min(L, Math.floor(d * (L + 1) / (maxd + 1)));   // band: how many levels down at distance d
  if (c.elevationShape === "ridges") {   // 2 or 3 ridges follow seeded paths out from the source and fall away at half the speed; the land between them is a level lower
    const crest = new Set([src]), arms = 2 + (rnd() < .5 ? 1 : 0), ends = land.filter(k => far(k) >= Math.min(5, maxd - 1));
    for (let a = 0; a < arms && ends.length; a++) for (let k = ends[Math.floor(rnd() * ends.length)]; k != null; k = par[k]) crest.add(k);
    const dc = {}, cq = [...crest]; for (const k of cq) dc[k] = 0; for (let i = 0; i < cq.length; i++) for (const n of nbr(cq[i])) if (isLand.has(n) && !(n in dc)) { dc[n] = dc[cq[i]] + 1; cq.push(n) }
    for (const k of land) h[k] = crest.has(k) ? L - Math.floor(band(far(k)) / 2) : Math.max(0, L - band(far(k)) - ((k in dc ? dc[k] : 9) >= 2 ? 1 : 0)) }
  else if (c.elevationShape === "terraces") {   // broad flat tiers falling away in one seeded direction: the source's side is a plateau at the top, and each tier is a level lower
    const ang = (Math.floor(rnd() * 6) * 60 + (rnd() - .5) * 30) * Math.PI / 180, ux = Math.cos(ang), uy = Math.sin(ang), at = k => [g.at[k][0] + (g.at[k][1] & 1 ? .5 : 0), g.at[k][1] * .8660254], s0 = at(src), pj = {};
    let mp = 1; for (const k of land) { const p = at(k); pj[k] = (p[0] - s0[0]) * ux + (p[1] - s0[1]) * uy; mp = Math.max(mp, pj[k]) }
    for (const k of land) h[k] = L - (pj[k] <= 0 ? 0 : Math.min(L, Math.floor(pj[k] * (L + 1) / (mp + 1e-9)))) }
  else for (const k of land) { const u = rnd(); h[k] = Math.max(0, Math.min(L, L - band(far(k)) + (u < .2 ? -1 : u > .8 ? 1 : 0))) }   // foothills: rings falling away from the source, with some bumps
  h[src] = L;
  for (let ch = true; ch;) { ch = false; for (const k of land) { let m = 0; for (const n of nbr(k)) if (isLand.has(n) && h[n] - 1 > m) m = h[n] - 1; if (h[k] < m) { h[k] = m; ch = true } } }   // neighbours differ by at most 1: low cells are raised to one below their highest neighbour
  for (const k in g.at) out[k] = k in h ? h[k] : L;   // a mountain is at the top height
  return out }
const ELEVS = new WeakMap();
function elevOf(c, seed) { let m = ELEVS.get(c); if (!m) ELEVS.set(c, m = new Map()); let e = m.get(seed);
  if (!e) { if (m.size >= 64) m.delete(m.keys().next().value); m.set(seed, e = makeElevation(c, seed)) } return e }
// A river tile that stepped down from the tile it flows from makes a waterfall on that edge. It is read from the heights and the river, so nothing is stored.
const fallAt = (S, k) => { const c = S.cfg, v = S.r[k]; if (!c.elevation || !v || v.from == null) return false; const e = elevOf(c, S.seed); return e[k] < e[v.from] };
// Do these two cells count as neighbours for this kind of effect? Across a step they don't (stepAdjacency): for "score" (Meadow's multiplier) with "score" or "all", for every kind with "all" ("grow": Roots and Steppe,
// "copy": lock copies, "plant": prairie spread, reed beds and pine-oneers). A river tile is never blocked here: land beside a river counts as before. True means the step blocks it.
function across(S, a, b, kind) { const c = S.cfg; if (!c.elevation || c.stepAdjacency === "none" || (kind !== "score" && c.stepAdjacency !== "all") || a in S.r || b in S.r) return false; const e = elevOf(c, S.seed); return e[a] !== e[b] }

// ---------- reach: a river tile of level l reaches riverReach[l - 1] tiles out, in hex steps. Mountains don't block it.
// Every tile within n steps of p, added to the set `out`.
function ball(c, p, n, out) { const H = c.map.length, W = c.map[0].length, pq = p[0] - (p[1] - (p[1] & 1)) / 2;
  for (let y = Math.max(0, p[1] - n); y <= Math.min(H - 1, p[1] + n); y++) for (let x = Math.max(0, p[0] - n); x <= Math.min(W - 1, p[0] + n); x++) {
    const dq = pq - (x - (y - (y & 1)) / 2), dr = p[1] - y; if ((Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2 <= n) out.add(x + "," + y) }
  return out }
// Every tile within reach of the river, as a set of keys. It only changes when the river does, so it is kept until then
// (don't change the set you get back). `plus` ({"x,y": level}) asks "what if these river tiles were there too", without
// changing the run.
const REACH = new WeakMap();
function reachOf(S, plus) { const c = S.cfg, g = grid(c); let n = 0, sum = 0; for (const k in S.r) { n++; sum += S.r[k].l }
  let hit = REACH.get(S); const ver = n + "/" + sum;
  if (!hit || hit.ver !== ver) { const set = new Set(); for (const k in S.r) ball(c, g.at[k], reachAt(c, S.r[k].l), set); hit = {ver, set}; REACH.set(S, hit) }
  if (!plus) return hit.set; const out = new Set(hit.set); for (const k in plus) ball(c, unkey(k), reachAt(c, plus[k]), out); return out }
// The empty land within reach, as keys in reading order: where a habitat can be planted.
function plantable(S, reach = reachOf(S)) { const out = []; for (const k of grid(S.cfg).land) if (reach.has(k) && !(k in S.h) && !(k in S.r)) out.push(k); return out }
// Where tile t can be planted on empty land (LOU-301; Dan, Nov 20: "turquoise represents marsh and must be adjacent to a river", "Yes, grass can be placed to
// adjacent grass tiles event if not in the water zone"). Green plants anywhere within the river's reach. Marsh (marshNeedsRiver) only on empty land that shares an
// edge with a river tile, the source and locked river tiles included: reach doesn't matter. Prairie (prairieSpreads) anywhere within reach, and also on empty land
// that shares an edge with another prairie habitat of any level, locked or not, even outside reach. Always in reading order, so the preview and a replay agree.
// A marsh bank tile is next to a river tile, or (LOU-304) next to a reed bed: a marsh habitat of upgradeLevel or higher. Reed beds are derived from kind and level, so nothing is stored.
// A locked reed bed still counts, as a locked river tile does.
const reedBedAt = (S, k) => S.cfg.upgradeLevel > 0 && S.hb[k] === "m" && S.h[k] >= S.cfg.upgradeLevel;
const marshBank = (S, k) => grid(S.cfg).nb[k].some(q => q in S.r || (reedBedAt(S, q) && !across(S, k, q, "plant")));
const prairieNext = (S, k) => grid(S.cfg).nb[k].some(q => S.hb[q] === "p" && !across(S, k, q, "plant"));
// A pine-oneer (LOU-306) is a tree habitat of upgradeLevel or higher that picked it (a locked one still counts). Trees can be planted on empty land beside one, even outside the river's reach. Since LOU-314 (Dan, Nov 22:
// "just make trees a regular tile that needs addition") a tree plants like green, on empty land within reach, and this is its way past it.
const pineBank = (S, k) => grid(S.cfg).nb[k].some(q => S.cfg.upgradeLevel > 0 && S.hb[q] === "t" && S.hf[q] === "pine" && S.h[q] >= S.cfg.upgradeLevel && !across(S, k, q, "plant"));
function plantableFor(S, t, reach = reachOf(S)) { const c = S.cfg, out = [];
  if (t.b === "t") { for (const k of grid(c).land) if (!(k in S.h) && !(k in S.r) && (reach.has(k) || pineBank(S, k))) out.push(k); return out }
  if (t.b === "m" && c.marshNeedsRiver) { for (const k of grid(c).land) if (!(k in S.h) && !(k in S.r) && marshBank(S, k)) out.push(k); return out }
  if (t.b === "p" && c.prairieSpreads) { for (const k of grid(c).land) if (!(k in S.h) && !(k in S.r) && (reach.has(k) || prairieNext(S, k))) out.push(k); return out }
  return plantable(S, reach) }

// ---------- upgrades (LOU-303, LOU-304, LOU-305; Dan, Nov 20: "Make it level 4", "Let's make it an upgrade...and then also should it be an aesthetic difference as well?"). At upgradeLevel a marsh,
// prairie or trees habitat gains an upgrade, a power of its own that also shows in its look. The marsh's reed bed is derived from the tile's kind and level alone: nothing is stored for it and no move
// is added. The prairie's (steppe or meadow, LOU-305) and the trees' (LOU-306) are picked by the player when the tile first reaches the upgrade level: the pick is a move of its own ({a:"u"}), it is
// stored on the tile (S.hf, {"x,y": id}), and a lock's copy of such a tile keeps it (f on the tile). upgradeOf(c, tile) is the id of the upgrade a habitat tile has, or "". UPGRADE gives each its name and
// the one plain line the page shows for it. PICKS says which kinds pick, and from what.
const UPGRADE = {reed:{name:"Reed bed", line:"Reed bed: marsh can grow one tile further inland"},
  steppe:{name:"Steppe", line:"Steppe: plants a free prairie each time it levels up"},
  meadow:{name:"Meadow", line:"Meadow: level-ups score more with marsh and trees next to it"},
  roots:{name:"Roots", line:"Roots: when it levels up, lower neighbors rise a level"},
  pine:{name:"Pine-oneer", line:"Pine-oneer: trees can be planted on empty land next to it"}};
const PICKS = {p:["steppe", "meadow"], t:["roots", "pine"]};
const upgradeOf = (c, t) => c.upgradeLevel > 0 && t && t.k === "h" && t.l >= c.upgradeLevel ? (t.b === "m" ? "reed" : t.f || "") : "";
// The six faces clockwise starting at the top right (NE), the fixed order a steppe fills its free tiles in (the faces are numbered 0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE).
const CW = [1, 0, 5, 4, 3, 2];
const readingOrder = (a, b) => { const p = unkey(a), q = unkey(b); return p[1] - q[1] || p[0] - q[0] };
// The empty land beside k, in the fixed order: not a mountain, a river tile or an occupied tile.
const freeSpots = (S, k) => { const out = []; for (const d of CW) { const q = step(unkey(k), d); if (inside(S.cfg, q) && openKey(S, key(q)) && !across(S, k, key(q), "grow")) out.push(key(q)) } return out };
// What a meadow's level-up is multiplied by: 1 + the marsh and trees habitats beside it (any level, locked or not; green, prairie and river tiles don't count), up to meadowMax.
const meadowMult = (S, k) => { let n = 0; for (const q of grid(S.cfg).nb[k]) if ((S.hb[q] === "m" || S.hb[q] === "t") && !across(S, k, q, "score")) n++; return Math.min(S.cfg.meadowMax, 1 + n) };   // (marsh and trees across a step don't count with elevation on, LOU-310)
// The marsh river multiplier (LOU-309; Dan, Nov 21: "let's do a marsh bonus that for each "additional" river tile, it's a score multiple. 1 river = x1 (normal), 2 river = 2x...3x, 4x, 5x...."): the points a marsh
// tile scores (planted, combined onto, levelled, lifted by roots) are multiplied by a number that grows with the river tiles that share an edge with it. Dan first set it to the count itself (x1 to x6), then
// (Nov 21: "make the marsh multiplier 1, 1.5, 2, 2.5, 3, 3.5 instead") to marshRiverRamp: the multiplier for 1, 2, 3 ... river tiles touching, and the last number for any more. None touching is x1, and no
// number is below x1. A score can now end in .5 (halves add up exactly). River tiles count at any level, locked or not, the source included. It is worked out from the board at the moment of the score and paid
// once, so nothing is stored. Off (marshRiverMultiplier false) it is x1.
const marshMult = (S, k) => { const c = S.cfg; if (!c.marshRiverMultiplier) return 1; let n = 0; for (const q of grid(c).nb[k]) if (q in S.r) n++; return n < 1 ? 1 : c.marshRiverRamp[Math.min(n, c.marshRiverRamp.length) - 1] };
// A habitat at the upgrade level with no upgrade yet, of a kind that picks, has a pick to make. The picks are asked in reading order (row, then column), one at a time, before any other move.
function needPick(S, k) { const c = S.cfg; if (c.upgradeLevel > 0 && S.h[k] >= c.upgradeLevel && PICKS[S.hb[k] || ""] && !S.hf[k] && !S.pend.includes(k)) { S.pend.push(k); S.pend.sort(readingOrder) } }
// A habitat that levelled up (by a combine, or lifted by roots) fires its upgrade. Steppe: steppePerLevel free level 1 prairies on empty land beside it, in the fixed order; they aren't taken from the pile, so
// they use no tile and are not counted as planted, and each scores 1. (A meadow's multiplier is already in the move's points.) Roots (LOU-306): see roots(). Returns what it caused: the keys planted, the
// tiles lifted (each {k, pts}), and the points all of that scored.
function steppe(S, k, got) { const c = S.cfg;
  for (const j of freeSpots(S, k).slice(0, c.steppePerLevel)) { S.h[j] = 1; S.hb[j] = "p"; S.free++; got.free.push(j); got.pts += scoreOf(c, 1) } }
function levelUp(S, k) { const got = {free:[], lifts:[], pts:0, liftPts:0};
  if (S.hf[k] === "steppe") steppe(S, k, got); else if (S.hf[k] === "roots") roots(S, k, got);
  return got }
// Roots (LOU-306; Dan: "I like roots...put no cap on it, allow chain reaction for combos"). Each time a roots tree levels up, every unlocked habitat that shares an edge with it and is lower than the tree rises
// one level for free (rootsPerLevel limits it to the lowest ones, 0 lifts none) and scores the points for its new level, like a combine. With rootsChain a tile that rises counts as having levelled up, so its
// own upgrade fires: a steppe plants its free tiles, a meadow multiplies the points of the rise, and a roots tree lifts its own lower neighbours in turn. A tile that reaches the upgrade level this way has a pick
// to make, chain or not. It is worked out as a queue in a fixed order (neighbours clockwise from the top right, first come first served), so a replay rebuilds the same run. It always ends: a tile only rises while
// it is lower than the tree lifting it, so no level passes the level of the tree that started it. The step limit is a safety net only, and never hit.
const ROOTS_LIMIT = 20000;
function roots(S, k0, got) { const c = S.cfg, queue = [k0]; let steps = 0;
  while (queue.length && c.rootsPerLevel > 0) { const x = queue.shift(), lx = S.h[x]; let el = [];
    for (const d of CW) { const q = step(unkey(x), d); if (!inside(c, q)) continue; const j = key(q); if (j in S.h && !(j in S.lk) && S.h[j] < lx && !across(S, x, j, "grow")) el.push(j) }
    if (el.length > c.rootsPerLevel) el = el.map((j, i) => [j, i]).sort((a, b) => S.h[a[0]] - S.h[b[0]] || a[1] - b[1]).slice(0, c.rootsPerLevel).sort((a, b) => a[1] - b[1]).map(a => a[0]);
    for (const j of el) { if (++steps > ROOTS_LIMIT) return; S.h[j]++; const l2 = S.h[j]; let pts = scoreOf(c, l2);
      if (c.rootsChain && S.hf[j] === "meadow") pts *= meadowMult(S, j);
      if (S.hb[j] === "m") pts *= marshMult(S, j);   // a lifted marsh tile scores times the river tiles touching it (LOU-309), chain or not
      got.pts += pts; got.liftPts += pts; got.lifts.push({k:j, pts}); S.lifted++; S.top = Math.max(S.top, l2);
      if (c.rootsChain) { if (S.hf[j] === "steppe") steppe(S, j, got); else if (S.hf[j] === "roots") queue.push(j) }
      needPick(S, j) } } }
// Make the pick for the first tile waiting: f is one of its kind's upgrades. Choosing plants and scores nothing. The only move while a pick is pending.
function pick(S, k, f) { if (S.over || !S.pend.length || S.pend[0] !== k || !(PICKS[S.hb[k] || ""] || []).includes(f)) return null;
  S.hf[k] = f; S.pend.shift(); const p = unkey(k); S.moves.push({a:"u", x:p[0], y:p[1], f}); fill(S);
  note(S, {k:"h", l:S.h[k], ...(S.hb[k] ? {b:S.hb[k]} : {})}, "pick", p, S.h[k], 0); S.log[S.log.length - 1].f = f; return {does:"pick", f, p} }
// How many moves one undo takes back: a pick goes with the move that led to it (and with any other picks made after that move), so undo never lands on a half-made choice.
const undoCount = moves => { let n = 0; while (n < moves.length && moves[moves.length - 1 - n].a === "u") n++; return Math.min(moves.length, n + 1) };

// ---------- moves
// Everything tile i of the pile's front can do: [{p, does, l, pts}]. does: "plant" on empty land within reach (a tree: or beside a pine-oneer) · "combine" on
// a habitat of the same level, which goes up one · "extend" the river onto empty land that touches it · "widen" a river tile
// of the same level. l is the level left on the map and pts the points the move scores. A different level is never allowed,
// and a locked tile can't be combined onto or widened (the river can still be extended from a locked river tile).
// A habitat above bareGroundMaxLevel is offered no plant ("refuse"), or plants as level 1 ("downgrade": l is 1 and so are the points).
function options(S, i = 0) { const c = S.cfg, g = grid(c), t = S.q[i], out = [], at = k => [g.at[k][0], g.at[k][1]]; if (!t || S.over || S.pend.length) return out;
  if (t.k === "h") {
    if (t.l < c.maxLevel) for (const k in S.h) if (S.h[k] === t.l && !(k in S.lk)) { const from = S.hb[k];
      if (!c.biomeMatch || from === t.b) { const mm = from === "m" ? marshMult(S, k) : 1, mult = S.hf[k] === "meadow" ? meadowMult(S, k) : mm;   // biomeMatch: only the same kind combines. A meadow's level-up scores times 1 + its marsh and trees
        out.push({p:at(k), does:"combine", l:t.l + 1, pts:scoreOf(c, t.l + 1) * mult, ...(mult > 1 ? {mult} : {}), ...(mult > 1 && from === "m" ? {mk:"marsh"} : {})}) } }
    const lp = plantLevel(c, t.l);   // the level it lands as on empty land (0: refused)
    if (lp) for (const k of plantableFor(S, t)) { const mm = t.b === "m" ? marshMult(S, k) : 1; out.push({p:at(k), does:"plant", l:lp, pts:scoreOf(c, lp) * mm, ...(mm > 1 ? {mult:mm, mk:"marsh"} : {})}) }   // by kind: marsh on the river bank, prairie also next to prairie
  } else for (const o of riverMoves(S, t, c.riverRaiseGuard ? i : -1)) out.push(o);
  return out }
// Where river tile t can go: raise ("widen") a river tile of its own level, or extend the river onto empty land that touches it. skip is the tile's place in the pile when the stranding
// guard is on (riverRaiseGuard), and -1 for no guard.
function riverMoves(S, t, skip) { const c = S.cfg, g = grid(c), out = [], at = k => [g.at[k][0], g.at[k][1]];
  // Rivers rise downstream (riverMonotone): a new river tile can't be lower than the tile it joins, and a tile can only be widened
  // once every tile that joins it is already that high, so a river is widened from its end back towards the source.
  const mono = c.riverMonotone, el = c.elevation ? elevOf(c, S.seed) : null, has = mono || el ? new Set(Object.values(S.r).map(v => v.from)) : null, kidMin = {};
  if (mono) for (const k in S.r) { const f = S.r[k].from; if (f != null) kidMin[f] = Math.min(kidMin[f] === undefined ? 99 : kidMin[f], S.r[k].l) }
  if (t.l < riverTop(c)) for (const k in S.r) if (S.r[k].l === t.l && !(k in S.lk) && (!mono || (kidMin[k] === undefined ? 99 : kidMin[k]) > t.l) && (skip < 0 || !strands(S, skip, k, t.l + 1))) out.push({p:at(k), does:"widen", l:t.l + 1, pts:riverPts(c, t.l + 1, true)});   // "widen" is raising a river tile a level, up to riverTop
  for (const k of g.land) if (!(k in S.h) && !(k in S.r) && g.nb[k].some(q => q in S.r)) { const j = has ? joinTo(S, at(k), has) : null;   // j: the river tile it would flow from
    if ((!mono || S.r[j].l <= t.l) && (!el || el[k] <= el[j])) out.push({p:at(k), does:"extend", l:t.l, pts:riverPts(c, t.l, false)}) }   // rivers never go up (LOU-310): the new tile can't be higher than the one behind it
  return out }
// The stranding guard (riverRaiseGuard; Dan, Nov 21: "fix the opening trap"). Would raising river tile k to level nl leave a river tile that is waiting in the pile (not the one being placed, at skip) with no legal move?
// Four river tiles open a run, so raising the source with the first strands the other three: a level 1 river tile can't be lower than the source it would flow from. The pile that counts is what the player can see.
function strands(S, skip, k, nl) { const r = S.r[k], old = r.l; r.l = nl; let bad = false;
  for (let j = 0; j < S.q.length && !bad; j++) if (j !== skip && S.q[j].k === "r" && !riverMoves(S, S.q[j], -1).length) bad = true;
  r.l = old; return bad }
// How much land a river move would open: the empty land it newly brings within reach.
function opens(S, i, o) { const t = S.q[i]; if (!t || t.k !== "r") return 0;
  const before = reachOf(S), k0 = key(o.p); let n = 0;
  for (const k of ball(S.cfg, o.p, reachAt(S.cfg, o.l), new Set())) if (!before.has(k) && k !== k0 && openKey(S, k)) n++; return n }
// The one-line reason tile i can't go on p.
function why(S, i, p) { const c = S.cfg, t = S.q[i]; if (S.pend.length) return "Choose an upgrade first."; if (!t) return "No tiles left."; if (!p || !inside(c, p)) return "";
  const k = key(p), hl = S.h[k], rv = S.r[k];
  if (codeAt(c, p) === "B") return t.k === "r" ? "The river can't cross a mountain." : "Nothing grows on a mountain.";
  if (k in S.lk) return "That tile is locked.";
  if (t.k === "h") {
    const no = plantLevel(c, t.l) ? "" : `Only level ${c.bareGroundMaxLevel}${c.bareGroundMaxLevel > 1 ? " or lower" : ""} can be planted on bare ground. Combine it or discard it.`;   // "refuse": nothing above the limit is planted
    if (rv) return no || "That's the river. Plant beside it.";
    if (hl) { const hb = S.hb[k];
      if (hl >= c.maxLevel) return hb ? `${BIOME_NAME[hb]} level ${hl} is the top level.` : `${levelName(c, hl)} is the top level.`;
      if (c.biomeMatch && hb !== t.b) return t.b === "t" ? `That's ${tileText(c, {k:"h", l:hl, b:hb})}. Trees go on open land, or on a tree of the same level.` : `That's ${tileText(c, {k:"h", l:hl, b:hb})}. Only a tile of the same kind and level goes on it.`;   // another kind
      return `That's level ${hl}. Only a level ${hl} tile can go on it.` }
    if (no) return no;
    if (t.b === "t") return c.upgradeLevel > 0 ? "Trees plant on open land in the river's reach, or next to a pine-oneer." : "Trees plant on open land in the river's reach.";
    if (t.b === "m" && c.marshNeedsRiver) return c.upgradeLevel > 0 ? "Marsh needs a tile next to the river or a reed bed." : "Marsh needs a tile next to the river.";
    if (t.b === "p" && c.prairieSpreads) return "Prairie needs a tile within reach of the river or next to prairie.";
    return "Too far from the river." }
  if (hl) return "A river tile needs empty land.";
  if (rv) { if (rv.l >= riverTop(c)) return riverTop(c) > widthTop(c) ? `River level ${rv.l} is the top level.` : "The river is at its widest here."; if (rv.l !== t.l) return `Only a level ${rv.l} river tile ${rv.l < widthTop(c) ? "widens this" : "levels this up"}.`;
    if (c.riverRaiseGuard && riverMoves(S, t, -1).some(o => o.does === "widen" && key(o.p) === k)) return "Extend the river first: raising it now would leave your other river tiles nowhere to go.";   // the raise is legal except for the guard
    return c.riverMonotone ? "The river after this tile is lower. Widen downstream first." : "" }
  if (!grid(c).nb[k].some(q => q in S.r)) return "A river tile has to touch the river.";
  const jt = joinTo(S, p), up = S.r[jt];
  if (c.elevation && jt != null) { const e = elevOf(c, S.seed); if (e[k] > e[jt]) return `Rivers can't flow uphill: that land is height ${e[k]} and the river beside it is height ${e[jt]}.` }
  return c.riverMonotone && up && up.l > t.l ? `A river tile can't be lower than the one it flows from (level ${up.l}).` : "" }
// Which river tile a new one joins, for drawing: the river's end if it touches one, otherwise the newest river tile it touches.
function joinTo(S, p, has = new Set(Object.values(S.r).map(v => v.from))) { let best = null;
  for (const q of nbrs(S.cfg, p)) { const k = key(q), v = S.r[k]; if (!v) continue; const end = !has.has(k);
    if (!best || (end && !best.end) || (end === best.end && v.n > best.n)) best = {k, end, n:v.n} }
  return best ? best.k : null }
function note(S, t, did, p, l, pts, copies) { const e = {n:S.moves.length, t, did, at:p ? [p[0], p[1]] : null, l, pts, score:S.score, room:plantable(S).length}; if (copies) e.copies = copies; S.log.push(e) }
// Put tile i on p. Returns what happened ({does, l, pts, tile, greened: the land newly within reach}), or null if it can't go there.
function place(S, i, p) { const o = options(S, i).find(o => o.p[0] === p[0] && o.p[1] === p[1]); if (!o) return null;
  const t = S.q.splice(i, 1)[0], k = key(p), c = S.cfg, before = t.k === "r" ? reachOf(S) : null; let got = {free:[], lifts:[], pts:0, liftPts:0};
  if (o.does === "plant") { S.h[k] = o.l; if (t.b) S.hb[k] = t.b; if (t.f && o.l >= c.upgradeLevel) S.hf[k] = t.f; S.planted++ }   // o.l is the level it lands as: the tile's own, or 1 when "downgrade" lowers it. A copy keeps its upgrade if it lands at the upgrade level
  else if (o.does === "combine") { S.h[k] = o.l; S.combined++; got = levelUp(S, k) }   // the habitat levels up, so its upgrade fires
  else if (o.does === "extend") { S.r[k] = {l:t.l, from:joinTo(S, p), n:S.rn++}; S.extended++ }
  else { S.r[k].l = o.l; S.widened++ }
  const pts = o.pts + got.pts; S.score += pts; if (t.k === "h") { S.top = Math.max(S.top, o.l); needPick(S, k) }   // a river move scores only when riverScore says so (o.pts is 0 otherwise); pts also has what a steppe's free tiles scored
  if (t.c) { S.copyPlaced++; S.copyPoints += pts }
  earn(S); S.used++; S.moves.push({a:"p", i, x:p[0], y:p[1]});
  const greened = before ? [...reachOf(S)].filter(q => !before.has(q)) : [];
  fill(S); note(S, t, o.does, p, o.l, pts); const e = S.log[S.log.length - 1]; if (o.mult > 1) { e.mult = o.mult; if (o.mk) e.mk = o.mk } if (got.free.length) e.free = got.free; if (got.lifts.length) { e.lifted = got.lifts.length; e.liftPts = got.liftPts } return {...o, pts, tile:t, greened, free:got.free, lifts:got.lifts, liftPts:got.liftPts} }
// Throw tile i away. It scores nothing and still uses up the tile, so a run can never get stuck.
function discard(S, i = 0) { if (S.over || !S.q[i] || S.pend.length) return null; const t = S.q.splice(i, 1)[0];
  S.discarded++; if (t.c) S.copyDiscarded++; S.used++; S.moves.push({a:"d", i}); fill(S); note(S, t, "discard", null, 0, 0); return {does:"discard", tile:t} }

// ---------- locking (LOU-299). Lock a tile and every neighbour that is an unlocked habitat or river tile at or below its
// level is copied, exactly, to the back of the pile. The originals stay. The locked tile can't be combined onto, widened,
// locked again or copied, but it keeps its score, still counts as the top level, and (a river tile) still reaches land.
// A lock is earned for every lockEvery tiles placed (discards don't count); only lockHold can be held, and one earned
// while holding that many is lost. A lock doesn't use the tile in hand.
function earn(S) { const c = S.cfg; if (!c.lockEnabled || c.lockEvery <= 0 || ++S.toLock < c.lockEvery) return; S.toLock = 0; if (S.locks < c.lockHold) S.locks++; else S.lockLost++ }
const hasLock = S => S.cfg.lockEnabled && (S.cfg.lockEvery === 0 || S.locks > 0);
const lockable = (S, p) => { const k = key(p); return hasLock(S) && !S.over && !S.pend.length && !(k in S.lk) && (k in S.h || (k in S.r && S.cfg.lockRivers)) };
// What locking the tile at p would do: copies (the tiles banked, river tiles first, then habitats from the lowest level),
// from (the neighbours they are copied from, in the same order) and high (neighbours above its level, which give nothing).
function copiesOf(S, p) { const c = S.cfg, k0 = key(p), L = k0 in S.h ? S.h[k0] : k0 in S.r ? S.r[k0].l : 0, from = [], high = [];
  for (const k of grid(c).nb[k0] || []) { if (k in S.lk || across(S, k0, k, "copy")) continue; const t = k in S.h ? {k:"h", l:S.h[k], c:1, ...(S.hb[k] ? {b:S.hb[k]} : {}), ...(S.hf[k] ? {f:S.hf[k]} : {})} : k in S.r && c.lockRivers ? {k:"r", l:S.r[k].l, c:1} : null; if (!t) continue;
    if (c.lockLevelCap && t.l > L) high.push(k); else from.push([k, t]) }
  from.sort((a, b) => (a[1].k === "r" ? 0 : 1) - (b[1].k === "r" ? 0 : 1) || a[1].l - b[1].l);
  return {copies:from.map(f => f[1]), from:from.map(f => f[0]), high} }
// Would any lock the player holds bank a copy? (When the pile is empty, the run goes on only while this is true.)
function lockWouldCopy(S) { if (!hasLock(S)) return false; const c = S.cfg;
  for (const k in S.h) if (!(k in S.lk) && copiesOf(S, unkey(k)).copies.length) return true;
  if (c.lockRivers) for (const k in S.r) if (!(k in S.lk) && copiesOf(S, unkey(k)).copies.length) return true; return false }
// Copies go to the back of the pile (S.bank). With lockCopiesGo "front", or an endless stack (which has no back), they
// become the next tiles instead.
function lock(S, p) { if (!lockable(S, p)) return null; const c = S.cfg, k = key(p), got = copiesOf(S, p), t = k in S.h ? {k:"h", l:S.h[k], ...(S.hb[k] ? {b:S.hb[k]} : {}), ...(S.hf[k] ? {f:S.hf[k]} : {})} : {k:"r", l:S.r[k].l};
  S.lk[k] = 1; if (c.lockEvery !== 0) S.locks--; S.lockUsed++; S.copyBanked += got.copies.length;
  if (c.lockCopiesGo === "front" || c.stackSize === 0) S.q.splice(Math.min(1, S.q.length), 0, ...got.copies); else S.bank.push(...got.copies);
  S.moves.push({a:"l", x:p[0], y:p[1]}); fill(S); note(S, t, "lock", p, t.l, 0, got.copies); return {does:"lock", tile:t, ...got} }
// End the run by hand, once the pile is empty.
function end(S) { if (S.over || S.q.length || S.pend.length) return null; S.over = true; S.moves.push({a:"e"}); note(S, null, "end", null, 0, 0); return {does:"end"} }
function apply(S, m) { return m.a === "p" ? place(S, m.i, [m.x, m.y]) : m.a === "d" ? discard(S, m.i) : m.a === "l" ? lock(S, [m.x, m.y]) : m.a === "e" ? end(S) : m.a === "u" ? pick(S, m.x + "," + m.y, m.f) : null }
function replay(cfg, seed, moves) { const S = fresh(cfg, seed);
  for (const m of moves) if (!apply(S, m)) throw new Error("Flowgrow: move " + (S.moves.length + 1) + " can't be replayed"); return S }

// ---------- words
const tileText = (c, t) => t.k === "r" ? (t.l > 1 ? `River tile (level ${t.l})` : "River tile") : t.b ? `${BIOME_NAME[t.b]} (level ${t.l})` : (n => n === "Level " + t.l ? n : `${n} (level ${t.l})`)(levelName(c, t.l));
const DID = {plant:"planted", combine:"combined", extend:"extended the river", widen:"widened the river", discard:"discarded"};
const extras = e => (e.mult > 1 ? ` (${e.mk === "marsh" ? "Marsh" : "Meadow"} ×${e.mult})` : "") + (e.free ? ` (Steppe planted ${e.free.length} free)` : "") + (e.lifted ? ` (Roots lifted ${e.lifted}, ${e.liftPts} points)` : "");   // what a level-up's upgrade did, for the run log
// The run log: one line per move, with the tile (dealt, or a copy), what was done and where, the points, the score and the
// plantable tiles left. A lock's line has the tile locked and the copies it banked.
function logText(S) { const c = S.cfg, lines = [`Flowgrow run log · seed ${S.seed} · ${c.stackSize ? c.stackSize + " tiles" : "endless"} · places are column,row from 0`];
  for (const e of S.log) lines.push(e.did === "end" ? `${e.n}. Ended the run · score ${e.score}` :
    e.did === "pick" ? `${e.n}. Picked ${UPGRADE[e.f].name} for the ${BIOME_NAME[e.t.b].toLowerCase()} tile at ${e.at[0]},${e.at[1]} · score ${e.score}` :
    e.did === "lock" ? `${e.n}. Locked ${tileText(c, e.t)} at ${e.at[0]},${e.at[1]} · banked ${e.copies.length ? `${e.copies.length} ${e.copies.length === 1 ? "copy" : "copies"}: ${e.copies.map(t => tileText(c, t)).join(", ")}` : "no copies"} · score ${e.score}` :
    `${e.n}. ${tileText(c, e.t)}, ${e.t.c ? "copy" : "dealt"} · ${DID[e.did]}${e.at ? ` at ${e.at[0]},${e.at[1]}` : ""}${e.did === "combine" ? `, now level ${e.l} ${e.t.b ? BIOME_NAME[e.t.b] : levelName(c, e.l)}` : e.did === "widen" ? `, now level ${e.l}` : e.did === "plant" && e.l < e.t.l ? `, as level ${e.l} ${e.t.b ? BIOME_NAME[e.t.b] : levelName(c, e.l)}` : ""} · +${e.pts}${extras(e)} · score ${e.score} · ${e.room} plantable left`);
  const locks = c.lockEnabled ? ` · locks used ${S.lockUsed}, lost ${S.lockLost} · copies banked ${S.copyBanked}, placed ${S.copyPlaced}, discarded ${S.copyDiscarded} · ${S.copyPoints} points from copies` : "";
  lines.push(S.over ? `Run over · score ${S.score} · top level ${S.top} · planted ${S.planted} · combined ${S.combined} · river extended ${S.extended}, widened ${S.widened} · discarded ${S.discarded}${locks}` : `Still playing · score ${S.score} · ${left(S)} tiles left${locks}`);
  return lines.join("\n") }
const settingsText = c => ["Flowgrow settings", ...KEYS.map(([k, , label]) => `${label}: ${k === "map" ? "\n  " + c.map.join("\n  ") : Array.isArray(c[k]) ? c[k].join(", ") : c[k]}`)].join("\n");

const rules = {HEX, step, hexDist, key, unkey, KEYS, tidy, mapOf, parseTile, tileWord, inside, codeAt, nbrs, isOpen, levelName, scoreOf, riverTop, reachAt, plantLevel, seedOf, rulesKey,
  roll, fill, left, fresh, reachOf, plantable, options, opens, why, place, discard, replay, tileText, logText, settingsText, upgradeOf, UPGRADE, PICKS, reedBedAt, pick, needPick, undoCount, meadowMult, marshMult, freeSpots, makeElevation, elevOf, fallAt, across,
  hasLock, lockable, copiesOf, lockWouldCopy, lock, end};
G.Flowgrow = {rules};
// With no page, or when the simulator asks (FLOWGROW_SIM), the file stops here: only the rules are loaded.
if (typeof document === "undefined" || G.FLOWGROW_SIM) return;

// ====================================================================================================================
// Part 2: the page. A quick prototype (Dan, Nov 19: "just make a quick MVP to prototype"): the island, the river, the pile
// and the seven levels, in Flow Tile's hexes and colours. The projection, the land painting and the tree painters are
// trimmed copies from play.js. The pile runs across the bottom, front to back (Dan, Nov 19: "where's the tile pile?").
// Locking (LOU-299) has its button, lock mode, a confirm card and the banked copies at the back of the pile.
// Not built yet: Tuning, sound, the settings sheet and the painterly extras.
// ====================================================================================================================
// Which page loaded this file (LOU-315, LOU-316). A page names itself before the file loads: window.FLOWGROW_PAGE = "test" is the test build (LOU-315): the plain look only, nothing that needs art, the rules switches in the address and the
// test tools. With no name the page is as it always was. Nothing in the rules (part 1) knows about a page: a page only decides what this part draws, loads and keeps.
const PAGE = G.FLOWGROW_PAGE || "", TEST = PAGE === "test";
// "play" is the public page (LOU-316): the 3D look by default and one game for a player: no look switch, no rules or seed in the address. ?dev=1 is a developer's door: it turns on ?look= and ?seed= (not the rules: they stay on the test
// build), shows a small "dev" line and keeps its own saved run, so a developer never touches a player's.
const PLAY = PAGE === "play", DEV = PLAY && new URLSearchParams(location.search).get("dev") === "1";
const SRC_URL = document.currentScript.src, SW_URL = new URL(G.FLOWGROW_SW || "sw.js", SRC_URL).href; // sw.js sits next to this file (and the 3D look's files are found from here too); a page can name its own (the test build's)
const $ = id => document.getElementById(id), tx = (id, v) => { const e = $(id); if (e) e.textContent = v };
const MEMP = TEST ? "flowgrow.test." : DEV ? "flowgrow.dev." : "flowgrow.";   // the test build and a developer on the play page each have their own saved run, best scores and settings, so neither overwrites a player's run
const mem = {get(k) { try { return localStorage.getItem(MEMP + k) } catch (_) { return null } },
  set(k, v) { try { if (v == null) localStorage.removeItem(MEMP + k); else localStorage.setItem(MEMP + k, v) } catch (_) {} }};
// Until Nov 20, 2026 Flowgrow lived inside Flow Tile and saved under "flowtile.flowgrow.". Both sites share one address, so those old
// keys may still be here: bring the best score and any run in progress across once, then drop them.
if (!TEST && !DEV) for (const k of ["best", "run.v2"]) try { const old = localStorage.getItem("flowtile.flowgrow." + k); if (old != null) { if (mem.get(k) == null) mem.set(k, old); localStorage.removeItem("flowtile.flowgrow." + k) } } catch (_) {}
if (!TEST && !DEV) for (const v of ["run.v2", "run.v3", "run.v4", "run.v5", "run.v6", "run.v7", "run.v8", "run.v9", "run.v10", "run.v11"]) mem.set(v, null); // runs are saved as run.v12.<ruleset> since LOU-310 (Nov 21: one slot for each ruleset, so the elevation maps keep their own runs; run.v11 since the marsh ramp, run.v10 since LOU-309, run.v9 since the stranding guard, run.v8 since LOU-306) (a rule change can make an older move list illegal, so each one bumps the version): the older keys are dead, drop them
// Any config value can be changed in the address for one visit, as key=value, with the simulator's names and checks (LOU-309: "so he can play it"), for example ?marshRiverMultiplier=true. A run and its
// best score are kept per ruleset, so they never mix with the default game's (and each ruleset has its own saved run slot, run.v12.<ruleset>).
const QS = {}; if (!PLAY) for (const [k, v] of new URLSearchParams(location.search)) if (KEYS.some(e => e[0] === k)) QS[k] = v;   // the play page has no rules in its address: they are for the test build
const MADE = tidy({...G.FLOWGROW, ...QS}, G.FLOWGROW), CFG = MADE.cfg, ASKED = Object.keys(QS).filter(k => !MADE.bad.includes(k) && JSON.stringify(CFG[k]) !== JSON.stringify(G.FLOWGROW[k])), GRID = grid(CFG), W = CFG.map[0].length, H = CFG.map.length;
const RK = rulesKey(CFG), BEST = "best." + RK, SLOT = "run.v13." + RK, NAME = G.FLOWGROW_NAME || "";   // each ruleset has its own saved run too (run.v13: LOU-314 changed what a tree can do, so a save from before it, which can hold a move that is no longer legal, is never read), so the maps and the usual game don't overwrite one another; NAME is set by a map page // the best score is kept per ruleset (every number that changes how a run plays), so scores from different rules never meet
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches, now = () => performance.now();
let S = null, opts = [], landSig = "", wonShown = false, msgT = 0, lockMode = false, lockSel = null, lockList = [], carryCell = null, swallow = 0;   // carryCell: the cell a carried tile hovers over (LOU-317); swallow: a press-and-hold lock has already used this touch, so its lift is not a tap
const pops = {}, fx = [];

// ---------- the look (Dan, Nov 20): "simple" is flat blue and green hexes with a number on each, for piloting; "painted" is the first look.
// The page opens on the simple look. ?look=painted shows the painted one for that visit, and the menu's Look row switches and remembers.
// LOU-311: "3d" is a third look, drawn by flowgrow.look3d.js (and the vendored three.js), which are loaded only when it is asked for. Until it has loaded the page draws the simple look.
const LOOKS = TEST ? ["simple"] : ["simple", "painted", "3d"];   // the test build has the plain look only (LOU-315): no ?look=, nothing that needs art
const LOOK_PARAM = new URLSearchParams(location.search).get("look"), DEV_LOOK = DEV && LOOKS.includes(LOOK_PARAM);   // ?dev=1&look= fixes a look (and the play page then keeps it, with no fallback)
const WANT = TEST ? "simple" : PLAY ? (DEV_LOOK ? LOOK_PARAM : "3d") : (() => { const u = new URLSearchParams(location.search).get("look"), m = mem.get("look"); return LOOKS.includes(u) ? u : new URLSearchParams(location.search).has("example") ? "3d" : LOOKS.includes(m) ? m : "simple" })();   // ?example= (an example island) is only drawn by the 3D look, so it opens that
let skin = WANT === "3d" ? "simple" : WANT, L3 = null;   // L3: the 3D look's controller, once it is mounted (then skin is "3d")
const flat = () => skin !== "painted";   // the simple look and the 3D look share the flat maths and the simple tile pictures
$("app").classList.toggle("simple", flat());
const markLook = () => { const a = $("app"); a.dataset.look = skin; a.classList.toggle("pg-test", TEST) };   // (LOU-317) the screen's ink follows the look: white on the 3D look's teal sea, dark on the pale painted and plain looks
markLook();

// ---------- the hex projection (from play.js): pointy-top hexes built flat in world space (radius R), then projected isometrically (or, in the simple look, not at all)
const cv = $("cv"), ctx0 = cv.getContext("2d"); let ctx = ctx0;
const R = 46, SQ3 = Math.sqrt(3), DEPTH = 30, TAU = Math.PI * 2, HAND = "'M PLUS Rounded 1c', Nunito, sans-serif";
const world = (x, y) => [x * SQ3 * R + (y & 1 ? SQ3 * R / 2 : 0), y * 1.5 * R];
const proj = (wx, wy) => flat() ? {x:wx, y:wy} : {x:(wx - wy) * .7071, y:(wx + wy) * .3536};
const iso = (x, y) => { const [wx, wy] = world(x, y); return proj(wx, wy) };
const ORDER = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ORDER.push([x, y]);
const resort = () => ORDER.sort((a, b) => iso(...a).y - iso(...b).y || iso(...a).x - iso(...b).x); resort(); // back to front
function hexPts(p, r = R) { const [wx, wy] = world(...p); return [0, 1, 2, 3, 4, 5].map(i => { const a = (60 * i - 90) * Math.PI / 180, q = proj(wx + r * Math.cos(a), wy + r * Math.sin(a)); return [q.x, q.y] }) }
// edge i of a hex runs from corner i to corner i + 1 and faces neighbour (7 - i) mod 6; it faces the viewer when its normal points down the screen
const EDGE_FACE = i => (7 - i) % 6, FRONT = [0, 1, 2, 3, 4, 5].map(i => { const a = (60 * i - 60) * Math.PI / 180; return Math.cos(a) + Math.sin(a) > .01 });
function rpath(pts, rad = 8) { const n = pts.length, m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  ctx.beginPath(); ctx.moveTo(...m(pts[n - 1], pts[0])); for (let i = 0; i < n; i++) ctx.arcTo(...pts[i], ...m(pts[i], pts[(i + 1) % n]), rad); ctx.closePath() }
const hexPath = (tiles, r = R + 1) => { const P = new Path2D(); for (const p of tiles) { hexPts(p, r).forEach(([x, y], i) => i ? P.lineTo(x, y) : P.moveTo(x, y)); P.closePath() } return P };
const bounds = () => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const p of ORDER) for (const [x, y] of hexPts(p)) { a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, y); d = Math.max(d, y) }
  return flat() ? {x:a - 12, y:b - 12, w:c - a + 24, h:d - b + 24} : {x:a - 14, y:b - 112, w:c - a + 28, h:d - b + 112 + DEPTH + 16} }; // painted: room above for the tallest tree
let B = bounds();

// ---------- paint helpers (from play.js)
function poly(pts, fill) { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fillStyle = fill; ctx.fill() }
function line(pts, col, w) { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke() }
function ell(x, y, rx, ry, fill) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7); ctx.fillStyle = fill; ctx.fill() }
function ink(col, w) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke() }
const rng = (...k) => { let s = 1; for (const v of ["flowgrow", ...k].join("|")) s = (Math.imul(s ^ v.charCodeAt(0), 2654435761) >>> 0) || 7; s = s % 2147483646 + 1; return () => (s = s * 16807 % 2147483647) / 2147483647 };
const inTile = (p, r, k = .78) => { const [wx, wy] = world(...p), a = r() * TAU, d = Math.sqrt(r()) * R * k, q = proj(wx + d * Math.cos(a), wy + d * Math.sin(a)); return [q.x, q.y] };
let ps = 1; // the resolution the island is painted at (device px per world unit)
function feather(path, col, blur) { ctx.save(); const sh = 5000; ctx.shadowColor = col; ctx.shadowBlur = blur * ps; ctx.shadowOffsetX = sh; ctx.translate(-sh / ps, 0); ctx.fillStyle = "#000"; ctx.fill(path); ctx.restore() }
const pebble = (x, y, s) => { ell(x, y + .6 * s, 2.4 * s, 1.2 * s, "rgba(70,60,40,.18)"); ell(x, y, 2.2 * s, 1.4 * s, "#b7b09c"); ell(x - .6 * s, y - .5 * s, 1 * s, .6 * s, "rgba(255,255,255,.6)") };
// A small white pill with text (from play.js): the level on a habitat, the points on a ring.
// A habitat that has an upgrade (LOU-304) also carries its upgrade's small mark at the left of the pill.
function tag(x, y, text, col = "#24434a", size = 15, locked = false, up = "") { ctx.save(); ctx.font = `800 ${size - 2}px ${HAND}`;
  const tw = text ? ctx.measureText(text).width : 0, lw = locked ? (text ? 11 : 8) : 0, uw = up ? 12 : 0, w = Math.max(18, tw + lw + uw + 14), hh = size + 5, left = x - (tw + lw + uw) / 2;
  const pill = (dx, dy) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2 + dx, y - hh / 2 + dy, w, hh, hh / 2) : ctx.rect(x - w / 2 + dx, y - hh / 2 + dy, w, hh) };
  pill(0, 1.5); ctx.fillStyle = "rgba(30,60,70,.2)"; ctx.fill(); pill(0, 0); ctx.fillStyle = "rgba(255,255,255,.95)"; ctx.fill();
  if (up) UPG_LOOK[up].mark(left + uw / 2 - 1, y, .5 * size / 15, ...UPG_LOOK[up].pill);
  if (locked) { const lx = left + uw; ctx.fillStyle = col; ctx.fillRect(lx, y - 1, 8, 6); ctx.beginPath(); ctx.arc(lx + 4, y - 1, 2.6, Math.PI, 0); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke() } // a small padlock
  ctx.fillStyle = col; ctx.textAlign = "center"; ctx.textBaseline = "middle"; if (text) ctx.fillText(text, x + (lw + uw) / 2, y + 1); ctx.restore() }

// ---------- the look of upgrades (LOU-304; Dan: "should it be an aesthetic difference as well?"). An upgrade shows in the simple look as a tinted rim round its tile and a small mark under the number, and in
// the painted look as a variation of the tile's art and the same mark on its level pill. Each upgrade has one entry here, so the next ones (steppe, meadow, roots, pine-oneer) plug in without reworking
// anything: add its id to UPGRADE in the rules (name and line) and its rim, mark and art here.
//   rim            the tint of the rim round the tile (simple look)
//   tile, pill     the two colours the mark is drawn in on a tile and on the level pill: [stalks, heads]
//   mark(x, y, s, a, b)   the mark itself, about 14 units across, centred on x, y in the current frame, in colours a and b
//   art(p)         the painted look's variation of tile p, drawn after its patch and before the picture that stands on it
//   icon(cx, cy, rad)     the same variation on a pile tile's disc (device pixels)
const reedClump = (x, y, r, s = 1) => { const n = 2 + (r() < .5 ? 1 : 0);
  for (let i = 0; i < n; i++) { const dx = (i - (n - 1) / 2) * 2.6 * s + (r() - .5) * 1.4 * s, h = (10 + r() * 7) * s, lean = (r() - .5) * 4 * s;
    ctx.beginPath(); ctx.moveTo(x + dx, y); ctx.quadraticCurveTo(x + dx + lean * .3, y - h * .55, x + dx + lean, y - h); ctx.strokeStyle = i % 2 ? "#6f8f3c" : "#5d7f33"; ctx.lineWidth = 1.2 * s; ctx.lineCap = "round"; ctx.stroke();
    if (r() < .6) ell(x + dx + lean, y - h - 1.2 * s, 1.5 * s, 3.4 * s, "#7a4a2a");   // a cattail head
    if (r() < .5) { ctx.beginPath(); ctx.moveTo(x + dx, y - h * .35); ctx.quadraticCurveTo(x + dx + 4 * s, y - h * .7, x + dx + 6 * s, y - h * .9); ctx.strokeStyle = "rgba(111,143,60,.8)"; ctx.lineWidth = .9 * s; ctx.stroke() } } };   // and a leaf blade
const alongEdges = (p, key, fn) => { const r = rng(key, p), pts = hexPts(p, R - 6); for (let i = 0; i < 6; i++) { const a = pts[i], b = pts[(i + 1) % 6]; for (const t of [.2, .5, .8]) fn(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r) } };
const roundDisc = (cx, cy, rad, key, fn) => { const r = rng(key, "icon", Math.round(rad)), s = rad / 36; for (let i = 0; i < 10; i++) { const ang = (i * 19 + 5) * Math.PI / 180; fn(cx + rad * .98 * Math.cos(ang), cy + rad * .9 * Math.sin(ang), r, s) } };
// a steppe's seed heads fanning outward, and a meadow's flowers in bloom
const seedClump = (x, y, r, s = 1) => { const n = 2 + (r() < .5 ? 1 : 0);
  for (let i = 0; i < n; i++) { const dx = (i - (n - 1) / 2) * 3 * s, h = (11 + r() * 7) * s, lean = (r() - .5) * 3 * s; ctx.beginPath(); ctx.moveTo(x + dx, y); ctx.quadraticCurveTo(x + dx + lean * .3, y - h * .5, x + dx + lean, y - h); ctx.strokeStyle = "#b8902a"; ctx.lineWidth = 1.1 * s; ctx.lineCap = "round"; ctx.stroke();
    for (const a of [-.7, -.35, 0, .35, .7]) { ctx.beginPath(); ctx.moveTo(x + dx + lean, y - h); ctx.lineTo(x + dx + lean + Math.sin(a) * 6 * s, y - h - Math.cos(a) * 6 * s); ctx.strokeStyle = "#f0d46a"; ctx.lineWidth = .9 * s; ctx.stroke() } } };
const flowerClump = (x, y, r, s = 1) => { const n = 2 + (r() < .5 ? 1 : 0);
  for (let i = 0; i < n; i++) { const dx = (i - (n - 1) / 2) * 3.4 * s + (r() - .5) * s, h = (6 + r() * 6) * s, col = ["#ff7fb0", "#ffffff", "#ffd24d", "#b48cff"][Math.floor(r() * 4)];
    ctx.beginPath(); ctx.moveTo(x + dx, y); ctx.lineTo(x + dx, y - h); ctx.strokeStyle = "#5d7f33"; ctx.lineWidth = 1 * s; ctx.lineCap = "round"; ctx.stroke(); for (let k = 0; k < 5; k++) { const a = k * TAU / 5; ell(x + dx + Math.cos(a) * 1.9 * s, y - h + Math.sin(a) * 1.9 * s, 1.5 * s, 1.5 * s, col) } ell(x + dx, y - h, 1.1 * s, 1.1 * s, "#e8a317") } };
// roots curling out under a tile, and a small pine with a cone (the trees' upgrades)
const rootClump = (x, y, r, s = 1) => { for (let i = 0; i < 2; i++) { const dx = (i - .5) * 5 * s + (r() - .5) * 2 * s, ex = dx + (r() - .5) * 12 * s, ey = y + (7 + r() * 4) * s;
    ctx.beginPath(); ctx.moveTo(x + dx, y); ctx.quadraticCurveTo(x + dx + (r() - .5) * 6 * s, y + 4 * s, x + ex, ey); ctx.quadraticCurveTo(x + ex + 3 * s, ey + 2.6 * s, x + ex + 1.4 * s, ey - 1.2 * s); ctx.strokeStyle = "#7a5230"; ctx.lineWidth = 1.7 * s; ctx.lineCap = "round"; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + dx, y); ctx.quadraticCurveTo(x + dx + 1 * s, y + 4 * s, x + ex, ey); ctx.strokeStyle = "rgba(190,140,90,.7)"; ctx.lineWidth = .7 * s; ctx.stroke() } };
const pineClump = (x, y, r, s = 1) => { const h = (13 + r() * 5) * s; ctx.fillStyle = "#5a3d22"; ctx.fillRect(x - .9 * s, y - 3 * s, 1.8 * s, 3 * s);
  for (const [t, w] of [[0, 5.5], [.34, 4.4], [.66, 3.2]]) { const by = y - 2 * s - t * h * .8, tp = by - h * .5; ctx.beginPath(); ctx.moveTo(x, tp); ctx.lineTo(x + w * s, by); ctx.lineTo(x - w * s, by); ctx.closePath(); ctx.fillStyle = "#2f5f55"; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, tp); ctx.lineTo(x - w * s, by); ctx.lineTo(x - .5 * s, by); ctx.closePath(); ctx.fillStyle = "#4f8a72"; ctx.fill() }
  if (r() < .7) ell(x + 3 * s, y - 1 * s, 1.5 * s, 2.2 * s, "#7a4a2a") };
const UPG_LOOK = {
  roots: {rim:"#e3b66b", tile:["#f6dfb0", "#8a5a2b"], pill:["#8a5a2b", "#3d6a2a"],
    mark(x, y, s, a, b) { ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.lineCap = "round"; ctx.strokeStyle = a; ctx.lineWidth = 1.7;   // roots curling out from one point
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, 0); ctx.stroke(); ell(0, -7, 1.9, 1.9, b);
      for (const g of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(g * 5, 1, g * 6.5, 6); ctx.quadraticCurveTo(g * 7.4, 9, g * 4.6, 8.2); ctx.stroke() }
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(.8, 4, -1.2, 8.5); ctx.stroke(); ctx.restore() },
    art(p) { alongEdges(p, "roots", rootClump) }, icon(cx, cy, rad) { roundDisc(cx, cy, rad, "roots", rootClump) } },
  pine: {rim:"#b9e6cf", tile:["#e1f6ea", "#8a5a2b"], pill:["#2f6f4a", "#8a5a2b"],
    mark(x, y, s, a, b) { ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = a;   // a small pine
      for (const [apex, base, w] of [[-8, -2, 4.5], [-5, 2, 6], [-1, 6, 7.5]]) { ctx.beginPath(); ctx.moveTo(0, apex); ctx.lineTo(w, base); ctx.lineTo(-w, base); ctx.closePath(); ctx.fill() }
      ctx.fillStyle = b; ctx.fillRect(-1, 6, 2, 3); ctx.restore() },
    art(p) { alongEdges(p, "pine", pineClump) }, icon(cx, cy, rad) { roundDisc(cx, cy, rad, "pine", pineClump) } },
  steppe: {rim:"#c4451c", tile:["#fff4d6", "#7a2f10"], pill:["#a86a10", "#7a2f10"],
    mark(x, y, s, a, b) { ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.lineCap = "round"; ctx.strokeStyle = a; ctx.lineWidth = 1.5;   // five seed heads fanning out from one point
      for (const g of [-.95, -.48, 0, .48, .95]) { const tx2 = Math.sin(g) * 9, ty = 7 - Math.cos(g) * 12; ctx.beginPath(); ctx.moveTo(0, 7); ctx.lineTo(tx2, ty); ctx.stroke(); ell(tx2, ty, 1.7, 1.7, b) }
      ctx.restore() },
    art(p) { alongEdges(p, "steppe", seedClump) }, icon(cx, cy, rad) { roundDisc(cx, cy, rad, "steppe", seedClump) } },
  meadow: {rim:"#d63f8e", tile:["#fff0f7", "#f2b100"], pill:["#d63f8e", "#e8a317"],
    mark(x, y, s, a, b) { ctx.save(); ctx.translate(x, y); ctx.scale(s, s); for (let k = 0; k < 5; k++) { const g = k * TAU / 5 - Math.PI / 2; ell(Math.cos(g) * 4.2, Math.sin(g) * 4.2, 2.7, 2.7, a) } ell(0, 0, 2.3, 2.3, b); ctx.restore() },   // a flower in bloom
    art(p) { alongEdges(p, "meadow", flowerClump) }, icon(cx, cy, rad) { roundDisc(cx, cy, rad, "meadow", flowerClump) } },
  reed: {rim:"#f1e6a8", tile:["#fff3c4", "#a8743a"], pill:["#5d7f33", "#7a4a2a"],
    mark(x, y, s, a, b) { ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.lineCap = "round"; ctx.strokeStyle = a; ctx.lineWidth = 1.7;   // three reeds with cattail heads
      for (const [dx, lean] of [[-3.8, -.8], [0, 0], [3.8, .8]]) { ctx.beginPath(); ctx.moveTo(dx, 7); ctx.lineTo(dx + lean, -3); ctx.stroke(); ell(dx + lean * 1.2, -5, 1.8, 3.4, b) }
      ctx.restore() },
    art(p) { const r = rng("reed", p), pts = hexPts(p, R - 6); for (let i = 0; i < 6; i++) { const a = pts[i], b = pts[(i + 1) % 6]; for (const t of [.2, .5, .8]) reedClump(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r) } },   // reeds standing along the six edges
    icon(cx, cy, rad) { const r = rng("reed", "icon", Math.round(rad)), s = rad / 36; for (let i = 0; i < 10; i++) { const ang = (i * 19 + 5) * Math.PI / 180; reedClump(cx + rad * .98 * Math.cos(ang), cy + rad * .9 * Math.sin(ang), r, s) } } } };   // and round a pile tile's disc
// The one plain line for a habitat's upgrade, or "": shown when a tap can't place the tile in hand on a tile that has one, and when a move gives a tile its upgrade.
const upgradeLine = t => { const u = upgradeOf(CFG, t); return u ? UPGRADE[u].line + "." : "" };

// ---------- the island: bare ground, and grass on the land within reach of the river. Painted once and kept until reach changes.
const COL = {bare:"#d6cf98", grass:"#86c46f"}, DABS = {grass:["#b3dc86", "#5a9f62", "#b9dc98"], bare:["#c9c48c", "#e4dbb0", "#dcd5a0"]};
const landC = document.createElement("canvas"), LPAD = 60; let landKey = "";
const isGreen = (reach, p) => reach.has(key(p)) && CFG.map[p[1]][p[0]] === "_";
// ---------- elevation on the page (LOU-310). Empty land is tinted darker the lower it is (the simple look) or lighter the higher it is (the painted look), a dark line runs along the high side of every step, and a
// waterfall is white foam lines across the edge a river tile stepped down at. All of it is worked out from the heights and the river each time it is drawn.
const EL = () => CFG.elevation && S ? elevOf(CFG, S.seed) : null;
function stepEdges(fn) { const E = EL(); if (!E) return; for (const p of ORDER) { const k = key(p); if (CFG.map[p[1]][p[0]] === "B") continue; const hp = hexPts(p, R - 1.5);
  for (let i = 0; i < 6; i++) { const q = step(p, EDGE_FACE(i)); if (inside(CFG, q) && CFG.map[q[1]][q[0]] !== "B" && E[key(q)] < E[k]) fn(hp[i], hp[(i + 1) % 6]) } } }   // edge i faces neighbour EDGE_FACE(i)
function fallMarks() { if (!CFG.elevation) return; for (const k in S.r) { if (!fallAt(S, k)) continue; const p = GRID.at[k], v = S.r[k], c = iso(...p), hp = hexPts(p, R - 1.5);
  for (let d = 0; d < 6; d++) if (key(step(p, d)) === v.from) { const i = (7 - d) % 6, a = hp[i], b = hp[(i + 1) % 6], m = z => [z[0] + (c.x - z[0]) * .3, z[1] + (c.y - z[1]) * .3];
    line([a, b], "rgba(255,255,255,.96)", 4.4); line([m(a), m(b)], "rgba(255,255,255,.75)", 2.6) } } }
function paintLand(reach) { const edges = [];
  for (const p of ORDER) { const h = hexPts(p); for (let i = 0; i < 6; i++) if (!inside(CFG, step(p, EDGE_FACE(i)))) edges.push({a:h[i], b:h[(i + 1) % 6], front:FRONT[i]}) }
  const top = hexPath(ORDER, R + .6);
  ctx.save(); ctx.translate(0, DEPTH + 10); feather(top, "rgba(70,110,120,.35)", 18); ctx.restore();     // the island's soft shadow on the sea
  for (const e of edges) if (e.front) { const y0 = Math.min(e.a[1], e.b[1]), g = ctx.createLinearGradient(0, y0, 0, y0 + DEPTH); g.addColorStop(0, "#a99171"); g.addColorStop(1, "#6f5c48"); // the earth cliff with a grass lip
    poly([[e.a[0], e.a[1] - 1], [e.b[0], e.b[1] - 1], [e.b[0], e.b[1] + DEPTH], [e.a[0], e.a[1] + DEPTH]], g);
    poly([[e.a[0], e.a[1] - 1], [e.b[0], e.b[1] - 1], [e.b[0], e.b[1] + 3.5], [e.a[0], e.a[1] + 3.5]], "#6f9e5c") }
  ctx.save(); ctx.clip(top); ctx.fillStyle = COL.bare; ctx.fill(top);
  const green = ORDER.filter(p => isGreen(reach, p)); if (green.length) feather(hexPath(green, R + 3), COL.grass, 14); // grass blends into the bare ground
  for (const p of ORDER) { const k = isGreen(reach, p) ? "grass" : "bare", r = rng("t", p), d = DABS[k], tint = r() < .5 ? "#ffffff" : "#3d5a3a";
    for (let i = 0; i < 18; i++) { const [x, y] = inTile(p, r, 1.08); ctx.globalAlpha = .22 + r() * .2; ctx.beginPath(); ctx.ellipse(x, y, 2 + r() * 3.5, 1 + r() * 1.6, (r() - .5) * .8, 0, TAU); ctx.fillStyle = i % 5 === 4 ? tint : d[i % d.length]; ctx.fill() }
    ctx.globalAlpha = 1;
    if (k === "grass") { for (let i = 0; i < 9; i++) { const [x, y] = inTile(p, r); line([[x, y], [x + (r() - .5) * 2.5, y - 3 - r() * 3]], i % 3 ? "rgba(70,140,80,.55)" : "rgba(190,225,150,.7)", 1.1) } }
    else { for (let i = 0; i < 3; i++) { const [x, y] = inTile(p, r); pebble(x, y, .6 + r() * .4) }
      if (r() < .3) { const [x, y] = inTile(p, r, .5); line([[x - 6, y], [x - 1, y + 2], [x + 4, y - 1], [x + 7, y + 1]], "rgba(120,100,60,.35)", .9) } } }
  ctx.strokeStyle = "rgba(255,255,255,.09)"; ctx.lineWidth = 1; for (const p of ORDER) { rpath(hexPts(p, R - .5), 6); ctx.stroke() } // the hex grid, just a hint
  if (CFG.elevation) { const E = EL(); for (const p of ORDER) { if (CFG.map[p[1]][p[0]] === "B") continue; rpath(hexPts(p, R - .5), 6); ctx.fillStyle = `rgba(255,255,255,${.1 * E[key(p)]})`; ctx.fill() }   // higher land is lighter (LOU-310)
    stepEdges((a, b) => line([a, b], "rgba(60,42,25,.55)", 2.8)) }
  ctx.restore() }
function land() { const lw = B.w + 2 * LPAD, lh = B.h + 2 * LPAD; ps = Math.min(Math.pow(2, Math.ceil(Math.log2(scale) * 2) / 2), 4096 / Math.max(lw, lh));
  const lk = ps + "|" + landSig; if (lk === landKey) return; landKey = lk; landC.width = Math.ceil(lw * ps); landC.height = Math.ceil(lh * ps);
  ctx = landC.getContext("2d"); ctx.setTransform(ps, 0, 0, ps, -(B.x - LPAD) * ps, -(B.y - LPAD) * ps); paintLand(reachOf(S)); ctx = ctx0 }

// ---------- the seven levels: sprouts, meadow, thicket, saplings, grove, forest, old forest. Each is painted once into a
// sprite, lit from the upper left, and each is clearly bigger and taller than the one before. The trees are play.js's.
const leaf = (x, y, r, col) => ell(x, y, r, r * .86, col);
const TREE = {
  round(r) { line([[0, 0], [0, -11]], "#6b4a32", 3); line([[0, -7], [-4, -13]], "#6b4a32", 1.8); line([[0, -8], [4, -14]], "#6b4a32", 1.6);
    const cl = [[-8, -16, 7], [8, -16, 7], [0, -22, 8], [-5, -26, 6.5], [6, -26, 6.5], [0, -30, 6], [-9, -21, 5.5], [9, -21, 5.5]];
    for (const [x, y, s] of cl) leaf(x, y + 1.5, s, "#2c6a5a"); for (const [x, y, s] of cl) leaf(x - .8, y, s * .82, "#4c9a74");
    for (const [x, y, s] of cl) if (x <= 2 && y < -18) leaf(x - 1.8, y - 1.5, s * .55, "#93cf8f"); for (let i = 0; i < 6; i++) leaf(-7 + r() * 9, -30 + r() * 12, 1.4 + r(), "#e2f0b0") },
  pine() { line([[0, 0], [0, -6]], "#5a3d22", 2.6);
    for (let i = 0; i < 5; i++) { const y0 = -4 - i * 6.5, w = 11 - i * 1.9, y1 = y0 - 10; ctx.beginPath(); ctx.moveTo(-w, y0); ctx.quadraticCurveTo(-w * .3, y0 - 4, 0, y1); ctx.quadraticCurveTo(w * .3, y0 - 4, w, y0); ctx.quadraticCurveTo(0, y0 + 2.5, -w, y0); ctx.fillStyle = "#2f5f55"; ctx.fill();
      ctx.beginPath(); ctx.moveTo(-w, y0); ctx.quadraticCurveTo(-w * .3, y0 - 4, 0, y1); ctx.lineTo(-1, y0 + 1); ctx.closePath(); ctx.fillStyle = "#4f8a72"; ctx.fill() } },
  birch(r) { ctx.fillStyle = "#f2efe6"; ctx.fillRect(-1.3, -24, 2.6, 24); for (let i = 0; i < 5; i++) line([[-1.3, -3 - i * 4.4 - r() * 2], [r() * 1.6 - .3, -3 - i * 4.4 - r() * 2]], "#3a3a3a", 1.1);
    for (let i = 0; i < 9; i++) leaf(-7 + r() * 14, -30 + r() * 12, 3 + r() * 2.2, ["#8cc47a", "#a8d48a", "#cfe6a0"][i % 3]) },
  poplar() { line([[0, 0], [0, -6]], "#6b4a32", 2.4); ell(0, -22, 5.5, 17, "#3f7f5c"); ell(-1.2, -23, 4.4, 15, "#4f9a64"); ell(-2, -26, 2.4, 10, "#7cbf7a") } };
const put = (x, y, s, f, r) => { ell(x + 3 * s, y + 1, 10 * s, 3.2 * s, "rgba(40,70,50,.22)"); ctx.save(); ctx.translate(x, y); ctx.scale(s, s); f(r); ctx.restore() };
function shrub(x, y, s) { ell(x + 2 * s, y + 1, 9 * s, 3 * s, "rgba(40,70,50,.2)");
  for (const [a, b, rr, col] of [[-5, -3, 5, "#3f7f5c"], [4, -3, 5.5, "#3f7f5c"], [0, -6, 6, "#4c9a74"], [-3, -7, 3.6, "#7cbf84"], [3, -8, 3, "#93cf8f"]]) ell(x + a * s, y + b * s, rr * s, rr * s * .8, col) }
function sapling(x, y, s) { ell(x + 2 * s, y + 1, 7 * s, 2.4 * s, "rgba(40,70,50,.2)"); line([[x, y], [x + .6 * s, y - 20 * s]], "#7a5a3a", 1.8 * s);
  for (const [a, b, rr, col] of [[-3.2, -17, 4.2, "#5fae6c"], [3.6, -20, 4.6, "#6dbb72"], [0, -25, 5, "#8fd08a"], [-2.6, -27, 2.6, "#c8ecae"]]) ell(x + a * s, y + b * s, rr * s, rr * s * .86, col) }
const MFL = [["#ffffff", "#f2c531"], ["#e5573f", "#3b2a2a"], ["#5b8fe0", "#d9e6ff"], ["#f4c531", "#fff3b0"], ["#a985da", "#d6c2f2"]];
const LEVEL = [null,
  () => { ell(0, 3, 27, 12, "rgba(64,120,70,.4)"); ell(-2, 2, 20, 8, "rgba(126,186,100,.5)");                    // 1 Sprouts: seedlings and clover on a mossy bed
    for (const [x, y] of [[-19, 0], [2, -5], [19, 1], [-8, 7]]) for (const [a, b] of [[-1.7, 0], [1.7, 0], [0, -1.7]]) ell(x + a, y + b, 2, 1.5, "#4f9a5a");
    for (const [x, y] of [[12, -4], [-6, -3], [-15, 4], [6, 1], [15, 7], [-1, 9]]) { line([[x, y], [x, y - 6]], "#4a7a32", 1.5); ell(x - 2.5, y - 6.5, 2.8, 1.6, "#93c565"); ell(x + 2.5, y - 7.4, 2.8, 1.6, "#b6e088") } },
  r => { ell(0, 3, 30, 13, "rgba(226,240,170,.85)"); ell(-4, 1, 18, 7, "rgba(250,246,200,.55)");                 // 2 Meadow: a drift of wildflowers
    const f = []; for (let i = 0; i < 32; i++) { const a = r() * TAU, d = Math.sqrt(r()) * 25; f.push([Math.cos(a) * d, Math.sin(a) * d * .45 + 3, 4 + r() * 6, i % 5]) }
    for (const [x, y, st, k] of f.sort((a, b) => a[1] - b[1])) { line([[x, y], [x, y - st]], "rgba(78,128,66,.85)", 1); ell(x, y - st, 2.4, 2, MFL[k][0]); ell(x, y - st, 1, .8, MFL[k][1]) } },
  r => { ell(2, 5, 31, 12, "rgba(40,80,50,.22)"); shrub(-13, -3, 1.3); shrub(13, -5, 1.4); shrub(-3, 7, 1.7); shrub(19, 8, 1.05);  // 3 Thicket: shrubs and bushes
    for (let i = 0; i < 8; i++) ell(-12 + r() * 22, -8 + r() * 9, 1.4, 1.4, "#d8453a") },
  () => { ell(1, 4, 28, 11, "rgba(64,120,70,.3)"); sapling(12, -5, 1.1); sapling(-13, -1, 1); sapling(1, 9, 1.25) }, // 4 Saplings: three young trees
  r => { ell(1, 4, 32, 12, "rgba(40,80,50,.2)"); put(2, -11, .95, TREE.birch, r); put(-16, 1, 1.05, TREE.round, r); put(15, 5, 1, TREE.poplar, r) }, // 5 Grove: three full trees
  r => { ell(0, 5, 38, 14, "rgba(30,70,45,.3)");                                                                 // 6 Forest: tall, dense trees of mixed kinds
    put(-18, -10, 1.3, TREE.pine, r); put(5, -14, 1.5, TREE.pine, r); put(24, -6, 1.3, TREE.poplar, r); put(-25, 4, 1.25, TREE.round, r); put(-3, 7, 1.45, TREE.round, r); put(20, 10, 1.2, TREE.birch, r) },
  r => { ell(4, 5, 42, 14, "rgba(30,60,45,.3)");                                                                 // 7 Old forest: one giant old tree that fills the tile
    ctx.beginPath(); ctx.moveTo(-17, 5); ctx.quadraticCurveTo(-7, -2, -7, -30); ctx.lineTo(8, -30); ctx.quadraticCurveTo(8, -2, 19, 5); ctx.quadraticCurveTo(0, 9, -17, 5); ctx.fillStyle = "#6b4a32"; ctx.fill();
    ctx.beginPath(); ctx.moveTo(2, 7); ctx.quadraticCurveTo(3, -10, 2, -30); ctx.lineTo(8, -30); ctx.quadraticCurveTo(8, -2, 19, 5); ctx.closePath(); ctx.fillStyle = "#553926"; ctx.fill();
    ell(-2, -11, 3, 4.6, "#35231a"); line([[-4, -27], [-20, -46]], "#6b4a32", 5); line([[4, -27], [22, -48]], "#553926", 5); line([[0, -29], [1, -54]], "#6b4a32", 6);
    const cl = [[-30, -52, 17], [31, -54, 17], [0, -62, 22], [-17, -73, 17], [18, -75, 17], [0, -87, 15], [-37, -66, 12], [39, -66, 12], [-9, -48, 14], [13, -50, 14]];
    for (const [x, y, s] of cl) leaf(x, y + 3, s, "#245c4e"); for (const [x, y, s] of cl) leaf(x - 1.5, y, s * .84, "#3f8f6a");
    for (const [x, y, s] of cl) if (x <= 4 && y < -56) leaf(x - 4, y - 3.5, s * .55, "#8fcf8a"); for (let i = 0; i < 18; i++) leaf(-34 + r() * 56, -94 + r() * 40, 1.6 + r() * 1.6, "#e2f0b0");
    ell(-22, 6, 7, 3, "#6fa84a"); ell(22, 7, 6, 2.6, "#5f9a40") }];
const TALL = [0, 10, 14, 24, 36, 46, 74, 104];                                         // how far each level stands above its tile's centre
const SPX = 3, HB = {w:116, h:132, ox:58, oy:110}, sprites = {};                       // sprite px per world unit; the box, and where the tile's centre sits in it
function hsprite(l) { l = Math.max(1, Math.min(l, 7)); if (sprites[l]) return sprites[l]; const c = document.createElement("canvas"); c.width = HB.w * SPX; c.height = HB.h * SPX;
  const keep = ctx; ctx = c.getContext("2d"); ctx.setTransform(SPX, 0, 0, SPX, HB.ox * SPX, HB.oy * SPX); LEVEL[l](rng("lv", l)); ctx = keep; return sprites[l] = c }
// A tile as a small picture, for the pile: a habitat's own sprite, or a stretch of river.
const ICON = [0, [62, .6], [66, .62], [70, .72], [74, .82], [88, .85], [106, .87], [124, .88]]; // per level: the world units the picture spans, and how far down the tile's centre sits
function tileIcon(t, px) { if (flat()) return simpleIcon(t, px); const c = document.createElement("canvas"), d = Math.min(devicePixelRatio || 1, 3); c.width = c.height = Math.round(px * d); c.style.width = c.style.height = px + "px";
  const keep = ctx; ctx = c.getContext("2d");
  if (t.k === "h") { const [span, cy] = ICON[Math.min(t.l, 7)], u = px / span * d;
    if (t.b) { ctx.fillStyle = t.b === "p" ? "rgba(247,206,60,.85)" : t.b === "t" ? "rgba(24,110,66,.85)" : "rgba(56,200,190,.8)"; ctx.beginPath(); ctx.arc(px * d / 2, px * d * .56, px * d * .38, 0, TAU); ctx.fill() }   // a yellow or turquoise disc behind it shows its kind
    const up = upgradeOf(CFG, t); if (up) UPG_LOOK[up].icon(px * d / 2, px * d * .56, px * d * .38);                   // and an upgrade's variation of the art goes round the disc (LOU-304)
    ctx.drawImage(hsprite(t.l), px * d / 2 - HB.ox * u, px * d * cy - HB.oy * u, HB.w * u, HB.h * u) }
  else { const u = px / 64 * d, w = t.l > 1 ? 15 : 9; ctx.setTransform(u, 0, 0, u, px * d / 2, px * d / 2);
    for (const [add, col] of [[5, "rgba(95,143,92,.5)"], [2.5, "#d9cfa3"], [0, "#8cc2d2"], [-w * .55, "#6fa9c4"]]) { ctx.beginPath(); ctx.moveTo(-26, 9); ctx.bezierCurveTo(-8, 14, 4, -14, 26, -8); ink(col, w + add * 2) }
    ctx.beginPath(); ctx.moveTo(-12, 5); ctx.quadraticCurveTo(-4, 4, 2, -1); ink("rgba(255,255,255,.7)", 1.6) }
  ctx = keep; return c }

function mountain(cx, cy) { // from play.js
  ell(cx + 4, cy + 9, 34, 10, "rgba(50,70,70,.2)");
  poly([[cx + 6, cy + 8], [cx + 19, cy - 24], [cx + 33, cy + 5]], "#aeb8c2"); poly([[cx + 19, cy - 24], [cx + 33, cy + 5], [cx + 20, cy + 7]], "#8995a3");
  poly([[cx - 30, cy + 7], [cx - 4, cy - 50], [cx + 26, cy + 6]], "#b9c4cc"); poly([[cx - 4, cy - 50], [cx + 26, cy + 6], [cx + 4, cy + 10]], "#8e9aa8");
  poly([[cx - 4, cy - 50], [cx - 14, cy - 30], [cx - 8, cy - 33], [cx - 3, cy - 27], [cx + 3, cy - 32], [cx + 9, cy - 28]], "#f7fafb");
  poly([[cx - 4, cy - 50], [cx + 9, cy - 28], [cx + 3, cy - 32], [cx - 1, cy - 30]], "#dfe8ee"); poly([[cx + 19, cy - 24], [cx + 14, cy - 15], [cx + 18, cy - 17], [cx + 23, cy - 13]], "#f7fafb");
  ctx.globalAlpha = .9; poly([[cx - 30, cy + 7], [cx - 18, cy - 3], [cx - 8, cy + 1], [cx + 4, cy - 4], [cx + 14, cy + 2], [cx + 26, cy + 6], [cx + 33, cy + 5], [cx + 20, cy + 10], [cx - 10, cy + 11]], "#5f8f6a"); ctx.globalAlpha = 1 }
function source(o, t) { // from play.js: a small pool with ripple rings spreading out
  ell(o.x, o.y + 2, 21, 10.5, "rgba(90,140,110,.35)"); ell(o.x, o.y + 1, 19, 9.5, "#a9d4e2"); ell(o.x + 1, o.y + 2, 11, 5, "#7fb6c9"); ell(o.x - 5, o.y - 1, 9, 3.4, "rgba(255,255,255,.5)");
  if (reduce) return; for (const ph of [0, .5]) { const k = (t / 2.4 + ph) % 1; ctx.globalAlpha = (1 - k) * .8; ctx.beginPath(); ctx.ellipse(o.x, o.y + 1, 5 + k * 14, 2.5 + k * 7, 0, 0, 7); ink("#ffffff", 1.3); ctx.globalAlpha = 1 } }
// The river: each river tile is joined to the one it came from. A level 2 tile is drawn wider.
function river(t) { const seg = []; for (const k in S.r) { const v = S.r[k], a = iso(...GRID.at[k]), b = v.from ? iso(...GRID.at[v.from]) : a; seg.push({a, b, w:v.l > 1 ? 18 : 9.5}) }
  const pass = (add, col, mul = 1) => { ctx.strokeStyle = col; ctx.lineCap = "round"; for (const s of seg) { ctx.lineWidth = s.w * mul + add * 2; ctx.beginPath(); ctx.moveTo(s.b.x, s.b.y); ctx.lineTo(s.a.x + .01, s.a.y); ctx.stroke() } };
  pass(5, "rgba(95,143,92,.4)"); pass(2.5, "#d9cfa3"); pass(0, "#8cc2d2"); pass(0, "#6fa9c4", .45);
  if (!reduce) { ctx.save(); ctx.setLineDash([4, 30]); ctx.lineDashOffset = -t * 22; ctx.globalAlpha = .45; pass(-3.9, "#dff1f8", .0001); ctx.restore() } } // soft pale-blue glints drift with the current

// ---------- the camera (from play.js): view.z is zoom relative to "the whole island fits"; cx, cy is the world point in the middle
const view = {z:null, cx:0, cy:0}, lay = {w:0, h:0, topH:0, availH:0, dpr:1, fit:1, zAuto:1}; let scale = 1, off = {x:0, y:0}, lastSize = "";
const SRC = unkey(Object.keys(fresh(CFG, 1).r)[0]);
// the height of the pile over the bottom of the island (LOU-317): the island is fitted and centred in what is left between the top line and the pile
const dockH = () => { const d = $("actions"), b = $("board"); return d && b ? Math.max(0, Math.round(b.getBoundingClientRect().bottom - d.getBoundingClientRect().top)) : 0 };
function resize() { const box = $("board"), w = box.clientWidth, h = box.clientHeight, dpr = Math.min(devicePixelRatio || 1, 3); if (!w || !h) return;
  const topH = $("top").offsetHeight, botH = dockH(), k = [w, h, topH, botH, dpr].join(); if (k === lastSize) return; lastSize = k;
  const availH = Math.max(40, h - topH - botH), fit = Math.min(w / B.w, availH / B.h), play = Math.min(1.3, w / (CFG.tilesAcross * (flat() ? 80 : 89))); // a hex is about 89 world px across when tilted, 80 flat
  Object.assign(lay, {w, h, topH, botH, availH, dpr, fit, zAuto:Math.max(1, play / fit)});
  if (view.z === null) { view.z = lay.zAuto; const o = iso(...SRC); view.cx = o.x; view.cy = o.y }   // open on the source, with about tilesAcross tiles across
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); if (L3) L3.resize(); applyView() }
function applyView() { view.z = Math.min(Math.max(5, lay.zAuto * 1.6), Math.max(1, view.z)); const s = lay.fit * view.z, vw = lay.w / s, vh = lay.availH / s;
  view.cx = vw >= B.w ? B.x + B.w / 2 : Math.min(B.x + B.w - vw / 2, Math.max(B.x + vw / 2, view.cx));
  view.cy = vh >= B.h ? B.y + B.h / 2 : Math.min(B.y + B.h - vh / 2, Math.max(B.y + vh / 2, view.cy));
  scale = s * lay.dpr; off = {x:lay.w / 2 * lay.dpr - view.cx * scale, y:(lay.topH + lay.availH / 2) * lay.dpr - view.cy * scale};
  draw() }
function tileAt(cx, cy) { const r = cv.getBoundingClientRect(), d = cv.width / r.width, x = ((cx - r.left) * d - off.x) / scale, y = ((cy - r.top) * d - off.y) / scale;
  const a = x / .7071, b = y / .3536, wx = flat() ? x : (a + b) / 2, wy = flat() ? y : (b - a) / 2, ry = Math.round(wy / (1.5 * R)); let best = null, bd = 1e9;
  for (let yy = ry - 1; yy <= ry + 1; yy++) { const rx = Math.round((wx - (yy & 1 ? SQ3 * R / 2 : 0)) / (SQ3 * R));
    for (let xx = rx - 1; xx <= rx + 1; xx++) { if (!inside(CFG, [xx, yy])) continue; const [qx, qy] = world(xx, yy), dd = Math.hypot(qx - wx, qy - wy); if (dd < bd) { bd = dd; best = [xx, yy] } } }
  return best && bd <= R ? best : null }
const scr = p => { if (L3 && skin === "3d") return L3.scr(p); const r = cv.getBoundingClientRect(), d = cv.width / r.width, o = iso(...p); return [r.left + (o.x * scale + off.x) / d, r.top + (o.y * scale + off.y) / d] };

// ---------- the rings on the island (LOU-317; Dan, Nov 22: "make the tiles coming on floating", "tidy up the whole screen"). Every cell the tile in hand can go to has a soft dashed ring with its points inside, in dark gold: no white pill floats over the
// island any more. A river tile's cells are rings with nothing in them (a river tile scores nothing), a raise says "wider", a plant that lands lower or scores more says so under its points, and the cell a carried tile hovers over is lit.
function optLabel(o) { const t = S.q[0] || {}, gain = o.pts > 0 ? "+" + o.pts : "";
  if (o.does === "combine") return {main:gain, col:"#7a5a12", size:15};
  if (o.does === "widen") return {main:widenText(o), col:"#0f6f5e", size:13};
  if (o.does === "plant") return {main:gain, note:[o.l < t.l ? "as " + o.l : "", o.mult > 1 ? "×" + o.mult : ""].filter(Boolean).join(" "), col:o.mult > 1 ? "#0c6a64" : "#7a5a12", size:12};
  return {main:gain, col:"#1f5f8f", size:12} }
const sameCell = (a, b) => (!a && !b) || (!!a && !!b && a[0] === b[0] && a[1] === b[1]), isCarry = o => sameCell(o.p, carryCell), RINGCOL = {plant:"#3f9a5a", extend:"#2f86d6", combine:"#d9961a", widen:"#1f9c86"};
function ringText(x, y, text, col, size) { ctx.save(); ctx.font = `800 ${size}px ${HAND}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round"; ctx.lineWidth = 4; ctx.strokeStyle = "rgba(255,255,255,.92)"; ctx.strokeText(text, x, y); ctx.fillStyle = col; ctx.fillText(text, x, y); ctx.restore() }
function optionRings(t) { if (S.over || lockMode) return; const pu = reduce ? .5 : .5 + .5 * Math.sin(t * 3), fl = flat();
  for (const o of opts) { const hot = isCarry(o), pts = hexPts(o.p, R - (fl ? 4 : 6)), c = iso(...o.p), col = RINGCOL[o.does] || RINGCOL.plant, rad = fl ? 7 : 8;
    rpath(pts, rad); ctx.fillStyle = o.does === "combine" ? `rgba(255,222,120,${.2 + .1 * pu + (hot ? .22 : 0)})` : `rgba(255,255,255,${.2 + .06 * pu + (hot ? .24 : 0)})`; ctx.fill();
    ctx.setLineDash([7, 6]); rpath(pts, rad); ink("rgba(255,255,255,.92)", hot ? 7.4 : 5.4); rpath(pts, rad); ink(col, hot ? 3.8 : 2.6 + .5 * pu); ctx.setLineDash([]);
    const L = optLabel(o), y = c.y + (fl ? 0 : 3); if (L.main) ringText(c.x, y - (L.note ? 6 : 0), L.main, L.col, L.size); if (L.note) ringText(c.x, y + 7, L.note, L.col, 11) } }

// ---------- drawing, every frame: the sea, the island, the river, then everything standing on it from back to front
const easeBack = k => 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2);
function draw() { if (!S || !lay.w) return; const T = now(), t = T / 1000;
  if (L3 && skin === "3d") return L3.draw(T, t);
  if (flat()) return drawSimple(T, t);
  land(); ctx = ctx0; ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, cv.height); g.addColorStop(0, "#cfe3ea"); g.addColorStop(.3, "#cfe6ea"); g.addColorStop(1, "#8fbccb"); ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(scale, 0, 0, scale, off.x, off.y); ctx.drawImage(landC, B.x - LPAD, B.y - LPAD, landC.width / ps, landC.height / ps);
  river(t); fallMarks();
  for (const p of ORDER) { const k = key(p), o = iso(...p), code = CFG.map[p[1]][p[0]], l = S.h[k];
    if (code === "T") source(o, t); else if (code === "B") mountain(o.x, o.y);
    if (l) { const a = pops[k] ? (T - pops[k]) / 320 : 1, s = a < 1 && !reduce ? easeBack(Math.max(.05, a)) : 1; if (a >= 1) delete pops[k]; // a quick pop when a tile lands
      if (S.hb[k]) { rpath(hexPts(p, R - 5), 8); ctx.fillStyle = S.hb[k] === "p" ? "rgba(247,206,60,.8)" : S.hb[k] === "t" ? "rgba(24,110,66,.8)" : "rgba(56,200,190,.75)"; ctx.fill() }   // a yellow, turquoise or deep green patch under the picture shows its kind
      const up = upgradeOf(CFG, {k:"h", b:S.hb[k], l, f:S.hf[k]}); if (up) UPG_LOOK[up].art(p);                                      // an upgrade is a variation of the tile's art (LOU-304): the reed bed has reeds along its edge
      ctx.save(); ctx.translate(o.x, o.y); ctx.scale(s, s); if (k in S.lk) ctx.globalAlpha = .7; ctx.drawImage(hsprite(l), -HB.ox, -HB.oy, HB.w, HB.h); ctx.restore() } } // a locked habitat is a little muted
  optionRings(t);   // what the tile in hand can do (LOU-317): a soft dashed ring on every cell it can go to, with its points inside
  for (const k in S.h) { const o = iso(...GRID.at[k]); tag(o.x + 25, o.y + 13, String(S.h[k]), S.hb[k] === "p" ? "#7a5a10" : S.hb[k] === "m" ? "#0d6a66" : S.hb[k] === "t" ? "#0f4f31" : "#24434a", 14, k in S.lk, upgradeOf(CFG, {k:"h", b:S.hb[k], l:S.h[k], f:S.hf[k]})) } // every habitat carries its level (and its upgrade's mark), and a padlock once it is locked
  if (CFG.marshRiverMultiplier) for (const k in S.h) if (S.hb[k] === "m" && !(k in S.lk)) { const m = marshMult(S, k); if (m > 1) { const o = iso(...GRID.at[k]); tag(o.x + 25, o.y - 3, "×" + m, "#0d6a66", 12) } }   // a marsh tile that scores more shows its multiplier above its level (LOU-309)
  for (const k in S.lk) if (k in S.r) { const o = iso(...GRID.at[k]); tag(o.x, o.y + 1, S.r[k].l > 1 ? String(S.r[k].l) : "", "#24434a", 14, true) } // a locked river tile gets a padlock of its own
  for (const k in S.r) if (!(k in S.lk) && S.r[k].l > 1) { const o = iso(...GRID.at[k]); tag(o.x, o.y + 1, String(S.r[k].l), "#1f5f8f", 14) }   // and an unlocked one past level 1 carries its level
  if (lockMode) lockHints(); pickRing(T);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let i = fx.length - 1; i >= 0; i--) { const f = fx[i], k = (T - f.t0) / 900; if (k >= 1) { fx.splice(i, 1); continue } const o = iso(...f.p), y = o.y - f.up - 26 * (1 - Math.pow(1 - k, 2)); // points float up in pale gold
    ctx.globalAlpha = k < .5 ? 1 : (1 - k) / .5; ctx.font = `800 ${17 * lay.dpr / scale}px ${HAND}`; ctx.lineWidth = 3.5 * lay.dpr / scale; ctx.strokeStyle = "rgba(60,45,10,.6)"; ctx.lineJoin = "round"; ctx.strokeText(f.text, o.x, y); ctx.fillStyle = "#ffe9a8"; ctx.fillText(f.text, o.x, y); ctx.globalAlpha = 1 } }

// ---------- the simple look (Dan, Nov 20: "just have basic blue tile for water and green tiles, then have a number on them, the locking
// mechanism"). Flat hexes seen from above: blue is the river (darker once it is level 2), green is a habitat (darker with each level),
// pale green is empty land the river reaches, off-white is land it doesn't, grey is a mountain. Every river tile and habitat carries
// its level as a number, and a locked tile carries a padlock. The rules, the pile and the buttons are the same as in the painted look.
const SK = {sea:"#e9f0f3", bare:"#f4f3ee", reach:"#dff1d6", mtn:"#aeb7bf", mtnInk:"#77828d", edge:"rgba(25,55,65,.28)",
  // a river tile has a level too (Dan, Nov 20): light blue, then deeper blue, then darker with every level like the habitats. Only the first two widen it
  river:[null, "#5aaeea", "#2f86d6", "#2a76c4", "#2566b0", "#20579c", "#1c4a88", "#183e75", "#153463", "#122c55", "#102549", "#0e1f3d", "#0c1a34", "#0a152b", "#081123", "#060d1c"], hab:[null, "#a8dc84", "#86cf74", "#5fba61", "#3fa258", "#2a894c", "#1f7040", "#165830", "#134e2a", "#124626", "#103f23", "#0f381f", "#0e321c", "#0d2c19", "#0c2616", "#0b2013"],
  // the other two kinds (Dan, Nov 20): prairie is yellow and marsh is turquoise, each darker with every level like the green ones
  prairie:[null, "#ffe866", "#fbd83d", "#f3c51f", "#e2ac14", "#c9920f", "#a97a0e", "#8b640d", "#74530c", "#64470b", "#563d0a", "#4a3409", "#402d08", "#372607", "#2f2106", "#271b05"],
  marsh:[null, "#5fe3d3", "#34cfc0", "#1db8ab", "#12a095", "#0c887f", "#0a716a", "#095c57", "#084c48", "#074241", "#063a39", "#053332", "#042d2c", "#042726", "#032121", "#031c1c"],
  // trees (LOU-302): deep green, clearly darker than the green habitat at every level
  trees:[null, "#2a8a5a", "#217a4e", "#196a43", "#135b39", "#0e4d30", "#0b4129", "#093723", "#082f1f", "#07291b", "#062418", "#052015", "#041c13", "#041911", "#03160f", "#03130d"]};
const tileFill = t => t.k === "r" ? SK.river[Math.min(t.l, 15)] : (t.b === "p" ? SK.prairie : t.b === "m" ? SK.marsh : t.b === "t" ? SK.trees : SK.hab)[Math.min(t.l, 15)];
const numInk = t => t.k === "r" || t.b === "t" ? "#ffffff" : t.b === "p" ? (t.l >= 6 ? "#ffffff" : "#4a3a05") : t.b === "m" ? (t.l >= 5 ? "#ffffff" : "#0c3b38") : t.l >= 4 ? "#ffffff" : "#173c2a";
const flatHex = r => [0, 1, 2, 3, 4, 5].map(i => { const a = (60 * i - 90) * Math.PI / 180; return [r * Math.cos(a), r * Math.sin(a)] });
function padlock(x, y, s, col) { ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 2.6; ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(0, -3, 5, Math.PI, 0); ctx.stroke(); ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(-7.5, -3, 15, 11.5, 2.5); else ctx.rect(-7.5, -3, 15, 11.5); ctx.fill(); ctx.restore() }
// A tile as a small picture, for the pile and the menu: a flat hex in its colour with its level on it.
function simpleIcon(t, px) { const c = document.createElement("canvas"), d = Math.min(devicePixelRatio || 1, 3); c.width = c.height = Math.round(px * d); c.style.width = c.style.height = px + "px";
  const keep = ctx; ctx = c.getContext("2d"); const u = px * d / 100; ctx.setTransform(u, 0, 0, u, px * d / 2, px * d / 2);
  rpath(flatHex(47), 10); ctx.fillStyle = tileFill(t); ctx.fill(); ink(SK.edge, 4);
  const up = upgradeOf(CFG, t); if (up) { rpath(flatHex(44), 10); ink(UPG_LOOK[up].rim, 7) }   // an upgrade has a tinted rim and a small mark (LOU-304), here too
  if (t.l >= 8) { rpath(flatHex(38), 9); ink("#e0a31c", 6); if (t.l >= 12) { rpath(flatHex(27), 8); ink("#f3d27a", 4) } }
  ctx.fillStyle = numInk(t); ctx.font = `800 ${t.l > 9 ? 44 : 58}px ${HAND}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(t.l), 0, up ? -4 : 4);
  if (up) UPG_LOOK[up].mark(0, 30, 1.45, ...UPG_LOOK[up].tile);
  ctx = keep; return c }
function drawSimple(T, t) { ctx = ctx0; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = SK.sea; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(scale, 0, 0, scale, off.x, off.y);
  const reach = reachOf(S), pu = reduce ? .5 : .5 + .5 * Math.sin(t * 3), hex = flatHex(R - 2.2), EV = EL();
  for (const p of ORDER) { const k = key(p), o = iso(...p), rv = S.r[k], hl = S.h[k], code = CFG.map[p[1]][p[0]], tile = rv ? {k:"r", l:rv.l} : hl ? {k:"h", l:hl, b:S.hb[k], f:S.hf[k]} : null;
    const fill = code === "B" ? SK.mtn : tile ? tileFill(tile) : reach.has(k) ? SK.reach : SK.bare;
    const a = pops[k] ? (T - pops[k]) / 280 : 1, s = a < 1 && !reduce ? .78 + .22 * easeBack(Math.max(0, a)) : 1; if (a >= 1) delete pops[k]; // a quick pop when a tile lands
    ctx.save(); ctx.translate(o.x, o.y); ctx.scale(s, s); rpath(hex, 7); ctx.fillStyle = fill; ctx.fill();
    if (EV && !tile && code !== "B") { rpath(hex, 7); ctx.fillStyle = `rgba(60,85,110,${.13 * (CFG.elevationLevels - EV[k])})`; ctx.fill() }   // empty land is tinted darker the lower it is (LOU-310)
    ink(SK.edge, 1.6);
    const up = tile ? upgradeOf(CFG, tile) : "";
    if (up) { rpath(hex, 7); ink(UPG_LOOK[up].rim, 3.6) }                                                        // an upgrade has a tinted rim round its tile (LOU-304)
    if (tile && tile.l >= 8) { rpath(flatHex(R - 7), 7); ink("#e0a31c", 3.2); if (tile.l >= 12) { rpath(flatHex(R - 13), 7); ink("#f3d27a", 2.4) } }   // levels 8 and up have a gold rim, 12 and up a second one
    if (code === "B") { ctx.beginPath(); ctx.moveTo(-17, 13); ctx.lineTo(0, -17); ctx.lineTo(17, 13); ctx.closePath(); ctx.fillStyle = SK.mtnInk; ctx.fill() }
    if (code === "T") { ctx.beginPath(); ctx.arc(0, 0, R - 9, 0, TAU); ink("rgba(255,255,255,.85)", 2.4) }   // the source has a white ring inside its tile
    if (tile) { ctx.fillStyle = numInk(tile); ctx.font = `800 ${R * (tile.l > 9 ? .78 : .98)}px ${HAND}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(tile.l), 0, 3);
      if (up) UPG_LOOK[up].mark(0, R * .63, 1.05, ...UPG_LOOK[up].tile);                                        // and a small mark under its number
      if (k in S.lk) padlock(0, -R * .6, 1.05, numInk(tile)); else if (tile.b === "m" && CFG.marshRiverMultiplier) { const m = marshMult(S, k); if (m > 1) tag(R * .56, -R * .4, "×" + m, "#0c3b38", 13) } }   // a marsh tile that scores more shows its multiplier (LOU-309)                                                  // a locked tile carries a padlock
    ctx.restore() }
  stepEdges((a, b) => line([a, b], "rgba(25,45,65,.6)", 3.4)); fallMarks();   // the steps, and the waterfalls (LOU-310)
  optionRings(t);   // what the tile in hand can do (LOU-317): a soft dashed ring on every cell it can go to, with its points inside (green plant, blue river, gold combine, teal raise)
  if (lockMode) lockHints(); pickRing(T);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let i = fx.length - 1; i >= 0; i--) { const f = fx[i], k = (T - f.t0) / 900; if (k >= 1) { fx.splice(i, 1); continue } const o = iso(...f.p), y = o.y - R * .3 - 34 * (1 - Math.pow(1 - k, 2)); // points float up
    ctx.globalAlpha = k < .5 ? 1 : (1 - k) / .5; ctx.font = `800 ${17 * lay.dpr / scale}px ${HAND}`; ctx.lineWidth = 3.5 * lay.dpr / scale; ctx.strokeStyle = "rgba(40,60,20,.55)"; ctx.lineJoin = "round"; ctx.strokeText(f.text, o.x, y); ctx.fillStyle = "#fff3b8"; ctx.fillText(f.text, o.x, y); ctx.globalAlpha = 1 } }

// Lock mode: every tile that can be locked shows how many copies it would bank. Once one is picked, each copy is marked on
// the neighbour it comes from, and a neighbour that is too high to copy says so.
function lockHints() { const up = k => TALL[Math.min(S.h[k] || 0, 7)] || 8;
  const ring = flat() ? (p, a, b) => { rpath(hexPts(p, R - 4), 7); ink(a, 7); rpath(hexPts(p, R - 4), 7); ink(b, 3) }
    : (p, a, b) => { const c = iso(...p); ctx.beginPath(); ctx.ellipse(c.x, c.y + 1, 32, 16, 0, 0, 7); ink(a, 4.5); ctx.beginPath(); ctx.ellipse(c.x, c.y + 1, 32, 16, 0, 0, 7); ink(b, 1.6) };
  const over = (k, text, col, locked) => { const c = iso(...GRID.at[k]); tag(c.x, c.y - (flat() ? R * .62 : up(k) + 14), text, col, 14, locked) };
  if (!lockSel) { for (const L of lockList) ring(L.p, "rgba(255,244,214,.95)", "#d9a520"); for (const L of lockList) over(key(L.p), L.n + (L.n === 1 ? " copy" : " copies"), "#7a5a10"); return }
  const got = copiesOf(S, lockSel); ring(lockSel, "rgba(255,244,214,.95)", "#d9a520"); for (const k of got.from) ring(GRID.at[k], "rgba(232,255,248,.95)", "rgba(63,191,164,.9)");
  for (const k of got.from) over(k, "copy " + (k in S.h ? S.h[k] : "river"), "#0f7a66"); for (const k of got.high) over(k, "too high", "#6b7b7e"); over(key(lockSel), "lock", "#7a5a10", true) }
function lockCard() { const k = key(lockSel), got = copiesOf(S, lockSel), n = got.copies.length;
  tx("lockT", `Lock this ${k in S.h ? (S.hb[k] ? BIOME_NAME[S.hb[k]].toLowerCase() + " " + S.h[k] : levelName(CFG, S.h[k]).toLowerCase()) : "river tile"}?`);
  tx("lockS", (n ? `Banks ${n} ${n === 1 ? "copy" : "copies"}: ${got.copies.map(t => t.k === "r" ? "river" + (t.l > 1 ? " " + t.l : "") : (t.b ? BIOME_NAME[t.b].toLowerCase() : levelName(CFG, t.l).toLowerCase()) + " " + t.l).join(", ")}.` : "Banks nothing.") + (got.high.length ? ` ${got.high.length} too high to copy.` : "") + " It can't grow after.") }

// ---------- the pile, the top bar and the messages
function say(t, warn) { const m = $("msg"); m.textContent = t || ""; m.classList.toggle("warn", !!warn); m.classList.toggle("fade", !t); clearTimeout(msgT); if (t) msgT = setTimeout(() => m.classList.add("fade"), warn ? 3200 : 4500) }
// ---------- the tile holder's pictures (LOU-312). The five level 1 tiles the pile deals (river, green, prairie, marsh, trees) have an illustrated sprite, baked once from the Flowgrow Pile Tiles page and kept in art/pile/
// (tools/bake-pile-sprites.mjs makes them). The holder draws a sprite for a tile that is level 1 with no upgrade; every other tile keeps its flat picture and its number. A sprite that is missing or hasn't loaded is
// simply not used: the flat tile is drawn, so the holder is never empty. A sprite has its level number baked into the picture (Dan, Nov 22: "the level numbers 'blend in' rather than stick out with the pill"), so it carries no
// pill, and its level is in the tile's accessible label instead. A copy's gold dot and the hand's ring are the same HTML as before, over the picture.
// placeholder: art for levels 2+ is not made yet
const PILE_KINDS = ["river", "green", "prairie", "marsh", "trees"], PILE_ART = {};
const pileKind = t => t.k === "r" ? (t.l === 1 ? "river" : "") : t.k === "h" && t.l === 1 && !upgradeOf(CFG, t) ? ({p:"prairie", m:"marsh", t:"trees"}[t.b || ""] || "green") : "";
function loadPileArt() { for (const k of PILE_KINDS) { const a = PILE_ART[k] = {img:new Image(), ok:false}; a.img.onload = () => { a.ok = true; if (S) drawPile() }; a.img.onerror = () => { a.ok = false }; a.img.src = new URL("art/pile/" + k + ".webp", SRC_URL).href } }
function tileEl(t, px, cls, art) { const el = document.createElement("div"); el.className = "fgt " + cls + (t.c ? " copy" : "");
  el.title = tileText(CFG, t) + (upgradeOf(CFG, t) ? ", " + UPGRADE[upgradeOf(CFG, t)].name.toLowerCase() : "") + (t.c ? ", a copy" : "");
  if (art) { el.setAttribute("role", "img"); el.setAttribute("aria-label", (t.k === "r" && t.l === 1 ? "River tile (level 1)" : tileText(CFG, t)) + (upgradeOf(CFG, t) ? ", " + UPGRADE[upgradeOf(CFG, t)].name.toLowerCase() : "") + (t.c ? ", a copy" : "")) }   // the pile's tiles say their level in words (the number is part of a picture)
  const inn = document.createElement("div"); inn.className = "fgin"; el.appendChild(inn);   // the picture and its level badge: this layer is what bobs
  const pk = art ? pileKind(t) : "", pa = pk && PILE_ART[pk];
  if (pa && pa.ok) { const im = pa.img.cloneNode(); im.className = "fgart"; im.alt = ""; im.draggable = false; el.classList.add("art"); inn.appendChild(im) } else inn.appendChild(tileIcon(t, px));
  if (!el.classList.contains("art") && (t.k === "h" || t.l > 1)) { const b = document.createElement("i"); b.className = "fgl"; b.textContent = t.l; inn.appendChild(b) } return el }
// A habitat above the bare ground limit that "downgrade" plants as level 1 (the hand's caption and the outlines on the island say so).
const lowers = t => t.k === "h" && plantLevel(CFG, t.l) > 0 && plantLevel(CFG, t.l) < t.l;
// A marsh tile with no tile next to the river free (LOU-301): the pile's caption says why there is nothing to plant it on. It can still combine onto marsh, or be discarded.
const marshStuck = t => t.k === "h" && t.b === "m" && CFG.marshNeedsRiver && !S.pend.length && !opts.some(o => o.does === "plant");
// What the ring on a river tile it can raise says (Dan, Nov 20: rivers level up): "wider" while the raise still widens the river, and its points (riverScore) or the new level after that.
const widenText = o => o.l <= CFG.riverReach.length ? "wider" + (o.pts ? " +" + o.pts : "") : o.pts ? "+" + o.pts : "level " + o.l;
// ---------- the pile, floating over the island (LOU-317). The tile in hand is large, the next two trail to its right (Dan, Nov 22: "show the next two"), and a stack of thin slabs at the right end has one slab for every tile left (the tile in hand
// and the copies waiting at the back are in it), tinted by the kind of the tile where that is known, so the stack gets shorter as the game goes on. A tile that is played leaves, the next ones glide forward a place and a slab lifts off the
// stack. Each tile is one element that keeps its place in the pile (a tile is the same object in the game from the moment it is dealt), moved by a class (s0 in hand, s1 and s2 next, s3 coming off the stack).
const NEXT_SHOWN = 2, dockEls = new Map(), TINT = {r:"#58b4e8", g:"#7dce5c", p:"#e3de6a", m:"#6ec6b4", t:"#2f7d4f", n:"#d6e4d2"}, SLAB_CAP = 24;
let dockS = null, dockN = -1, dockSig = "", dockTop = "", dockCount = 0;
const artOk = t => { const pk = pileKind(t), pa = pk && PILE_ART[pk]; return !!(pa && pa.ok) };
function dockTile(t) { const el = tileEl(t, 172, "dk", true), c = el.querySelector("canvas"); if (c) c.style.width = c.style.height = "100%"; el._art = artOk(t); return el }
const handName = t => t.k === "r" ? "River tile · level " + t.l : tileText(CFG, t).replace(/ \(level (\d+)\)$/, " · level $1");
const handLabel = t => marshStuck(t) ? tileText(CFG, t) + (t.c ? " copy" : "") + " · no bank tile free" : lowers(t) ? tileText(CFG, t) + (t.c ? " copy" : "") + " · plants as level 1" : handName(t) + (t.c ? " · copy" : "");
const shade = (hex, k) => "#" + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, "0")).join("");
function slabSVG(tints) { const n = tints.length, out = [];
  for (let i = n - 1; i >= 0; i--) { const y = 4 * i; out.push(`<polygon points="2,${y + 11} 22,${y + 16} 22,${y + 20} 2,${y + 15}" fill="${shade(tints[i], .6)}"/><polygon points="22,${y + 16} 42,${y + 11} 42,${y + 15} 22,${y + 20}" fill="${shade(tints[i], .78)}"/><polygon points="22,${y} 42,${y + 5} 42,${y + 11} 22,${y + 16} 2,${y + 11} 2,${y + 5}" fill="${tints[i]}"/>`) }
  return `<svg viewBox="0 0 44 ${4 * n + 16}" aria-hidden="true"><g stroke="rgba(40,34,24,.55)" stroke-width=".6" stroke-linejoin="round">${out.join("")}</g></svg>` }
function liftSlab(color, count) { const d = $("actions"), e = document.createElement("div"); e.className = "fgslab"; e.style.bottom = `calc(${80 + 4 * (count - 1)} * var(--u))`; e.innerHTML = slabSVG([color]); d.appendChild(e); setTimeout(() => e.remove(), 320) }
function drawPile() { const layer = $("queue"), inst = dockS !== S || reduce || !dockEls.size;   // a run that has just been loaded, undone or begun, or a visitor who asks for less motion, gets the pile at once: nothing glides
  if (dockS !== S) { dockS = S; layer.textContent = ""; dockEls.clear(); dockN = -1; dockSig = "" }
  const show = S.q.slice(0, 1 + Math.min(NEXT_SHOWN, CFG.queueShown));
  for (const [t, el] of [...dockEls]) if (!show.includes(t)) { dockEls.delete(t); el.remove() }   // a tile that was played or discarded leaves
  show.forEach((t, i) => { let el = dockEls.get(t);
    if (el && el._art !== artOk(t)) { const ne = dockTile(t); ne.className = el.className; el.replaceWith(ne); dockEls.set(t, ne); el = ne }   // its picture has come in
    if (!el) { el = dockTile(t); dockEls.set(t, el); el.classList.add(inst ? "s" + i : "s3"); layer.appendChild(el); if (!inst) el.getBoundingClientRect() }   // a new tile starts on the stack and glides to its place
    for (const c of ["s0", "s1", "s2", "s3"]) el.classList.remove(c); el.classList.add("s" + i) });
  const t0 = S.q[0]; $("hName").hidden = !t0; if (t0) tx("hName", handLabel(t0)); $("dkShadow").hidden = !t0; $("grab").hidden = !t0 || S.over || !!S.pend.length;
  let em = layer.querySelector(".fgempty"); if (!t0) { if (!em) { em = document.createElement("span"); em.className = "fgempty"; layer.appendChild(em) } em.textContent = S.over ? "Run over" : "Pile empty" } else if (em) em.remove();
  // the count and the stack: one slab for every tile left (the stack is drawn up to SLAB_CAP slabs high, and the count says the rest)
  const n = left(S), tint = x => TINT[x.k === "r" ? "r" : x.b || "g"], front = S.q.map(tint), back = S.bank.map(tint);
  let mid = CFG.stackSize === 0 ? Math.max(0, 20 - front.length - back.length) : Math.max(0, CFG.stackSize - S.dealt); const over = front.length + mid + back.length - SLAB_CAP; if (over > 0) mid = Math.max(0, mid - over);
  const tints = [...front, ...Array(mid).fill(TINT.n), ...back].slice(0, SLAB_CAP), sig = (n === Infinity ? "∞" : "") + tints.join();
  tx("leftT", n === Infinity ? "∞ left" : n + " left"); $("leftChip").hidden = !(n > 0); $("stack").hidden = !(n > 0);
  if (sig !== dockSig) { if (!inst && dockN === n + 1 && dockTop && dockCount) liftSlab(dockTop, dockCount); $("stack").innerHTML = slabSVG(tints); dockSig = sig }   // the top slab lifts off as a tile is played
  dockN = n; dockTop = tints[0] || ""; dockCount = tints.length; $("actions").style.setProperty("--n", tints.length); $("stack").setAttribute("aria-label", "The pile: " + (n === Infinity ? "many tiles" : n === 1 ? "1 tile" : n + " tiles"));
  { const lc = $("lockChip"); lc.hidden = !(CFG.lockEnabled && CFG.lockEvery > 0); if (!lc.hidden) { lc.textContent = S.locks + (S.locks === 1 ? " lock" : " locks"); lc.title = "Next one in " + (CFG.lockEvery - S.toLock) + " tiles" } }   // with limited locks, the locks held (the rules with unlimited locks, the usual ones, show nothing)
  const list = $("bankList"); $("bank").hidden = !S.bank.length; list.textContent = ""; for (const x of S.bank) list.appendChild(tileEl(x, 32, "", true)) } // the copies waiting at the back, in order, in the menu
// The pick (LOU-305): a card above the pile with one large button for each of the first waiting tile's two upgrades, each with its mark, its name and one plain line.
function drawPick() { const k = S.pend[0], card = $("pickq"); card.hidden = !k; if (!k) return;
  { const r = card.getBoundingClientRect(), [, sy] = scr(GRID.at[k]), s = lay.fit * view.z; if (r.height && s && sy > r.top - 56) { view.cy += (sy - (r.top - 80)) / s; applyView() } }   // the tile waiting for its pick must not be under the card: pan it up
  (PICKS[S.hb[k] || ""] || []).forEach((f, i) => { const b = $("pick" + i); b.dataset.f = f; b.textContent = ""; const c = document.createElement("canvas"), d = Math.min(devicePixelRatio || 1, 3); c.width = c.height = Math.round(26 * d); c.style.width = c.style.height = "26px";
    const keep = ctx; ctx = c.getContext("2d"); ctx.setTransform(d, 0, 0, d, 13 * d, 13 * d); UPG_LOOK[f].mark(0, 0, 1.3, ...UPG_LOOK[f].pill); ctx = keep; b.appendChild(c);
    const n = document.createElement("b"), l = document.createElement("small"); n.textContent = UPGRADE[f].name; l.textContent = UPGRADE[f].line.replace(/^[^:]+: /, ""); b.appendChild(n); b.appendChild(l) }) }
function doPick(f) { const k = S.pend[0]; if (!k || !pick(S, k, f)) return; say(UPGRADE[f].line + "."); sync() }
function pickRing(T) { if (!S.pend.length) return; const p = GRID.at[S.pend[0]], pu = reduce ? .5 : .5 + .5 * Math.sin(T / 1000 * 3);   // a gold ring on the tile that is waiting for its pick
  if (flat()) { rpath(hexPts(p, R - 3), 7); ink("rgba(255,255,255,.95)", 8); rpath(hexPts(p, R - 3), 7); ink("#d9a520", 4 + pu) }
  else { const c = iso(...p); ctx.beginPath(); ctx.ellipse(c.x, c.y + 1, 34, 17, 0, 0, 7); ink("rgba(255,244,214,.95)", 5); ctx.beginPath(); ctx.ellipse(c.x, c.y + 1, 34, 17, 0, 0, 7); ink("#d9a520", 2.2) } }
function sync() { opts = options(S, 0); landSig = [...reachOf(S)].join(";") + (CFG.elevation ? "|e" + S.seed : "");   // with elevation the painted land also depends on the seed (its heights)
  const waiting = !S.q.length && !S.over; // the pile is empty but a lock would still bank a copy: lock, or end the run
  if (S.over || !hasLock(S)) { lockMode = false; lockSel = null } else if (waiting) lockMode = true;
  lockList = lockMode ? [...Object.keys(S.h), ...Object.keys(S.r)].map(k => GRID.at[k]).filter(p => lockable(S, p)).map(p => ({p, n:copiesOf(S, p).copies.length})) : [];
  tx("hScore", S.score);
  $("undoBtn").disabled = !S.moves.length; $("discardBtn").disabled = S.over || !S.q.length || !!S.pend.length; drawPile(); drawPick();
  $("endq").hidden = !waiting || !!lockSel; $("lockq").hidden = !lockSel; if (lockSel) lockCard();
  if (S.over && !wonShown) result(); if (!S.over) wonShown = false; $("win").hidden = !S.over; $("app").classList.toggle("won", S.over);
  mem.set(SLOT, S.over ? null : JSON.stringify({seed:S.seed, moves:S.moves, at:Date.now(), rules:RK})); if (TEST) { mirror(); testLine() } if (DEV) devLine(); if (L3) L3.sync(); draw() }
// When the tiles run out: the score, the best score on this device, the top level and what was done.
function result() { wonShown = true; try { G.Flowgrow.onRunEnd({...runRecord(), score:S.score, top:S.top, mode:CFG.mode}) } catch (_) {}   // the hook (LOU-316): daily challenges and the leaderboard hang off it later
  const best = +mem.get(BEST) || 0, low = S.log.filter(e => e.did === "plant" && e.l < e.t.l).length; if (S.score > best) mem.set(BEST, String(S.score));
  $("wScore").innerHTML = `<b>${S.score} points</b> · ${S.score > best ? (best ? `New best (was ${best})` : "New best") : `Best ${best}`}`;
  $("wGoals").innerHTML = [[`Top level ${S.top}${S.top ? " · " + levelName(CFG, S.top) : ""}`, `${Object.keys(S.h).length} habitats on the island`], [`${S.planted} planted${low ? ` (${low} as level 1)` : ""} · ${S.combined} combined`, `${S.discarded} discarded`],
    [`River: ${S.extended} extended · ${S.widened} widened`, `${Object.keys(S.r).length} river tiles with the source`],
    ...(CFG.lockEnabled ? [[`Locks: ${S.lockUsed} used · ${S.lockLost} lost`, `${Object.keys(S.lk).length} tiles locked`], [`Copies: ${S.copyBanked} banked · ${S.copyPlaced} placed · ${S.copyDiscarded} discarded`, `${S.copyPoints} points from copies`]] : [])].map(([b, s]) => `<li><div><b>${b}</b><small>${s}</small></div></li>`).join("") }

// ---------- a run: new, saved after every move, rebuilt from its seed and moves on reload (a finished or day-old run starts fresh)
const urlSeed = PLAY && !DEV ? null : new URLSearchParams(location.search).get("seed");   // a player has no seed to choose
function newRun() { S = fresh(CFG, urlSeed != null && urlSeed !== "" ? urlSeed : Math.floor(Math.random() * 1e9)); for (const k in pops) delete pops[k]; fx.length = 0; lockMode = false; lockSel = null; say(S.q[0] && S.q[0].k === "r" ? "Drag or tap land next to your river." : "Drag or tap green land."); sync() }
function load() { try { const d = JSON.parse(mem.get(SLOT) || "null"); if (!d || d.rules !== RK || !Array.isArray(d.moves) || Date.now() - d.at > 12 * 3600e3 || (TEST && urlSeed != null && urlSeed !== "" && d.seed !== seedOf(urlSeed))) return false; S = replay(CFG, d.seed, d.moves); return !S.over } catch (_) { return false } }   // on the test build ?seed= means that run: a saved run of another seed isn't picked up
// With elevation, a tap that has nothing else to say gives the height of the land it was on (LOU-310), and a river tile that stepped down says so.
const heightLine = (p, res) => { if (!CFG.elevation) return ""; const k = key(p), h = elevOf(CFG, S.seed)[k]; return res.does === "extend" && fallAt(S, k) ? `Waterfall: the river steps down to height ${h}.` : `Height ${h}.` };
function tap(p, carried) { if (swallow) { swallow = 0; return } if (!S || S.over || !p) return;
  if (lockMode) { if (!lockable(S, p)) { say(key(p) in S.lk ? "That tile is locked." : "Pick a habitat or a river tile.", true); return } lockSel = p; say(""); sync(); return }
  const had = S.locks, hand = S.q[0], res = place(S, 0, p);
  if (!res) { const k = key(p), u = k in S.h ? upgradeLine({k:"h", b:S.hb[k], l:S.h[k], f:S.hf[k]}) : "", w = why(S, 0, p), hg = CFG.elevation && w && !/uphill/.test(w) && CFG.map[p[1]][p[0]] !== "B" ? ` Height ${elevOf(CFG, S.seed)[k]}.` : "";
    say(w + hg + (u ? " " + u : ""), true); return }   // a refused tap says why, and with elevation the land's height   // a refused tap on a tile with an upgrade says what the upgrade is
  pops[key(p)] = now(); if (res.pts) fx.push({p, text:"+" + res.pts, t0:now(), up:TALL[Math.min(res.l, 7)]});
  for (const j of res.free) { pops[j] = now(); fx.push({p:unkey(j), text:"+1", t0:now(), up:TALL[1]}) }   // a steppe's free tiles pop in and score 1 each
  for (const L of res.lifts) { pops[L.k] = now(); fx.push({p:unkey(L.k), text:"+" + L.pts, t0:now(), up:TALL[Math.min(S.h[L.k], 7)]}) }   // and so do the tiles roots lifted
  const kind = res.tile.b, gained = res.tile.k === "h" && upgradeOf(CFG, {k:"h", b:kind, l:res.l}) && !(res.does === "combine" && upgradeOf(CFG, {k:"h", b:kind, l:res.l - 1}));   // a move that gives a tile its upgrade says what it is
  if (!carried && hand) flyGhost(hand, p);   // the tile in hand glides out to where it goes (a carried tile is already there)
  const said = S.locks > had ? "You earned a lock. Press and hold a tile to lock it." : res.lifts.length ? `Roots +${res.lifts.length} ${res.lifts.length === 1 ? "tile" : "tiles"}, ${res.liftPts} points.` : S.pend.length ? "Choose an upgrade." : res.mult > 1 ? `${res.mk === "marsh" ? "Marsh" : "Meadow"} ×${res.mult}: +${res.pts}.` : res.free.length ? `Steppe planted ${res.free.length === 1 ? "a free prairie" : res.free.length + " free prairies"}.` : res.does === "plant" && res.l < res.tile.l ? `Planted as level ${res.l}.` : gained ? upgradeLine({k:"h", b:kind, l:res.l}) : heightLine(p, res) || lockTip(); say(said); sync() }
// There is no Lock button (LOU-317), so a player is told once, after a few moves and when the move has nothing else to say, how to lock a tile.
function lockTip() { if (!CFG.lockEnabled || !hasLock(S) || S.lockUsed || S.moves.length < 5 || mem.get("tip.lock")) return ""; mem.set("tip.lock", "1"); return "Tip: press and hold a tile to lock it." }
function undo() { if (!S.moves.length) return; S = replay(CFG, S.seed, S.moves.slice(0, S.moves.length - undoCount(S.moves))); lockMode = false; lockSel = null; say("Stepped back."); sync() }   // a pick goes back with the move that led to it
async function copyText(t) { try { await navigator.clipboard.writeText(t); return true } catch (_) {} try { const a = document.createElement("textarea"); a.value = t; a.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(a); a.select(); const ok = document.execCommand("copy"); a.remove(); return ok } catch (_) { return false } }

// ---------- the test build's tools (LOU-315). A run is its config, seed and moves, so a bug report can be a paste: runRecord() is that, as an object, and loadRun() replays one (in place when the rules are the ones
// in force, otherwise by opening this page with the run's rules in the address). The board is also data: one element for every cell with its kind, level and cell as attributes (and the pile), so a test can read
// the board without pixels. And the rules line says plainly which rules this visit changed. They are drawn only where the page has the elements for them (test/index.html).
const runRecord = () => ({flowgrow:"run", v:1, rules:RK, seed:S.seed, config:Object.fromEntries(ASKED.map(k => [k, CFG[k]])), moves:S.moves});
function loadRun(text) { let r; try { r = JSON.parse(String(text).trim()) } catch (_) { return "That isn't a run: paste the text that Copy run gave." }
  if (!r || r.flowgrow !== "run" || !Array.isArray(r.moves) || r.seed == null || !r.config || typeof r.config !== "object") return "That isn't a run: paste the text that Copy run gave.";
  const need = tidy({...G.FLOWGROW, ...r.config}, G.FLOWGROW); if (need.bad.length) return "Those rules aren't valid here: " + need.bad.join(", ") + ".";
  if (rulesKey(need.cfg) !== RK) {   // another ruleset: open this page with the run's rules in the address, and replay it there
    const q = new URLSearchParams(); q.set("seed", r.seed); for (const [k, v] of Object.entries(r.config)) { if (k === "map") return "This run has its own map, which can't go in the address."; q.set(k, Array.isArray(v) ? v.join(",") : String(v)) }
    try { sessionStorage.setItem("flowgrow.test.pending", JSON.stringify({config:r.config, seed:r.seed, moves:r.moves})) } catch (_) { return "This run was played under other rules and this device can't carry it across." }
    location.href = location.pathname + "?" + q; return "" }
  try { S = replay(CFG, r.seed, r.moves) } catch (e) { return "That run can't be replayed here: " + String(e.message).replace(/^Flowgrow: /, "") + "." }
  for (const k in pops) delete pops[k]; fx.length = 0; lockMode = false; lockSel = null; wonShown = false; say("Run loaded."); sync(); return "" }
function takePending() { try { const p = sessionStorage.getItem("flowgrow.test.pending"); if (!p) return false; sessionStorage.removeItem("flowgrow.test.pending"); const r = JSON.parse(p);
    if (rulesKey(tidy({...G.FLOWGROW, ...r.config}, G.FLOWGROW).cfg) !== RK) return false; S = replay(CFG, r.seed, r.moves); return true } catch (_) { return false } }
const domCells = [], KIND_WORD = {p:"prairie", m:"marsh", t:"trees"};
function mirror() { const box = $("boardDom"); if (!box) return;
  if (!domCells.length) for (const k of Object.keys(GRID.at)) { const e = document.createElement("div"); e.id = "t-" + k.replace(",", "-"); e.setAttribute("role", "listitem"); e.dataset.cell = k; box.appendChild(e); domCells.push([k, e]) }
  const reach = reachOf(S);
  for (const [k, e] of domCells) { const rv = S.r[k], hl = S.h[k], mt = codeAt(CFG, GRID.at[k]) === "B", up = hl ? upgradeOf(CFG, {k:"h", ...(S.hb[k] ? {b:S.hb[k]} : {}), l:hl, f:S.hf[k]}) : "";
    e.dataset.kind = mt ? "mountain" : rv ? (rv.from == null ? "source" : "river") : hl ? KIND_WORD[S.hb[k] || ""] || "green" : "empty"; e.dataset.level = String(rv ? rv.l : hl || 0);
    e.dataset.locked = k in S.lk ? "1" : "0"; e.dataset.reach = !mt && !rv && !hl && reach.has(k) ? "1" : "0"; if (up) e.dataset.up = up; else delete e.dataset.up }
  const pile = $("pileDom"); if (pile) { pile.textContent = ""; const add = (id, t) => { const e = document.createElement("div"); e.id = id; e.dataset.kind = t.k === "r" ? "river" : KIND_WORD[t.b || ""] || "green"; e.dataset.level = String(t.l); e.dataset.copy = t.c ? "1" : "0"; pile.appendChild(e) };
    S.q.forEach((t, i) => add(i === 0 ? "hand" : "next-" + i, t)); S.bank.forEach((t, i) => add("bank-" + i, t)) } }
function devLine() { const e = $("devLine"); if (e) { e.hidden = false; e.textContent = "dev · look " + skin + " · seed " + S.seed + " · saved under flowgrow.dev.*" } }   // the play page's developer line (LOU-316)
function testLine() { const e = $("testLine"); if (!e) return; const ch = ASKED.map(k => `${k}=${Array.isArray(CFG[k]) ? CFG[k].join(",") : CFG[k]}`);
  e.textContent = "Test build · seed " + S.seed + " · " + (ch.length ? "rules changed: " + ch.join(", ") : "rules as the game"); e.classList.toggle("changed", ch.length > 0); e.dataset.rules = RK; e.dataset.changed = ch.join(" ") }

// ---------- input: drag to pan, pinch or wheel to zoom; a touch that barely moves is a tap (from play.js)
const ptrs = new Map(); let drag = null, dragged = false;
cv.addEventListener("pointerdown", e => { ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY}); try { cv.setPointerCapture(e.pointerId) } catch (_) {} const pts = [...ptrs.values()];
  if (pts.length === 1) { drag = {x:e.clientX, y:e.clientY, cx:view.cx, cy:view.cy}; dragged = false } else if (pts.length === 2) { drag = {pinch:Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), z:view.z}; dragged = true } });
cv.addEventListener("pointermove", e => { if (!ptrs.has(e.pointerId) || !drag) return; ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY}); const pts = [...ptrs.values()];
  if (drag.pinch && pts.length >= 2) { view.z = drag.z * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / drag.pinch; applyView(); return } if (drag.pinch) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (!dragged && Math.hypot(dx, dy) < 9) return; dragged = true; const s = lay.fit * view.z; view.cx = drag.cx - dx / s; view.cy = drag.cy - dy / s; applyView() });
const lift = e => { ptrs.delete(e.pointerId); if (!ptrs.size) drag = null };
cv.addEventListener("pointercancel", e => { lift(e); dragged = false });
cv.addEventListener("contextmenu", e => e.preventDefault());
cv.addEventListener("wheel", e => { e.preventDefault(); view.z *= Math.exp(-e.deltaY * .0015); applyView() }, {passive:false});
cv.addEventListener("pointerup", e => { const wasDrag = dragged; lift(e); if (wasDrag) { if (!ptrs.size) dragged = false; return } tap(tileAt(e.clientX, e.clientY)) });
$("undoBtn").onclick = undo;
function doDiscard() { if (discard(S, 0)) { say("Discarded."); sync() } }
$("discardBtn").onclick = doDiscard;
$("again").onclick = newRun;
// Lock (LOU-317: there is no Lock button): press and hold a tile on the island (right-click with a mouse) and confirm on the card above the pile. With the pile empty and a lock to use, any tap on a tile picks it (lock mode).
$("pickq").addEventListener("click", e => { const b = e.target.closest("button[data-f]"); if (b) doPick(b.dataset.f) });
function lockTile(p) { if (!S || S.over || !p || !CFG.lockEnabled) return;
  if (S.pend.length) { say("Choose an upgrade first.", true); return }
  if (!hasLock(S)) { say(CFG.lockEvery > 0 ? `No lock yet. Next one in ${CFG.lockEvery - S.toLock} tiles.` : "", true); return }
  if (!lockable(S, p)) { say(key(p) in S.lk ? "That tile is locked." : "Press and hold a habitat or a river tile to lock it.", true); return }
  lockMode = true; lockSel = p; say(""); sync() }
$("lockYes").onclick = () => { if (!lockSel) return; const r = lock(S, lockSel); lockMode = false; lockSel = null; if (r) say(r.copies.length ? `Locked. ${r.copies.length} ${r.copies.length === 1 ? "copy" : "copies"} banked.` : "Locked. Nothing to copy."); sync() };
$("lockNo").onclick = () => { lockSel = null; lockMode = false; sync() };   // (with an empty pile and a lock still in hand, sync turns lock mode back on)
$("endYes").onclick = () => { if (end(S)) sync() };
$("copyLog").onclick = async () => { const e = $("dToast"); e.textContent = await copyText(logText(S)) ? "Run log copied." : "Couldn't copy on this device."; e.hidden = false; setTimeout(() => { e.hidden = true }, 2200) };
// The menu: how to play, the seven levels, a new run, the run log and Home. Tap outside to close.
const menu = open => { $("mConf").hidden = true; tx("mSeed", "Seed " + S.seed); tx("lookNote", skin === "3d" ? "3D. Tap for the simple look" : skin === "painted" ? "Painted. Tap for the 3D look" : "Simple. Tap for the painted look");
  const tr = $("timeRow"); if (tr) { tr.hidden = !(L3 && skin === "3d"); if (L3 && skin === "3d") tx("timeNote", L3.timeNote()) }   // the time of day is a 3D-look setting
  $("menu").hidden = !open };
$("menuBtn").onclick = () => menu(true);
// ---------- carrying the tile in hand (LOU-317). Drag it out of the pile: it lifts, hovers over the cell it would go to with its shadow on the ground and a small tag with the points ("+3 here"), and lands when it is let go. Let go over Discard to
// discard it, and anywhere else (or on a cell it can't go to) and it goes back (a cell that refuses it says why). Tapping land still places the tile in hand at once. The rings show on every cell it can go to the whole time.
const hapt = ms => { try { if (navigator.vibrate) navigator.vibrate(ms) } catch (_) {} };
const U = () => $("actions").getBoundingClientRect().width / 390 || 1;
const cellUnder = (x, y) => L3 && skin === "3d" ? L3.cellAt(x, y) : tileAt(x, y), optAt = p => (p && opts.find(o => sameCell(o.p, p))) || null;
const overDiscard = (x, y) => { const r = $("discardBtn").getBoundingClientRect(), m = 16; return !$("discardBtn").disabled && x >= r.left - m && x <= r.right + m && y >= r.top - m && y <= r.bottom + m };
function carryPaint(t) { const box = $("carryTile"); box.textContent = ""; const el = tileEl(t, Math.round(112 * U()), "cr", true), c = el.querySelector("canvas"); if (c) c.style.width = c.style.height = "100%"; box.appendChild(el) }
function carryPlace(x, y, snap) { const c = $("carry"); c.classList.toggle("snap", !!snap); c.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)` }
const handSpot = () => { const g = $("grab").getBoundingClientRect(); return [g.left + g.width / 2, g.bottom - 8 * U()] };
// a tile that is placed with a tap glides out of the pile to its cell and fades there (reduced motion: it just goes)
function flyGhost(t, p) { if (reduce || !$("grab").offsetWidth) return; const c = $("carry"), [hx, hy] = handSpot(), [sx, sy] = scr(p);
  carryPaint(t); c.hidden = false; c.className = "fgcarry"; carryPlace(hx, hy, false); c.getBoundingClientRect(); c.classList.add("go"); carryPlace(sx, sy + 4 * U(), false); setTimeout(() => { if (!carry) { c.hidden = true; c.className = "fgcarry" } }, 240) }
let carry = null;
function carryOn() { const t = S.q[0]; if (!t) return; if (lockSel) { lockSel = null; lockMode = false; sync() }   // a lock that was being chosen is let go: this drag is a placement
  carry.on = true; carryPaint(t); const c = $("carry"); c.hidden = false; c.className = "fgcarry"; $("app").classList.add("carrying"); hapt(8) }
function carryMove(x, y) { const dd = overDiscard(x, y), o = dd ? null : optAt(cellUnder(x, y)), c = $("carry"), u = U(); $("discardBtn").classList.toggle("drop", dd);
  if (o) { const [sx, sy] = scr(o.p), L = optLabel(o); carryPlace(sx, sy + 4 * u, true); tx("carryTag", o.does === "widen" ? L.main + " here" : o.pts > 0 ? "+" + o.pts + " here" : o.does === "extend" ? "River here" : "Plant here") }
  else carryPlace(x, y - 2 * u, false);
  c.classList.toggle("snap", !!o); const cell = o ? o.p : null; if (!sameCell(cell, carryCell)) { carryCell = cell; if (L3 && L3.hover) L3.hover(cell); if (reduce) draw() } }
function carryEnd(pt) { const c = $("carry"), app = $("app"); $("discardBtn").classList.remove("drop"); carryCell = null; if (L3 && L3.hover) L3.hover(null);
  const away = () => { c.hidden = true; c.className = "fgcarry"; app.classList.remove("carrying") }, back = () => { const [hx, hy] = handSpot(); if (reduce) { away(); return } c.classList.add("go"); carryPlace(hx, hy, false); setTimeout(away, 220) };   // back to the pile
  if (!pt) { back(); return }
  if (overDiscard(pt[0], pt[1])) { away(); doDiscard(); return }
  const p = cellUnder(pt[0], pt[1]); if (!p) { back(); return }
  if (optAt(p)) { c.classList.add("go"); app.classList.remove("carrying"); tap(p, true); setTimeout(() => { if (!carry) away() }, 220) }   // it lands: the island takes it, the next tile glides in
  else { tap(p, true); back() } }   // a cell that can't take it says why, and the tile goes back
{ const grab = $("grab");
  grab.addEventListener("pointerdown", e => { if (!S || S.over || !S.q[0] || S.pend.length || (e.pointerType === "mouse" && e.button !== 0)) return; try { grab.setPointerCapture(e.pointerId) } catch (_) {} carry = {id:e.pointerId, x0:e.clientX, y0:e.clientY, on:false}; e.preventDefault() });
  grab.addEventListener("pointermove", e => { if (!carry || e.pointerId !== carry.id) return; if (!carry.on) { if (Math.hypot(e.clientX - carry.x0, e.clientY - carry.y0) < 8) return; carryOn() } carryMove(e.clientX, e.clientY) });
  const up = (e, drop) => { if (!carry || e.pointerId !== carry.id) return; const c = carry; carry = null; try { grab.releasePointerCapture(e.pointerId) } catch (_) {}
    if (!c.on) { if (drop) say(S.q[0] && S.q[0].k === "r" ? "Drag or tap land next to your river." : "Drag or tap green land."); return }
    carryEnd(drop ? [e.clientX, e.clientY] : null) };
  grab.addEventListener("pointerup", e => up(e, true)); grab.addEventListener("pointercancel", e => up(e, false)); grab.addEventListener("contextmenu", e => e.preventDefault()) }

// ---------- press and hold a tile on the island to lock it (right-click with a mouse). A ring fills while the finger is held; at the end the lock card opens, and the lift of that touch is not a tap.
{ const board = $("board"), ring = $("holdRing"), H = {t:0, show:0, id:-1, x:0, y:0, fired:0};
  const stop = () => { clearTimeout(H.t); clearTimeout(H.show); H.t = H.show = 0; ring.hidden = true; ring.className = "fghold" };
  const fire = () => { H.t = 0; H.fired = now(); swallow = 0; ring.className = "fghold done"; setTimeout(stop, 160); hapt(14); lockTile(cellUnder(H.x, H.y)); swallow = 1 };
  board.addEventListener("pointerdown", e => { if (!e.isPrimary) { stop(); return } swallow = 0; stop(); if (e.target.tagName !== "CANVAS" || (e.pointerType === "mouse" && e.button !== 0) || !S || S.over || !CFG.lockEnabled) return;
    H.id = e.pointerId; H.x = e.clientX; H.y = e.clientY; H.t = setTimeout(fire, 460);
    H.show = setTimeout(() => { ring.style.left = H.x + "px"; ring.style.top = H.y + "px"; ring.hidden = false; ring.className = "fghold"; ring.getBoundingClientRect(); ring.className = "fghold on" }, 140) }, true);
  board.addEventListener("pointermove", e => { if (H.t && e.pointerId === H.id && Math.hypot(e.clientX - H.x, e.clientY - H.y) > 9) stop() }, true);
  for (const ev of ["pointerup", "pointercancel"]) board.addEventListener(ev, e => { if (e.pointerId !== H.id) return; const fired = H.t === 0 && H.fired && now() - H.fired < 3000 && ev === "pointerup"; if (H.t) stop(); H.id = -1; swallow = fired && swallow ? 1 : 0 }, true);
  board.addEventListener("contextmenu", e => { if (e.target.tagName !== "CANVAS") return; e.preventDefault(); if (now() - H.fired < 900) return; stop(); lockTile(cellUnder(e.clientX, e.clientY)) }, true) }

$("menu").addEventListener("click", async e => { if (e.target === $("menu")) { menu(false); return } const b = e.target.closest("[data-m]"); if (!b) return; const k = b.dataset.m;
  if (k === "new") { $("mConf").hidden = false; return } if (k === "newNo") { $("mConf").hidden = true; return }
  if (k === "log") { const ok = await copyText(logText(S)); menu(false); say(ok ? "Run log copied." : "Couldn't copy on this device."); return }
  if (k === "runcopy") { const ok = await copyText(JSON.stringify(runRecord())); menu(false); say(ok ? "Run copied: its rules, seed and moves." : "Couldn't copy on this device."); return }   // the test build's tools (LOU-315)
  if (k === "runload") { $("runBox").hidden = false; $("runText").focus(); return } if (k === "runNo") { $("runBox").hidden = true; return }
  if (k === "runGo") { const m = loadRun($("runText").value); tx("runMsg", m); if (!m) { $("runBox").hidden = true; menu(false) } return }
  if (k === "reload") { location.reload(); return }
  if (k === "time") { if (L3 && L3.cycleTime) { L3.cycleTime(); menu(true) } return }   // Auto, Day, Golden hour, Night, Pause: the menu stays open so the new choice shows
  menu(false); if (k === "newYes") newRun(); else if (k === "look") setSkin(LOOKS[(LOOKS.indexOf(skin) + 1) % LOOKS.length]); else if (k === "zoom") { if (L3 && skin === "3d") L3.toggleFit(); else { view.z = view.z > 1.02 ? 1 : lay.zAuto; applyView() } } });
addEventListener("keydown", e => { if (e.key === "Escape") menu(false) });
function fillLadder() { const L = $("ladder"); L.textContent = ""; for (let l = 1; l <= CFG.maxLevel; l++) { const d = document.createElement("div"); d.appendChild(tileEl({k:"h", l}, 40, "")); const n = document.createElement("small"); n.innerHTML = `${levelName(CFG, l)}<b>+${scoreOf(CFG, l)}</b>`; d.appendChild(n); L.appendChild(d) } }
fillLadder();
// The marsh multiplier in words, from the ramp ("x1.5 for two, x2 for three ..."): each river tile count from two up (from one when one is above x1), and a ramp shorter than six says "or more" on its last number.
function marshRampText(c) { const r = c.marshRiverRamp, W = ["", "one", "two", "three", "four", "five", "six"], out = [];
  for (let n = r[0] > 1 ? 1 : 2; n <= r.length; n++) out.push(`×${r[n - 1]} for ${W[n]}${n === r.length && n < 6 ? " or more" : ""}`);
  return out.length ? " A marsh tile scores more for each river tile it touches: " + out.join(", ") + "." : "" }
// The menu's how-to lines follow the rules in force: the bare ground rule (LOU-300), and whether locks are limited.
{ const n = CFG.bareGroundMaxLevel, hb = $("howBare"); hb.hidden = n >= CFG.maxLevel;
  hb.textContent = CFG.bareGroundMode === "downgrade" ? `Planted on bare ground, a tile above level ${n} lands as level 1.` : `Only level ${n}${n > 1 ? " or lower" : ""} can be planted on bare ground. A higher tile has to combine onto a habitat of its own level, or be discarded.`;
  tx("howLock", (CFG.lockEvery > 0 ? `Every ${CFG.lockEvery} tiles you place earns a lock. ` : "There is no limit on locks. ") + "Press and hold a tile on the island (or right-click it) to lock it: its neighbours, at its level or below, are copied to the back of your pile, and a locked tile can't grow any more.");
  const ha = $("howAddr"); ha.hidden = !ASKED.length; ha.textContent = ASKED.length ? "This visit changes " + ASKED.map(k => `${k}=${Array.isArray(CFG[k]) ? CFG[k].join(", ") : CFG[k]}`).join(", ") + " (from the address). Your run and best score are kept apart from the usual game's." : "";
  const hv = $("howBiome"); hv.hidden = !(CFG.prairieShare > 0 || CFG.marshShare > 0);
  hv.textContent = "Yellow tiles are Prairie and turquoise tiles are Marsh. " + (CFG.biomeMatch ? "They grow the same way as the green ones, but a tile only combines with a habitat of its own kind and level." : "Any kind combines with any kind of the same level.")
    + (CFG.marshNeedsRiver ? " Marsh only goes on land that touches the river" + (CFG.upgradeLevel > 0 ? " or a reed bed." : ".") : "") + (CFG.prairieSpreads ? " Prairie can also go on land that touches prairie, even outside the river's reach." : "")
    + (CFG.marshRiverMultiplier ? marshRampText(CFG) : "");
  const ht = $("howTrees"); ht.hidden = !(CFG.treeShare > 0);
  ht.textContent = "Trees (deep green) plant like green, on empty land within reach of the river, and only combine with trees of the same level.";
  const hu = $("howUpgrade"), reedOn = CFG.marshShare > 0 && CFG.marshNeedsRiver, steppeOn = CFG.prairieShare > 0, treesOn = CFG.treeShare > 0; hu.hidden = !(CFG.upgradeLevel > 0 && (reedOn || steppeOn || treesOn));   // upgrades (LOU-304, LOU-305)
  hu.textContent = (reedOn ? `From level ${CFG.upgradeLevel} a marsh habitat is a reed bed, shown by a pale rim and a small reed mark: marsh can be planted on land that touches it, as if it were river bank.` : "")
    + (reedOn && (steppeOn || treesOn) ? " " : "") + (steppeOn ? `A prairie habitat that reaches level ${CFG.upgradeLevel} asks you to choose an upgrade: Steppe plants a free prairie each time it levels up, and Meadow multiplies its level-ups by the marsh and trees next to it.` : "")
    + (treesOn ? ` A tree habitat that reaches level ${CFG.upgradeLevel} asks too: Roots lifts the lower habitats beside it a level each time it levels up, and Pine-oneer lets trees be planted on land next to it.` : "");
  const hr = $("howRiver"); hr.hidden = CFG.riverMaxLevel <= CFG.riverReach.length && CFG.riverScore === "none" && !CFG.riverRaiseGuard;
  hr.textContent = (CFG.riverMaxLevel > CFG.riverReach.length
    ? `A river tile put on a river tile of its own level raises it a level${CFG.riverScore === "none" ? "" : " and scores the points for the new level"}. Only the first ${CFG.riverReach.length} levels widen the river and reach more land. After that the level just counts.`
    : `A river tile put on a river tile of its own level widens it${CFG.riverScore === "none" ? "" : " and scores points"}.`)
    + (CFG.riverRaiseGuard ? " A river tile can't raise a river tile if that would leave another river tile in your pile with nowhere to go, so extend the river first." : "") }
// A map page (the elevation maps) names itself, and says what the heights mean (LOU-310).
if (NAME) { document.title = "Flowgrow · " + NAME; const mb = document.querySelector("#menu .mhead b"); if (mb) mb.textContent = "Flowgrow · " + NAME }
{ const he = $("howElev"); he.hidden = !CFG.elevation; if (CFG.elevation) he.textContent = `Heights, 0 to ${CFG.elevationLevels}: the land is shaded by height (lighter is higher) and a dark line is a step down. The river starts on the highest ground and can go level or down, never up; where it steps down it makes a waterfall, shown as white lines. `
  + (CFG.stepAdjacency === "all" ? "Tiles across a step don't count as neighbours: no Meadow bonus, no Roots lift, no Steppe tile, no lock copy, and no prairie spread, reed bed or pine-oneer land." : CFG.stepAdjacency === "score" ? "Marsh and trees across a step don't count towards a Meadow's multiplier." : "A step changes nothing else.") }
// Switch the look and remember it. The camera starts again on the source, since the two looks have different bounds.
function setSkin(v) { if (!LOOKS.includes(v) || v === skin) return; if (!PLAY) mem.set("look", v);   // the play page remembers no look: it picks one each visit
  if (v === "3d") { enter3d(); return }   // it loads first, and the page keeps drawing the look it has until then
  if (skin === "3d") leave3d();
  skin = v; markLook(); $("app").classList.toggle("simple", flat());
  B = bounds(); resort(); landKey = ""; lastSize = ""; view.z = null; fillLadder(); resize(); sync() }
// ---------- the 3D look (LOU-311). The vendored three.js (r128) and flowgrow.look3d.js are fetched the first time it is asked for (?look=3d, or the Look row), so the other looks never load them. The look only reads the
// game (the bridge below) and calls tap(); it never changes a rule, a score, a save or the seed. If the files or WebGL aren't there the page keeps the look it has and says so.
const LOOK3D_FILES = ["vendor/three.r128.min.js", "flowgrow.look3d.js", "flowgrow.look3d.art.js", "flowgrow.look3d.sky.js"];
let l3Loading = null;
function load3d() { if (G.Flowgrow3D) return Promise.resolve(G.Flowgrow3D); if (l3Loading) return l3Loading;
  l3Loading = LOOK3D_FILES.concat(new URLSearchParams(location.search).has("example") ? ["flowgrow.look3d.example.js"] : []).reduce((p, f) => p.then(() => new Promise((ok, bad) => { const s = document.createElement("script"); s.src = new URL(f, SRC_URL).href; s.onload = ok; s.onerror = () => bad(new Error("Couldn't load " + f)); document.head.appendChild(s) })), Promise.resolve()).then(() => G.Flowgrow3D);
  l3Loading.catch(() => { l3Loading = null }); return l3Loading }
const bridge3d = () => ({board:$("board"), cv, top:$("top"), cfg:CFG, grid:GRID, rules, W, H, key, unkey, step, reduce, state:() => S, options:() => opts, tap, say, bottom:dockH, optLabel,
  lock:() => ({mode:lockMode, sel:lockSel, list:lockList}), pops, fx, widenText, marshMult, upgradeOf, levelName, tileText, BIOME_NAME, mem});
// (the play page never says "Loading the 3D look", so it has no message to clear when the look is up, and a message of its own stays)
function enter3d() { if (L3) return Promise.resolve(); if (!PLAY) say("Loading the 3D look…");
  return load3d().then(m => { const ctl = m.mount(bridge3d()); if (!ctl) throw new Error("This device can't draw 3D."); L3 = ctl; skin = "3d"; markLook(); cv.style.visibility = "hidden"; $("app").classList.toggle("simple", true);
    if (!PLAY) say(""); lastSize = ""; resize(); sync() }).catch(err => { if (!PLAY) say((err && err.message || "The 3D look couldn't start.") + " Staying on the " + skin + " look.", true) }) }   // the play page says nothing: it drops to a simpler look (settleLook)
function leave3d() { if (!L3) return; L3.unmount(); L3 = null; cv.style.visibility = "" }

// ---------- the play page's quiet fallback (LOU-316). The page opens on the 3D look. If the device can't draw it (no WebGL) or the first frames run under 20 fps, it drops to the painted look, and from there to the plain look,
// which always works. The run is the same run: a look only reads the game. Nothing is said, nothing is remembered and there is no error screen. Low battery turns the day and the wind down to a still picture (no
// shadows, no animals, the day held), as reduced motion does. ?dev=1&fps=N gives the probe a frame rate to see, to try the fallback.
const FPS_LOW = 20, FPS_FORCED = DEV && new URLSearchParams(location.search).has("fps") ? +new URLSearchParams(location.search).get("fps") : null;
function frameRate(frames = 40, warm = 20) { if (FPS_FORCED != null) return Promise.resolve(FPS_FORCED);
  return new Promise(res => { let n = 0, t0 = 0; const step = t => { if (document.hidden) { n = 0; requestAnimationFrame(step); return } n++; if (n === warm) t0 = t; if (n === warm + frames) return res(frames * 1000 / (t - t0)); requestAnimationFrame(step) }; requestAnimationFrame(step) }) }
async function settleLook() { try { const bt = navigator.getBattery ? await navigator.getBattery() : null; if (bt && !bt.charging && bt.level < .2) Object.assign(G.FLOWGROW.look3d || (G.FLOWGROW.look3d = {}), {quality:"low", dayNight:"fixed:day"}) } catch (_) {}
  await enter3d(); if (skin === "3d" && await frameRate() >= FPS_LOW) return;
  setSkin("painted"); if (await frameRate() >= FPS_LOW) return;
  setSkin("simple") }
// ---------- the first run (LOU-316): three short screens, once. Place a tile, match two of the same level, grow the river. A run in progress or a developer never sees it; skipping or finishing remembers it.
const INTRO = [["Place a tile", "Drag the tile in your hand onto land next to your river, or just tap the land.", `<g fill="#e4efe0" stroke="#b3c4c6" stroke-width="2"><path d="M30 38l22-13 22 13v26L52 77 30 64z"/><path d="M78 38l22-13 22 13v26L100 77 78 64z"/><path d="M54 66l22-13 22 13v26L76 105 54 92z"/></g><path d="M20 50 C 40 62, 60 40, 76 52" fill="none" stroke="#5aaeea" stroke-width="9" stroke-linecap="round"/><path d="M78 38l22-13 22 13v26L100 77 78 64z" fill="none" stroke="#e0a31c" stroke-width="4" stroke-dasharray="7 6"/><path d="M96 22l8-14 8 14z" fill="#e0a31c"/>`],
  ["Match two of the same level", "Put a tile on one of the same level and they grow into the next level.", `<path d="M28 48l18-10 18 10v20L46 78 28 68z" fill="#a6e47f" stroke="#3f9a3a" stroke-width="2.5"/><text x="46" y="65" text-anchor="middle" font-size="22" font-weight="800" fill="#173c2a">1</text><text x="75" y="64" text-anchor="middle" font-size="22" font-weight="800" fill="#4f6f70">+</text><path d="M88 48l18-10 18 10v20l-18 10-18-10z" fill="#a6e47f" stroke="#3f9a3a" stroke-width="2.5"/><text x="106" y="65" text-anchor="middle" font-size="22" font-weight="800" fill="#173c2a">1</text><path d="M60 94h40" stroke="#4f6f70" stroke-width="3" stroke-linecap="round"/><path d="M52 108l20-11 20 11v22l-20 11-20-11z" transform="translate(8 -26)" fill="#52b94e" stroke="#278a3a" stroke-width="2.5"/><text x="80" y="124" text-anchor="middle" font-size="22" font-weight="800" fill="#fff">2</text>`],
  ["Grow the river", "River tiles reach more land. Place them, and widen the river by matching them too.", `<path d="M14 92 C 40 70, 56 104, 84 80 S 128 66, 146 56" fill="none" stroke="#5aaeea" stroke-width="7" stroke-linecap="round"/><path d="M14 92 C 40 70, 56 104, 84 80" fill="none" stroke="#9fd2f4" stroke-width="13" stroke-linecap="round" opacity=".55"/><g fill="#e4efe0" stroke="#b3c4c6" stroke-width="2"><path d="M100 24l16-9 16 9v18l-16 9-16-9z"/><path d="M52 30l16-9 16 9v18l-16 9-16-9z"/><path d="M20 38l16-9 16 9v18l-16 9-16-9z"/></g>`]];
function showIntro() { const el = $("intro"); if (!el) return; let i = 0, seen = false; const done = () => { el.hidden = true; mem.set("intro", "1") };
  const draw = () => { tx("introT", INTRO[i][0]); tx("introP", INTRO[i][1]); $("introArt").innerHTML = `<svg viewBox="0 0 160 150" width="160" height="150" aria-hidden="true">${INTRO[i][2]}</svg>`; tx("introGo", i === INTRO.length - 1 ? "Play" : "Next");
    $("introDots").innerHTML = INTRO.map((_, j) => `<i${j === i ? ' class="on"' : ""}></i>`).join("") };
  $("introGo").onclick = () => { if (i === INTRO.length - 1) done(); else { i++; draw() } }; $("introSkip").onclick = done; draw(); el.hidden = false; void seen }
// What the page says about the old runs on this device (LOU-316): a run saved by an older version of the rules can't be replayed now, so it is dropped, once, with a plain line.
function staleRuns() { let n = 0; try { for (const k of Object.keys(localStorage)) { const m = /^flowgrow\.run\.v(\d+)\./.exec(k); if (!m || +m[1] >= 13) continue; try { if ((JSON.parse(localStorage.getItem(k)).moves || []).length) n++ } catch (_) {} localStorage.removeItem(k) } } catch (_) {} return n }
addEventListener("resize", resize);
if (window.ResizeObserver) { const ro = new ResizeObserver(resize); ro.observe($("board")); ro.observe($("top")); ro.observe($("actions")) }
function loop() { draw(); requestAnimationFrame(loop) }
if (!TEST) loadPileArt();   // the pile's pictures (they are drawn when they arrive); the test build has none, its tiles are the flat ones
if (TEST && takePending()) sync(); else if (load()) sync(); else { const old = PLAY && !DEV ? staleRuns() : 0; newRun(); if (old) say("Your earlier run was from an older version of the rules, so this is a new run.") }   // on the test build, a run that was loaded under other rules is waiting here
if (PLAY && !DEV && mem.get("intro") !== "1" && !S.moves.length) showIntro();   // the first-run moment, once
if (PLAY) fetch(SW_URL).then(r => r.text()).then(s => { const m = /VERSION = "(v\d+)"/.exec(s); if (m) tx("mVer", m[1]) }).catch(() => {});   // a small version in the menu only
requestAnimationFrame(() => requestAnimationFrame(() => { try { performance.mark("fg-first-board") } catch (_) {} }));   // when the board first showed, for the numbers on LOU-316
resize(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { lastSize = ""; resize(); drawPile() });
if (reduce) draw(); else loop();
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register(SW_URL).catch(() => {}));
if (PLAY && !DEV_LOOK) settleLook(); else if (WANT === "3d") enter3d();   // ?look=3d (or the remembered look); the play page picks its own (below)
// for checking the page from a script
G.Flowgrow.onRunEnd = G.Flowgrow.onRunEnd || (() => {});   // onRunEnd(result): the seed, rules, moves and score of a run that has just ended. It does nothing yet (LOU-316)
Object.assign(G.Flowgrow, {run:() => S, runRecord, loadRun, page:() => PAGE, tap, undo, pick:doPick, lockMode:() => lockMode, lockTile, discard:() => $("discardBtn").click(), newRun, scr, options:() => opts, skin:() => skin, setSkin,
  show(h, r) { S.h = h; if (r) S.r = r; S.top = Math.max(0, ...Object.values(h)); sync() }, look3d:() => L3, look(p, z) { if (L3 && skin === "3d") return L3.look(p, z); const o = iso(...p); view.cx = o.x; view.cy = o.y; if (z) view.z = z; applyView() }});
})();
