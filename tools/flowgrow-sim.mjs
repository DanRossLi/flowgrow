#!/usr/bin/env node
// Flowgrow simulator (LOU-298). A developer tool: it is not part of the game and nothing here is loaded by a page.
//
// It plays Flowgrow with the game's own rules. flowgrow.config.js and flowgrow.js themselves are loaded here, with a
// stand-in for the page's window (the file stops after its rules when there is no page), so the simulator and the game
// can't drift apart. No build step and no packages: plain Node 18 or newer.
//
//   node tools/flowgrow-sim.mjs                      1,000 seeded runs with the config file's values
//   node tools/flowgrow-sim.mjs 500 riverShare=0.15  500 runs with one value changed (any config value, as key=value)
//   node tools/flowgrow-sim.mjs --test               the rule checks; exits with an error if one fails
//
// The simple player combines when it can, otherwise plants, and uses each river tile where it opens the most land.
// No run may crash or stall, and every run must rebuild exactly from its seed and moves.
import fs from "fs"; import path from "path"; import {fileURLToPath} from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------- the game's rules, loaded as they are
function load() { const window = {FLOWGROW_SIM:true};
  for (const f of ["flowgrow.config.js", "flowgrow.js"]) new Function("window", fs.readFileSync(path.join(ROOT, f), "utf8"))(window);
  return {R:window.Flowgrow.rules, base:window.FLOWGROW} }
const {R, base} = load();
const BASE = R.tidy(base).cfg;
// The rule checks are written for these values, the first build's, so tuning flowgrow.config.js never breaks them (the pilot pile, for one,
// changes the pile; bare ground takes any level, and the bare ground rule is checked on its own below). The report and the command line use the config file as it is.
const REF = (() => { const t = R.tidy({...base, map:["_____________", "_BB__________", "__B_______B__", "__________BB_", "______T______", "_____________", "___BB________", "_____________", "_____________"],
  stackSize:80, queueShown:3, pickFrom:1, riverShare:.1, opening:["habitat 1", "habitat 1", "river"], maxLevel:7, levelOdds:.5, scoreByLevel:[1, 3, 6, 10, 15, 21, 28], riverReach:[1, 2], riverMonotone:false, bareGroundMaxLevel:24, bareGroundMode:"refuse", prairieShare:0, marshShare:0, biomeMatch:true, marshNeedsRiver:false, prairieSpreads:false, treeShare:0, overgrow:true, upgradeLevel:0, riverMaxLevel:2, riverScore:"none",
  levelNames:["Sprouts", "Meadow", "Thicket", "Saplings", "Grove", "Forest", "Old forest"], lockEnabled:true, lockLevelCap:true, lockCopiesGo:"back", lockRivers:true, lockEvery:10, lockHold:1}, base);
  if (t.bad.length) throw new Error("bad reference config: " + t.bad); return t.cfg })();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- the simple player: one turn
// The tile a lock would bank the most copies from (the first one, on a tie).
function bestLock(S) { let best = null, n = -1;
  for (const k of [...Object.keys(S.h), ...Object.keys(S.r)]) { const p = R.unkey(k); if (!R.lockable(S, p)) continue; const c = R.copiesOf(S, p).copies.length; if (c > n) { n = c; best = p } }
  return best ? {p:best, n} : null }
function turn(S) { const c = S.cfg;
  if (c.lockEnabled) { const b = R.hasLock(S) ? bestLock(S) : null;
    if (!S.q.length) return b && b.n > 0 ? R.lock(S, b.p) : R.end(S);                            // the pile is empty: lock while that banks a copy
    if (b && b.n > 0 && c.lockEvery > 0 && S.toLock === c.lockEvery - 1) return R.lock(S, b.p) } // use each lock just before the next one arrives
  const opts = R.options(S, 0), t = S.q[0]; if (!opts.length) return R.discard(S, 0);
  let o = null;
  if (t.k === "h") o = opts.find(x => x.does === "combine") || opts[0];      // combine when it can, otherwise plant
  else { let best = -1; for (const x of opts) { const n = R.opens(S, 0, x) + (x.does === "widen" ? .5 : 0); if (n > best) { best = n; o = x } } } // a tie goes to widening, which uses no land
  return R.place(S, 0, o.p) }
// What the plant rules do to the tile in hand (LOU-301): how often a marsh tile has no tile next to the river free to plant on, and how often prairie plants beyond the river's reach.
// And (LOU-302) how often a tree in hand has no legal target at all (a tree never plants on bare ground, so it has only a habitat of its own level to grow over).
function watch(S) { const t = S.q[0]; if (t.k !== "h" || !t.b) return null;
  if (t.b === "t") return {b:"t", none:!R.options(S, 0).length, copy:!!t.c};
  const o = R.options(S, 0).filter(x => x.does === "plant");
  if (t.b === "m") { const c = S.cfg, via = c.marshNeedsRiver && c.upgradeLevel > 0 ? o.filter(x => !R.nbrs(c, x.p).some(q => R.key(q) in S.r)) : [];   // (LOU-304) the places that are legal only because of a reed bed: they touch no river tile
    return {b:"m", none:!o.length, via:new Set(via.map(x => R.key(x.p))), rescued:via.length > 0 && via.length === o.length} }
  const reach = R.reachOf(S); return {b:"p", beyond:new Set(o.filter(x => !reach.has(R.key(x.p))).map(x => R.key(x.p)))} }
function tally(m, pre, res) { if (pre.b === "t") { m.treeTurns++; if (pre.copy) m.treeCopyTurns++; if (pre.none) m.treeNoTarget++ }
  else if (pre.b === "m") { m.marshTurns++; if (pre.none) m.marshNoBank++; if (res.does === "plant") { m.marshPlanted++; if (pre.via.has(R.key(res.p))) m.reedPlanted++ } if (pre.rescued) m.reedRescued++ } else { m.prairieTurns++; m.spreadOffered += pre.beyond.size; if (res.does === "plant" && pre.beyond.has(R.key(res.p))) m.spreadPlanted++ } }
// One whole run. Returns the run, how many turns were tight, and what went wrong (if anything).
function play(cfg, seed) { const out = {S:null, tight:0, error:"", m:{marshTurns:0, marshNoBank:0, prairieTurns:0, spreadOffered:0, spreadPlanted:0, treeTurns:0, treeCopyTurns:0, treeNoTarget:0, marshPlanted:0, reedPlanted:0, reedRescued:0}};
  try { const S = out.S = R.fresh(cfg, seed), cap = 6000; let n = 0;
    while (!S.over) { if (++n > cap) { out.error = "stalled"; break } if (S.q.length && R.plantable(S).length <= 2) out.tight++; const pre = S.q.length ? watch(S) : null, res = turn(S); if (!res) { out.error = "a move was refused"; break } if (pre) tally(out.m, pre, res) }
    if (!out.error && !same(S, R.replay(cfg, seed, S.moves))) out.error = "did not rebuild from its seed and moves";
  } catch (e) { out.error = "crashed: " + (e && e.message || e) }
  return out }

// ---------- the report
const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1), pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const sum = a => a.reduce((x, y) => x + y, 0);
const f1 = v => v.toFixed(1), f2 = v => v.toFixed(2), share = (a, f) => Math.round(100 * a.filter(f).length / (a.length || 1)) + "%";
const copiesBy = (s, did) => s.log.filter(e => e.did === did && e.t && e.t.c).length;                   // copies placed by this kind of move
const copiesDown = s => s.log.filter(e => e.did === "plant" && e.t && e.t.c && e.l < e.t.l).length;     // copies planted as level 1 ("downgrade")
function report(cfg, runs) { const res = []; for (let seed = 1; seed <= runs; seed++) res.push(play(cfg, seed));
  const bad = res.filter(r => r.error), ok = res.filter(r => !r.error).map(r => ({...r, hab:Object.keys(r.S.h).length, riv:Object.keys(r.S.r).length, room:R.plantable(r.S).length}));
  const S = ok.map(r => r.S), sc = S.map(s => s.score), top = S.map(s => s.top), lv = [4, 5, 6, 7].filter(l => l <= cfg.maxLevel);
  console.log(`Flowgrow: ${runs} runs, ${cfg.stackSize} tiles each${cfg.lockEnabled ? `, locking on (${cfg.lockEvery ? `a lock every ${cfg.lockEvery} tiles placed, ${cfg.lockHold} held` : "locks free, used when the pile is empty"})` : ", locking off"}`);
  const bare = cfg.bareGroundMaxLevel < cfg.maxLevel;   // the bare ground rule is in force: say so, and say what happens to the copies (with it off the report is as it was)
  if (bare) console.log(`  bare ground          takes level ${cfg.bareGroundMaxLevel}${cfg.bareGroundMaxLevel > 1 ? " and below" : " only"}; above that: ${cfg.bareGroundMode === "refuse" ? "refused (combine or discard)" : "planted as level 1"}`);
  console.log(`  score                average ${Math.round(avg(sc))} · 10th percentile ${pct(sc, .1)} · 90th percentile ${pct(sc, .9)}`);
  console.log(`  top level            average ${f1(avg(top))}${lv.map(l => ` · level ${l}+ in ${share(top, t => t >= l)}`).join("")}`);
  const trees = cfg.treeShare > 0, overs = s => s.log.filter(e => e.did === "overgrow");   // trees (LOU-302) are dealt: the report says what they did (with treeShare 0 it is as it was)
  console.log(`  habitats on the map  ${f1(avg(ok.map(r => r.hab)))} (planted ${f1(avg(S.map(s => s.planted)))}, combined ${f1(avg(S.map(s => s.combined)))}${trees ? `, of them ${f1(avg(S.map(s => s.overgrown)))} overgrows` : ""})`);
  if (cfg.prairieShare + cfg.marshShare > 0 || trees) console.log(`  kinds on the map     ${f1(avg(S.map(s => Object.keys(s.h).filter(k => !s.hb[k]).length)))} green · ${f1(avg(S.map(s => Object.values(s.hb).filter(b => b === "p").length)))} prairie · ${f1(avg(S.map(s => Object.values(s.hb).filter(b => b === "m").length)))} marsh${trees ? ` · ${f1(avg(S.map(s => Object.values(s.hb).filter(b => b === "t").length)))} trees` : ""} habitats at the end`);
  console.log(`  river tiles          ${f1(avg(ok.map(r => r.riv)))} with the source (extended ${f1(avg(S.map(s => s.extended)))}, widened ${f1(avg(S.map(s => s.widened)))})`);
  if (cfg.riverMaxLevel > cfg.riverReach.length) console.log(`  river levels         the river rises to level ${f1(avg(ok.map(r => Math.max(...Object.values(r.S.r).map(v => v.l)))))} on average (${f1(avg(S.map(s => s.log.filter(e => e.did === "widen" && e.l > cfg.riverReach.length).length)))} level-ups past the widest)${cfg.riverScore === "none" ? "" : `, ${f1(avg(S.map(s => s.log.reduce((n, e) => n + (e.did === "widen" || e.did === "extend" ? e.pts : 0), 0))))} points from river moves`}`);
  console.log(`  discards             ${f2(avg(S.map(s => s.discarded)))} a run · at least one in ${share(S, s => s.discarded > 0)} of runs`);
  console.log(`  tight turns          ${f1(avg(ok.map(r => r.tight)))} a run with 2 or fewer plantable tiles · ${f1(avg(ok.map(r => r.room)))} plantable tiles left at the end`);
  if (cfg.marshNeedsRiver || cfg.prairieSpreads) { const M = ok.map(r => r.m), land = cfg.map.join("").split("_").length - 1, empty = ok.map(r => land - r.hab - (r.riv - 1));   // the plant rules of LOU-301 are on: say what they do
    console.log(`  marsh                ${f1(avg(M.map(m => m.marshTurns)))} marsh tiles in hand a run · nothing to plant it on in ${f1(100 * sum(M.map(m => m.marshNoBank)) / Math.max(1, sum(M.map(m => m.marshTurns))))}% of those turns · ${f2(avg(S.map(s => s.log.filter(e => e.did === "discard" && e.t && e.t.b === "m").length)))} marsh tiles discarded a run`);
    console.log(`  prairie spread       ${f1(avg(M.map(m => m.prairieTurns)))} prairie tiles in hand a run · planted beyond the river's reach ${f2(avg(M.map(m => m.spreadPlanted)))} times a run · ${f1(sum(M.map(m => m.spreadOffered)) / Math.max(1, sum(M.map(m => m.prairieTurns))))} extra tiles offered per prairie tile in hand`);
    console.log(`  island               ${f1(avg(empty))} of ${land} land cells empty at the end (${f1(avg(ok.map(r => r.room)))} of them within the river's reach)`) }
  if (trees) { const M = ok.map(r => r.m), O = S.map(overs), kind = b => f2(avg(O.map(l => l.filter(e => e.from === b).length)));   // what trees did (LOU-302): how often one had no legal target, and what the overgrows took
    console.log(`  trees                ${f1(avg(M.map(m => m.treeTurns)))} tree tiles in hand a run (${f1(avg(M.map(m => m.treeCopyTurns)))} of them copies) · no legal target in ${f1(100 * sum(M.map(m => m.treeNoTarget)) / Math.max(1, sum(M.map(m => m.treeTurns))))}% of those turns · ${f2(avg(S.map(s => s.log.filter(e => e.did === "discard" && e.t && e.t.b === "t").length)))} tree tiles discarded a run`);
    console.log(`  overgrow             ${f2(avg(O.map(l => l.length)))} a run: ${kind("")} on green · ${kind("p")} on prairie · ${kind("m")} on marsh · ${f1(avg(O.map(l => l.reduce((n, e) => n + e.pts, 0))))} points from overgrows · ${f2(avg(S.map(s => s.combined - s.overgrown)))} plain combines a run`) }
  if (cfg.upgradeLevel > 0 && cfg.marshShare > 0) { const M = ok.map(r => r.m), up = cfg.upgradeLevel, reach = s => s.log.filter(e => e.t && e.t.b === "m" && ((e.did === "combine" && e.l === up) || (e.did === "plant" && e.l >= up))).length;   // upgrades (LOU-304): how often a marsh tile reaches the upgrade level, and how often the reed bed is used
    console.log(`  reed beds            ${f2(avg(S.map(reach)))} marsh tiles reach level ${up} a run (in ${share(S, s => reach(s) > 0)} of runs) · ${f1(avg(S.map(s => Object.keys(s.h).filter(k => s.hb[k] === "m" && s.h[k] >= up).length)))} reed beds on the map at the end · ${f1(avg(M.map(m => m.marshPlanted)))} marsh planted a run, ${f2(avg(M.map(m => m.reedPlanted)))} of them only because of a reed bed (${f2(avg(M.map(m => m.reedRescued)))} marsh tiles a run had no other place to plant)`) }
  if (cfg.lockEnabled) {
    console.log(`  moves                ${f1(avg(S.map(s => s.moves.length)))} a run`);
    console.log(`  locks                ${f1(avg(S.map(s => s.lockUsed)))} used · ${f1(avg(S.map(s => s.lockLost)))} lost · ${f1(avg(S.map(s => Object.keys(s.lk).length)))} tiles locked at the end`);
    console.log(`  copies               ${f1(avg(S.map(s => s.copyBanked)))} banked · ${f1(avg(S.map(s => s.copyPlaced)))} placed · ${f2(avg(S.map(s => s.copyDiscarded)))} discarded · ${f1(avg(S.map(s => s.copyPoints)))} points from copies`);
    if (bare) console.log(`  copies placed        ${f1(avg(S.map(s => copiesBy(s, "plant"))))} planted on bare ground${cfg.bareGroundMode === "downgrade" ? ` (${f1(avg(S.map(copiesDown)))} of them as level 1)` : ""} · ${f1(avg(S.map(s => copiesBy(s, "combine"))))} combined${trees ? ` · ${f1(avg(S.map(s => copiesBy(s, "overgrow"))))} overgrown` : ""} · ${f1(avg(S.map(s => copiesBy(s, "extend") + copiesBy(s, "widen"))))} river tiles · ${f2(avg(S.map(s => s.copyDiscarded)))} discarded`) }
  if (bad.length) { console.log(`  ${bad.length} of ${runs} runs went wrong:`); for (const r of bad.slice(0, 10)) console.log(`    seed ${r.S ? r.S.seed : "?"}: ${r.error}`); process.exitCode = 1 }
  else console.log("  no run crashed or stalled, and every run rebuilt exactly from its seed and moves") }

// ---------- the rule checks: small set-ups with a fixed pile (the config's opening list), checked one fact at a time
function checks() { let n = 0; const fails = [];
  const ok = (what, cond) => { n++; if (!cond) fails.push(what) };
  const cfgWith = o => { const t = R.tidy({...REF, ...o}, REF); if (t.bad.length) throw new Error("bad test config: " + t.bad); return t.cfg };
  const run = (opening, o = {}) => R.fresh(cfgWith({opening, ...o}), 7);
  const at = (S, p) => S.h[R.key(p)], riv = (S, p) => S.r[R.key(p)], does = (S, p, i = 0) => (R.options(S, i).find(o => o.p + "" === p + "") || {}).does;
  const SRC = [6, 4], E = [7, 4], W = [5, 4], FAR = [9, 4];

  { const t = R.tidy(base); ok("the config file passes its own checks", t.bad.length === 0 && same(t.cfg.map, base.map)) }
  { const S = R.fresh(REF, 1); ok("a run starts with the source as a level 1 river tile", riv(S, SRC) && riv(S, SRC).l === 1 && Object.keys(S.r).length === 1);
    ok("the first three tiles are habitat 1, habitat 1, river", same(S.q.slice(0, 3), [{k:"h", l:1}, {k:"h", l:1}, {k:"r", l:1}]));
    ok("the pile shows the tile in hand and the next 3, with 80 tiles left", S.q.length === 4 && S.dealt === 4 && R.left(S) === 80);
    ok("at the start the 6 tiles round the source can be planted", R.plantable(S).length === 6 && R.plantable(S).every(k => R.hexDist(R.unkey(k), SRC) === 1)) }
  { const S = run(["habitat 1", "habitat 1", "habitat 2", "habitat 1"]);
    ok("land 2 tiles from a level 1 river tile is too far", R.place(S, 0, [8, 4]) === null && R.why(S, 0, [8, 4]) === "Too far from the river.");
    const a = R.place(S, 0, E); ok("planting a level 1 tile scores 1", a && a.does === "plant" && a.pts === 1 && S.score === 1 && at(S, E) === 1 && S.planted === 1 && S.top === 1);
    const b = R.place(S, 0, E); ok("a level 1 tile on a level 1 habitat makes level 2 and scores 3", b && b.does === "combine" && b.pts === 3 && at(S, E) === 2 && S.score === 4 && S.combined === 1 && Object.keys(S.h).length === 1);
    const c = R.place(S, 0, E); ok("a level 2 tile on a level 2 habitat makes level 3 and scores 6", c && c.pts === 6 && at(S, E) === 3 && S.score === 10 && S.top === 3);
    ok("a different level is never allowed", R.place(S, 0, E) === null && R.why(S, 0, E) === "That's level 3. Only a level 3 tile can go on it." && at(S, E) === 3 && S.score === 10) }
  { const S = run(["habitat 3"]); const a = R.place(S, 0, E); ok("a level 3 tile planted on empty land scores 6", a && a.does === "plant" && a.pts === 6 && S.score === 6 && S.top === 3) }
  { const S = run(["habitat 7", "habitat 7"]); R.place(S, 0, E);
    ok("a level 7 habitat can't be combined", R.place(S, 0, E) === null && R.why(S, 0, E) === "Old forest is the top level." && does(S, W) === "plant") }
  { const S = run(["river", "river", "river", "river", "habitat 1"]);
    ok("a river tile can't go on land that doesn't touch the river", R.place(S, 0, FAR) === null && R.why(S, 0, FAR) === "A river tile has to touch the river.");
    const a = R.place(S, 0, E); ok("a river tile extends the river onto empty land that touches it, for no points", a && a.does === "extend" && a.pts === 0 && S.score === 0 && riv(S, E).l === 1 && S.extended === 1);
    ok("a level 1 river tile reaches 1 tile out", R.plantable(S).length === 8 && a.greened.length === 3 && !R.plantable(S).includes("9,4"));
    ok("a new river tile joins the river's end", riv(S, E).from === "6,4");
    const b = R.place(S, 0, SRC); ok("a river tile on a level 1 river tile widens it to level 2", b && b.does === "widen" && riv(S, SRC).l === 2 && S.widened === 1 && S.score === 0);
    ok("a level 2 river tile reaches 2 tiles out", R.reachOf(S).has("4,4") && R.reachOf(S).has("6,2") && !R.reachOf(S).has("3,4") && b.greened.length > 0);
    ok("level 2 is the widest", R.place(S, 0, SRC) === null && R.why(S, 0, SRC) === "The river is at its widest here.");
    const c = R.place(S, 0, W); ok("the river can branch", c && c.does === "extend" && riv(S, W).from === "6,4" && Object.keys(S.r).length === 3);
    R.place(S, 0, [8, 4]); ok("a tile further along joins the newest end it touches", riv(S, [8, 4]).from === "7,4");
    ok("a habitat can't go on the river", R.place(S, 0, E) === null && R.why(S, 0, E) === "That's the river. Plant beside it.") }
  { const S = run(["habitat 1", "river"]); R.place(S, 0, E);
    ok("a river tile can't go on a habitat", R.place(S, 0, E) === null && R.why(S, 0, E) === "A river tile needs empty land.") }
  { const S = run(["river", "habitat 1", "river"], {map:["_____", "_TB__", "_____"]}); R.place(S, 0, [1, 1]);
    ok("mountains don't block reach", R.plantable(S).includes("3,1"));
    ok("nothing goes on a mountain", R.place(S, 0, [2, 1]) === null && R.why(S, 0, [2, 1]) === "Nothing grows on a mountain." && R.why(S, 1, [2, 1]) === "The river can't cross a mountain.") }
  { const S = run(["habitat 1", "habitat 1", "habitat 1"], {stackSize:3, queueShown:1}); const d = R.discard(S, 0);
    ok("a discard scores nothing and still uses up the tile", d && S.discarded === 1 && S.score === 0 && S.used === 1 && R.left(S) === 2);
    R.place(S, 0, E); ok("the run isn't over while a tile is left", !S.over && R.left(S) === 1);
    R.place(S, 0, E); ok("the run ends when the last tile is used", S.over && R.left(S) === 0 && R.options(S, 0).length === 0 && R.discard(S, 0) === null && R.place(S, 0, W) === null) }
  { const S = run([], {stackSize:0}); let riv2 = 0, N = 30000; for (let i = 0; i < N; i++) if (R.roll(S).k === "r") riv2++;
    ok("one dealt tile in ten is a river tile", Math.abs(riv2 / N - .1) < .008);
    let all1 = true; for (let i = 0; i < 300; i++) { const t = R.roll(S); if (t.k === "h" && t.l !== 1) all1 = false } ok("with no habitat on the map every habitat dealt is level 1", all1);
    S.top = 3; const c = [0, 0, 0, 0]; for (let i = 0; i < N; i++) { const t = R.roll(S); if (t.k === "h") c[t.l]++ } const h = c[1] + c[2] + c[3];
    ok("levels 1, 2 and 3 are dealt 4 : 2 : 1 when 3 is the top level on the map", c[0] === 0 && Math.abs(c[1] / h - 4 / 7) < .012 && Math.abs(c[2] / h - 2 / 7) < .012 && Math.abs(c[3] / h - 1 / 7) < .012);
    S.top = 9; let over = false; for (let i = 0; i < 3000; i++) if (R.roll(S).l > 7) over = true; ok("no tile is dealt above the top level", !over) }
  { const NOLOCK = cfgWith({lockEnabled:false}), a = play(NOLOCK, 42), b = play(NOLOCK, 42), c = play(NOLOCK, 43), REF = NOLOCK;
    ok("the same seed and the same moves give the same run", !a.error && same(a.S, b.S));
    ok("another seed gives another pile", !same(a.S.log.map(e => e.t), c.S.log.map(e => e.t)));
    ok("a whole run uses every tile and its score is the sum of its moves", a.S.over && a.S.used === 80 && a.S.moves.length === 80 && a.S.log.reduce((s, e) => s + e.pts, 0) === a.S.score && a.S.planted + a.S.combined + a.S.extended + a.S.widened + a.S.discarded === 80);
    const part = R.replay(REF, 42, a.S.moves.slice(0, 30)), back = R.replay(REF, 42, a.S.moves.slice(0, 29)), again = R.replay(REF, 42, a.S.moves.slice(0, 29)); R.place(again, a.S.moves[29].i, [a.S.moves[29].x ?? 0, a.S.moves[29].y ?? 0]) || R.discard(again, 0);
    ok("undo steps back one move and never re-rolls a tile", same(back.q.slice(0, 3), R.replay(REF, 42, a.S.moves.slice(0, 29)).q.slice(0, 3)) && same(part, again));
    ok("the run log has one line per move", a.S.log.length === 80 && R.logText(a.S).split("\n").length === 82 && a.S.log.every((e, i) => e.n === i + 1)) }
  { ok("levels 1 to 7 score 1, 3, 6, 10, 15, 21, 28", same([1, 2, 3, 4, 5, 6, 7].map(l => R.scoreOf(REF, l)), [1, 3, 6, 10, 15, 21, 28]));
    ok("past level 7 the score carries on the pattern", R.scoreOf(REF, 8) === 36 && R.scoreOf(REF, 9) === 45) }
  { const t = R.tidy({...REF, map:["___", "_X_", "___"], stackSize:"12", riverShare:5, opening:"habitat 2, river, habitat 1", levelNames:""}, REF);
    ok("a bad map or a bad number is refused and the old value stands", same(t.bad, ["map", "riverShare", "levelNames"]) && same(t.cfg.map, REF.map) && t.cfg.riverShare === .1 && t.cfg.stackSize === 12 && same(t.cfg.opening, ["habitat 2", "river", "habitat 1"]));
    ok("a map needs exactly one source", R.mapOf(["___", "___", "___"]) === undefined && R.mapOf(["T__", "__T", "___"]) === undefined && !!R.mapOf("_T_ ___ _B_")) }
  { const S = run(["habitat 1", "habitat 2", "habitat 1"], {pickFrom:3}); const a = R.place(S, 1, E);
    ok("with pick from 3, the second tile can be taken instead", a && at(S, E) === 2 && same(S.q[0], {k:"h", l:1}) && same(R.replay(S.cfg, 7, S.moves), S)) }
  { const S = run(["river 2", "river 2"]); const a = R.place(S, 0, E);
    ok("a level 2 river tile extends at level 2, reaches 2 tiles out and can't widen", a && a.does === "extend" && riv(S, E).l === 2 && R.reachOf(S).has("9,4") && does(S, SRC) === undefined && does(S, E) === undefined) }

  // ----- locking (LOU-299). A set-up puts habitats and river tiles straight on the island and gives the player one lock.
  const setup = (h, r = {}, o = {}) => { const S = R.fresh(cfgWith({opening:[], ...o}), 7); for (const k in h) S.h[k] = h[k]; for (const k in r) S.r[k] = {l:r[k], from:null, n:S.rn++};
    S.top = Math.max(0, ...Object.values(S.h)); S.locks = 1; return S };
  const C = [8, 6], N = ["9,6", "8,5", "7,5", "7,6", "7,7", "8,7"];   // a tile with six land neighbours, and those neighbours
  const got = (S, p = C) => R.copiesOf(S, p).copies.map(t => (t.k === "r" ? "r" : "") + t.l).join(" ");
  { const S = setup({"8,6":5, [N[0]]:5, [N[1]]:3, [N[2]]:5, [N[3]]:1, [N[4]]:5, [N[5]]:2});
    ok("lock: a level 5 habitat beside habitats 1, 2, 3, 5, 5, 5 copies 1, 2, 3, 5, 5, 5", got(S) === "1 2 3 5 5 5") }
  { const S = setup({"8,6":2, [N[0]]:5, [N[1]]:5, [N[2]]:5, [N[3]]:5, [N[4]]:5, [N[5]]:5});
    ok("lock: a level 2 habitat beside six level 5 habitats copies nothing", got(S) === "" && R.copiesOf(S, C).high.length === 6) }
  { const S = setup({"8,6":3, [N[0]]:4, [N[1]]:2, [N[2]]:3});
    ok("lock: a level 3 habitat beside habitats 2, 3, 4 copies 2 and 3", got(S) === "2 3" && same(R.copiesOf(S, C).high, [N[0]])) }
  { const S = setup({"8,6":3}, {[N[0]]:2});
    ok("lock: a level 3 habitat beside a level 2 river tile gets one level 2 river copy", got(S) === "r2") }
  { const S = setup({"8,6":1}, {[N[0]]:2});
    ok("lock: a level 1 habitat beside a level 2 river tile gets no copy", got(S) === "") }
  { const S = setup({[N[0]]:1, [N[1]]:4}, {"8,6":1});
    ok("lock: a level 1 river tile beside a level 1 and a level 4 habitat gets one level 1 habitat copy", got(S) === "1" && R.lockable(S, C)) }
  { const S = setup({"5,6":3, "6,6":1}); S.lk["6,6"] = 1;   // 4,6 is a mountain and the other neighbours are empty land
    ok("lock: a locked neighbour, a mountain and empty land give no copy", got(S, [5, 6]) === "" && R.codeAt(S.cfg, [4, 6]) === "B") }
  { const S = setup({"8,6":3, [N[0]]:1, [N[1]]:2}, {[N[2]]:1}), q0 = JSON.stringify(S.q), sc = S.score; const a = R.lock(S, C);
    ok("lock: copies are exact, river tiles first, then habitats from the lowest level", a && same(a.copies, [{k:"r", l:1, c:1}, {k:"h", l:1, c:1}, {k:"h", l:2, c:1}]) && same(S.bank, a.copies));
    ok("lock: it doesn't use the tile in hand, scores nothing, and the originals stay", JSON.stringify(S.q) === q0 && S.score === sc && S.h[N[0]] === 1 && S.h[N[1]] === 2 && S.locks === 0 && S.lockUsed === 1 && S.copyBanked === 3);
    ok("lock: tiles left counts the banked copies", R.left(S) === 83);
    ok("lock: a locked tile can't be locked again, and with no lock held nothing can be locked", R.lock(S, C) === null && !R.lockable(S, [9, 6]));
    S.locks = 1; ok("lock: a locked tile is not copied when a neighbour is locked", got(S, [9, 6]) === "" && got(S, [8, 5]) === "r1 1" && !R.copiesOf(S, [8, 5]).from.includes("8,6")) }
  { const S = run(["habitat 1", "habitat 1", "river", "river", "habitat 1"]); R.place(S, 0, E); S.locks = 2; R.lock(S, E);
    ok("lock: a locked habitat can't be combined onto", R.place(S, 0, E) === null && R.why(S, 0, E) === "That tile is locked." && does(S, E) === undefined);
    R.place(S, 0, W); R.lock(S, SRC);
    ok("lock: a locked river tile can't be widened", R.place(S, 0, SRC) === null && R.why(S, 0, SRC) === "That tile is locked.");
    ok("lock: a locked river tile still reaches land and the river can still be extended from it", R.plantable(S).length > 0 && does(S, [6, 3]) === "extend" && R.place(S, 0, [6, 3]) !== null && S.r["6,3"].from === "6,4") }
  { const S = run(["habitat 1", "habitat 2", "habitat 1", "habitat 1"], {stackSize:4, queueShown:1}); R.place(S, 0, E); S.locks = 1; R.lock(S, SRC);
    ok("lock: copies wait at the back of the pile, behind every tile still to be dealt", same(S.bank, [{k:"h", l:1, c:1}]) && S.q.every(t => !t.c) && R.left(S) === 4);
    R.place(S, 0, W); R.place(S, 0, E); R.place(S, 0, [6, 3]);
    ok("lock: a copy arrives once the dealt tiles are used up", !S.over && S.q.length === 1 && S.q[0].c === 1 && S.bank.length === 0 && R.left(S) === 1);
    const a = R.place(S, 0, [6, 5]); ok("lock: a copy plays and scores like a dealt tile", a && a.does === "plant" && a.pts === 1 && S.copyPlaced === 1 && S.copyPoints === 1 && S.over) }
  { const S = R.fresh(cfgWith({opening:[], riverShare:0, stackSize:40}), 3); let n = 0; const tick = () => { const o = R.options(S, 0); return o.length ? R.place(S, 0, o[0].p) : R.discard(S, 0) };
    for (let i = 0; i < 9; i++) tick(); ok("lock: no lock before 10 tiles are placed", S.locks === 0 && S.toLock === 9 - S.discarded);
    R.discard(S, 0); ok("lock: a discard doesn't count toward a lock", S.locks === 0);
    while (S.toLock !== 0 || S.locks === 0) tick(); ok("lock: one lock is earned for every 10 tiles placed", S.locks === 1 && S.planted + S.combined === 10);
    while (S.planted + S.combined < 20) tick(); ok("lock: only one can be held, and one earned while holding it is lost", S.locks === 1 && S.lockLost === 1);
    const moves = S.moves.length; R.lock(S, R.unkey(Object.keys(S.h)[0])); const back = R.replay(S.cfg, 3, S.moves.slice(0, -1));
    ok("lock: undo steps back over a lock, and a reload brings the locked tiles and banked copies back", S.moves.length === moves + 1 && S.moves[moves].a === "l" && back.locks === 1 && Object.keys(back.lk).length === 0 && back.bank.length === 0 && same(R.replay(S.cfg, 3, S.moves), S)) }
  { const S = run(["habitat 1", "habitat 1"], {stackSize:2, queueShown:1}); R.place(S, 0, E); S.locks = 1; R.place(S, 0, W);
    ok("lock: with the pile empty the run goes on while a lock would bank a copy", !S.over && S.q.length === 0 && R.lockWouldCopy(S) && R.options(S, 0).length === 0);
    const T = R.replay(S.cfg, 7, []); R.place(T, 0, E); T.locks = 1; R.place(T, 0, W); ok("lock: End run ends it by hand", R.end(T) && T.over && R.end(T) === null);
    R.lock(S, SRC); ok("lock: locking then brings the copies in", !S.over && S.q.length === 2 && S.q[0].c === 1);
    R.place(S, 0, E); R.place(S, 0, W); ok("lock: the run ends when the pile is empty and no lock is held", S.over && S.h["7,4"] === 2 && S.h["5,4"] === 2) }
  { const S = run(["habitat 1"], {stackSize:1, queueShown:0}); R.place(S, 0, E); ok("lock: with no lock held the run ends when the pile is empty", S.over && R.end(S) === null) }
  { const A = setup({"8,6":1, [N[0]]:4}, {[N[1]]:2}, {lockLevelCap:false}); ok("lock: with the level cap off, every unlocked neighbour is copied", got(A) === "r2 4");
    const B2 = setup({"8,6":3}, {[N[0]]:1}, {lockRivers:false}); ok("lock: with river locking off, river tiles are neither locked nor copied", got(B2) === "" && !R.lockable(B2, R.unkey(N[0])) && R.lockable(B2, C));
    const F = setup({"8,6":3, [N[0]]:2}, {}, {lockCopiesGo:"front"}), hand = JSON.stringify(F.q[0]); R.lock(F, C); ok("lock: with copies to the front, they are the next tiles", JSON.stringify(F.q[0]) === hand && same(F.q[1], {k:"h", l:2, c:1}) && F.bank.length === 0);
    const Z = setup({"8,6":3, [N[0]]:2}, {}, {lockEvery:0}); Z.locks = 0; ok("lock: with lockEvery 0, locks are free and unlimited", R.lockable(Z, C) && R.lock(Z, C) && R.lockable(Z, R.unkey(N[0])) && Z.locks === 0);
    const O = setup({"8,6":3, [N[0]]:2}, {}, {lockEnabled:false}); ok("lock: with locking off, nothing can be locked", !R.lockable(O, C) && R.lock(O, C) === null) }

  { const a = play(REF, 42), S = a.S;
    ok("lock: a whole run with locking ends, and its score is the sum of its moves", !a.error && S.over && S.lockUsed > 0 && S.log.reduce((s, e) => s + e.pts, 0) === S.score && S.planted + S.combined + S.extended + S.widened + S.discarded === S.used && S.used === 80 + S.copyPlaced + S.copyDiscarded);
    ok("lock: the run log has a line for every move, and marks locks and copies", R.logText(S).split("\n").length === S.moves.length + 2 && /\. Locked .* banked /.test(R.logText(S)) && /, copy · /.test(R.logText(S)) && /, dealt · /.test(R.logText(S))) }

  // ----- the pilot pile (Dan, Nov 20: "make starting tiles only level 1 and have 10 tiles only, which makes the loop the challenge")
  { const S = R.fresh(cfgWith({levelOdds:0, stackSize:0, opening:[], riverShare:0}), 11); S.top = 7; let all1 = true; for (let i = 0; i < 4000; i++) { const t = R.roll(S); if (t.k !== "h" || t.l !== 1) all1 = false }
    ok("level odds 0: every dealt habitat is level 1, even with a level 7 on the map", all1) }
  { const a = play(cfgWith({levelOdds:0, stackSize:10}), 5), S = a.S, dealt = S.log.filter(e => e.t && !e.t.c && e.did !== "lock" && e.did !== "end");
    ok("a pile of 10 with level odds 0: all 10 dealt tiles are level 1, so anything higher in the run came from combining or a lock copy",
      !a.error && S.over && S.dealt === 10 && dealt.length === 10 && dealt.every(e => e.t.l === 1) && S.used === 10 + S.copyPlaced + S.copyDiscarded) }
  { const S = run(["habitat 1", "habitat 1", "habitat 1", "habitat 1"], {levelOdds:0, stackSize:4, queueShown:0}); R.place(S, 0, E); R.place(S, 0, E);
    ok("with only level 1 dealt, the pile takes a habitat to level 2 and no further: no tile in hand fits a level 2 habitat", at(S, E) === 2 && R.options(S, 0).length > 0 && R.options(S, 0).every(o => o.does === "plant" && o.p + "" !== E + "")) }
  ok("the config file asks for the pilot pile, grown to 20 tiles (Dan, Nov 20: expand starting tiles to 20), with level odds 0", BASE.stackSize === 20 && BASE.levelOdds === 0);
  // ----- no lock limit (Dan, Nov 20: "there is no lock limit, a user can lock as many times as they want")
  ok("the config file has no lock limit: lockEvery 0, so a lock is always at hand", BASE.lockEnabled === true && BASE.lockEvery === 0);
  { const k = R.rulesKey(REF); ok("a ruleset's key changes with any rule, and not with names or zoom",
      /^[0-9a-z]{1,7}$/.test(k) && R.rulesKey(cfgWith({})) === k && R.rulesKey(cfgWith({lockEvery:0})) !== k && R.rulesKey(cfgWith({stackSize:10})) !== k && R.rulesKey(cfgWith({levelOdds:0})) !== k && R.rulesKey(cfgWith({tilesAcross:7, levelNames:["A"]})) === k) }

  // ----- rivers rise downstream (Dan, Nov 20: "all river tiles must be equal or greater than the river tile behind it")
  { const S = run(["river", "river", "river", "river", "river"], {riverMonotone:true}); R.place(S, 0, E); R.place(S, 0, E);          // E joins the source, then is widened (nothing joins it)
    ok("rivers rise downstream: after a level 2 river tile only a level 2 tile can follow, a level 1 tile can't",
      riv(S, E).l === 2 && does(S, [8, 4]) === undefined && R.place(S, 0, [8, 4]) === null && R.why(S, 0, [8, 4]) === "A river tile can't be lower than the one it flows from (level 2).") }
  { const S = run(["river", "river", "river", "river"], {riverMonotone:true}); R.place(S, 0, E);
    ok("a river tile can't be widened while a tile after it is lower: widen downstream first", does(S, SRC) === undefined && does(S, E) === "widen" && R.place(S, 0, SRC) === null && R.why(S, 0, SRC) === "The river after this tile is lower. Widen downstream first.");
    R.place(S, 0, E); ok("once the tile after it is level 2, the source can be widened too", riv(S, E).l === 2 && does(S, SRC) === "widen" && !!R.place(S, 0, SRC) && riv(S, SRC).l === 2) }
  { const S = run(["river", "river", "river 2", "river"], {riverMonotone:true}); R.place(S, 0, E); R.place(S, 0, E);
    ok("equal is allowed: a level 2 river tile can follow a level 2 one", does(S, [8, 4]) === "extend" && !!R.place(S, 0, [8, 4]) && riv(S, [8, 4]).l === 2 && riv(S, [8, 4]).from === "7,4") }
  { const S = run(["river", "river", "river", "river"], {riverMonotone:true}); R.place(S, 0, E); R.place(S, 0, E);
    ok("branches are each checked against the tile they join: a level 1 branch off the level 1 source is fine while the other branch is level 2", riv(S, E).l === 2 && does(S, W) === "extend" && !!R.place(S, 0, W) && riv(S, W).from === "6,4" && riv(S, W).l === 1) }
  { const S = run(["river", "river", "river"], {riverMonotone:true}); R.place(S, 0, SRC);
    ok("widening the source first leaves a later level 1 river tile with no move at all: a river is widened from its end", riv(S, SRC).l === 2 && R.options(S, 0).length === 0) }
  { const cfg = cfgWith({riverMonotone:true}), S = R.fresh(cfg, 5); let z = 12345, guard = 0; const rn = () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    while (!S.over && guard++ < 400) { if (!S.q.length) { R.end(S); break } const o = R.options(S, 0); if (!o.length) { R.discard(S, 0); continue } R.place(S, 0, o[Math.floor(rn() * o.length)].p) }
    let low = 0; for (const k in S.r) { const f = S.r[k].from; if (f != null && S.r[k].l < S.r[f].l) low++ }
    ok("a whole run of random legal moves with rivers rising downstream: no river tile is lower than the one it joins, and it replays from its seed", S.over && low === 0 && Object.keys(S.r).length > 3 && same(S, R.replay(cfg, 5, S.moves))) }
  ok("the config file has the river rule on", BASE.riverMonotone === true && R.rulesKey(cfgWith({riverMonotone:true})) !== R.rulesKey(REF));

  // ----- the top level is 15 (Dan, Nov 20: "uncap the tiles max to 15")
  ok("the config file's top level is 15, and levels 1 to 15 score 1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78, 91, 105, 120", BASE.maxLevel === 15 && same([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(l => R.scoreOf(BASE, l)), [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78, 91, 105, 120]));
  { const S = run(["habitat 14", "habitat 14", "habitat 15"], {maxLevel:15}); R.place(S, 0, E); const b = R.place(S, 0, E);
    ok("with the top level at 15, a level 14 tile on a level 14 habitat makes level 15 and scores 120, and level 15 can't be combined onto",
      b && b.does === "combine" && b.pts === 120 && at(S, E) === 15 && R.options(S, 0).length > 0 && R.options(S, 0).every(o => o.p + "" !== E + "") && R.why(S, 0, E) === "Level 15 is the top level.") }
  ok("a level past the names is just called Level N, with no repeat in its text; named levels keep their names", R.levelName(REF, 9) === "Level 9" && R.tileText(REF, {k:"h", l:9}) === "Level 9" && R.levelName(REF, 7) === "Old forest" && R.tileText(REF, {k:"h", l:3}) === "Thicket (level 3)");
  ok("the top level can be set up to 24 and not past it", R.tidy({...REF, maxLevel:15}, REF).bad.length === 0 && R.tidy({...REF, maxLevel:24}, REF).bad.length === 0 && R.tidy({...REF, maxLevel:25}, REF).bad.includes("maxLevel"));

  // ----- bare ground takes level 1 only (LOU-300; Dan, Nov 20: "get rid of lock capping. and yes let's implement level 1 only on bare ground").
  // bareGroundMode "refuse": a habitat above bareGroundMaxLevel can't be planted on empty land, it can only combine or be discarded. "downgrade": it plants
  // as a level 1 habitat and scores 1. REF lets any level plant (bareGroundMaxLevel 24), so every check above is about the first build's rule.
  const RF = {bareGroundMaxLevel:1, bareGroundMode:"refuse"}, DG = {bareGroundMaxLevel:1, bareGroundMode:"downgrade"}, NO = "Only level 1 can be planted on bare ground. Combine it or discard it.";
  { const S = run(["habitat 2", "habitat 3", "habitat 1"], RF);
    ok("refuse: a level 2 tile can't be planted on bare ground: no plant is offered, nothing is placed, and the toast says what to do",
      does(S, E) === undefined && R.place(S, 0, E) === null && R.options(S, 0).length === 0 && R.why(S, 0, E) === NO && R.why(S, 0, FAR) === NO && R.why(S, 0, SRC) === NO && S.planted === 0 && Object.keys(S.h).length === 0);
    R.discard(S, 0); ok("refuse: a level 3 tile can't be planted either", does(S, E) === undefined && R.place(S, 0, E) === null && R.options(S, 0).length === 0 && R.why(S, 0, E) === NO);
    R.discard(S, 0); const a = R.place(S, 0, E);
    ok("refuse: a level 1 tile is planted on bare ground as before, for 1 point", a && a.does === "plant" && a.l === 1 && a.pts === 1 && at(S, E) === 1 && S.score === 1 && S.planted === 1 && S.discarded === 2) }
  { const S = run(["habitat 2"], RF); S.h["7,4"] = 2; S.h["5,4"] = 3; S.top = 3;
    ok("refuse: level 2 on level 2 combines, level 2 on level 3 doesn't, and the combine is the only move",
      does(S, E) === "combine" && does(S, W) === undefined && R.place(S, 0, W) === null && R.why(S, 0, W) === "That's level 3. Only a level 3 tile can go on it." && R.options(S, 0).length === 1);
    const b = R.place(S, 0, E); ok("refuse: the combine is unchanged, level 3 for 6 points", b && b.does === "combine" && b.l === 3 && b.pts === 6 && at(S, E) === 3 && S.score === 6 && S.combined === 1) }
  { const S = run(["river 2", "habitat 1"], RF), a = R.place(S, 0, E);
    ok("refuse: a level 2 river tile is unaffected, it extends the river at level 2 and reaches 2 tiles out", a && a.does === "extend" && a.l === 2 && riv(S, E).l === 2 && R.reachOf(S).has("9,4")) }
  { const S = setup({"8,6":2, "9,6":3, "7,6":3}, {}, {...RF, lockEvery:0, stackSize:1, queueShown:0}); R.discard(S, 0);   // the one dealt tile is gone: the pile is empty
    ok("refuse: with the pile empty the run goes on while a lock would bank a copy", !S.over && S.q.length === 0 && R.lockWouldCopy(S));
    R.lock(S, [9, 6]); R.lock(S, [7, 6]);                                           // each level 3 habitat copies the level 2 habitat between them
    ok("refuse: two locks bank two level 2 copies of the one level 2 habitat", S.q.length === 1 && S.q[0].c === 1 && S.q[0].l === 2 && S.bank.length === 1 && S.copyBanked === 2);
    const first = R.place(S, 0, [8, 6]);
    ok("refuse: the first copy combines onto it (level 3, 6 points), and the second has nowhere to go: not on bare ground, and no level 2 habitat is left",
      first && first.does === "combine" && at(S, [8, 6]) === 3 && S.score === 6 && S.q.length === 1 && S.q[0].l === 2 && R.options(S, 0).length === 0);
    R.discard(S, 0); ok("refuse: a copy that can't be placed is discarded, and the run still ends", S.over && S.copyDiscarded === 1 && S.copyPlaced === 1 && S.score === 6 && R.discard(S, 0) === null) }
  { const S = run(["habitat 2", "habitat 3", "habitat 1"], DG), o = R.options(S, 0).find(x => x.p + "" === E + "");
    ok("downgrade: a level 2 tile can be planted on bare ground, and the move says it lands as level 1 for 1 point", does(S, E) === "plant" && o.l === 1 && o.pts === 1 && R.options(S, 0).length === R.plantable(S).length);
    const a = R.place(S, 0, E);
    ok("downgrade: it lands as a level 1 habitat and scores 1, not 3, and keeps its kind: it is still a habitat", a && a.does === "plant" && a.tile.k === "h" && a.tile.l === 2 && a.l === 1 && a.pts === 1 && at(S, E) === 1 && !riv(S, E) && S.score === 1 && S.top === 1 && S.planted === 1);
    const b = R.place(S, 0, W); ok("downgrade: a level 3 tile lands as level 1 too, for 1 point", b && b.l === 1 && b.pts === 1 && at(S, W) === 1 && S.score === 2 && S.top === 1) }
  { const S = run(["habitat 2"], DG); S.h["7,4"] = 2; S.h["5,4"] = 3; S.top = 3; const pl = R.options(S, 0).filter(x => x.does === "plant");
    ok("downgrade: level 2 on level 2 combines and level 2 on level 3 doesn't, and the only plants are level 1",
      does(S, E) === "combine" && does(S, W) === undefined && R.why(S, 0, W) === "That's level 3. Only a level 3 tile can go on it." && pl.length > 0 && pl.every(x => x.l === 1 && x.pts === 1));
    const b = R.place(S, 0, E); ok("downgrade: the combine is unchanged, level 3 for 6 points", b && b.does === "combine" && b.l === 3 && b.pts === 6 && at(S, E) === 3 && S.score === 6) }
  { const S = run(["river 2", "habitat 1"], DG), a = R.place(S, 0, E);
    ok("downgrade: a level 2 river tile is unaffected, it extends the river at level 2 and reaches 2 tiles out", a && a.does === "extend" && a.l === 2 && riv(S, E).l === 2 && R.reachOf(S).has("9,4")) }
  { const S = setup({"8,6":3, "9,6":5}, {}, {...DG, lockEvery:0, stackSize:1, queueShown:0}); R.discard(S, 0); R.lock(S, [9, 6]);   // the level 5 habitat copies the level 3 one beside it
    const o = R.options(S, 0), pl = o.filter(x => x.does === "plant");
    ok("downgrade: a level 3 copy can combine onto the level 3 habitat or be planted as level 1", S.q.length === 1 && S.q[0].c === 1 && S.q[0].l === 3 && o.some(x => x.does === "combine" && x.p + "" === "8,6") && pl.length > 0 && pl.every(x => x.l === 1 && x.pts === 1));
    const a = R.place(S, 0, E);
    ok("downgrade: a copy planted on bare ground lands as level 1 and counts as a copy placed, for 1 point", a && a.l === 1 && at(S, E) === 1 && S.copyPlaced === 1 && S.copyPoints === 1 && S.planted === 1 && S.score === 1) }
  { const a = run(["habitat 2", "habitat 3"], {bareGroundMaxLevel:2, bareGroundMode:"refuse"}), b = run(["habitat 2", "habitat 3"], {bareGroundMaxLevel:2, bareGroundMode:"downgrade"}), pa = R.place(a, 0, E), pb = R.place(b, 0, E);
    ok("a limit of 2: a level 2 tile still plants as level 2 for 3 points, in both modes", pa && pa.l === 2 && pa.pts === 3 && at(a, E) === 2 && pb && pb.l === 2 && pb.pts === 3 && at(b, E) === 2);
    ok("a limit of 2: a level 3 tile is refused in refuse mode, and lands as level 1 in downgrade mode",
      R.options(a, 0).length === 0 && R.why(a, 0, W) === "Only level 2 or lower can be planted on bare ground. Combine it or discard it." && does(b, W) === "plant" && R.place(b, 0, W).l === 1 && at(b, W) === 1) }
  for (const mode of ["refuse", "downgrade"]) { const S = run(["habitat 7"], {bareGroundMaxLevel:15, bareGroundMode:mode}), a = R.place(S, 0, E);
    ok(`a limit of 15 (${mode}): a level 7 tile plants as level 7 for 28 points, as before this rule`, a && a.does === "plant" && a.l === 7 && a.pts === 28 && at(S, E) === 7 && S.top === 7) }
  { const bad = []; for (let s = 1; s <= 12; s++) { const a = play(cfgWith({bareGroundMaxLevel:15}), s), b = play(cfgWith({bareGroundMaxLevel:15, bareGroundMode:"downgrade"}), s); if (a.error || b.error || a.S.score !== b.S.score || !same(a.S.moves, b.S.moves)) bad.push(s) }
    ok("with the limit at 15 no tile is above it, so the two modes play exactly alike", bad.length === 0) }
  for (const mode of ["refuse", "downgrade"]) { const bad = []; for (let s = 1; s <= 8; s++) { const a = play(cfgWith({bareGroundMaxLevel:1, bareGroundMode:mode, lockEvery:0, stackSize:10, levelOdds:0}), s); if (a.error || !a.S.over) bad.push(s) }
    ok(`the simple player ends every run with bare ground at level 1 (${mode}): it discards what it can't place instead of getting stuck`, bad.length === 0) }
  for (const mode of ["refuse", "downgrade"]) { const cfg = cfgWith({bareGroundMaxLevel:1, bareGroundMode:mode, opening:["habitat 3", "habitat 2", "habitat 1", "river"], lockEvery:0, stackSize:12}), S = R.fresh(cfg, 5);
    let z = 4242, guard = 0; const rn = () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    while (!S.over && guard++ < 4000) { if (!S.q.length) { const lk = Object.keys(S.h).map(R.unkey).find(p => R.lockable(S, p) && R.copiesOf(S, p).copies.length); if (!lk) { R.end(S); break } R.lock(S, lk); continue }
      const o = R.options(S, 0); if (!o.length || rn() < .1) { R.discard(S, 0); continue } R.place(S, 0, o[Math.floor(rn() * o.length)].p) }
    const planted = S.log.filter(e => e.did === "plant"), low = planted.filter(e => e.l < e.t.l), tall = planted.filter(e => e.l > 1);
    ok(`a whole run of random legal moves (${mode}): it ends, nothing above level 1 is planted on bare ground, and it replays from its seed`,
      S.over && guard < 4000 && tall.length === 0 && (mode === "refuse" ? low.length === 0 : low.length > 0) && same(S, R.replay(cfg, 5, S.moves)));
    if (mode === "downgrade" && low.length) { const m = low[0].n, k = R.key(low[0].at), withIt = R.replay(cfg, 5, S.moves.slice(0, m)), without = R.replay(cfg, 5, S.moves.slice(0, m - 1));
      ok("downgrade: undo steps back over a downgraded tile, a reload brings it back, and the run log says it landed as level 1",
        withIt.h[k] === 1 && withIt.log[m - 1].t.l > 1 && !(k in without.h) && same(R.replay(cfg, 5, S.moves.slice(0, m)), withIt) && /planted at \d+,\d+, as level 1 Sprouts · \+1 · /.test(R.logText(S))) } }
  ok("the ruleset key changes with the bare ground level and with its mode", R.rulesKey(cfgWith(RF)) !== R.rulesKey(cfgWith({bareGroundMaxLevel:2, bareGroundMode:"refuse"})) && R.rulesKey(cfgWith(RF)) !== R.rulesKey(cfgWith(DG)));
  { const t = R.tidy({...REF, bareGroundMaxLevel:0, bareGroundMode:"sideways"}, REF);
    ok("a bad bare ground level or mode is refused and the old value stands", same(t.bad, ["bareGroundMaxLevel", "bareGroundMode"]) && t.cfg.bareGroundMaxLevel === 24 && t.cfg.bareGroundMode === "refuse") }
  ok("the config file has bare ground at level 1, and the mode is downgrade (Dan, Nov 20: level 1 only on bare ground, then put downgrade in the game to play test)", BASE.bareGroundMaxLevel === 1 && BASE.bareGroundMode === "downgrade");

  // ----- grasslands (yellow) and marsh (turquoise) (Dan, Nov 20: "add a yellow tile for grasslands and then add a turquoise tile for marsh", "expand starting tiles to 20").
  // They are habitats of kinds of their own: a tile has b "p" or "m" (the original green one has no b), a combine needs the same kind (biomeMatch) and the same level, and a
  // copy keeps its kind. REF deals none of them (both shares are 0), so every check above is about the game as it was.
  ok("tiles can be written in words: prairie 2, marsh 3, habitat 1, river 2", same([R.parseTile("prairie 2"), R.parseTile("marsh 3"), R.parseTile("habitat 1"), R.parseTile("river 2"), R.parseTile("Marsh 1")], [{k:"h", l:2, b:"p"}, {k:"h", l:3, b:"m"}, {k:"h", l:1}, {k:"r", l:2}, {k:"h", l:1, b:"m"}])
    && R.parseTile("marsh") === null && R.parseTile("swamp 1") === null && R.tileWord({k:"h", l:2, b:"p"}) === "prairie 2" && R.tileWord({k:"h", l:3, b:"m"}) === "marsh 3" && R.tileWord({k:"h", l:1}) === "habitat 1");
  { const S = run(["prairie 2", "marsh 1", "habitat 1"], {});
    ok("an opening of prairie, marsh and green deals them in that order, and each tile's text names its kind", same(S.q.slice(0, 3), [{k:"h", l:2, b:"p"}, {k:"h", l:1, b:"m"}, {k:"h", l:1}]) && R.tileText(S.cfg, S.q[0]) === "Prairie (level 2)" && R.tileText(S.cfg, S.q[1]) === "Marsh (level 1)" && R.tileText(S.cfg, S.q[2]) === "Sprouts (level 1)") }
  { const S = run(["marsh 1", "prairie 1", "habitat 1"], {}), a = R.place(S, 0, E), b = R.place(S, 0, W), c = R.place(S, 0, [6, 3]);
    ok("a marsh tile is planted as a marsh habitat, then a prairie one, then a green one: level 1, 1 point each", a && a.does === "plant" && a.pts === 1 && S.h["7,4"] === 1 && S.hb["7,4"] === "m" && b && S.hb["5,4"] === "p" && c && S.h["6,3"] === 1 && !("6,3" in S.hb) && S.score === 3 && S.planted === 3) }
  { const S = run(["marsh 1", "prairie 1", "habitat 1", "marsh 1"], {}), msg = "That's Marsh (level 1). Only a tile of the same kind and level goes on it."; R.place(S, 0, E);
    ok("a prairie tile can't go on a marsh habitat of the same level: no move, and the text says why", does(S, E) === undefined && R.place(S, 0, E) === null && R.why(S, 0, E) === msg && R.options(S, 0).every(o => o.does === "plant"));
    R.discard(S, 0); ok("neither can a green tile", does(S, E) === undefined && R.place(S, 0, E) === null && R.why(S, 0, E) === msg);
    R.discard(S, 0); const r = R.place(S, 0, E);
    ok("a marsh tile can: marsh level 2 for 3 points", r && r.does === "combine" && r.l === 2 && r.pts === 3 && S.h["7,4"] === 2 && S.hb["7,4"] === "m" && S.combined === 1) }
  { const S = run(["habitat 1", "marsh 1"], {}); R.place(S, 0, E); ok("a marsh tile can't go on a green habitat either", does(S, E) === undefined && R.why(S, 0, E) === "That's Sprouts (level 1). Only a tile of the same kind and level goes on it.") }
  { const S = run(["marsh 1", "prairie 1"], {biomeMatch:false}); R.place(S, 0, E); const r = R.place(S, 0, E);
    ok("with kinds not having to match, a prairie tile does combine onto a marsh habitat of its level, and the habitat stays marsh", r && r.does === "combine" && S.h["7,4"] === 2 && S.hb["7,4"] === "m") }
  { const S = setup({"8,6":3, [N[0]]:2, [N[1]]:1, [N[2]]:1}, {}, {lockEvery:0, stackSize:1, queueShown:0}); S.hb["8,6"] = "m"; S.hb[N[0]] = "p"; S.hb[N[1]] = "m"; R.discard(S, 0);   // a level 3 marsh beside a level 2 prairie, a level 1 marsh and a level 1 green
    const copies = R.copiesOf(S, C).copies; R.lock(S, C);
    ok("lock: copies keep the kind they are copied from, lowest level first", same(copies, [{k:"h", l:1, c:1, b:"m"}, {k:"h", l:1, c:1}, {k:"h", l:2, c:1, b:"p"}]) && same(S.q[0], copies[0]) && same(S.bank, copies.slice(1)));
    const a = R.place(S, 0, [6, 3]); ok("lock: a marsh copy is planted as a marsh habitat", a && a.does === "plant" && S.hb["6,3"] === "m" && S.copyPlaced === 1) }
  { const S = setup({"8,6":3, "9,6":5}, {}, {...DG, lockEvery:0, stackSize:1, queueShown:0}); S.hb["8,6"] = "p"; R.discard(S, 0); R.lock(S, [9, 6]);   // the level 5 habitat copies the level 3 prairie beside it
    const a = R.place(S, 0, E);
    ok("downgrade: a level 3 prairie copy is planted as prairie at level 1 for 1 point: it keeps its kind", a && a.l === 1 && a.pts === 1 && S.h["7,4"] === 1 && S.hb["7,4"] === "p" && S.copyPlaced === 1 && /planted at 7,4, as level 1 Prairie · \+1 · /.test(R.logText(S))) }
  { const S = run([], {stackSize:0, prairieShare:.3, marshShare:.2, riverShare:0}), c = {p:0, m:0, h:0}, n = 30000, lv = new Set(); for (let i = 0; i < n; i++) { const t = R.roll(S); c[t.b || "h"]++; lv.add(t.l) }
    ok("dealt habitats are prairie 30% of the time and marsh 20%, and the rest are green", Math.abs(c.p / n - .3) < .012 && Math.abs(c.m / n - .2) < .012 && Math.abs(c.h / n - .5) < .012 && lv.size === 1 && lv.has(1)) }
  { const S = run([], {stackSize:0, riverShare:.1}); let any = false; for (let i = 0; i < 5000; i++) if (R.roll(S).b) any = true; ok("with both shares 0 no tile is ever prairie or marsh", !any) }
  { const t = R.tidy({...REF, prairieShare:.7, marshShare:.6}, REF), u = R.tidy({...REF, prairieShare:"x", biomeMatch:"maybe"}, REF);
    ok("prairie and marsh together can't pass 1: both are refused and the old values stand", same(t.bad, ["prairieShare", "marshShare"]) && t.cfg.prairieShare === 0 && t.cfg.marshShare === 0);
    ok("a bad share or a bad kinds switch is refused", same(u.bad, ["prairieShare", "biomeMatch"]) && u.cfg.prairieShare === 0 && u.cfg.biomeMatch === true) }
  ok("the ruleset key changes with the shares and with the kinds switch", R.rulesKey(cfgWith({prairieShare:.3})) !== R.rulesKey(REF) && R.rulesKey(cfgWith({marshShare:.3})) !== R.rulesKey(REF) && R.rulesKey(cfgWith({biomeMatch:false})) !== R.rulesKey(REF));
  ok("the config file deals prairie and marsh and shows every kind in its first tiles (Dan, Nov 20)", BASE.prairieShare > 0 && BASE.marshShare > 0 && BASE.prairieShare + BASE.marshShare < 1 && BASE.biomeMatch === true && BASE.opening.includes("prairie 1") && BASE.opening.includes("marsh 1"));
  for (const mode of ["refuse", "downgrade"]) { const cfg = cfgWith({bareGroundMaxLevel:1, bareGroundMode:mode, prairieShare:.3, marshShare:.3, opening:["habitat 1", "prairie 1", "marsh 1", "river"], lockEvery:0, stackSize:20}), S = R.fresh(cfg, 9);
    let z = 777, guard = 0; const rn = () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    while (!S.over && guard++ < 4000) { if (!S.q.length) { const lk = Object.keys(S.h).map(R.unkey).find(p => R.lockable(S, p) && R.copiesOf(S, p).copies.length); if (!lk) { R.end(S); break } R.lock(S, lk); continue }
      const o = R.options(S, 0); if (!o.length || rn() < .1) { R.discard(S, 0); continue } R.place(S, 0, o[Math.floor(rn() * o.length)].p) }
    const T = R.fresh(cfg, 9); let mixed = 0; for (const m of S.moves) { if (m.a === "p") { const t = T.q[m.i], k = m.x + "," + m.y; if (k in T.h && (T.hb[k] || "") !== (t.b || "")) mixed++ }
      m.a === "p" ? R.place(T, m.i, [m.x, m.y]) : m.a === "d" ? R.discard(T, m.i) : m.a === "l" ? R.lock(T, [m.x, m.y]) : R.end(T) }
    const kinds = new Set(Object.values(S.hb));
    ok(`a whole run of random legal moves with prairie and marsh (${mode}): it ends, both kinds were planted, no tile ever combined onto another kind, and it replays from its seed`,
      S.over && guard < 4000 && kinds.has("p") && kinds.has("m") && mixed === 0 && same(S, R.replay(cfg, 9, S.moves))) }

  // ----- rivers level up (Dan, Nov 20: "make rivers also level up, just as points make the "width" max 2"). A river tile put on a river tile of its own level raises it a level, up
  // to riverMaxLevel, and only the first two levels widen it (riverReach). riverScore says what scores. REF is the first build's: top level 2, and rivers score nothing.
  const RV = {riverMaxLevel:15, riverScore:"levels"};
  { const S = run(["river 2", "river 2", "river 3", "river 3"], RV), a = R.place(S, 0, E);
    ok("a level 2 river tile extends the river at level 2, and extending scores nothing", a && a.does === "extend" && a.l === 2 && a.pts === 0 && riv(S, E).l === 2 && S.score === 0);
    ok("a level 2 river tile put on a level 2 one raises it to level 3 (past the widest) for the points of level 3", does(S, E) === "widen" && (b => b && b.l === 3 && b.pts === 6 && riv(S, E).l === 3 && S.score === 6 && S.widened === 1)(R.place(S, 0, E)));
    ok("the width stops at 2: a level 3 river tile reaches 2 tiles out and no further", R.reachOf(S).has("9,4") && !R.reachOf(S).has("10,4") && R.reachAt(S.cfg, 3) === 2 && R.reachAt(S.cfg, 15) === 2);
    const c = R.place(S, 0, E); ok("and so on: a level 3 on a level 3 makes level 4 for 10", c && c.does === "widen" && c.pts === 10 && riv(S, E).l === 4 && S.score === 16);
    ok("a river tile of another level can't raise it, and the text says so", R.place(S, 0, E) === null && R.why(S, 0, E) === "Only a level 4 river tile levels this up." && does(S, [8, 4]) === "extend") }
  { const S = run(["river 3", "river 3"], {riverMaxLevel:3, riverScore:"levels"}); R.place(S, 0, E);
    ok("a river tile at its top level can't be raised, and the text says so", does(S, E) === undefined && R.place(S, 0, E) === null && R.why(S, 0, E) === "River level 3 is the top level.") }
  for (const [mode, ext, up] of [["all", 1, 3], ["levels", 0, 3], ["none", 0, 0]]) { const S = run(["river", "river"], {riverMaxLevel:15, riverScore:mode}), a = R.place(S, 0, E), b = R.place(S, 0, E);
    ok(`river points (${mode}): extending the river scores ${ext}, and raising a river tile to level 2 scores ${up}`, a && a.does === "extend" && a.pts === ext && b && b.does === "widen" && b.pts === up && S.score === ext + up) }
  { const S = run(["river 2", "river 2", "river 2"], {...RV, riverMonotone:true}); R.place(S, 0, E); R.place(S, 0, E);
    ok("rivers still rise downstream with river levels: after a level 3 river tile a level 2 one can't follow", riv(S, E).l === 3 && does(S, [8, 4]) === undefined && R.why(S, 0, [8, 4]) === "A river tile can't be lower than the one it flows from (level 3).") }
  { const t = R.tidy({...REF, riverMaxLevel:0, riverScore:"most"}, REF);
    ok("a bad river top level or river points setting is refused and the old value stands", same(t.bad, ["riverMaxLevel", "riverScore"]) && t.cfg.riverMaxLevel === 2 && t.cfg.riverScore === "none") }
  ok("the ruleset key changes with the river top level and the river points", R.rulesKey(cfgWith({riverMaxLevel:15})) !== R.rulesKey(REF) && R.rulesKey(cfgWith({riverScore:"levels"})) !== R.rulesKey(REF));
  ok("the config file lets rivers level up to 15 and scores the level-ups, with the width still stopping at 2 (Dan, Nov 20)", BASE.riverMaxLevel === 15 && BASE.riverScore === "levels" && same(BASE.riverReach, [1, 2]));
  { const cfg = cfgWith({...RV, riverMonotone:true, opening:["river", "habitat 1", "river 2", "river 2", "river 3", "river 3", "river 4", "river 4"], riverShare:.35, lockEvery:0, stackSize:30}), S = R.fresh(cfg, 4);
    let z = 99, guard = 0; const rn = () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    while (!S.over && guard++ < 4000) { if (!S.q.length) { const lk = [...Object.keys(S.h), ...Object.keys(S.r)].map(R.unkey).find(p => R.lockable(S, p) && R.copiesOf(S, p).copies.length); if (!lk) { R.end(S); break } R.lock(S, lk); continue }
      const o = R.options(S, 0), w = o.filter(x => x.does === "widen"); if (!o.length || rn() < .08) { R.discard(S, 0); continue } const pick = w.length && rn() < .8 ? w : o; R.place(S, 0, pick[Math.floor(rn() * pick.length)].p) }
    let low = 0, top = 0; for (const k in S.r) { const f = S.r[k].from; top = Math.max(top, S.r[k].l); if (f != null && S.r[k].l < S.r[f].l) low++ }
    ok("a whole run of random legal moves with river levels: it ends, a river tile passed level 2, none is lower than the one it joins, the score is the sum of the moves, and it replays from its seed",
      S.over && guard < 4000 && top > 2 && low === 0 && S.log.reduce((s, e) => s + e.pts, 0) === S.score && same(S, R.replay(cfg, 4, S.moves))) }

  // ----- marsh must touch the river, prairie spreads (LOU-301; Dan, Nov 20: "turquoise represents marsh and must be adjacent to a river", "Yellow...is grass, and we need it to have a power",
  // "Yes, grass can be placed to adjacent grass tiles event if not in the water zone, good idea"). REF has both rules off, so every check above is about marsh and prairie planting like green.
  const MR = {marshNeedsRiver:true}, PS = {prairieSpreads:true}, BK = o => R.nbrs(REF, o.p).some(q => R.key(q) in S0.r);
  let S0 = null;
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) {
    { const S = S0 = run(["river 2", "marsh 1", "marsh 1", "marsh 1"], {...mode, ...MR}); R.place(S, 0, E);   // E is a level 2 river tile, which reaches 2 tiles out: (9,4) is within reach but touches no river tile
      ok(`marsh (${name}): a tile next to the river is offered, a tile only within reach is not`, R.reachOf(S).has("9,4") && does(S, [8, 4]) === "plant" && does(S, W) === "plant" && does(S, [9, 4]) === undefined && R.options(S, 0).filter(o => o.does === "plant").every(BK));
      ok(`marsh (${name}): a refused tile gets the toast in plain words`, R.place(S, 0, [9, 4]) === null && R.why(S, 0, [9, 4]) === "Marsh needs a tile next to the river." && R.why(S, 0, E) === "That's the river. Plant beside it.");
      R.place(S, 0, W); ok(`marsh (${name}): marsh onto marsh of its own level combines`, does(S, W) === "combine" && (r => r && r.l === 2 && r.pts === 3 && S.hb["5,4"] === "m")(R.place(S, 0, W))) }
    { const S = S0 = run(["marsh 1"], {...mode, ...MR}); S.lk["6,4"] = 1; ok(`marsh (${name}): a locked river tile still counts as a river tile (so does the source)`, does(S, W) === "plant" && does(S, E) === "plant") }
    { const S = S0 = setup(name === "refuse" ? {"8,6":1, "9,6":3} : {"8,6":3, "9,6":5}, {}, {...mode, ...MR, lockEvery:0, stackSize:1, queueShown:0}); S.hb["8,6"] = "m"; R.discard(S, 0); R.lock(S, [9, 6]);   // the lock banks a marsh copy (level 1 in refuse, level 3 in downgrade)
      const pl = R.options(S, 0).filter(o => o.does === "plant");
      ok(`marsh (${name}): a lock copy of marsh follows the rule, and a downgraded copy lands as level 1 on a bank tile only`, S.q[0].c === 1 && S.q[0].b === "m" && pl.length === 6 && pl.every(BK) && pl.every(o => o.l === 1) && does(S, [9, 4]) === undefined && (a => a && S.h["5,4"] === 1 && S.hb["5,4"] === "m")(R.place(S, 0, W))) }
    { const S = S0 = setup({"7,4":1, "6,3":1, "5,3":1, "5,4":1, "5,5":1, "6,5":1}, {}, {...mode, ...MR, opening:["marsh 1"], stackSize:1, queueShown:0, lockEvery:10}); S.locks = 0;   // all six bank tiles are taken by green
      ok(`marsh (${name}): a marsh tile with no free bank tile has nowhere to go, and can be discarded: the run ends`, R.options(S, 0).length === 0 && !S.over && !!R.discard(S, 0) && S.over) }
    { const S = S0 = run(["prairie 1", "prairie 1", "prairie 1", "habitat 1"], {...mode, ...PS}); R.place(S, 0, E);   // prairie at E (within reach), then land outside reach that touches it
      ok(`prairie (${name}): plants within reach, and next to prairie outside reach, and nowhere else`, !R.reachOf(S).has("8,4") && does(S, [8, 4]) === "plant" && does(S, W) === "plant" && does(S, [9, 4]) === undefined && R.why(S, 0, [9, 4]) === "Prairie needs a tile within reach of the river or next to prairie.");
      R.place(S, 0, [8, 4]); ok(`prairie (${name}): prairie that spread can spread again`, does(S, [9, 4]) === "plant" && (a => a && a.l === 1)(R.place(S, 0, [9, 4])));
      ok(`prairie (${name}): green still plants only within reach`, does(S, [10, 4]) === undefined && does(S, [5, 4]) === "plant" && R.why(S, 0, [10, 4]) === "Too far from the river.") }
    { const S = S0 = run(["prairie 1", "prairie 1"], {...mode, prairieSpreads:false}); R.place(S, 0, E);
      ok(`prairie (${name}): with the spread off it plants only inside reach`, does(S, [8, 4]) === undefined && does(S, W) === "plant" && R.why(S, 0, [8, 4]) === "Too far from the river.") }
  }
  { const S = setup({"8,4":1, "9,4":1, "9,3":1}, {"7,4":1}, {...PS, opening:["prairie 1"], stackSize:1, queueShown:0}); S.hb["8,4"] = "p"; S.hb["9,3"] = "p";   // prairie beside a mountain (10,3), a river tile (7,4) and an occupied tile (9,4)
    const pl = R.options(S, 0).filter(o => o.does === "plant").map(o => o.p + "");
    ok("prairie spread: never onto a mountain, a river tile or an occupied tile, but onto the empty land beside prairie", !pl.includes("10,3") && !pl.includes("7,4") && !pl.includes("9,4") && !pl.includes("8,4") && pl.includes("9,2") && pl.includes("10,4") && R.why(S, 0, [10, 3]) === "Nothing grows on a mountain." && R.why(S, 0, [7, 4]) === "That's the river. Plant beside it.") }
  { const S = setup({"8,4":1}, {}, {...PS, opening:["habitat 1"], stackSize:1, queueShown:0}); S.locks = 1; S.hb["8,4"] = "p"; S.lk["8,4"] = 1;   // a locked prairie tile still lets prairie spread
    const T = setup({"8,4":1}, {}, {...PS, opening:["prairie 1"], stackSize:1, queueShown:0}); T.hb["8,4"] = "p"; T.lk["8,4"] = 1;
    ok("prairie spread: a locked prairie habitat still lets prairie spread from it, and green still can't use it", does(T, [9, 4]) === "plant" && does(S, [9, 4]) === undefined) }
  { const S = run(["river 2", "marsh 1"], {marshNeedsRiver:false}); R.place(S, 0, E); ok("with marshNeedsRiver off, marsh plants wherever green does", does(S, [9, 4]) === "plant") }
  { const t = R.tidy({...REF, marshNeedsRiver:"sometimes", prairieSpreads:"maybe"}, REF); ok("a bad value for the marsh or prairie rule is refused and the old value stands", same(t.bad, ["marshNeedsRiver", "prairieSpreads"]) && t.cfg.marshNeedsRiver === false && t.cfg.prairieSpreads === false) }
  ok("the ruleset key changes with the marsh rule and with the prairie rule", R.rulesKey(cfgWith(MR)) !== R.rulesKey(REF) && R.rulesKey(cfgWith(PS)) !== R.rulesKey(REF) && R.rulesKey(cfgWith({...MR, ...PS})) !== R.rulesKey(cfgWith(MR)));
  ok("the config file has both rules on, and calls the yellow kind prairie (Dan, Nov 20)", BASE.marshNeedsRiver === true && BASE.prairieSpreads === true && BASE.opening.includes("prairie 1") && R.parseTile("prairie 2").b === "p" && R.parseTile("grasslands 2") === null && R.tileText(REF, {k:"h", l:2, b:"p"}) === "Prairie (level 2)");
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) { const cfg = cfgWith({...mode, ...MR, ...PS, prairieShare:.4, marshShare:.4, opening:["prairie 1", "marsh 1", "habitat 1", "river", "prairie 1"], lockEvery:0, stackSize:30, riverShare:.15}), S = R.fresh(cfg, 8);
    let z = 31, guard = 0; const rn = () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    while (!S.over && guard++ < 4000) { if (!S.q.length) { const lk = [...Object.keys(S.h), ...Object.keys(S.r)].map(R.unkey).find(p => R.lockable(S, p) && R.copiesOf(S, p).copies.length); if (!lk) { R.end(S); break } R.lock(S, lk); continue }
      const o = R.options(S, 0); if (!o.length || rn() < .08) { R.discard(S, 0); continue } R.place(S, 0, o[Math.floor(rn() * o.length)].p) }
    const T = R.fresh(cfg, 8); let wrong = 0, spread = 0, marshPlanted = 0;   // every planting obeys the rule of its kind at the moment it is made
    for (const m of S.moves) { if (m.a === "p") { const t = T.q[m.i], k = m.x + "," + m.y;
        if (t.k === "h" && !(k in T.h)) { const reach = R.reachOf(T).has(k), nb = R.nbrs(cfg, [m.x, m.y]).map(R.key), bank = nb.some(q => q in T.r), pn = nb.some(q => T.hb[q] === "p");
          if (t.b === "m") { marshPlanted++; if (!bank) wrong++ } else if (t.b === "p") { if (!reach && !pn) wrong++; if (!reach) spread++ } else if (!reach) wrong++ } }
      m.a === "p" ? R.place(T, m.i, [m.x, m.y]) : m.a === "d" ? R.discard(T, m.i) : m.a === "l" ? R.lock(T, [m.x, m.y]) : R.end(T) }
    ok(`a whole run of random legal moves with both rules (${name}): it ends, every planting obeyed the rule of its kind, marsh and prairie spread were both used, and it replays from its seed`,
      S.over && guard < 4000 && wrong === 0 && marshPlanted > 0 && spread > 0 && same(S, R.replay(cfg, 8, S.moves))) }

  // ----- trees, deep green (LOU-302; Dan, Nov 20: "should we have a 'deep green' tile which is trees? And what special should this have?", then "I like overgrow"). A tree is a habitat of
  // a kind of its own (b "t"). With overgrow on it is never planted on bare ground: it grows over an unlocked habitat of its own level, of any other kind, which becomes a tree habitat one
  // level up and loses its old kind. REF deals no trees (treeShare 0) and these set-ups write them into the opening, so every check above is about the game as it was.
  const TG = "Trees grow over a habitat of the same level.";
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) {
    { const S = setup({"8,6":2, "9,6":2, "7,6":2, "8,5":3, "7,5":2}, {"7,7":2}, {...mode, opening:["trees 2", "trees 2", "trees 2"]}); S.hb["9,6"] = "p"; S.hb["7,6"] = "m"; S.lk["7,5"] = 1;   // green, prairie and marsh at level 2, a level 3 green, a locked level 2 green, a level 2 river tile
      ok(`trees (${name}): a level 2 tree can overgrow a level 2 green, prairie and marsh habitat, and nothing else: not a level 3 habitat, a locked one, a river tile or bare ground`,
        same(R.options(S, 0).map(o => o.does + ":" + o.p).sort(), ["overgrow:7,6", "overgrow:8,6", "overgrow:9,6"]) && R.plantable(S).includes("7,4") && does(S, E) === undefined && R.place(S, 0, E) === null && R.why(S, 0, E) === TG
        && R.place(S, 0, [8, 5]) === null && R.why(S, 0, [8, 5]) === TG && R.why(S, 0, [7, 5]) === "That tile is locked." && R.why(S, 0, [7, 7]) === TG);
      const a = R.place(S, 0, [8, 6]);
      ok(`trees (${name}): overgrowing a green habitat makes a level 3 tree and scores 6, like a combine; the tile stays a habitat`, a && a.does === "overgrow" && a.l === 3 && a.pts === 6 && a.from === "" && S.h["8,6"] === 3 && S.hb["8,6"] === "t" && S.score === 6 && S.combined === 1 && S.overgrown === 1 && S.planted === 0 && S.top === 3 && Object.keys(S.h).length === 5);
      const b = R.place(S, 0, [9, 6]), c = R.place(S, 0, [7, 6]);
      ok(`trees (${name}): overgrowing a prairie tile or a marsh tile does the same, and the tile loses its old kind`, b && b.from === "p" && c && c.from === "m" && S.h["9,6"] === 3 && S.hb["9,6"] === "t" && S.h["7,6"] === 3 && S.hb["7,6"] === "t" && S.score === 18 && S.overgrown === 3 && S.combined === 3);
      ok(`trees (${name}): the run log says what was overgrown`, /^1\. Trees \(level 2\), dealt · overgrew the green tile at 8,6, now level 3 Trees · \+6 · /m.test(R.logText(S)) && /overgrew the prairie tile at 9,6, now level 3 Trees/.test(R.logText(S)) && /overgrew the marsh tile at 7,6, now level 3 Trees/.test(R.logText(S))) }
    { const S = setup({"8,4":2, "9,4":1}, {}, {...mode, ...PS, opening:["prairie 1", "trees 2", "prairie 1"]}); S.hb["8,4"] = "p"; S.hb["9,4"] = "p";   // two prairie tiles outside the river's reach: (7,3) touches only the first, (8,3) touches both
      const before = does(S, [7, 3]) === "plant" && does(S, [8, 3]) === "plant"; R.discard(S, 0); R.place(S, 0, [8, 4]);
      ok(`trees (${name}): an overgrown prairie tile no longer lets prairie spread from it; prairie planted next to it stays, and prairie still spreads from the rest`, before && S.hb["8,4"] === "t" && S.hb["9,4"] === "p" && S.h["9,4"] === 1 && does(S, [7, 3]) === undefined && R.why(S, 0, [7, 3]) === "Prairie needs a tile within reach of the river or next to prairie." && does(S, [8, 3]) === "plant") }
    { const S = setup({"7,6":2}, {}, {...mode, opening:["trees 2", "marsh 3"]}); S.hb["7,6"] = "m"; R.place(S, 0, [7, 6]);
      ok(`trees (${name}): an overgrown marsh tile is no longer marsh: a level 3 marsh tile can't go on it, and the text says it is Trees`, S.hb["7,6"] === "t" && does(S, [7, 6]) === undefined && R.why(S, 0, [7, 6]) === "That's Trees (level 3). Only a tile of the same kind and level goes on it.") }
    { const S = setup({"8,6":2}, {}, {...mode, opening:["trees 2", "trees 2"]}); S.hb["8,6"] = "t";
      ok(`trees (${name}): a tree onto a tree of its own level combines, as before: level 3 for 6 points, still Trees, and not counted as an overgrow`, does(S, [8, 6]) === "combine" && (a => a && a.does === "combine" && a.l === 3 && a.pts === 6 && S.h["8,6"] === 3 && S.hb["8,6"] === "t" && S.combined === 1 && S.overgrown === 0)(R.place(S, 0, [8, 6]))) }
    { const S = setup({"8,6":3, "7,5":2}, {"7,7":1}, {...mode, opening:["trees 1", "trees 2", "trees 3"]}); S.lk["7,5"] = 1;   // a level 3 green, a locked level 2 green, a level 1 river tile
      ok(`trees (${name}): a level 1 tree is refused on bare ground, with the toast, and has nothing to grow over`, R.plantable(S).includes("7,4") && R.options(S, 0).length === 0 && does(S, E) === undefined && R.place(S, 0, E) === null && R.why(S, 0, E) === TG && R.why(S, 0, FAR) === TG && R.why(S, 0, [8, 6]) === TG && R.why(S, 0, [7, 7]) === TG && S.planted === 0);
      R.discard(S, 0);
      ok(`trees (${name}): a level 2 tree is refused on bare ground too, and a locked level 2 habitat is no target`, R.options(S, 0).length === 0 && R.place(S, 0, E) === null && R.why(S, 0, E) === TG && R.why(S, 0, [7, 5]) === "That tile is locked.");
      R.discard(S, 0);
      ok(`trees (${name}): a level 3 tree grows over the level 3 habitat, and only that: level 4 for 10 points`, R.options(S, 0).length === 1 && does(S, [8, 6]) === "overgrow" && (a => a && a.l === 4 && a.pts === 10 && S.h["8,6"] === 4 && S.hb["8,6"] === "t")(R.place(S, 0, [8, 6]))) }
    { const S = setup({"8,6":3, [N[0]]:2, [N[1]]:1}, {}, {...mode, lockEvery:0, stackSize:1, queueShown:0}); S.hb["8,6"] = "t"; S.hb[N[0]] = "t"; S.hb[N[1]] = "p"; R.discard(S, 0);   // a level 3 tree beside a level 2 tree and a level 1 prairie
      const copies = R.copiesOf(S, C).copies; R.lock(S, C);
      ok(`trees (${name}): lock copies of a tree keep their kind, lowest level first`, same(copies, [{k:"h", l:1, c:1, b:"p"}, {k:"h", l:2, c:1, b:"t"}]) && same(S.q[0], copies[0]) && same(S.bank, copies.slice(1)));
      const a = R.place(S, 0, E);
      ok(`trees (${name}): the tree copy follows the tree rule: it can only combine onto its own tree and never plants`, a && a.does === "plant" && S.hb["7,4"] === "p" && S.q[0].b === "t" && S.q[0].l === 2 && S.q[0].c === 1 && R.options(S, 0).length === 1 && does(S, R.unkey(N[0])) === "combine" && R.why(S, 0, W) === TG) }
    { const S = run(["trees 2"], {...mode, stackSize:1, queueShown:0});
      ok(`trees (${name}): a tree with nothing to grow over can only be discarded, and the run still ends`, R.options(S, 0).length === 0 && R.place(S, 0, E) === null && !!R.discard(S, 0) && S.over && S.discarded === 1 && S.planted === 0) }
    { const S = setup({"8,6":3, "9,6":5}, {}, {...mode, lockEvery:0, stackSize:1, queueShown:0}); S.hb["8,6"] = "t"; R.discard(S, 0); R.lock(S, [9, 6]);   // the level 5 habitat copies the level 3 tree beside it
      ok(`trees (${name}): a tree copy is a tile like any other: it can combine onto its own tree`, S.q.length === 1 && S.q[0].c === 1 && S.q[0].b === "t" && S.q[0].l === 3 && R.options(S, 0).length === 1 && does(S, [8, 6]) === "combine");
      R.lock(S, [8, 6]);   // freeze that tree: nothing is left to grow over
      ok(`trees (${name}): a tree copy with no target can be discarded, and the run still ends`, !S.over && R.options(S, 0).length === 0 && !!R.discard(S, 0) && S.over && S.copyDiscarded === 1 && S.copyPlaced === 0) }
    { const S = run(["trees 1", "habitat 1", "trees 1", "trees 3"], {...mode, overgrow:false}), a = R.place(S, 0, E);
      ok(`trees (${name}): with overgrow off a tree plants like green, as a tree habitat, and a green tile can't go on it`, a && a.does === "plant" && a.l === 1 && a.pts === 1 && S.h["7,4"] === 1 && S.hb["7,4"] === "t" && S.planted === 1 && does(S, E) === undefined && R.why(S, 0, E) === "That's Trees (level 1). Only a tile of the same kind and level goes on it.");
      R.discard(S, 0); const b = R.place(S, 0, E);
      ok(`trees (${name}): with overgrow off a tree combines onto a tree, and nothing counts as an overgrow`, b && b.does === "combine" && b.l === 2 && S.hb["7,4"] === "t" && S.overgrown === 0 && S.combined === 1);
      ok(`trees (${name}): with overgrow off a level 3 tree is ${name === "refuse" ? "refused on bare ground" : "planted as a level 1 tree"}, as green would be`, name === "refuse" ? R.options(S, 0).length === 0 : does(S, W) === "plant" && (r => r && r.l === 1 && S.hb["5,4"] === "t")(R.place(S, 0, W))) }
    { const S = setup({"8,6":2}, {}, {...mode, biomeMatch:false, opening:["trees 2", "prairie 3"]}); S.hb["8,6"] = "p"; const a = R.place(S, 0, [8, 6]), up = does(S, [8, 6]) === "combine", b = R.place(S, 0, [8, 6]);
      ok(`trees (${name}): with kinds not having to match, a tree still overgrows another kind, and a prairie tile then combines onto the trees and the habitat stays trees`, a && a.does === "overgrow" && up && b && b.does === "combine" && b.l === 4 && S.h["8,6"] === 4 && S.hb["8,6"] === "t" && S.overgrown === 1) }
  }
  { const t = R.tidy({...REF, treeShare:1.5, overgrow:"sometimes"}, REF), u = R.tidy({...REF, treeShare:"x"}, REF);
    ok("a bad tree share or a bad overgrow switch is refused and the old value stands", same(t.bad, ["treeShare", "overgrow"]) && t.cfg.treeShare === 0 && t.cfg.overgrow === true && same(u.bad, ["treeShare"]) && u.cfg.treeShare === 0) }
  ok("the ruleset key changes with the tree share and with the overgrow switch", R.rulesKey(cfgWith({treeShare:.2})) !== R.rulesKey(REF) && R.rulesKey(cfgWith({overgrow:false})) !== R.rulesKey(REF));
  ok("the config file deals trees (20% of the habitats after the opening) with overgrow on, and its opening has none (Dan, Nov 20: \"I like overgrow\")", BASE.treeShare === .2 && BASE.overgrow === true && !BASE.opening.some(w => R.parseTile(w).b === "t"));
  ok("trees can be written in words, and have a name: trees 2, Trees (level 2)", same(R.parseTile("trees 2"), {k:"h", l:2, b:"t"}) && R.parseTile("trees") === null && R.parseTile("tree 2") === null && R.tileWord({k:"h", l:2, b:"t"}) === "trees 2" && R.tileText(REF, {k:"h", l:2, b:"t"}) === "Trees (level 2)");
  { const S = run([], {stackSize:0, prairieShare:.3, marshShare:.3, treeShare:.2, riverShare:0}), c = {t:0, p:0, m:0, h:0}, n = 40000, lv = new Set(); for (let i = 0; i < n; i++) { const t = R.roll(S); c[t.b || "h"]++; lv.add(t.l) }
    ok("dealt habitats are trees 20% of the time and the rest keep the 40 : 30 : 30 split: green 32%, prairie 24%, marsh 24%", Math.abs(c.t / n - .2) < .012 && Math.abs(c.h / n - .32) < .012 && Math.abs(c.p / n - .24) < .012 && Math.abs(c.m / n - .24) < .012 && lv.size === 1) }
  { const S = R.fresh(cfgWith({opening:BASE.opening, treeShare:1, riverShare:0, stackSize:20}), 3); for (let i = 0; i < 5; i++) R.discard(S, 0);
    ok("trees are dealt only after the opening: the first five tiles are the opening's, and with every habitat after it a tree, the sixth is one", S.log.slice(0, 5).map(e => e.t.k + (e.t.b || "")).join(" ") === "h h r hp hm" && S.q[0].k === "h" && S.q[0].b === "t") }
  { const S = run([], {stackSize:0, treeShare:.5}); let more = 0, N2 = 2000; for (let i = 0; i < N2; i++) if (R.roll(S).b === "t") more++; const T = run([], {stackSize:0, treeShare:0}); let none = 0; for (let i = 0; i < N2; i++) if (R.roll(T).b) none++;
    ok("with the tree share 0 no tile is ever a tree", more > 0 && none === 0) }
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) { const cfg = cfgWith({...mode, ...MR, ...PS, treeShare:.4, prairieShare:.3, marshShare:.3, opening:["habitat 1", "prairie 1", "marsh 1", "river", "habitat 1"], lockEvery:0, stackSize:30, riverShare:.1}), S = R.fresh(cfg, 12);
    let z = 53, guard = 0; const rn = () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    while (!S.over && guard++ < 4000) { if (!S.q.length) { const lk = [...Object.keys(S.h), ...Object.keys(S.r)].map(R.unkey).find(p => R.lockable(S, p) && R.copiesOf(S, p).copies.length); if (!lk) { R.end(S); break } R.lock(S, lk); continue }
      const o = R.options(S, 0); if (!o.length || rn() < .08) { R.discard(S, 0); continue } R.place(S, 0, o[Math.floor(rn() * o.length)].p) }
    const T = R.fresh(cfg, 12); let wrong = 0, grew = 0;   // every tree goes on a habitat of its own level that isn't locked, never on bare ground
    for (const m of S.moves) { if (m.a === "p") { const t = T.q[m.i], k = m.x + "," + m.y; if (t.k === "h" && t.b === "t") { if (!(k in T.h) || T.h[k] !== t.l || k in T.lk) wrong++; else if (T.hb[k] !== "t") grew++ } }
      m.a === "p" ? R.place(T, m.i, [m.x, m.y]) : m.a === "d" ? R.discard(T, m.i) : m.a === "l" ? R.lock(T, [m.x, m.y]) : R.end(T) }
    ok(`a whole run of random legal moves with trees (${name}): it ends, trees overgrew other kinds, none was put on bare ground, a locked tile or another level, the score is the sum of the moves, and it replays from its seed`,
      S.over && guard < 4000 && grew > 0 && grew === S.overgrown && wrong === 0 && !S.log.some(e => e.did === "plant" && e.t.b === "t") && S.planted + S.combined + S.extended + S.widened + S.discarded === S.used && S.log.reduce((s, e) => s + e.pts, 0) === S.score && same(S, R.replay(cfg, 12, S.moves)));
    const first = S.log.find(e => e.did === "overgrow");
    ok(`trees (${name}): undo steps back over an overgrow (the tile has its old kind and level again), and a reload brings the tree back`, !!first && (() => { const k = R.key(first.at), withIt = R.replay(cfg, 12, S.moves.slice(0, first.n)), without = R.replay(cfg, 12, S.moves.slice(0, first.n - 1));
        return without.h[k] === first.l - 1 && (without.hb[k] || "") === first.from && withIt.h[k] === first.l && withIt.hb[k] === "t" && same(withIt, R.replay(cfg, 12, S.moves.slice(0, first.n))) })() && /overgrew the (green|prairie|marsh) tile at \d+,\d+, now level \d+ Trees/.test(R.logText(S))) }
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) { const bad = []; let dropped = 0; for (let s = 1; s <= 8; s++) { const a = play(cfgWith({...mode, treeShare:.6, lockEvery:0, stackSize:20}), s); if (a.error || !a.S.over) bad.push(s); else dropped += a.S.log.filter(e => e.did === "discard" && e.t && e.t.b === "t").length }
    ok(`the simple player ends every run with trees in the pile (${name}): it discards a tree that has nothing to grow over instead of getting stuck`, bad.length === 0 && dropped > 0) }

  // ----- upgrades: the marsh's reed bed (LOU-303, LOU-304; Dan, Nov 20: "Make it level 4", "Let's make it an upgrade...and then also should it be an aesthetic difference as well?", "There's no need for
  // protection...it's not a combat game"). A marsh habitat of upgradeLevel or higher is a reed bed: marsh can be planted on empty land that touches it, as if it were river bank. It is derived from
  // the tile's kind and level, so nothing is stored and no move is added. REF has upgradeLevel 0 (no upgrades), so every check above is about the game as it was.
  const UP = {upgradeLevel:4}, MN = "Marsh needs a tile next to the river or a reed bed.";
  const legalMarsh = S => { const out = []; S.cfg.map.forEach((row, y) => [...row].forEach((ch, x) => { const k = x + "," + y; if (ch !== "_" || k in S.h || k in S.r) return;   // what the rule says, worked out from the board alone
      if (R.nbrs(S.cfg, [x, y]).some(q => { const j = R.key(q); return j in S.r || (S.cfg.upgradeLevel > 0 && S.hb[j] === "m" && S.h[j] >= S.cfg.upgradeLevel) })) out.push(k) })); return out.sort().join(" ") };
  const plants = S => R.options(S, 0).filter(o => o.does === "plant").map(o => o.p + "").sort().join(" ");
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) {
    { const S = setup({"8,4":4}, {}, {...mode, ...MR, ...UP, opening:["marsh 1", "marsh 1", "marsh 1"]}); S.hb["8,4"] = "m";
      ok(`reed bed (${name}): a marsh tile of level 4 lets marsh be planted on empty land touching it, as if it were river bank, and the preview shows every legal tile`,
        ["9,4", "8,3", "7,3", "7,5", "8,5"].every(k => does(S, R.unkey(k)) === "plant") && does(S, E) === "plant" && plants(S) === legalMarsh(S) && R.reedBedAt(S, "8,4") && R.upgradeOf(S.cfg, {k:"h", b:"m", l:4}) === "reed");
      ok(`reed bed (${name}): it opens ground one tile further inland and no more: land two tiles from it is refused, with the toast in plain words`, does(S, [10, 4]) === undefined && does(S, [9, 3]) === undefined && R.place(S, 0, [10, 4]) === null && R.why(S, 0, [10, 4]) === MN) }
    { const S = setup({"8,4":3}, {}, {...mode, ...MR, ...UP, opening:["marsh 1"]}); S.hb["8,4"] = "m";
      ok(`reed bed (${name}): a marsh tile of level 3 is no reed bed: marsh still plants only next to a river tile, and nowhere else`, !R.reedBedAt(S, "8,4") && R.upgradeOf(S.cfg, {k:"h", b:"m", l:3}) === "" && plants(S) === legalMarsh(S) && plants(S).split(" ").length === 6 && does(S, [9, 4]) === undefined && R.why(S, 0, [9, 4]) === MN) }
    { const S = setup({"8,4":4}, {}, {...mode, ...MR, ...UP, opening:["marsh 1", "marsh 3"]}); S.hb["8,4"] = "m"; const a = R.place(S, 0, [9, 4]);
      ok(`reed bed (${name}): a marsh tile planted next to a reed bed lands as level 1 and scores 1`, a && a.does === "plant" && a.l === 1 && a.pts === 1 && S.h["9,4"] === 1 && S.hb["9,4"] === "m" && S.planted === 1 && !R.reedBedAt(S, "9,4"));
      if (name === "refuse") ok("reed bed (refuse): a level 3 marsh tile can't be planted next to it, and the toast says what to do", R.options(S, 0).filter(o => o.does === "plant").length === 0 && R.place(S, 0, [8, 3]) === null && R.why(S, 0, [8, 3]) === NO);
      else ok("reed bed (downgrade): a level 3 marsh tile is planted next to it as a level 1 marsh habitat", does(S, [8, 3]) === "plant" && (b => b && b.l === 1 && b.pts === 1 && S.h["8,3"] === 1 && S.hb["8,3"] === "m")(R.place(S, 0, [8, 3]))) }
    { const S = setup({"8,4":4}, {}, {...mode, ...MR, ...UP, opening:["marsh 1", "trees 4", "marsh 1"]}); S.hb["8,4"] = "m"; const near = does(S, [8, 3]) === "plant"; R.place(S, 0, [9, 4]); R.place(S, 0, [8, 4]);   // marsh beside the reed bed, then a level 4 tree grows over the reed bed
      ok(`reed bed (${name}): a reed bed is lost when a tree overgrows it: marsh no longer plants next to it, the marsh planted there before stays, and the river bank still works`,
        near && S.hb["8,4"] === "t" && S.h["8,4"] === 5 && !R.reedBedAt(S, "8,4") && R.upgradeOf(S.cfg, {k:"h", b:"t", l:5}) === "" && S.hb["9,4"] === "m" && does(S, [8, 3]) === undefined && does(S, E) === "plant" && plants(S) === legalMarsh(S)) }
    { const S = setup({"8,4":4, "9,4":5}, {}, {...mode, ...MR, ...UP, lockCopiesGo:"front", lockEvery:0, opening:["marsh 1", "marsh 1"]}); S.hb["8,4"] = "m"; R.lock(S, [9, 4]);   // the level 5 green habitat copies the level 4 marsh beside it
      const copy = S.q[1]; R.place(S, 0, E);
      ok(`reed bed (${name}): a lock copy of a reed bed is still level 4 marsh, so it is still one, and it combines onto the original: level 5 is a reed bed too`,
        same(copy, {k:"h", l:4, c:1, b:"m"}) && R.upgradeOf(S.cfg, copy) === "reed" && S.q[0].c === 1 && does(S, [8, 4]) === "combine" && (b => b && S.h["8,4"] === 5 && R.reedBedAt(S, "8,4") && does(S, [8, 3]) === "plant")(R.place(S, 0, [8, 4]))) }
    { const S = setup({"8,4":4}, {}, {...mode, ...MR, ...UP, opening:["marsh 1"]}); S.hb["8,4"] = "m"; S.lk["8,4"] = 1;
      ok(`reed bed (${name}): a locked reed bed still counts, as a locked river tile does`, R.reedBedAt(S, "8,4") && does(S, [9, 4]) === "plant" && plants(S) === legalMarsh(S)) }
    { const S = setup({"8,4":4, "8,6":4, "6,2":4}, {}, {...mode, ...MR, ...UP, opening:["marsh 1"]}); S.hb["8,6"] = "p"; S.hb["6,2"] = "t";   // a green, a prairie and a trees habitat of level 4
      ok(`reed bed (${name}): green, prairie and trees gain nothing at level 4: marsh still plants only next to the river`, plants(S) === legalMarsh(S) && plants(S).split(" ").length === 6 && [null, "p", "t"].every(b => R.upgradeOf(S.cfg, {k:"h", l:4, ...(b ? {b} : {})}) === "") && R.upgradeOf(S.cfg, {k:"r", l:9}) === "") }
  }
  { const S = setup({"8,4":4}, {}, {...MR, upgradeLevel:0, opening:["marsh 1"]}); S.hb["8,4"] = "m";
    ok("with the upgrade level 0 there is no reed bed: marsh next to a level 4 marsh habitat is refused, with the old toast", !R.reedBedAt(S, "8,4") && R.upgradeOf(S.cfg, {k:"h", b:"m", l:4}) === "" && does(S, [9, 4]) === undefined && R.why(S, 0, [9, 4]) === "Marsh needs a tile next to the river.") }
  { const S = setup({"8,4":3}, {}, {...MR, upgradeLevel:3, opening:["marsh 1"]}), T3 = setup({"8,4":2}, {}, {...MR, upgradeLevel:3, opening:["marsh 1"]}); S.hb["8,4"] = "m"; T3.hb["8,4"] = "m";
    ok("the upgrade level is the config's: with 3, a level 3 marsh habitat is a reed bed and a level 2 one is not", R.reedBedAt(S, "8,4") && does(S, [9, 4]) === "plant" && !R.reedBedAt(T3, "8,4") && does(T3, [9, 4]) === undefined) }
  { const S = setup({"8,4":4}, {}, {marshNeedsRiver:false, ...UP, opening:["marsh 1"]}); S.hb["8,4"] = "m";
    ok("with marsh not needing the river, the reed bed changes nothing: marsh plants wherever green does", does(S, [9, 4]) === undefined && does(S, E) === "plant" && R.why(S, 0, [9, 4]) === "Too far from the river.") }
  { const t = R.tidy({...REF, upgradeLevel:25}, REF), u = R.tidy({...REF, upgradeLevel:"x"}, REF), v = R.tidy({...REF, upgradeLevel:-1}, REF);
    ok("a bad upgrade level is refused and the old value stands", same(t.bad, ["upgradeLevel"]) && t.cfg.upgradeLevel === 0 && same(u.bad, ["upgradeLevel"]) && same(v.bad, ["upgradeLevel"])) }
  ok("the ruleset key changes with the upgrade level", R.rulesKey(cfgWith({upgradeLevel:4})) !== R.rulesKey(REF) && R.rulesKey(cfgWith({upgradeLevel:3})) !== R.rulesKey(cfgWith({upgradeLevel:4})));
  ok("the config file has upgrades at level 4 (Dan, Nov 20: \"Make it level 4\")", BASE.upgradeLevel === 4 && R.UPGRADE.reed.line === "Reed bed: marsh can grow one tile further inland");
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) { let wrong = 0, via = 0, marshPlanted = 0, ends = 0, replays = 0, sums = 0, made = null, madeCfg = null;   // six seeded runs of random legal moves, upgrade level 2 so that a random run makes reed beds: two marsh tiles of level 1 combine into one
    for (const sd of [21, 22, 23, 24, 25, 26]) { const cfg = cfgWith({...mode, ...MR, upgradeLevel:2, marshShare:.6, prairieShare:.2, treeShare:.1, opening:["marsh 1", "marsh 1", "habitat 1", "river", "marsh 1"], lockEvery:0, stackSize:40, riverShare:.1}), S = R.fresh(cfg, sd);
      let z = 17 + sd, guard = 0; const rn = () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      while (!S.over && guard++ < 4000) { if (!S.q.length) { const lk = [...Object.keys(S.h), ...Object.keys(S.r)].map(R.unkey).find(p => R.lockable(S, p) && R.copiesOf(S, p).copies.length); if (!lk) { R.end(S); break } R.lock(S, lk); continue }
        const o = R.options(S, 0); if (!o.length || rn() < .08) { R.discard(S, 0); continue } R.place(S, 0, o[Math.floor(rn() * o.length)].p) }
      const T = R.fresh(cfg, sd);   // every marsh planting touches a river tile or a reed bed at the moment it is made
      for (const m of S.moves) { if (m.a === "p") { const t = T.q[m.i], k = m.x + "," + m.y; if (t.k === "h" && t.b === "m" && !(k in T.h)) { marshPlanted++; const nb = R.nbrs(cfg, [m.x, m.y]).map(R.key), river = nb.some(q => q in T.r), reed = nb.some(q => T.hb[q] === "m" && T.h[q] >= 2); if (!river && !reed) wrong++; if (!river && reed) via++ } }
        m.a === "p" ? R.place(T, m.i, [m.x, m.y]) : m.a === "d" ? R.discard(T, m.i) : m.a === "l" ? R.lock(T, [m.x, m.y]) : R.end(T) }
      if (S.over && guard < 4000) ends++; if (same(S, R.replay(cfg, sd, S.moves))) replays++; if (S.planted + S.combined + S.extended + S.widened + S.discarded === S.used) sums++;
      const e = !made && S.log.find(e => e.did === "combine" && e.t.b === "m" && e.l === 2); if (e) made = {e, sd, moves:S.moves}, madeCfg = cfg }
    ok(`a whole run of random legal moves with reed beds (${name}): six runs end and replay from their seeds, every marsh planting touched a river tile or a reed bed, and some touched only a reed bed`, ends === 6 && replays === 6 && sums === 6 && wrong === 0 && marshPlanted > 0 && via > 0);
    const k = made && R.key(made.e.at);
    ok(`reed bed (${name}): undo steps back over the move that made one (nothing was stored: it was only the tile's level), and a reload brings it back`, !!made && R.reedBedAt(R.replay(madeCfg, made.sd, made.moves.slice(0, made.e.n)), k) && !R.reedBedAt(R.replay(madeCfg, made.sd, made.moves.slice(0, made.e.n - 1)), k) && same(R.replay(madeCfg, made.sd, made.moves.slice(0, made.e.n)), R.replay(madeCfg, made.sd, made.moves.slice(0, made.e.n)))) }
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) { const bad = []; let via = 0; for (let s = 1; s <= 8; s++) { const a = play(cfgWith({...mode, ...MR, upgradeLevel:2, marshShare:.6, lockEvery:0, stackSize:20}), s); if (a.error || !a.S.over) bad.push(s); else via += a.m.reedPlanted }
    ok(`the simple player ends every run with reed beds (${name}), and uses them`, bad.length === 0 && via > 0) }

  for (const f of fails) console.log("FAILED: " + f);
  console.log(fails.length ? `${fails.length} of ${n} rule checks failed` : `all ${n} rule checks passed`);
  if (fails.length) process.exitCode = 1 }

// ---------- command line
const args = process.argv.slice(2);
if (args.includes("--test")) checks();
else { let runs = 1000; const over = {};
  for (const a of args) { if (/^\d+$/.test(a)) runs = +a; else { const m = /^([A-Za-z]+)=(.*)$/.exec(a); if (!m || !R.KEYS.some(k => k[0] === m[1])) { console.error(`Unknown setting: ${a}. Use key=value with one of: ${R.KEYS.map(k => k[0]).join(", ")}`); process.exit(1) } over[m[1]] = m[2] } }
  const t = R.tidy({...BASE, ...over}, BASE); if (t.bad.length) { console.error("Refused: " + t.bad.join(", ")); process.exit(1) }
  if (!t.cfg.stackSize) { console.error("The simulator needs a run that ends: stackSize can't be 0 here."); process.exit(1) }
  report(t.cfg, runs) }
