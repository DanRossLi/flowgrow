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
// The simple player combines when it can, otherwise takes over green (LOU-307, with the switch on), otherwise plants, and uses each river tile where it opens the most land.
// No run may crash or stall, and every run must rebuild exactly from its seed and moves.
import fs from "fs"; import path from "path"; import {fileURLToPath} from "url"; import {spawnSync} from "child_process";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------- the game's rules, loaded as they are
function load() { const window = {FLOWGROW_SIM:true};
  for (const f of ["flowgrow.config.js", "flowgrow.js"]) new Function("window", fs.readFileSync(path.join(ROOT, f), "utf8"))(window);
  return {R:window.Flowgrow.rules, base:window.FLOWGROW} }
const {R, base} = load();
const BASE = R.tidy(base).cfg;
const GREEN = process.argv.includes("--green");   // print the report's green-on-the-map line even with the green takeover off (LOU-307), to compare with it on
// The rule checks are written for these values, the first build's, so tuning flowgrow.config.js never breaks them (the pilot pile, for one,
// changes the pile; bare ground takes any level, and the bare ground rule is checked on its own below). The report and the command line use the config file as it is.
const REF = (() => { const t = R.tidy({...base, map:["_____________", "_BB__________", "__B_______B__", "__________BB_", "______T______", "_____________", "___BB________", "_____________", "_____________"],
  stackSize:80, queueShown:3, pickFrom:1, riverShare:.1, opening:["habitat 1", "habitat 1", "river"], maxLevel:7, levelOdds:.5, scoreByLevel:[1, 3, 6, 10, 15, 21, 28], riverReach:[1, 2], riverMonotone:false, riverRaiseGuard:false, bareGroundMaxLevel:24, bareGroundMode:"refuse", prairieShare:0, marshShare:0, biomeMatch:true, marshNeedsRiver:false, marshRiverMultiplier:false, marshRiverRamp:[1, 2, 3, 4, 5, 6], elevation:false, elevationLevels:3, elevationShape:"foothills", stepAdjacency:"score", prairieSpreads:false, treeShare:0, upgradeLevel:0, riverMaxLevel:2, riverScore:"none",
  levelNames:["Sprouts", "Meadow", "Thicket", "Saplings", "Grove", "Forest", "Old forest"], lockEnabled:true, lockLevelCap:true, lockCopiesGo:"back", lockRivers:true, lockEvery:10, lockHold:1}, base);
  if (t.bad.length) throw new Error("bad reference config: " + t.bad); return t.cfg })();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- the simple player: one turn
// The tile a lock would bank the most copies from (the first one, on a tie).
function bestLock(S) { let best = null, n = -1;
  for (const k of [...Object.keys(S.h), ...Object.keys(S.r)]) { const p = R.unkey(k); if (!R.lockable(S, p)) continue; const c = R.copiesOf(S, p).copies.length; if (c > n) { n = c; best = p } }
  return best ? {p:best, n} : null }
const PICKIDX = {p:0, t:0};   // which of a kind's two upgrades the simple player picks: the first (steppe, roots) unless picks=meadow,pine says otherwise on the command line
function turn(S) { const c = S.cfg;
  if (S.pend.length) { const k = S.pend[0], kind = S.hb[k] || ""; return R.pick(S, k, R.PICKS[kind][PICKIDX[kind]]) }   // a pick to make (LOU-305): the fixed choice
  if (c.lockEnabled) { const b = R.hasLock(S) ? bestLock(S) : null;
    if (!S.q.length) return b && b.n > 0 ? R.lock(S, b.p) : R.end(S);                            // the pile is empty: lock while that banks a copy
    if (b && b.n > 0 && c.lockEvery > 0 && S.toLock === c.lockEvery - 1) return R.lock(S, b.p) } // use each lock just before the next one arrives
  const opts = R.options(S, 0), t = S.q[0]; if (!opts.length) return R.discard(S, 0);
  let o = null;
  if (t.k === "h") o = opts.find(x => x.does === "combine") || opts.find(x => x.does === "takeover") || opts[0];      // combine when it can, otherwise take over green (LOU-307: only with the switch on), otherwise plant
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
    while (!S.over) { if (++n > cap) { out.error = "stalled"; break } if (S.q.length && R.plantable(S).length <= 2) out.tight++; const pre = S.q.length && !S.pend.length ? watch(S) : null, res = turn(S); if (!res) { out.error = "a move was refused"; break } if (pre) tally(out.m, pre, res) }
    if (!out.error && !same(S, R.replay(cfg, seed, S.moves))) out.error = "did not rebuild from its seed and moves";
  } catch (e) { out.error = "crashed: " + (e && e.message || e) }
  return out }

// What the prairie and tree upgrades did in a run (LOU-305, LOU-306), worked out by replaying its moves: the level-ups of steppe, meadow and roots tiles, the free tiles a steppe (or a lifted steppe) planted, what a
// meadow's multiplier added, the tiles roots lifted, the longest chain and the most points one move scored, and the trees planted beside a pine-oneer (outside the river's reach: inside it a tree plants like green).
function upStats(cfg, S) { const T = R.fresh(cfg, S.seed), o = {steppeUps:0, meadowUps:0, meadowExtra:0, meadowCap:0, rootsUps:0, lifted:0, chainMax:0, chainPts:0, maxMove:0, pineTrees:0, free:0};
  for (const m of S.moves) { if (m.a === "p") { const t = T.q[m.i], up = T.hf[m.x + "," + m.y], past = !!t && t.b === "t" && !R.reachOf(T).has(m.x + "," + m.y), r = R.place(T, m.i, [m.x, m.y]);
      if (r.does === "combine") { if (up === "steppe") o.steppeUps++; if (up === "roots") o.rootsUps++; if (up === "meadow") { o.meadowUps++; if (r.mult > 1) { o.meadowExtra += r.pts - r.pts / r.mult; if (r.mult === cfg.meadowMax) o.meadowCap++ } } }
      o.free += r.free.length; if (r.lifts.length) { o.lifted += r.lifts.length; o.chainMax = Math.max(o.chainMax, r.lifts.length); o.chainPts += r.liftPts; o.maxMove = Math.max(o.maxMove, r.pts) }
      if (r.does === "plant" && past) o.pineTrees++ }
    else m.a === "d" ? R.discard(T, m.i) : m.a === "l" ? R.lock(T, [m.x, m.y]) : m.a === "u" ? R.pick(T, m.x + "," + m.y, m.f) : R.end(T) }
  return o }
// What the green takeover did in a run (LOU-307), worked out by replaying its moves: the takeovers (by kind, from lock copies, and the points they scored) and how many green habitats were on the map at the middle of the run
// (after half of its moves) and at the end of it.
function takeStats(cfg, S) { const T = R.fresh(cfg, S.seed), o = {n:0, pts:0, copies:0, copyPts:0, big:0, kind:{m:0, p:0, t:0}, mid:-1, end:0}, half = Math.floor(S.moves.length / 2), green = () => Object.keys(T.h).filter(k => !T.hb[k]).length;
  for (const m of S.moves) { if (m.a === "p") { const t = T.q[m.i], r = R.place(T, m.i, [m.x, m.y]); if (r.does === "takeover") { o.n++; o.pts += r.pts; o.big = Math.max(o.big, r.pts); o.kind[t.b]++; if (t.c) { o.copies++; o.copyPts += r.pts } } }
    else m.a === "d" ? R.discard(T, m.i) : m.a === "l" ? R.lock(T, [m.x, m.y]) : m.a === "u" ? R.pick(T, m.x + "," + m.y, m.f) : R.end(T);
    if (o.mid < 0 && T.moves.length >= half) o.mid = green() }
  o.end = green(); if (o.mid < 0) o.mid = o.end; return o }
// What the marsh river multiplier did in a run (LOU-309), worked out by replaying its moves: every score a marsh tile earned (planted, combined onto, lifted by roots) by its multiplier, the points
// from marsh, the largest single marsh score, and the points each marsh tile earned over the run (the most one tile earned says whether a marsh tile became a farm).
function marshStats(cfg, S) { const T = R.fresh(cfg, S.seed), o = {b:{}, pts:0, big:0, tile:{}};   // b: how many marsh scores had each multiplier (keyed by the multiplier: the ramp can have halves)
  const add = (k, m, p) => { o.b[m] = (o.b[m] || 0) + 1; o.pts += p; o.big = Math.max(o.big, p); o.tile[k] = (o.tile[k] || 0) + p };
  for (const m of S.moves) { if (m.a === "p") { const t = T.q[m.i], kk = m.x + "," + m.y, was = T.hb[kk], r = R.place(T, m.i, [m.x, m.y]);
      if (r.does === "plant" && t.b === "m") add(kk, r.mult || 1, r.pts); else if (r.does === "combine" && was === "m") add(kk, r.mult || 1, r.pts);
      for (const L of r.lifts) if (T.hb[L.k] === "m") add(L.k, R.marshMult(T, L.k), L.pts) }   // the river doesn't change in a move, so the multiplier now is the one the lift was paid (a tile can rise twice in one move, so the points can't be divided back)
    else m.a === "d" ? R.discard(T, m.i) : m.a === "l" ? R.lock(T, [m.x, m.y]) : m.a === "u" ? R.pick(T, m.x + "," + m.y, m.f) : R.end(T) }
  return o }

// What elevation did in a run (LOU-310), worked out by replaying its moves: how many of the Meadow's level-ups there were and how many multipliers a step lowered (the multiplier it would have had if steps didn't count).
function elevStats(cfg, S) { const T = R.fresh(cfg, S.seed), o = {meadowUps:0, lowered:0};
  for (const m of S.moves) { if (m.a === "p") { const kk = m.x + "," + m.y, up = T.hf[kk], t = T.q[m.i]; let n0 = 0; for (const q of R.nbrs(cfg, [m.x, m.y]).map(R.key)) if (T.hb[q] === "m" || T.hb[q] === "t") n0++;
      const r = R.place(T, m.i, [m.x, m.y]); if (r.does === "combine" && up === "meadow") { o.meadowUps++; if ((r.mult || 1) < Math.min(cfg.meadowMax, 1 + n0)) o.lowered++ } }
    else m.a === "d" ? R.discard(T, m.i) : m.a === "l" ? R.lock(T, [m.x, m.y]) : m.a === "u" ? R.pick(T, m.x + "," + m.y, m.f) : R.end(T) }
  return o }
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
  const trees = cfg.treeShare > 0;   // trees (LOU-302) are dealt: the report says what they did (with treeShare 0 it is as it was)
  console.log(`  habitats on the map  ${f1(avg(ok.map(r => r.hab)))} (planted ${f1(avg(S.map(s => s.planted)))}, combined ${f1(avg(S.map(s => s.combined)))})`);
  if (cfg.prairieShare + cfg.marshShare > 0 || trees) console.log(`  kinds on the map     ${f1(avg(S.map(s => Object.keys(s.h).filter(k => !s.hb[k]).length)))} green · ${f1(avg(S.map(s => Object.values(s.hb).filter(b => b === "p").length)))} prairie · ${f1(avg(S.map(s => Object.values(s.hb).filter(b => b === "m").length)))} marsh${trees ? ` · ${f1(avg(S.map(s => Object.values(s.hb).filter(b => b === "t").length)))} trees` : ""} habitats at the end`);
  if (cfg.greenTakeover || GREEN) { const Q = S.map(s => takeStats(cfg, s));   // the green takeover (LOU-307): with it on, what it did; --green prints the green line with it off too, for the comparison
    if (cfg.greenTakeover) console.log(`  green takeover       ${f2(avg(Q.map(q => q.n)))} takeovers a run (${f2(avg(Q.map(q => q.kind.m)))} marsh, ${f2(avg(Q.map(q => q.kind.p)))} prairie, ${f2(avg(Q.map(q => q.kind.t)))} trees; ${f2(avg(Q.map(q => q.copies)))} with lock copies) · none in ${share(Q, q => q.n === 0)} of runs · at most ${Math.max(...Q.map(q => q.n))} in a run · ${f1(avg(Q.map(q => q.pts)))} points from them (${Math.round(100 * sum(Q.map(q => q.pts)) / Math.max(1, sum(S.map(s => s.score))))}% of the score; ${f1(avg(Q.map(q => q.copyPts)))} from lock copies) · the most one scored ${Math.max(...Q.map(q => q.big))}`);
    console.log(`  green on the map     ${f1(avg(Q.map(q => q.mid)))} green habitats at the middle of a run (after half its moves) · ${f1(avg(Q.map(q => q.end)))} at the end`) }
  console.log(`  river tiles          ${f1(avg(ok.map(r => r.riv)))} with the source (extended ${f1(avg(S.map(s => s.extended)))}, widened ${f1(avg(S.map(s => s.widened)))})`);
  if (cfg.riverMaxLevel > cfg.riverReach.length) console.log(`  river levels         the river rises to level ${f1(avg(ok.map(r => Math.max(...Object.values(r.S.r).map(v => v.l)))))} on average (${f1(avg(S.map(s => s.log.filter(e => e.did === "widen" && e.l > cfg.riverReach.length).length)))} level-ups past the widest)${cfg.riverScore === "none" ? "" : `, ${f1(avg(S.map(s => s.log.reduce((n, e) => n + (e.did === "widen" || e.did === "extend" ? e.pts : 0), 0))))} points from river moves`}`);
  console.log(`  discards             ${f2(avg(S.map(s => s.discarded)))} a run · at least one in ${share(S, s => s.discarded > 0)} of runs`);
  console.log(`  tight turns          ${f1(avg(ok.map(r => r.tight)))} a run with 2 or fewer plantable tiles · ${f1(avg(ok.map(r => r.room)))} plantable tiles left at the end`);
  if (cfg.marshNeedsRiver || cfg.prairieSpreads) { const M = ok.map(r => r.m), land = cfg.map.join("").split("_").length - 1, empty = ok.map(r => land - r.hab - (r.riv - 1));   // the plant rules of LOU-301 are on: say what they do
    console.log(`  marsh                ${f1(avg(M.map(m => m.marshTurns)))} marsh tiles in hand a run · nothing to plant it on in ${f1(100 * sum(M.map(m => m.marshNoBank)) / Math.max(1, sum(M.map(m => m.marshTurns))))}% of those turns · ${f2(avg(S.map(s => s.log.filter(e => e.did === "discard" && e.t && e.t.b === "m").length)))} marsh tiles discarded a run`);
    console.log(`  prairie spread       ${f1(avg(M.map(m => m.prairieTurns)))} prairie tiles in hand a run · planted beyond the river's reach ${f2(avg(M.map(m => m.spreadPlanted)))} times a run · ${f1(sum(M.map(m => m.spreadOffered)) / Math.max(1, sum(M.map(m => m.prairieTurns))))} extra tiles offered per prairie tile in hand`);
    console.log(`  island               ${f1(avg(empty))} of ${land} land cells empty at the end (${f1(avg(ok.map(r => r.room)))} of them within the river's reach)`) }
  if (trees) { const M = ok.map(r => r.m);   // what trees did (LOU-302, LOU-314): how often one had no legal spot, and how many were discarded
    console.log(`  trees                ${f1(avg(M.map(m => m.treeTurns)))} tree tiles in hand a run (${f1(avg(M.map(m => m.treeCopyTurns)))} of them copies) · no legal spot in ${f1(100 * sum(M.map(m => m.treeNoTarget)) / Math.max(1, sum(M.map(m => m.treeTurns))))}% of those turns · ${f2(avg(S.map(s => s.log.filter(e => e.did === "discard" && e.t && e.t.b === "t").length)))} tree tiles discarded a run`) }
  if (cfg.upgradeLevel > 0 && cfg.marshShare > 0) { const M = ok.map(r => r.m), up = cfg.upgradeLevel, reach = s => s.log.filter(e => e.t && e.t.b === "m" && ((e.did === "combine" && e.l === up) || (e.did === "plant" && e.l >= up))).length;   // upgrades (LOU-304): how often a marsh tile reaches the upgrade level, and how often the reed bed is used
    console.log(`  reed beds            ${f2(avg(S.map(reach)))} marsh tiles reach level ${up} a run (in ${share(S, s => reach(s) > 0)} of runs) · ${f1(avg(S.map(s => Object.keys(s.h).filter(k => s.hb[k] === "m" && s.h[k] >= up).length)))} reed beds on the map at the end · ${f1(avg(M.map(m => m.marshPlanted)))} marsh planted a run, ${f2(avg(M.map(m => m.reedPlanted)))} of them only because of a reed bed (${f2(avg(M.map(m => m.reedRescued)))} marsh tiles a run had no other place to plant)`) }
  if (cfg.marshRiverMultiplier && cfg.marshShare > 0) { const Q = S.map(s => marshStats(cfg, s)), steps = [...new Set([1, ...cfg.marshRiverRamp])].sort((x, y) => x - y), b = v => f2(avg(Q.map(q => q.b[v] || 0))), best = q => Math.max(0, ...Object.values(q.tile));   // the marsh river multiplier (LOU-309) is on: how the multipliers are spread (one bucket for each number in the ramp), and what marsh earns
    console.log(`  marsh multiplier     ${f1(avg(Q.map(q => sum(Object.values(q.b)))))} marsh scores a run: ${steps.map(v => `x${v} ${b(v)}`).join(" · ")} · ${f1(avg(Q.map(q => q.pts)))} points from marsh (${Math.round(100 * sum(Q.map(q => q.pts)) / Math.max(1, sum(sc)))}% of the score) · the most one marsh tile earned in a run: ${f1(avg(Q.map(best)))} on average, ${Math.max(0, ...Q.map(best))} at most · the largest single marsh score ${Math.max(0, ...Q.map(q => q.big))}`) }
  if (cfg.elevation) { const Q = S.map(s => elevStats(cfg, s)), riv = S.map(s => Object.keys(s.r).length), fall = S.map(s => Object.keys(s.r).filter(k => R.fallAt(s, k)).length), rd = S.map(s => s.log.filter(e => e.did === "discard" && e.t && e.t.k === "r").length),
      handled = S.map((s, i) => s.extended + s.widened + rd[i]);   // elevation (LOU-310) is on: the river's waterfalls and length, the river tiles that had no legal cell and were discarded, and the Meadow multipliers a step lowered
    console.log(`  elevation            ${cfg.elevationShape}, ${cfg.elevationLevels} levels, step rule ${cfg.stepAdjacency}: ${f1(avg(fall))} waterfalls on a river of ${f1(avg(riv))} tiles · ${f2(avg(rd))} river tiles discarded a run with no legal cell (${f1(100 * sum(rd) / Math.max(1, sum(handled)))}% of the river tiles handled, in ${share(rd, v => v > 0)} of runs) · Meadow: ${f2(avg(Q.map(q => q.meadowUps)))} level-ups a run, ${f2(avg(Q.map(q => q.lowered)))} multipliers lowered by a step`) }
  if (cfg.upgradeLevel > 0 && (cfg.prairieShare > 0 || cfg.treeShare > 0)) { const U = S.map(s => upStats(cfg, s)), up = cfg.upgradeLevel, n = b => f2(avg(S.map(s => s.log.filter(e => e.did === "pick" && e.t.b === b).length))), any = b => share(S, s => s.log.some(e => e.did === "pick" && e.t.b === b)),
      pk = (b, f) => f2(avg(S.map(s => s.log.filter(e => e.did === "pick" && e.t.b === b && e.f === f).length)));   // the prairie and tree upgrades (LOU-305, LOU-306): how often level 4 is reached, how the picks go, what each upgrade added
    if (cfg.prairieShare > 0) console.log(`  prairie upgrades     ${n("p")} prairie tiles reach level ${up} a run (in ${any("p")} of runs) · picks ${pk("p", "steppe")} steppe, ${pk("p", "meadow")} meadow a run · steppe: ${f2(avg(U.map(u => u.steppeUps)))} level-ups a run, ${f2(avg(U.map(u => u.free)))} free tiles planted (as many points) · meadow: ${f2(avg(U.map(u => u.meadowUps)))} level-ups a run, ${f2(avg(U.map(u => u.meadowExtra)))} extra points from the multiplier, at the cap ${f2(avg(U.map(u => u.meadowCap)))} times a run`);
    if (cfg.treeShare > 0) console.log(`  tree upgrades        ${n("t")} tree tiles reach level ${up} a run (in ${any("t")} of runs) · picks ${pk("t", "roots")} roots, ${pk("t", "pine")} pine-oneer a run · roots: ${f2(avg(U.map(u => u.rootsUps)))} level-ups a run lifting ${f2(avg(U.map(u => u.lifted)))} tiles for ${f1(avg(U.map(u => u.chainPts)))} points (longest chain ${Math.max(0, ...U.map(u => u.chainMax))} tiles, most points in one move ${Math.max(0, ...U.map(u => u.maxMove))}) · ${f2(avg(U.map(u => u.pineTrees)))} trees planted beside a pine-oneer a run`) }
  if (cfg.lockEnabled) {
    console.log(`  moves                ${f1(avg(S.map(s => s.moves.length)))} a run`);
    console.log(`  locks                ${f1(avg(S.map(s => s.lockUsed)))} used · ${f1(avg(S.map(s => s.lockLost)))} lost · ${f1(avg(S.map(s => Object.keys(s.lk).length)))} tiles locked at the end`);
    console.log(`  copies               ${f1(avg(S.map(s => s.copyBanked)))} banked · ${f1(avg(S.map(s => s.copyPlaced)))} placed · ${f2(avg(S.map(s => s.copyDiscarded)))} discarded · ${f1(avg(S.map(s => s.copyPoints)))} points from copies`);
    if (bare) console.log(`  copies placed        ${f1(avg(S.map(s => copiesBy(s, "plant"))))} planted on bare ground${cfg.bareGroundMode === "downgrade" ? ` (${f1(avg(S.map(copiesDown)))} of them as level 1)` : ""} · ${f1(avg(S.map(s => copiesBy(s, "combine"))))} combined · ${f1(avg(S.map(s => copiesBy(s, "extend") + copiesBy(s, "widen"))))} river tiles · ${f2(avg(S.map(s => s.copyDiscarded)))} discarded`) }
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
  // The opening trap (Nov 21; Dan: "fix the opening trap"): four river tiles open a run, and raising the source with the first strands the other three, because a level 1 river tile can't be
  // lower than the source it would flow from. riverRaiseGuard (on) doesn't offer a raise that would leave a river tile waiting in the pile with no legal move.
  { const G = {riverRaiseGuard:true, riverMonotone:true, stackSize:5, queueShown:3}, OPEN = ["river", "river", "river", "river", "habitat 1"], S = run(OPEN, G), O = run(OPEN, {...G, riverRaiseGuard:false});
    ok("trap: with three more river tiles waiting, the first can't raise the source (and the six extends are all there)", !R.options(S, 0).some(o => o.does === "widen") && R.options(S, 0).filter(o => o.does === "extend").length === 6 && does(S, E) === "extend");
    ok("trap: tapping the source says to extend first", R.place(S, 0, SRC) === null && R.why(S, 0, SRC) === "Extend the river first: raising it now would leave your other river tiles nowhere to go.");
    ok("trap: with the guard off the raise is offered, and then the next river tile has no move at all", does(O, SRC) === "widen" && R.place(O, 0, SRC).does === "widen" && R.options(O, 0).length === 0 && R.why(O, 0, E) === "A river tile can't be lower than the one it flows from (level 2).");
    ok("trap: the guard takes nothing but the raise away", same(R.options(S, 0), R.options(run(OPEN, {...G, riverRaiseGuard:false}), 0).filter(o => o.does !== "widen")));
    for (const p of [[7, 4], [8, 4], [9, 4], [10, 4]]) R.place(S, 0, p);
    ok("trap: all four river tiles lay a stream of five tiles, with nothing discarded", Object.keys(S.r).length === 5 && S.extended === 4 && S.widened === 0 && S.discarded === 0 && S.q[0].k === "h");
    const D = run(OPEN, G); R.discard(D, 0); R.discard(D, 0); R.discard(D, 0);
    ok("trap: a player who wants the raise can still have it, by discarding the others first", does(D, SRC) === "widen" && R.place(D, 0, SRC).pts === 0 && riv(D, SRC).l === 2);
    const L = run(["river", "habitat 1"], {...G, stackSize:2}); ok("trap: with no other river tile waiting the source can be raised", does(L, SRC) === "widen");
    const M = run(["river", "river", "river"], {...G, stackSize:3}); R.place(M, 0, E); ok("trap: an end can be raised while the tiles waiting can still extend from the source", does(M, E) === "widen");
    const N = run(["river", "river", "river"], {...G, stackSize:3}); R.place(N, 0, E); R.place(N, 0, E);
    ok("trap: raising a tile leaves the river tile waiting a move, so the next one still goes on", riv(N, E).l === 2 && R.options(N, 0).some(o => o.does === "extend") && R.options(N, 0).length > 0) }
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
  ok("the config file asks for the pilot pile, grown to 20 tiles (Dan, Nov 20: expand starting tiles to 20) and then to 25 (Nov 22, LOU-318), with level odds 0", BASE.stackSize === 25 && BASE.levelOdds === 0);
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

  // ----- trees, deep green (LOU-302; Dan, Nov 20: "should we have a 'deep green' tile which is trees? And what special should this have?"). A tree is a habitat of a kind of its own (b "t"). Since LOU-314
  // (Dan, Nov 22: "create a ticket to remove the trees being 'planted over', just make trees a regular tile that needs addition") it is an ordinary habitat: it plants as level 1 on empty land within the
  // river's reach, like green (and beside a pine-oneer, even outside it), combines only with a tree of its own level and goes on nothing else, so no tile ever changes kind. REF deals no trees (treeShare 0)
  // and these set-ups write them into the opening, so every check above is about the game as it was.
  const TR = "Trees plant on open land in the river's reach.", TO = "Trees go on open land, or on a tree of the same level.", ROUND = Object.fromEntries(R.nbrs(REF, SRC).map(q => [R.key(q), 1]));   // ROUND: the six tiles round the source, all the land a level 1 river tile reaches
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) {
    { const S = run(["trees 1", "trees 1", "habitat 1", "habitat 1"], mode), a = R.place(S, 0, E);
      ok(`trees (${name}): a level 1 tree plants on empty land within reach, as a level 1 tree habitat that scores 1, like green`, a && a.does === "plant" && a.l === 1 && a.pts === 1 && S.h["7,4"] === 1 && S.hb["7,4"] === "t" && S.planted === 1 && S.score === 1 && S.top === 1 && S.combined === 0);
      ok(`trees (${name}): it goes on every empty tile within reach and nowhere else, and the toast says so`, same(R.options(S, 0).filter(o => o.does === "plant").map(o => o.p + "").sort(), R.plantable(S).slice().sort()) && R.plantable(S).length === 5 && does(S, FAR) === undefined && R.place(S, 0, FAR) === null && R.why(S, 0, FAR) === TR);
      ok(`trees (${name}): the run log says it was planted`, /^1\. Trees \(level 1\), dealt · planted at 7,4 · \+1 · score 1 · /m.test(R.logText(S))) }
    { const S = run(["trees 2", "trees 2"], mode);
      if (name === "refuse") ok("trees (refuse): a level 2 tree is refused on bare ground, with the bare ground toast, as green is", R.options(S, 0).length === 0 && R.place(S, 0, E) === null && R.why(S, 0, E) === NO && R.why(S, 0, FAR) === NO);
      else ok("trees (downgrade): a level 2 tree is planted on bare ground as a level 1 tree, as green is", does(S, E) === "plant" && (a => a && a.l === 1 && a.pts === 1 && S.h["7,4"] === 1 && S.hb["7,4"] === "t")(R.place(S, 0, E))) }
    { const S = setup({"8,6":2, "9,6":2, "7,6":2}, {"7,7":2}, {...mode, opening:["trees 2", "trees 2"]}); S.hb["9,6"] = "p"; S.hb["7,6"] = "m";   // green, prairie and marsh at level 2, and a level 2 river tile
      ok(`trees (${name}): a level 2 tree is refused on a level 2 green, prairie or marsh habitat, with the toast: nothing is planted over`, [[8, 6], [9, 6], [7, 6]].every(p => does(S, p) === undefined && R.place(S, 0, p) === null)
        && R.why(S, 0, [8, 6]) === "That's Meadow (level 2). " + TO && R.why(S, 0, [9, 6]) === "That's Prairie (level 2). " + TO && R.why(S, 0, [7, 6]) === "That's Marsh (level 2). " + TO
        && R.options(S, 0).every(o => o.does === "plant") && Object.keys(S.h).length === 3 && S.hb["8,6"] === undefined && S.hb["9,6"] === "p" && S.hb["7,6"] === "m" && S.combined === 0 && S.planted === 0 && S.score === 0);
      ok(`trees (${name}): nor on a river tile or a mountain, and a locked tile is no target`, does(S, [7, 7]) === undefined && R.place(S, 0, [7, 7]) === null && R.why(S, 0, [4, 6]) === "Nothing grows on a mountain.");
      S.lk["8,6"] = 1; ok(`trees (${name}): a locked habitat says so`, R.why(S, 0, [8, 6]) === "That tile is locked.") }
    { const S = setup({"8,6":2, "9,6":2, "7,6":2, "8,5":3, "8,7":3}, {}, {...mode, opening:["trees 2", "trees 2"]}); S.hb["8,6"] = "t"; S.hb["9,6"] = "p"; S.hb["7,6"] = "m"; S.hb["8,7"] = "t";   // a level 2 tree, prairie and marsh, a level 3 green and a level 3 tree
      ok(`trees (${name}): a tree combines with a tree of its own level and with no other kind or level`, same(R.options(S, 0).filter(o => o.does === "combine").map(o => o.p + ""), ["8,6"]) && [[9, 6], [7, 6], [8, 5], [8, 7]].every(p => does(S, p) === undefined));
      const a = R.place(S, 0, C);
      ok(`trees (${name}): the combine makes a level 3 tree for 6 points, still Trees, and counts as a combine, not a planting`, a && a.does === "combine" && a.l === 3 && a.pts === 6 && S.h["8,6"] === 3 && S.hb["8,6"] === "t" && S.score === 6 && S.combined === 1 && S.planted === 0 && S.top === 3);
      ok(`trees (${name}): the run log says it was combined`, /^1\. Trees \(level 2\), dealt · combined at 8,6, now level 3 Trees · \+6 · /m.test(R.logText(S))) }
    { const S = setup({"8,6":2}, {}, {...mode, biomeMatch:false, opening:["trees 2", "prairie 3"]}); S.hb["8,6"] = "p"; const a = R.place(S, 0, C), up = does(S, C) === "combine", b = R.place(S, 0, C);
      ok(`trees (${name}): with kinds not having to match, a tree combines onto another kind of its own level, and the habitat keeps its kind`, a && a.does === "combine" && a.l === 3 && up && b && b.does === "combine" && b.l === 4 && S.h["8,6"] === 4 && S.hb["8,6"] === "p") }
    { const S = setup({"8,6":3, [N[0]]:2, [N[1]]:1}, {}, {...mode, lockEvery:0, stackSize:1, queueShown:0}); S.hb["8,6"] = "t"; S.hb[N[0]] = "t"; S.hb[N[1]] = "p"; R.discard(S, 0);   // a level 3 tree beside a level 2 tree and a level 1 prairie
      const copies = R.copiesOf(S, C).copies; R.lock(S, C);
      ok(`trees (${name}): lock copies of a tree keep their kind, lowest level first`, same(copies, [{k:"h", l:1, c:1, b:"p"}, {k:"h", l:2, c:1, b:"t"}]) && same(S.q[0], copies[0]) && same(S.bank, copies.slice(1)));
      const a = R.place(S, 0, E);
      ok(`trees (${name}): the tree copy follows the tree rule: it combines onto its own level 2 tree, and plants like green (${name === "refuse" ? "refused on bare ground above level 1" : "as a level 1 tree"})`, a && a.does === "plant" && S.hb["7,4"] === "p" && S.q[0].b === "t" && S.q[0].l === 2 && S.q[0].c === 1 && does(S, R.unkey(N[0])) === "combine"
        && (name === "refuse" ? R.options(S, 0).length === 1 && R.why(S, 0, W) === NO : does(S, W) === "plant" && (r => r && r.l === 1 && S.hb["5,4"] === "t")(R.place(S, 0, W)))) }
    { const S = setup({"8,6":3, "9,6":5}, {}, {...mode, lockEvery:0, stackSize:1, queueShown:0}); S.hb["8,6"] = "t"; R.discard(S, 0); R.lock(S, [9, 6]);   // the level 5 habitat copies the level 3 tree beside it
      ok(`trees (${name}): a tree copy is a tile like any other: it can combine onto its own tree`, S.q.length === 1 && S.q[0].c === 1 && S.q[0].b === "t" && S.q[0].l === 3 && does(S, [8, 6]) === "combine") }
    { const S = setup(ROUND, {}, {...mode, opening:["trees 1"], stackSize:1, queueShown:0}); S.locks = 0;   // all six tiles within reach taken by green, and the pile is this one tree
      ok(`trees (${name}): a tree with no legal spot can be discarded, and the run still ends`, R.options(S, 0).length === 0 && R.place(S, 0, FAR) === null && !!R.discard(S, 0) && S.over && S.discarded === 1 && S.planted === 0) }
    { const S = setup(ROUND, {}, {...mode, opening:["trees 1"], stackSize:1, queueShown:0}); S.locks = 0; S.hb["7,4"] = "t";   // the same, with one of them a level 1 tree: now there is a combine
      ok(`trees (${name}): a level 1 tree has a spot once there is a level 1 tree to combine with`, R.options(S, 0).length === 1 && does(S, E) === "combine") }
  }
  { const cfg = cfgWith({opening:["habitat 1", "trees 1"], stackSize:3, queueShown:0}); let err = "";   // an old save, with a tree put on a green habitat (what a tree used to do), is no longer a legal run: it is refused with an error, and the page starts fresh
    try { R.replay(cfg, 7, [{a:"p", i:0, x:7, y:4}, {a:"p", i:0, x:7, y:4}]) } catch (e) { err = e.message }
    ok("a saved run in which a tree was put on another kind of habitat is refused cleanly: replay throws, it doesn't crash", err === "Flowgrow: move 2 can't be replayed") }
  { const t = R.tidy({...REF, treeShare:1.5}, REF), u = R.tidy({...REF, treeShare:"x"}, REF);
    ok("a bad tree share is refused and the old value stands", same(t.bad, ["treeShare"]) && t.cfg.treeShare === 0 && same(u.bad, ["treeShare"]) && u.cfg.treeShare === 0) }
  ok("the ruleset key changes with the tree share", R.rulesKey(cfgWith({treeShare:.2})) !== R.rulesKey(REF));
  ok("the config file deals trees (20% of the habitats after the opening), its opening has none (Dan, Nov 20), and it has no key the rules don't read, apart from the 3D look's block", BASE.treeShare === .2 && !BASE.opening.some(w => R.parseTile(w).b === "t") && Object.keys(base).every(k => k === "look3d" || R.KEYS.some(kk => kk[0] === k)));
  ok("trees can be written in words, and have a name: trees 2, Trees (level 2)", same(R.parseTile("trees 2"), {k:"h", l:2, b:"t"}) && R.parseTile("trees") === null && R.parseTile("tree 2") === null && R.tileWord({k:"h", l:2, b:"t"}) === "trees 2" && R.tileText(REF, {k:"h", l:2, b:"t"}) === "Trees (level 2)");
  { const S = run([], {stackSize:0, prairieShare:.3, marshShare:.3, treeShare:.2, riverShare:0}), c = {t:0, p:0, m:0, h:0}, n = 40000, lv = new Set(); for (let i = 0; i < n; i++) { const t = R.roll(S); c[t.b || "h"]++; lv.add(t.l) }
    ok("dealt habitats are trees 20% of the time and the rest keep the 40 : 30 : 30 split: green 32%, prairie 24%, marsh 24%", Math.abs(c.t / n - .2) < .012 && Math.abs(c.h / n - .32) < .012 && Math.abs(c.p / n - .24) < .012 && Math.abs(c.m / n - .24) < .012 && lv.size === 1) }
  { const n = BASE.opening.length, S = R.fresh(cfgWith({opening:BASE.opening, treeShare:1, riverShare:0, stackSize:20}), 3); for (let i = 0; i < n; i++) R.discard(S, 0);
    ok("trees are dealt only after the opening: the first tiles are the opening's, and with every habitat after it a tree, the next one is", same(S.log.slice(0, n).map(e => e.t.k + (e.t.b || "")), BASE.opening.map(w => { const t = R.parseTile(w); return t.k + (t.b || "") })) && S.q[0].k === "h" && S.q[0].b === "t") }
  ok("the config file opens with four river tiles, then green, green, prairie and marsh (Dan, Nov 21: \"have it start with 4 water tiles, that way I can build my stream\")", same(BASE.opening, ["river", "river", "river", "river", "habitat 1", "habitat 1", "prairie 1", "marsh 1"]));
  { const S = R.fresh(BASE, 5); let all = true; for (let i = 0; i < 4; i++) { const o = R.options(S, 0).find(x => x.does === "extend"); if (S.q[0].k !== "r" || !o || !R.place(S, 0, o.p)) all = false }
    ok("a run starts with four river tiles to place, and they make the stream four tiles longer (five river tiles with the source), before any habitat is dealt", all && Object.keys(S.r).length === 5 && S.extended === 4 && S.planted === 0 && S.q[0].k === "h") }
  { const S = run([], {stackSize:0, treeShare:.5}); let more = 0, N2 = 2000; for (let i = 0; i < N2; i++) if (R.roll(S).b === "t") more++; const T = run([], {stackSize:0, treeShare:0}); let none = 0; for (let i = 0; i < N2; i++) if (R.roll(T).b) none++;
    ok("with the tree share 0 no tile is ever a tree", more > 0 && none === 0) }
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) { const cfg = cfgWith({...mode, ...MR, ...PS, treeShare:.4, prairieShare:.3, marshShare:.3, opening:["habitat 1", "prairie 1", "marsh 1", "river", "habitat 1"], lockEvery:0, stackSize:30, riverShare:.1}), S = R.fresh(cfg, 12);
    let z = 53, guard = 0; const rn = () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    while (!S.over && guard++ < 4000) { if (!S.q.length) { const lk = [...Object.keys(S.h), ...Object.keys(S.r)].map(R.unkey).find(p => R.lockable(S, p) && R.copiesOf(S, p).copies.length); if (!lk) { R.end(S); break } R.lock(S, lk); continue }
      const o = R.options(S, 0); if (!o.length || rn() < .08) { R.discard(S, 0); continue } R.place(S, 0, o[Math.floor(rn() * o.length)].p) }
    const T = R.fresh(cfg, 12); let wrong = 0, planted = 0, combined = 0, changed = 0;   // every tree goes on empty land within reach, or on an unlocked tree habitat of its own level; no tile ever changes its kind
    for (const m of S.moves) { if (m.a === "p") { const t = T.q[m.i], k = m.x + "," + m.y; if (t.k === "h" && t.b === "t") { if (k in T.h) { if (T.h[k] !== t.l || k in T.lk || T.hb[k] !== "t") wrong++; else combined++ } else if (!R.reachOf(T).has(k)) wrong++; else planted++ } }
      const kinds = Object.fromEntries(Object.keys(T.h).map(k => [k, T.hb[k] || ""])); m.a === "p" ? R.place(T, m.i, [m.x, m.y]) : m.a === "d" ? R.discard(T, m.i) : m.a === "l" ? R.lock(T, [m.x, m.y]) : R.end(T);
      for (const k in kinds) if ((T.hb[k] || "") !== kinds[k]) changed++ }
    ok(`a whole run of random legal moves with trees (${name}): it ends, trees were planted, every tree went on empty land within reach or on a tree of its own level, no tile ever changed kind, the score is the sum of the moves, and it replays from its seed`,
      S.over && guard < 4000 && planted > 0 && wrong === 0 && changed === 0 && S.planted + S.combined + S.extended + S.widened + S.discarded === S.used && S.log.reduce((s, e) => s + e.pts, 0) === S.score && same(S, R.replay(cfg, 12, S.moves)));
    const first = S.log.find(e => e.did === "plant" && e.t.b === "t");
    ok(`trees (${name}): undo steps back over a tree being planted (the land is empty again), and a reload brings the tree back`, !!first && (() => { const k = R.key(first.at), withIt = R.replay(cfg, 12, S.moves.slice(0, first.n)), without = R.replay(cfg, 12, S.moves.slice(0, first.n - 1));
        return !(k in without.h) && withIt.h[k] === first.l && withIt.hb[k] === "t" && same(withIt, R.replay(cfg, 12, S.moves.slice(0, first.n))) })() && /Trees \(level \d+\), (dealt|copy) · planted at \d+,\d+/.test(R.logText(S))) }
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) { const bad = []; let dropped = 0; for (let s = 1; s <= 8; s++) { const a = play(cfgWith({...mode, treeShare:.6, lockEvery:0, stackSize:20}), s); if (a.error || !a.S.over) bad.push(s); else dropped += a.S.log.filter(e => e.did === "discard" && e.t && e.t.b === "t").length }
    ok(`the simple player ends every run with trees in the pile (${name}): it never gets stuck, and it discards a tree that has no legal spot${name === "refuse" ? "" : " (rare here: a tree plants as level 1)"}`, bad.length === 0 && (name === "downgrade" || dropped > 0)) }

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
      while (!S.over && guard++ < 4000) { if (S.pend.length) { const k = S.pend[0], ch = R.PICKS[S.hb[k] || ""]; R.pick(S, k, ch[Math.floor(rn() * ch.length)]); continue } if (!S.q.length) { const lk = [...Object.keys(S.h), ...Object.keys(S.r)].map(R.unkey).find(p => R.lockable(S, p) && R.copiesOf(S, p).copies.length); if (!lk) { R.end(S); break } R.lock(S, lk); continue }
        const o = R.options(S, 0); if (!o.length || rn() < .08) { R.discard(S, 0); continue } R.place(S, 0, o[Math.floor(rn() * o.length)].p) }
      const T = R.fresh(cfg, sd);   // every marsh planting touches a river tile or a reed bed at the moment it is made
      for (const m of S.moves) { if (m.a === "p") { const t = T.q[m.i], k = m.x + "," + m.y; if (t.k === "h" && t.b === "m" && !(k in T.h)) { marshPlanted++; const nb = R.nbrs(cfg, [m.x, m.y]).map(R.key), river = nb.some(q => q in T.r), reed = nb.some(q => T.hb[q] === "m" && T.h[q] >= 2); if (!river && !reed) wrong++; if (!river && reed) via++ } }
        m.a === "p" ? R.place(T, m.i, [m.x, m.y]) : m.a === "d" ? R.discard(T, m.i) : m.a === "l" ? R.lock(T, [m.x, m.y]) : m.a === "u" ? R.pick(T, m.x + "," + m.y, m.f) : R.end(T) }
      if (S.over && guard < 4000) ends++; if (same(S, R.replay(cfg, sd, S.moves))) replays++; if (S.planted + S.combined + S.extended + S.widened + S.discarded === S.used) sums++;
      const e = !made && S.log.find(e => e.did === "combine" && e.t.b === "m" && e.l === 2); if (e) made = {e, sd, moves:S.moves}, madeCfg = cfg }
    ok(`a whole run of random legal moves with reed beds (${name}): six runs end and replay from their seeds, every marsh planting touched a river tile or a reed bed, and some touched only a reed bed`, ends === 6 && replays === 6 && sums === 6 && wrong === 0 && marshPlanted > 0 && via > 0);
    const k = made && R.key(made.e.at);
    ok(`reed bed (${name}): undo steps back over the move that made one (nothing was stored: it was only the tile's level), and a reload brings it back`, !!made && R.reedBedAt(R.replay(madeCfg, made.sd, made.moves.slice(0, made.e.n)), k) && !R.reedBedAt(R.replay(madeCfg, made.sd, made.moves.slice(0, made.e.n - 1)), k) && same(R.replay(madeCfg, made.sd, made.moves.slice(0, made.e.n)), R.replay(madeCfg, made.sd, made.moves.slice(0, made.e.n)))) }
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) { const bad = []; let via = 0; for (let s = 1; s <= 8; s++) { const a = play(cfgWith({...mode, ...MR, upgradeLevel:2, marshShare:.6, lockEvery:0, stackSize:20}), s); if (a.error || !a.S.over) bad.push(s); else via += a.m.reedPlanted }
    ok(`the simple player ends every run with reed beds (${name}), and uses them`, bad.length === 0 && via > 0) }

  // ----- the pick, and the prairie's steppe and meadow (LOU-305; Dan: "At level 4 one of the upgrades can be "spreader", where every time that tile levels up, it plants a free level 1 prairie adjacent to
  // it until no more slots available", "Also instead of spreader call the ability steppe", "instead of Bloom, make it "meadow" and it adds the score of neighboring marsh and trees as a multiplier").
  // When a prairie habitat first reaches the upgrade level the player picks Steppe or Meadow: a move of its own, stored on the tile. Steppe: each level-up plants a free level 1 prairie beside it. Meadow: each
  // level-up scores times 1 + the marsh and trees beside it, up to meadowMax. REF has upgradeLevel 0, so every check above is about the game as it was. Real runs use upgrade level 2 so that two taps reach it.
  const PK = {upgradeLevel:4}, STEP = ["8,5", "9,6", "8,7", "7,7", "7,6", "7,5"], C6 = [8, 6];   // the six tiles round (8,6), clockwise from the top right
  const prairies = (S, ks, f) => { for (const k of ks) { S.h[k] = S.h[k] || 1; S.hb[k] = "p"; if (f) S.hf[k] = f } };
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) {
    { const cfg = cfgWith({...mode, upgradeLevel:2, opening:["prairie 1", "prairie 1", "habitat 1", "habitat 1"], stackSize:20, lockEvery:0}), S = R.fresh(cfg, 7); R.place(S, 0, E); const a = R.place(S, 0, E);
      ok(`pick (${name}): a prairie tile that reaches the upgrade level has a pick to make, and nothing else can be done until it is made`,
        a && a.does === "combine" && same(S.pend, ["7,4"]) && !S.hf["7,4"] && R.options(S, 0).length === 0 && R.place(S, 0, W) === null && R.discard(S, 0) === null && R.why(S, 0, W) === "Choose an upgrade first." && !S.over && !R.lockable(S, E) && R.end(S) === null && same(R.PICKS.p, ["steppe", "meadow"]));
      ok(`pick (${name}): only one of the kind's upgrades can be picked, and only for the first tile waiting`, R.pick(S, "7,4", "roots") === null && R.pick(S, "7,4", "reed") === null && R.pick(S, "6,3", "steppe") === null && S.pend.length === 1);
      const m0 = S.moves.length, b = R.pick(S, "7,4", "steppe");
      ok(`pick (${name}): choosing is a move of its own: stored on the tile, nothing planted and nothing scored, and the run goes on`, b && b.f === "steppe" && S.hf["7,4"] === "steppe" && !S.pend.length && S.moves.length === m0 + 1 && S.moves[m0].a === "u" && S.free === 0 && S.score === 4 && R.upgradeOf(cfg, {k:"h", l:2, b:"p", f:"steppe"}) === "steppe" && R.options(S, 0).length > 0 && /Picked Steppe for the prairie tile at 7,4/.test(R.logText(S)));
      const back = R.replay(cfg, 7, S.moves.slice(0, S.moves.length - R.undoCount(S.moves))), wait = R.replay(cfg, 7, S.moves.slice(0, -1));
      ok(`pick (${name}): undo takes back the pick and the combine together, a pick still pending goes with the combine alone, and a reload brings the pick back`, R.undoCount(S.moves) === 2 && back.moves.length === 1 && back.h["7,4"] === 1 && !back.pend.length && R.undoCount(S.moves.slice(0, -1)) === 1 && same(wait.pend, ["7,4"]) && same(R.replay(cfg, 7, S.moves), S)) }
    { const S = setup({"8,6":2, "9,6":3}, {}, {...mode, upgradeLevel:2, lockEvery:0, stackSize:1, queueShown:0}); prairies(S, ["8,6"], "steppe"); prairies(S, ["9,6"], "meadow"); R.discard(S, 0); R.lock(S, [9, 6]);   // the level 3 meadow copies the level 2 steppe beside it
      const copy = S.q[0];
      ok(`pick (${name}): a lock copy of a tile with an upgrade keeps it`, same(copy, {k:"h", l:2, c:1, b:"p", f:"steppe"}) && R.upgradeOf(S.cfg, copy) === "steppe");
      const a = R.place(S, 0, [8, 6]);
      ok(`pick (${name}): the copy combined onto the steppe offers no pick, and the steppe fires: a level 3 steppe plants a free prairie`, a && a.does === "combine" && !S.pend.length && S.hf["8,6"] === "steppe" && S.h["8,6"] === 3 && a.free.length === 1 && S.h["8,5"] === 1 && S.hb["8,5"] === "p") }
    { const S = setup({"9,6":3}, {}, {...mode, bareGroundMaxLevel:24, upgradeLevel:2, lockEvery:0, stackSize:1, queueShown:0}); prairies(S, ["9,6"], "steppe"); S.h["8,6"] = 2; S.hb["8,6"] = "p"; S.hf["8,6"] = "meadow"; S.top = 3; R.discard(S, 0); R.lock(S, [9, 6]);
      const a = R.place(S, 0, [5, 4]);   // the level 2 meadow copy, planted on bare ground where any level plants
      ok(`pick (${name}): a copy that lands at the upgrade level keeps its upgrade and offers no pick (and one that lands as level 1 has none)`, a && a.l === 2 && S.hf["5,4"] === "meadow" && !S.pend.length);
      const T = setup({"9,6":3}, {}, {...DG, upgradeLevel:2, lockEvery:0, stackSize:1, queueShown:0}); prairies(T, ["9,6"], "steppe"); T.h["8,6"] = 2; T.hb["8,6"] = "p"; T.hf["8,6"] = "meadow"; T.top = 3; R.discard(T, 0); R.lock(T, [9, 6]); const d = R.place(T, 0, [5, 4]);
      if (name === "downgrade") ok("pick (downgrade): the same copy planted as level 1 has no upgrade and no pick", d && d.l === 1 && !("5,4" in T.hf) && !T.pend.length) }
    { const S = setup({"6,2":2, "8,6":2, "3,5":2}, {}, {...mode, upgradeLevel:2, lockEnabled:false, stackSize:1, queueShown:0}); prairies(S, ["8,6", "6,2", "3,5"]); R.needPick(S, "8,6"); R.needPick(S, "6,2"); R.needPick(S, "3,5");
      ok(`pick (${name}): several picks at once are asked one at a time, in reading order (row, then column), and all are made before the next move`, same(S.pend, ["6,2", "3,5", "8,6"]) && R.pick(S, "8,6", "meadow") === null && R.options(S, 0).length === 0);
      R.pick(S, "6,2", "steppe"); R.pick(S, "3,5", "meadow"); const mid = R.options(S, 0).length === 0; S.q.length = 0; R.fill(S);
      ok(`pick (${name}): the run doesn't end with the pile empty while a pick is waiting, and ends once it is made`, mid && same(S.pend, ["8,6"]) && !S.over && R.pick(S, "8,6", "steppe") && S.over && S.hf["6,2"] === "steppe" && S.hf["3,5"] === "meadow" && S.hf["8,6"] === "steppe") }
    { const S = setup({"8,6":4}, {}, {...mode, ...PK, opening:["prairie 4", "prairie 5", "prairie 6"]}); prairies(S, ["8,6"], "steppe");
      ok(`steppe (${name}): the free tiles go to the first free tile clockwise from the top right, and never onto a mountain, a river tile or an occupied tile`, same(R.freeSpots(S, "8,6"), STEP) && same(R.freeSpots(setup({"5,5":1, "6,6":1, "5,7":1, "4,5":1}, {}, {...mode, ...PK}), "5,6"), ["4,7"]) && same(R.freeSpots(setup({"7,4":1, "7,5":1, "7,6":1, "6,6":1, "5,5":1}, {}, {...mode, ...PK}), "6,5"), []));
      const a = R.place(S, 0, C6);
      ok(`steppe (${name}): a level-up plants one free level 1 prairie beside it, scores 1 for it, and uses no tile`, a && a.does === "combine" && a.l === 5 && a.free.length === 1 && S.h["8,5"] === 1 && S.hb["8,5"] === "p" && !S.hf["8,5"] && a.pts === 16 && S.score === 16 && S.free === 1 && S.planted === 0 && S.used === 1 && /Steppe planted 1 free/.test(R.logText(S)));
      const b = R.place(S, 0, C6);
      ok(`steppe (${name}): the next level-up plants the next one, and a free tile plays as usual`, b && b.free[0] === "9,6" && S.h["9,6"] === 1 && S.free === 2 && S.score === 16 + 21 + 1) }
    { const S = setup({"8,6":4}, {}, {...mode, ...PK, opening:["prairie 4"]}); prairies(S, ["8,6"], "steppe"); for (const k of STEP) { S.h[k] = 1 } const a = R.place(S, 0, C6);
      ok(`steppe (${name}): with no free tile beside it nothing is planted, and the level-up still scores`, a && a.free.length === 0 && S.free === 0 && a.pts === 15 && S.h["8,6"] === 5) }
    { const S = setup({"8,6":4}, {}, {...mode, ...PK, steppePerLevel:6, opening:["prairie 4"]}), T = setup({"8,6":4}, {}, {...mode, ...PK, steppePerLevel:0, opening:["prairie 4"]}); prairies(S, ["8,6"], "steppe"); prairies(T, ["8,6"], "steppe"); const a = R.place(S, 0, C6), z = R.place(T, 0, C6);
      ok(`steppe (${name}): steppePerLevel 6 fills every free slot, and 0 plants none`, a.free.length === 6 && same(a.free, STEP) && S.free === 6 && a.pts === 15 + 6 && z.free.length === 0 && T.free === 0 && z.pts === 15) }
    { const S = setup({"8,6":4, "9,6":1, "8,5":2, "7,6":1, "7,5":1, "8,7":1}, {"7,7":1}, {...mode, ...PK, opening:["prairie 4", "prairie 4", "prairie 4", "prairie 4", "prairie 4"]}); prairies(S, ["8,6"], "meadow"); S.hb["9,6"] = "m"; S.hb["8,5"] = "t"; S.lk["8,5"] = 1; S.hb["7,5"] = "p"; S.hb["8,7"] = "m";   // marsh, a locked tree, green, prairie, marsh and a river tile round a meadow
      const pre = R.options(S, 0).find(o => o.p + "" === C6 + ""), a = R.place(S, 0, C6);
      ok(`meadow (${name}): a level-up scores the points times 1 + the marsh and trees beside it (locked ones count; green, prairie and river tiles don't), and the preview says so`, pre.pts === 15 * 4 && pre.mult === 4 && R.meadowMult(S, "8,6") === 4 && a.pts === 60 && a.mult === 4 && S.score === 60 && /Meadow ×4/.test(R.logText(S)) && a.free.length === 0) }
    { const S = setup({"8,6":4, "9,6":1, "8,5":2}, {}, {...mode, ...PK, opening:["prairie 4"]}); prairies(S, ["8,6"], "meadow"); S.hb["9,6"] = "m"; S.hb["8,5"] = "t"; const a = R.place(S, 0, C6);
      const T = setup({"8,6":4, "9,6":1}, {}, {...mode, ...PK, opening:["prairie 4"]}); prairies(T, ["8,6"], "meadow"); T.hb["9,6"] = "p"; const z = R.place(T, 0, C6);
      const U = setup({"8,6":4, "9,6":1}, {}, {...mode, ...PK, meadowMax:1, opening:["prairie 4"]}); prairies(U, ["8,6"], "meadow"); U.hb["9,6"] = "m"; const y = R.place(U, 0, C6), V = setup({"8,6":4, "9,6":1, "8,5":1, "7,6":1}, {}, {...mode, ...PK, meadowMax:2, opening:["prairie 4"]}); prairies(V, ["8,6"], "meadow"); V.hb["9,6"] = "m"; V.hb["8,5"] = "m"; V.hb["7,6"] = "t"; const x = R.place(V, 0, C6);
      ok(`meadow (${name}): two neighbours make ×3, no marsh or trees beside it makes ×1, meadowMax 1 gives nothing and meadowMax 2 caps it`, a.pts === 45 && a.mult === 3 && z.pts === 15 && z.mult === undefined && y.pts === 15 && x.pts === 30 && x.mult === 2) }
    { const S = setup({"8,6":3, "9,6":1}, {}, {...mode, ...PK, opening:["prairie 3"]}); prairies(S, ["8,6"]); S.hb["9,6"] = "m"; const a = R.place(S, 0, C6);
      ok(`meadow (${name}): the level-up that reaches the upgrade level is not multiplied (there is no upgrade until it is picked), and the pick comes next`, a.pts === 10 && a.mult === undefined && same(S.pend, ["8,6"]) && S.score === 10) }
  }
  { const t = R.tidy({...REF, steppePerLevel:7, meadowMax:0}, REF), u = R.tidy({...REF, steppePerLevel:"x", meadowMax:13}, REF);
    ok("a bad steppe or meadow value is refused and the old value stands", same(t.bad, ["steppePerLevel", "meadowMax"]) && t.cfg.steppePerLevel === 1 && t.cfg.meadowMax === 4 && same(u.bad, ["steppePerLevel", "meadowMax"])) }
  ok("the ruleset key changes with the steppe and meadow values", R.rulesKey(cfgWith({steppePerLevel:2})) !== R.rulesKey(REF) && R.rulesKey(cfgWith({meadowMax:2})) !== R.rulesKey(REF));
  ok("the config file has one free prairie a steppe level-up and meadow up to ×4", BASE.steppePerLevel === 1 && BASE.meadowMax === 4 && R.UPGRADE.steppe.line === "Steppe: plants a free prairie each time it levels up" && R.UPGRADE.meadow.line === "Meadow: level-ups score more with marsh and trees next to it");
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) { let ends = 0, replays = 0, sums = 0, picks = 0, frees = 0, mults = 0, clean = 0, undone = 0;
    for (const sd of [31, 32, 33, 34, 35, 36]) { const cfg = cfgWith({...mode, upgradeLevel:2, prairieShare:.6, marshShare:.2, treeShare:.1, opening:["prairie 1", "prairie 1", "prairie 1", "river", "marsh 1"], lockEvery:0, stackSize:40, riverShare:.1, steppePerLevel:2}), S = R.fresh(cfg, sd);
      let z = 5 + sd, guard = 0; const rn = () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      while (!S.over && guard++ < 4000) { if (S.pend.length) { const k = S.pend[0], ch = R.PICKS[S.hb[k] || ""]; R.pick(S, k, ch[Math.floor(rn() * ch.length)]); continue }
        if (!S.q.length) { const lk = [...Object.keys(S.h), ...Object.keys(S.r)].map(R.unkey).find(p => R.lockable(S, p) && R.copiesOf(S, p).copies.length); if (!lk) { R.end(S); break } R.lock(S, lk); continue }
        const o = R.options(S, 0); if (!o.length || rn() < .08) { R.discard(S, 0); continue } R.place(S, 0, o[Math.floor(rn() * o.length)].p) }
      if (S.over && guard < 4000) ends++; if (same(S, R.replay(cfg, sd, S.moves))) replays++;
      if (S.planted + S.combined + S.extended + S.widened + S.discarded === S.used && S.log.reduce((n, e) => n + e.pts, 0) === S.score) sums++;
      if (!S.pend.length && Object.keys(S.hf).every(k => R.PICKS[S.hb[k] || ""] && S.h[k] >= 2)) clean++;
      picks += S.moves.filter(m => m.a === "u").length; frees += S.free; mults += S.log.filter(e => e.mult > 1).length;
      const m = S.moves.findIndex(x => x.a === "u"); if (m >= 0 && R.undoCount(S.moves.slice(0, m + 1)) === 2 && R.replay(cfg, sd, S.moves.slice(0, m + 1 - 2)).pend.length === 0 && R.replay(cfg, sd, S.moves.slice(0, m)).pend.length === 1) undone++ }
    ok(`a whole run of random legal moves with picks, steppe and meadow (${name}): six runs end and replay from their seeds, no pick is left, every stored upgrade is on a prairie habitat at the upgrade level, the score is the sum of the moves, steppe planted free tiles, and undo steps back over a pick`,
      ends === 6 && replays === 6 && sums === 6 && clean === 6 && picks > 0 && frees > 0 && undone > 0) }
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) { const bad = []; let picks = 0; for (let s = 1; s <= 8; s++) { const a = play(cfgWith({...mode, upgradeLevel:2, prairieShare:.6, lockEvery:0, stackSize:20}), s); if (a.error || !a.S.over || a.S.pend.length) bad.push(s); else picks += a.S.moves.filter(m => m.a === "u").length }
    ok(`the simple player makes every pick and ends every run (${name})`, bad.length === 0 && picks > 0) }

  // ----- trees' roots and pine-oneer (LOU-306; Dan: "I like roots...put no cap on it, allow chain reaction for combos, I like pioneer....call it pine-oneer....like for pine trees"). Trees pick Roots or Pine-oneer at the
  // upgrade level, with the pick of LOU-305. Roots: each time the tree levels up, every unlocked habitat beside it that is lower than the tree rises a level for free and scores like a combine, in a chain.
  // Pine-oneer: trees can be planted on empty land beside it. REF has upgradeLevel 0, so every check above is about the game as it was.
  const treesAt = (S, ks, f) => { for (const k of ks) { S.hb[k] = "t"; if (f) S.hf[k] = f } };
  const liftedKeys = a => a.lifts.map(x => x.k);
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) {
    { const cfg = cfgWith({...mode, upgradeLevel:2, opening:["trees 1", "trees 1", "habitat 1", "trees 2"], stackSize:20, lockEvery:0}), S = R.fresh(cfg, 7); R.place(S, 0, E); const a = R.place(S, 0, E);
      ok(`trees pick (${name}): a tree habitat that reaches the upgrade level offers Roots and Pine-oneer, and nothing else can be done until the pick is made`, a && a.does === "combine" && same(S.pend, ["7,4"]) && same(R.PICKS.t, ["roots", "pine"]) && R.options(S, 0).length === 0 && R.discard(S, 0) === null && R.pick(S, "7,4", "steppe") === null && R.pick(S, "7,4", "roots") !== null && S.hf["7,4"] === "roots" && !S.pend.length && S.free === 0);
      const wait = R.replay(cfg, 7, S.moves.slice(0, -1)); R.place(S, 0, [6, 3]); const m = R.place(S, 0, E);
      ok(`roots (${name}): undo steps back over a level-up and everything it lifted together, and a reload brings it back`, m && m.lifts.length === 1 && S.h["6,3"] === 2 && S.h["7,4"] === 3 && S.score === 1 + 3 + 1 + 6 + 3 && R.undoCount(S.moves) === 1 && (U => U.h["6,3"] === 1 && U.h["7,4"] === 2 && U.lifted === 0)(R.replay(cfg, 7, S.moves.slice(0, -1))) && same(R.replay(cfg, 7, S.moves), S) && same(wait.pend, ["7,4"])) }
    { const S = setup({"8,6":4, "8,5":2, "9,6":3, "8,7":3, "7,7":5, "7,6":1}, {"7,5":1}, {...mode, ...PK, opening:["trees 4"]}); treesAt(S, ["8,6"], "roots"); S.hb["9,6"] = "p"; S.hb["8,7"] = "m"; treesAt(S, ["7,7"]); S.lk["7,6"] = 1;   // roots at (8,6); round it: green 2, prairie 3, marsh 3, a level 5 tree, a locked green, a river tile
      const pre = R.options(S, 0).find(o => o.p + "" === C6 + ""), a = R.place(S, 0, C6);
      ok(`roots (${name}): a level-up lifts every lower, unlocked habitat beside it a level, each scoring its new level, and lifts nothing equal or higher, locked, a river tile or bare ground`,
        pre.pts === 15 && a.pts === 15 + 6 + 10 + 10 && S.score === 41 && same(liftedKeys(a), ["8,5", "9,6", "8,7"]) && S.h["8,5"] === 3 && S.h["9,6"] === 4 && S.h["8,7"] === 4 && S.h["7,7"] === 5 && S.h["7,6"] === 1 && S.h["8,6"] === 5 && S.lifted === 3 && !("7,5" in S.h) && /Roots lifted 3, 26 points/.test(R.logText(S)));
      ok(`roots (${name}): a marsh habitat lifted to the upgrade level is a reed bed at once, and a prairie one has a pick to make`, R.reedBedAt(S, "8,7") && same(S.pend, ["9,6"]) && R.pick(S, "9,6", "meadow") !== null && S.hf["9,6"] === "meadow") }
    { const mk = o => { const S = setup({"8,6":4, "8,5":4, "9,6":4, "7,6":4, "6,6":1, "10,6":2}, {}, {...mode, ...PK, opening:["trees 4"], ...o}); treesAt(S, ["8,6", "9,6"], "roots"); prairies(S, ["8,5"], "steppe"); prairies(S, ["7,6"], "meadow"); S.hb["6,6"] = "m"; return S };   // roots (8,6) with a roots, a steppe and a meadow beside it, and a green two tiles from the east one
      const S = mk({}), a = R.place(S, 0, C6), T = mk({rootsChain:false}), b = R.place(T, 0, C6);
      ok(`roots (${name}): with the chain on, a lifted roots tree lifts its own lower neighbours, a lifted steppe plants its free tile, and a lifted meadow multiplies the points of its rise`,
        same(liftedKeys(a), ["8,5", "9,6", "7,6", "10,6"]) && S.h["10,6"] === 3 && a.free.length === 1 && a.free[0] === "9,4" && a.lifts[2].pts === 15 * 3 && a.pts === 15 + 15 + 1 + 15 + 45 + 6 && S.score === 97 && S.h["9,6"] === 5);
      ok(`roots (${name}): with the chain off they only rise and score: no further lift, no free tile, no multiplier`, same(liftedKeys(b), ["8,5", "9,6", "7,6"]) && T.h["10,6"] === 2 && b.free.length === 0 && T.free === 0 && b.pts === 60 && T.score === 60) }
    { const mk = o => { const S = setup({"8,6":4, "8,5":3, "9,6":1, "8,7":2}, {}, {...mode, ...PK, opening:["trees 4"], ...o}); treesAt(S, ["8,6"], "roots"); S.hb["8,5"] = "p"; return S };
      const one = mk({rootsPerLevel:1}), two = mk({rootsPerLevel:2}), none = mk({rootsPerLevel:0}), a = R.place(one, 0, C6), b = R.place(two, 0, C6), z = R.place(none, 0, C6);
      ok(`roots (${name}): rootsPerLevel 1 lifts only the lowest, 2 the two lowest (in the fixed order), and 0 lifts none`, same(liftedKeys(a), ["9,6"]) && a.pts === 15 + 3 && same(liftedKeys(b), ["9,6", "8,7"]) && b.pts === 15 + 3 + 6 && z.lifts.length === 0 && z.pts === 15 && none.lifted === 0) }
    { const S = setup({"8,6":4, "8,5":3, "9,6":3, "7,5":3}, {}, {...mode, ...PK, opening:["trees 4"]}); treesAt(S, ["8,6"], "roots"); treesAt(S, ["8,5"]); S.hb["9,6"] = "p"; S.hb["7,5"] = "p"; const a = R.place(S, 0, C6);
      ok(`roots (${name}): several tiles lifted to the upgrade level at once ask for their picks one at a time, in reading order, and all are made before the next move`,
        a.lifts.length === 3 && same(S.pend, ["7,5", "8,5", "9,6"]) && R.pick(S, "9,6", "steppe") === null && R.options(S, 0).length === 0 && R.pick(S, "7,5", "steppe") && R.pick(S, "8,5", "pine") && R.pick(S, "9,6", "meadow") && !S.pend.length && S.hf["8,5"] === "pine" && S.hf["9,6"] === "meadow") }
    { let worst = 0, ends = 0; for (const sd of [1, 2, 3]) { const S = setup({}, {}, {...mode, ...PK, opening:["trees 4"], rootsChain:true}); S.cfg.map.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== "_") return; const k = x + "," + y, l = 1 + (x * 3 + y * 5 + sd) % 4; S.h[k] = l; S.hb[k] = ["t", "p", "m", "t"][(x + y + sd) % 4]; if (S.hb[k] === "t" && l === 4) S.hf[k] = "roots"; if (S.hb[k] === "p" && l === 4) S.hf[k] = "steppe" }));
      S.hb["6,3"] = "t"; S.h["6,3"] = 4; S.hf["6,3"] = "roots"; S.top = 4; const before = Math.max(...Object.values(S.h)), a = R.place(S, 0, [6, 3]); worst = Math.max(worst, ...Object.values(S.h)); if (a && a.lifts.length > 0 && S.lifted <= 108 * 5) ends++ }
    ok(`roots (${name}): a chain on a board packed with roots trees and lower tiles ends, and no tile passes the level of the tree that started it`, ends === 3 && worst === 5) }
  }
  { const mkP = (o, h = {"8,6":4}) => { const S = setup(h, {}, {...PK, ...o}); for (const k in h) { S.hb[k] = "t"; S.hf[k] = "pine" } return S };
    for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) {
      const S = mkP({...mode, opening:["trees 1", "trees 2", "trees 1"]});
      ok(`pine-oneer (${name}): a tree plants on the empty land beside a pine-oneer, even outside the river's reach, as well as on the land within reach, and nowhere else`, same(R.options(S, 0).filter(o => o.does === "plant").map(o => o.p + "").sort(), [...STEP, ...R.plantable(S)].sort()) && STEP.every(k => !R.reachOf(S).has(k)) && R.options(S, 0).filter(o => o.does === "plant").every(o => o.l === 1) && does(S, [3, 3]) === undefined && does(S, [9, 7]) === undefined && R.why(S, 0, [3, 3]) === "Trees plant on open land in the river's reach, or next to a pine-oneer.");
      const a = R.place(S, 0, [9, 6]);
      ok(`pine-oneer (${name}): the tree lands as level 1 with no upgrade, scores 1, and the pine-oneer itself plants and scores nothing`, a && a.does === "plant" && a.l === 1 && a.pts === 1 && S.h["9,6"] === 1 && S.hb["9,6"] === "t" && !S.hf["9,6"] && S.planted === 1 && S.score === 1 && S.hf["8,6"] === "pine");
      if (name === "refuse") ok("pine-oneer (refuse): a level 2 tree can't be planted beside it, and the toast says what to do", R.options(S, 0).filter(o => o.does === "plant").length === 0 && R.why(S, 0, [8, 5]) === NO);
      else ok("pine-oneer (downgrade): a level 2 tree is planted beside it as a level 1 tree", does(S, [8, 5]) === "plant" && (b => b && b.l === 1 && b.pts === 1 && S.h["8,5"] === 1 && !S.hf["8,5"])(R.place(S, 0, [8, 5]))) }
    const M = mkP({...DG, opening:["trees 1"]}, {"5,6":4});   // beside a mountain at (4,6)
    ok("pine-oneer: it never plants on a mountain, a river tile or an occupied tile, and every free tile beside it is offered", R.codeAt(M.cfg, [4, 6]) === "B" && !R.options(M, 0).some(o => o.p + "" === "4,6") && R.freeSpots(M, "5,6").every(k => R.options(M, 0).some(o => o.does === "plant" && o.p + "" === k)));
    const Q = mkP({...DG, opening:["trees 1"]}, {"6,5":4}); Q.h["7,5"] = 1;   // beside the source, and next to an occupied tile
    ok("pine-oneer: land with a river tile or a habitat on it is not offered", R.options(Q, 0).filter(o => o.does === "plant").every(o => o.p + "" !== "6,4" && o.p + "" !== "7,5") && R.options(Q, 0).some(o => o.does === "plant") && does(Q, [7, 5]) === undefined);
    const L3 = setup({"8,6":3}, {}, {...DG, ...PK, opening:["trees 1"]}); treesAt(L3, ["8,6"], "pine"); const OFF = mkP({...DG, upgradeLevel:0, opening:["trees 1"]});
    ok("pine-oneer: a tree below the upgrade level is no pine-oneer, and with upgrades off there is none: a tree plants only within reach", same(R.options(L3, 0).filter(o => o.does === "plant").map(o => o.p + "").sort(), R.plantable(L3).slice().sort()) && same(R.options(OFF, 0).filter(o => o.does === "plant").map(o => o.p + "").sort(), R.plantable(OFF).slice().sort()));
    const RT = setup({"8,6":4}, {}, {...DG, ...PK, opening:["trees 1"]}); treesAt(RT, ["8,6"], "roots"); const NP = setup({"8,6":4}, {}, {...DG, ...PK, opening:["trees 1"]}); treesAt(NP, ["8,6"]);
    ok("a roots tree, or a tree that has no upgrade, is no pine-oneer: no tree is planted beside it, outside reach", same(R.options(RT, 0).filter(o => o.does === "plant").map(o => o.p + "").sort(), R.plantable(RT).slice().sort()) && same(R.options(NP, 0).filter(o => o.does === "plant").map(o => o.p + "").sort(), R.plantable(NP).slice().sort()));
    const G = mkP({...DG, opening:["trees 1"]}); ok("a tree plants by the river's reach as well as beside a pine-oneer", R.options(G, 0).filter(o => o.does === "plant").length > 6);
    const LK = mkP({...DG, opening:["trees 1"]}); LK.lk["8,6"] = 1; ok("pine-oneer: a locked one still counts", STEP.every(k => R.options(LK, 0).some(o => o.does === "plant" && o.p + "" === k)));
    const CP = setup({"8,6":4, "9,6":5}, {}, {...DG, ...PK, lockEvery:0, stackSize:1, queueShown:0}); treesAt(CP, ["8,6"], "roots"); R.discard(CP, 0); R.lock(CP, [9, 6]);
    ok("a lock copy of a tree with an upgrade keeps it", same(CP.q[0], {k:"h", l:4, c:1, b:"t", f:"roots"}) && R.upgradeOf(CP.cfg, CP.q[0]) === "roots" && R.upgradeOf(CP.cfg, {k:"h", l:4, b:"t", f:"pine"}) === "pine" && R.upgradeOf(CP.cfg, {k:"h", l:3, b:"t", f:"pine"}) === "") }
  { const t = R.tidy({...REF, rootsPerLevel:7, rootsChain:"maybe"}, REF), u = R.tidy({...REF, rootsPerLevel:"x"}, REF);
    ok("a bad roots value is refused and the old value stands", same(t.bad, ["rootsPerLevel", "rootsChain"]) && t.cfg.rootsPerLevel === 6 && t.cfg.rootsChain === true && same(u.bad, ["rootsPerLevel"])) }
  ok("the ruleset key changes with the roots values", R.rulesKey(cfgWith({rootsPerLevel:1})) !== R.rulesKey(REF) && R.rulesKey(cfgWith({rootsChain:false})) !== R.rulesKey(REF));
  ok("the config file lifts every lower neighbour with the chain on, and the registry has all five upgrades", BASE.rootsPerLevel === 6 && BASE.rootsChain === true && ["reed", "steppe", "meadow", "roots", "pine"].every(f => R.UPGRADE[f] && R.UPGRADE[f].line.startsWith(R.UPGRADE[f].name + ":")) && R.UPGRADE.roots.line === "Roots: when it levels up, lower neighbors rise a level");
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) { let ends = 0, replays = 0, sums = 0, lifted = 0, picks = 0, clean = 0;
    for (const sd of [41, 42, 43, 44, 45, 46]) { const cfg = cfgWith({...mode, upgradeLevel:2, treeShare:.6, prairieShare:.3, marshShare:.2, opening:["trees 1", "trees 1", "habitat 1", "river", "prairie 1"], lockEvery:0, stackSize:40, riverShare:.1}), S = R.fresh(cfg, sd);
      let z = 11 + sd, guard = 0; const rn = () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      while (!S.over && guard++ < 4000) { if (S.pend.length) { const k = S.pend[0], ch = R.PICKS[S.hb[k] || ""]; R.pick(S, k, ch[Math.floor(rn() * ch.length)]); continue }
        if (!S.q.length) { const lk = [...Object.keys(S.h), ...Object.keys(S.r)].map(R.unkey).find(p => R.lockable(S, p) && R.copiesOf(S, p).copies.length); if (!lk) { R.end(S); break } R.lock(S, lk); continue }
        const o = R.options(S, 0); if (!o.length || rn() < .08) { R.discard(S, 0); continue } R.place(S, 0, o[Math.floor(rn() * o.length)].p) }
      if (S.over && guard < 4000) ends++; if (same(S, R.replay(cfg, sd, S.moves))) replays++;
      if (S.planted + S.combined + S.extended + S.widened + S.discarded === S.used && S.log.reduce((n, e) => n + e.pts, 0) === S.score) sums++;
      if (!S.pend.length && Object.keys(S.hf).every(k => R.PICKS[S.hb[k] || ""] && S.h[k] >= 2)) clean++;
      lifted += S.lifted; picks += S.moves.filter(m => m.a === "u" && S.hf[m.x + "," + m.y] === "roots").length }
    ok(`a whole run of random legal moves with tree picks, roots and chains (${name}): six runs end and replay from their seeds, the score is the sum of the moves, every stored upgrade is on a pickable habitat at the upgrade level, and roots lifted tiles`, ends === 6 && replays === 6 && sums === 6 && clean === 6 && picks > 0 && lifted > 0) }
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) { const bad = []; for (let s = 1; s <= 8; s++) { const a = play(cfgWith({...mode, upgradeLevel:2, treeShare:.5, lockEvery:0, stackSize:20}), s); if (a.error || !a.S.over || a.S.pend.length) bad.push(s) }
    ok(`the simple player makes every tree pick and ends every run (${name})`, bad.length === 0) }

  // ----- the marsh river multiplier (LOU-309; Dan, Nov 21: "let's do a marsh bonus that for each "additional" river tile, it's a score multiple. 1 river = x1 (normal), 2 river = 2x...3x, 4x, 5x...."). Every score a marsh tile earns
  // (planted, combined onto, levelled, lifted by roots) is multiplied by the number of river tiles that share an edge with it, at least x1: the source and locked river tiles count, the river is read at the moment of the score,
  // and no other kind is multiplied. REF has it off, so every check above is about the game as it was.
  const MM = {marshRiverMultiplier:true}, riv6 = k => Object.fromEntries(STEP.slice(0, k).map(q => [q, 1])), RIVER3 = {"9,5":1, "7,5":1, "8,4":1};   // k river tiles round (8,6); three river tiles round (8,5)
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) {
    { const pl = [], co = [], lv = [], offered = [], off = [];
      for (const k of [1, 2, 3, 4]) {
        const P = setup({}, riv6(k), {...mode, ...MM, opening:["marsh 1"]}), ring = R.options(P, 0).find(o => o.p + "" === C6 + ""), a = R.place(P, 0, C6);
        pl.push(a && a.does === "plant" && a.pts === k && P.score === k && (k === 1 ? a.mult === undefined && a.mk === undefined : a.mult === k && a.mk === "marsh") && (k === 1 || ring.mult === k));
        const Cb = setup({"8,6":1}, riv6(k), {...mode, ...MM, opening:["marsh 1"]}); Cb.hb["8,6"] = "m"; const bo = R.options(Cb, 0).find(o => o.p + "" === C6 + ""), b = R.place(Cb, 0, C6);
        co.push(b && b.does === "combine" && b.pts === 3 * k && Cb.score === 3 * k && bo.pts === 3 * k); offered.push(k === 1 || bo.mult === k);
        const Lv = setup({"8,6":2}, riv6(k), {...mode, ...MM, opening:["marsh 2"]}); Lv.hb["8,6"] = "m"; lv.push(R.place(Lv, 0, C6).pts === 6 * k);
        const Z = setup({"8,6":1}, riv6(k), {...mode, opening:["marsh 1"]}); Z.hb["8,6"] = "m"; off.push(R.place(Z, 0, C6).pts === 3 && R.options(setup({}, riv6(k), {...mode, opening:["marsh 1"]}), 0).every(o => o.mult === undefined)) }
      ok(`marsh x (${name}): a marsh tile touching 1, 2, 3 and 4 river tiles scores x1, x2, x3 and x4 when it is planted`, pl.every(Boolean));
      ok(`marsh x (${name}): ...and when it is combined onto (the target scores, and the ring shows it) and when it levels up`, co.every(Boolean) && offered.every(Boolean) && lv.every(Boolean));
      ok(`marsh x (${name}): with marshRiverMultiplier off marsh scores as before, whatever touches it`, off.every(Boolean)) }
    { const S = setup({"8,6":4}, {}, {...mode, ...MM, ...PK, marshNeedsRiver:true, opening:["marsh 1", "marsh 1"]}); S.hb["8,6"] = "m"; const a = R.place(S, 0, [8, 5]), b = R.place(S, 0, [8, 5]);
      ok(`marsh x (${name}): a marsh tile that touches no river tile (planted beside a reed bed) scores x1, planted and combined onto`, R.reedBedAt(S, "8,6") && a.does === "plant" && a.pts === 1 && a.mult === undefined && b.does === "combine" && b.pts === 3 && b.mult === undefined) }
    { const S = setup({"7,4":1}, {"8,4":1}, {...mode, ...MM, opening:["marsh 1", "marsh 1"]}); S.hb["7,4"] = "m"; const lone = R.options(S, 0).find(o => o.p + "" === "7,4" + "").pts; S.lk["8,4"] = 1; const a = R.place(S, 0, [7, 4]);
      ok(`marsh x (${name}): the source and a locked river tile count`, lone === 6 && a.pts === 6 && a.mult === 2 && ((T) => { T.hb["7,4"] = "m"; return R.place(T, 0, [7, 4]).pts })(setup({"7,4":1}, {}, {...mode, ...MM, opening:["marsh 1"]})) === 3) }
    { const cfg = cfgWith({...mode, ...MM, opening:["river", "marsh 1", "marsh 1", "river", "river", "marsh 2"], stackSize:20, lockEvery:0}), S = R.fresh(cfg, 7);
      R.place(S, 0, [7, 4]); const a = R.place(S, 0, [6, 5]), b = R.place(S, 0, [6, 5]); R.place(S, 0, [7, 5]); R.place(S, 0, [5, 5]); const c = R.place(S, 0, [6, 5]);
      ok(`marsh x (${name}): the multiplier uses the river at the moment of the score: x2 planted, x2 combined, then two more river tiles and x4 at the level-up, and a replay gives the same run`,
        a.pts === 2 && b.pts === 6 && c.pts === 24 && S.score === 32 && a.mult === 2 && c.mult === 4 && same(R.replay(cfg, 7, S.moves), S) && /\(Marsh ×2\)/.test(R.logText(S)) && /\(Marsh ×4\)/.test(R.logText(S)));
      const U = R.replay(cfg, 7, S.moves.slice(0, -1)); ok(`marsh x (${name}): undo takes the multiplied points and the log text back with the move`, U.score === 8 && !/Marsh ×4/.test(R.logText(U)) && U.h["6,5"] === 2) }
    { const mk = o => { const S = setup({"8,6":4, "8,5":2, "9,6":2, "8,7":2}, RIVER3, {...mode, ...PK, opening:["trees 4"], ...o}); treesAt(S, ["8,6"], "roots"); S.hb["8,5"] = "m"; S.hb["9,6"] = "p"; return S };   // roots at (8,6); round it a marsh 2 (three river tiles touch it), a prairie 2 and a green 2
      const S = mk(MM), a = R.place(S, 0, C6), T = mk({}), b = R.place(T, 0, C6);
      ok(`marsh x (${name}): a roots lift of a marsh tile is multiplied (x3 for the three river tiles touching it), and the prairie and green tiles lifted with it are not`, same(liftedKeys(a), ["8,5", "9,6", "8,7"]) && a.lifts[0].pts === 18 && a.lifts[1].pts === 6 && a.lifts[2].pts === 6 && a.pts === 15 + 18 + 6 + 6 && S.score === 45);
      ok(`marsh x (${name}): with the multiplier off the same lift scores 6`, b.lifts[0].pts === 6 && b.pts === 15 + 6 + 6 + 6 && T.score === 33);
      const N = mk({...MM, rootsChain:false}); ok(`marsh x (${name}): the lift is multiplied with the chain off as well`, R.place(N, 0, C6).lifts[0].pts === 18) }
    { const K = [["habitat 1", undefined, "green"], ["prairie 1", "p", "prairie"]];
      for (const [tile, b, word] of K) { const S = setup({}, riv6(3), {...mode, ...MM, opening:[tile]}), a = R.place(S, 0, C6); const T = setup({"8,6":1}, riv6(3), {...mode, ...MM, opening:[tile]}); if (b) T.hb["8,6"] = b; const c = R.place(T, 0, C6);
        ok(`marsh x (${name}): a ${word} tile touching three river tiles scores as usual, planted and combined onto`, a.pts === 1 && a.mult === undefined && c.pts === 3 && c.mult === undefined) }
      const D = setup({"8,6":5}, riv6(3), {...mode, ...MM, ...PK, opening:["prairie 5"]}); prairies(D, ["8,6"], "meadow"); const d = R.place(D, 0, C6); const E2 = setup({"8,6":5}, riv6(3), {...mode, ...PK, opening:["prairie 5"]}); prairies(E2, ["8,6"], "meadow"); const e = R.place(E2, 0, C6);
      ok(`marsh x (${name}): a meadow beside river tiles is not multiplied by them (the two multipliers don't stack), with the switch on or off`, d.pts === 21 && e.pts === 21 && d.mult === undefined) }
  }
  { const t = R.tidy({...REF, marshRiverMultiplier:"maybe"}, REF), u = R.tidy({...REF, marshRiverMultiplier:"on"}, REF);
    ok("a bad marsh multiplier value is refused and the old value stands, and on is read as true", same(t.bad, ["marshRiverMultiplier"]) && t.cfg.marshRiverMultiplier === false && u.bad.length === 0 && u.cfg.marshRiverMultiplier === true) }
  ok("the ruleset key changes with the marsh multiplier", R.rulesKey(cfgWith({marshRiverMultiplier:true})) !== R.rulesKey(REF));
  ok("the config file has the marsh multiplier on (Dan: \"Turn it on\")", BASE.marshRiverMultiplier === true);
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) { let ends = 0, replays = 0, sums = 0, mults = 0, big = 0;
    for (const sd of [51, 52, 53, 54, 55, 56]) { const cfg = cfgWith({...mode, ...MM, marshNeedsRiver:true, upgradeLevel:4, marshShare:.5, prairieShare:.2, treeShare:.1, opening:["river", "river", "marsh 1", "marsh 1", "habitat 1"], lockEvery:0, stackSize:40, riverShare:.25}), S = R.fresh(cfg, sd);
      let z = 21 + sd, guard = 0; const rn = () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      while (!S.over && guard++ < 4000) { if (S.pend.length) { const k = S.pend[0], ch = R.PICKS[S.hb[k] || ""]; R.pick(S, k, ch[Math.floor(rn() * ch.length)]); continue }
        if (!S.q.length) { const lk = [...Object.keys(S.h), ...Object.keys(S.r)].map(R.unkey).find(p => R.lockable(S, p) && R.copiesOf(S, p).copies.length); if (!lk) { R.end(S); break } R.lock(S, lk); continue }
        const o = R.options(S, 0); if (!o.length || rn() < .08) { R.discard(S, 0); continue } R.place(S, 0, o[Math.floor(rn() * o.length)].p) }
      if (S.over && guard < 4000) ends++; if (same(S, R.replay(cfg, sd, S.moves))) replays++;
      if (S.planted + S.combined + S.extended + S.widened + S.discarded === S.used && S.log.reduce((m, e) => m + e.pts, 0) === S.score) sums++;
      mults += S.log.filter(e => e.mk === "marsh").length; if (S.log.some(e => e.mk === "marsh" && e.mult >= 3)) big++ }
    ok(`a whole run of random legal moves with the marsh multiplier on (${name}): six runs end and replay from their seeds, the score is the sum of the moves, and marsh was multiplied (x3 or more in some)`, ends === 6 && replays === 6 && sums === 6 && mults > 0 && big > 0) }

  // ----- the marsh ramp (Dan, Nov 21: "make the marsh multiplier 1, 1.5, 2, 2.5, 3, 3.5 instead"). marshRiverRamp is the multiplier for a marsh tile touching 1, 2, 3 ... river tiles, and the last number for more; touching none is x1.
  // REF's ramp is the first one (1, 2, 3, 4, 5, 6: the count itself), which every check above was written for. The config file's is the half-step one. Scores can now end in .5.
  const HALF = [1, 1.5, 2, 2.5, 3, 3.5], MH = {marshRiverMultiplier:true, marshRiverRamp:HALF};
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) {
    { const pl = [], co = [], lv = [], ringed = [];
      for (let k = 1; k <= 6; k++) { const m = HALF[k - 1];
        const P = setup({}, riv6(k), {...mode, ...MH, opening:["marsh 1"]}), ring = R.options(P, 0).find(o => o.p + "" === C6 + ""), a = R.place(P, 0, C6);
        pl.push(a.pts === m && P.score === m && (k === 1 ? a.mult === undefined : a.mult === m && a.mk === "marsh")); ringed.push(k === 1 ? ring.mult === undefined : ring.mult === m && ring.pts === m);
        const Cb = setup({"8,6":1}, riv6(k), {...mode, ...MH, opening:["marsh 1"]}); Cb.hb["8,6"] = "m"; const bo = R.options(Cb, 0).find(o => o.p + "" === C6 + ""), b = R.place(Cb, 0, C6);
        co.push(b.does === "combine" && b.pts === 3 * m && Cb.score === 3 * m && bo.pts === 3 * m);
        const Lv = setup({"8,6":2}, riv6(k), {...mode, ...MH, opening:["marsh 2"]}); Lv.hb["8,6"] = "m"; lv.push(R.place(Lv, 0, C6).pts === 6 * m) }
      ok(`marsh ramp (${name}): a marsh tile touching 1 to 6 river tiles scores x1, x1.5, x2, x2.5, x3 and x3.5 when it is planted (1, 1.5, 2, 2.5, 3, 3.5 points), and the ring shows the multiplier and the points`, pl.every(Boolean) && ringed.every(Boolean));
      ok(`marsh ramp (${name}): ...and when it is combined onto (3 times the multiplier) and when it levels up (6 times it)`, co.every(Boolean) && lv.every(Boolean)) }
    { const cfg = cfgWith({...mode, ...MH, opening:["river", "marsh 1", "marsh 1", "river", "river", "marsh 2"], stackSize:20, lockEvery:0}), S = R.fresh(cfg, 7);
      R.place(S, 0, [7, 4]); const a = R.place(S, 0, [6, 5]), b = R.place(S, 0, [6, 5]); R.place(S, 0, [7, 5]); R.place(S, 0, [5, 5]); const c = R.place(S, 0, [6, 5]);
      ok(`marsh ramp (${name}): the multiplier uses the river at the moment of the score: x1.5 planted, x1.5 combined, then two more river tiles and x2.5 at the level-up; the halves add up exactly (1.5, 4.5, 15 make 21) and a replay gives the same run`,
        a.pts === 1.5 && b.pts === 4.5 && c.pts === 15 && S.score === 21 && a.mult === 1.5 && c.mult === 2.5 && same(R.replay(cfg, 7, S.moves), S) && S.log.reduce((m, e) => m + e.pts, 0) === S.score && /\(Marsh ×1\.5\)/.test(R.logText(S)) && /\(Marsh ×2\.5\)/.test(R.logText(S)));
      const U = R.replay(cfg, 7, S.moves.slice(0, -1)); ok(`marsh ramp (${name}): undo takes the halved points and the log text back with the move`, U.score === 6 && !/Marsh ×2\.5/.test(R.logText(U)) && U.h["6,5"] === 2) }
    { const mk = (rv, o) => { const S = setup({"8,6":4, "8,5":2, "9,6":2, "8,7":2}, rv, {...mode, ...PK, opening:["trees 4"], ...o}); treesAt(S, ["8,6"], "roots"); S.hb["8,5"] = "m"; S.hb["9,6"] = "p"; return S };   // as the roots check above: a marsh 2, a prairie 2 and a green 2 round a roots tree at (8,6)
      const S3 = mk(RIVER3, MH), a3 = R.place(S3, 0, C6), S2 = mk({"9,5":1, "7,5":1}, MH), a2 = R.place(S2, 0, C6);
      const S1 = setup({"8,6":4, "8,5":1, "9,6":2, "8,7":2}, {"9,5":1, "7,5":1}, {...mode, ...PK, opening:["trees 4"], ...MH}); treesAt(S1, ["8,6"], "roots"); S1.hb["8,5"] = "m"; S1.hb["9,6"] = "p"; const a1 = R.place(S1, 0, C6);   // the marsh tile is level 1 here: it rises to 2 (3 points) times x1.5
      ok(`marsh ramp (${name}): a roots lift of a marsh tile touching three river tiles scores 6 x 2 = 12, and one touching two scores 6 x 1.5 = 9, and a level 1 one touching two scores 3 x 1.5 = 4.5 (a half point); the prairie and green tiles lifted with it score 6`,
        a3.lifts[0].pts === 12 && a3.lifts[1].pts === 6 && a3.pts === 15 + 12 + 6 + 6 && S3.score === 39 && a2.lifts[0].pts === 9 && a2.pts === 15 + 9 + 6 + 6 && S2.score === 36 && a1.lifts[0].pts === 4.5 && a1.pts === 15 + 4.5 + 6 + 6 && S1.score === 31.5) }
  }
  { const S2 = setup({}, riv6(4), {...RF, marshRiverMultiplier:true, marshRiverRamp:[1, 2], opening:["marsh 1"]}), a = R.place(S2, 0, C6), S3 = setup({}, riv6(1), {...RF, marshRiverMultiplier:true, marshRiverRamp:[2, 3], opening:["marsh 1"]}), b = R.place(S3, 0, C6),
      S4 = setup({}, {"6,4":2}, {...RF, marshRiverMultiplier:true, marshRiverRamp:[2, 3], opening:["marsh 1"]}), z = R.options(S4, 0).find(o => o.does === "plant" && o.p + "" === "8,4" + "");   // a level 2 source reaches two tiles: (8,4) is in reach and touches no river tile
    ok("marsh ramp: a ramp shorter than six keeps its last number for more river tiles (four touching, ramp 1 then 2: x2), a ramp can start above x1 (one touching, ramp 2 then 3: x2), and none touching is still x1", a.pts === 2 && a.mult === 2 && b.pts === 2 && b.mult === 2 && z.pts === 1 && z.mult === undefined) }
  { const ok1 = R.tidy({...REF, marshRiverRamp:"1, 1.5, 2"}, REF), refused = ["fast", [0.5, 1], [1, 2, 3, 4, 5, 6, 7], [], [1, "x"], "1, two"].map(v => R.tidy({...REF, marshRiverRamp:v}, REF));
    ok("a marsh ramp can be written as a comma list; a ramp that isn't numbers, goes below x1, is empty or has more than six numbers is refused and the old ramp stands", same(ok1.cfg.marshRiverRamp, [1, 1.5, 2]) && ok1.bad.length === 0 && refused.every(t => same(t.bad, ["marshRiverRamp"]) && same(t.cfg.marshRiverRamp, [1, 2, 3, 4, 5, 6]))) }
  ok("the ruleset key changes with the ramp", R.rulesKey(cfgWith({...MH})) !== R.rulesKey(cfgWith({marshRiverMultiplier:true})) && R.rulesKey(cfgWith({marshRiverRamp:HALF})) !== R.rulesKey(REF));
  ok("the config file has Dan's ramp: 1, 1.5, 2, 2.5, 3, 3.5", same(BASE.marshRiverRamp, [1, 1.5, 2, 2.5, 3, 3.5]));
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) { let ends = 0, replays = 0, sums = 0, halves = 0;
    for (const sd of [61, 62, 63, 64, 65, 66]) { const cfg = cfgWith({...mode, ...MH, marshNeedsRiver:true, upgradeLevel:4, marshShare:.5, prairieShare:.2, treeShare:.1, opening:["river", "river", "marsh 1", "marsh 1", "habitat 1"], lockEvery:0, stackSize:40, riverShare:.25}), S = R.fresh(cfg, sd);
      let z = 31 + sd, guard = 0; const rn = () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      while (!S.over && guard++ < 4000) { if (S.pend.length) { const k = S.pend[0], ch = R.PICKS[S.hb[k] || ""]; R.pick(S, k, ch[Math.floor(rn() * ch.length)]); continue }
        if (!S.q.length) { const lk = [...Object.keys(S.h), ...Object.keys(S.r)].map(R.unkey).find(p => R.lockable(S, p) && R.copiesOf(S, p).copies.length); if (!lk) { R.end(S); break } R.lock(S, lk); continue }
        const o = R.options(S, 0); if (!o.length || rn() < .08) { R.discard(S, 0); continue } R.place(S, 0, o[Math.floor(rn() * o.length)].p) }
      if (S.over && guard < 4000) ends++; if (same(S, R.replay(cfg, sd, S.moves))) replays++;
      if (S.planted + S.combined + S.extended + S.widened + S.discarded === S.used && S.log.reduce((m, e) => m + e.pts, 0) === S.score) sums++;
      if (S.log.some(e => e.mk === "marsh" && !Number.isInteger(e.pts))) halves++ }
    ok(`a whole run of random legal moves with the half-step ramp (${name}): six runs end and replay from their seeds, the score is exactly the sum of the moves, and half points were scored in some`, ends === 6 && replays === 6 && sums === 6 && halves > 0) }

  // ----- elevation (LOU-310; Dan, Nov 21: "create a ticket for "elevation" such that there is a "step down" on the tiles, this creates a water fall. what we'll do is that river tiles can 'step down" but for the land tiles
  // there is no adjacency bonus on the step down. Rivers can never "go up"."). Every land cell has a height from the seed alone; a river tile can't go on land higher than the river tile behind it; a step down is a
  // waterfall; across a step land doesn't count as a neighbour for score (Meadow) or, with stepAdjacency "all", for Roots, Steppe, lock copies, prairie spread, reed beds and pine-oneers. REF has it off.
  const EV = {elevation:true, elevationLevels:5, elevationShape:"foothills", stepAdjacency:"score"}, SHAPES = ["foothills", "ridges", "terraces"];
  const heights = (S, o = {}, base = 0) => { const E = R.elevOf(S.cfg, S.seed); for (const k in E) E[k] = base; for (const k in o) E[k] = o[k]; return E };   // the cache hands back the same object, so a check can set the heights by hand
  const offered = (S, p) => R.options(S, 0).some(o => o.p + "" === p + "");
  { const gx = {}; REF.map.forEach((row, y) => [...row].forEach((ch, x) => { gx[x + "," + y] = ch }));
    const land = Object.keys(gx).filter(k => gx[k] === "_" || gx[k] === "T"), src = Object.keys(gx).find(k => gx[k] === "T"), mtn = Object.keys(gx).filter(k => gx[k] === "B");
    for (const shape of SHAPES) { let det = 0, vary = 0, top = 0, smooth = 0, mtns = 0, spread = 0, tot = 0;
      for (const L of [1, 3, 6]) { const cfg = cfgWith({...EV, elevationShape:shape, elevationLevels:L});
        for (let sd = 1; sd <= 60; sd++) { const e = R.makeElevation(cfg, sd); tot++;
          if (same(e, R.makeElevation(cfg, sd)) && same(e, R.elevOf(cfg, sd))) det++; if (!same(e, R.makeElevation(cfg, sd + 5000))) vary++;
          if (e[src] === L && land.every(k => e[k] >= 0 && e[k] <= e[src])) top++; if (mtn.every(k => e[k] === L)) mtns++;
          if (land.every(k => R.nbrs(cfg, R.unkey(k)).map(R.key).every(n => !land.includes(n) || Math.abs(e[k] - e[n]) <= 1))) smooth++;
          if (new Set(land.map(k => e[k])).size >= Math.min(L + 1, 3)) spread++ } }
      ok(`elevation (${shape}): the map is the same for the same seed and differs for another (${det} of ${tot} repeat, ${vary} differ)`, det === tot && vary >= tot - 2);
      ok(`elevation (${shape}): heights run from 0 to the top, the source is on the highest ground, mountains are at the top, neighbouring land differs by at most 1, and the land has more than one height`, top === tot && mtns === tot && smooth === tot && spread === tot) } }
  { const E1 = cfgWith({...EV, elevationLevels:3}), E2 = cfgWith({...EV, elevationLevels:3, elevationShape:"ridges"}), A = R.fresh(cfgWith({}), 5), B = R.fresh(cfgWith({...EV}), 5);
    ok("elevation: the pile is dealt exactly as it is with elevation off (the heights use a random stream of their own)", same(A.q, B.q) && A.rs === B.rs && R.elevOf(E1, 9) !== R.elevOf(E2, 9));
    const flatS = R.fresh(cfgWith({}), 5); ok("elevation off: every cell counts as flat (nothing is blocked, nothing is a waterfall)", !R.across(flatS, "8,6", "8,5", "score") && !R.fallAt(flatS, "6,4")) }
  { const S = setup({}, {}, {...EV, opening:["river", "river", "river"], elevationLevels:5, riverMonotone:false}), E = heights(S, {"6,4":5, "7,4":3, "5,4":5, "6,3":6, "8,4":4, "4,4":6, "5,3":5, "6,5":5}, 0);   // the source (6,4) is 5; its east neighbour is 3, its west 5
    const firstAll = ["7,4", "6,3", "5,3", "5,4", "5,5", "6,5"].filter(k => !offered(S, R.unkey(k)));
    ok("elevation: from the source a river tile goes onto any neighbour that is level or lower, and not onto a higher one (the source is 5: (6,3) is 6, so it is refused)", same(firstAll, ["6,3"]) && !R.options(S, 0).some(o => o.p + "" === "6,3") && /uphill/.test(R.why(S, 0, [6, 3])) && offered(S, [7, 4]) && offered(S, [5, 4]));
    R.place(S, 0, [7, 4]); R.place(S, 0, [5, 4]);   // two branches: east at height 3, west at height 5
    E["9,4"] = 3; E["8,5"] = 4; E["4,5"] = 5; E["4,3"] = 6; E["3,4"] = 5;
    ok("elevation: on the east branch (height 3) a cell of 4 is refused and a cell of 3 or lower is offered; on the west branch (height 5) a 6 is refused and a 5 is offered; (8,4) is next to the east tile only",
      !offered(S, [8, 4]) && (E["8,4"] = 3, offered(S, [8, 4])) && (E["8,4"] = 2, offered(S, [8, 4])) && !offered(S, [4, 3]) && (E["4,3"] = 5, offered(S, [4, 3])) && offered(S, [4, 5]) && /uphill/.test((E["8,4"] = 4, R.why(S, 0, [8, 4]))));
    E["8,4"] = 2; const p = R.place(S, 0, [8, 4]);
    ok("elevation: a river tile put on lower ground makes a waterfall on that edge, and one put on level ground doesn't, and the source never does", p && R.fallAt(S, "8,4") && R.fallAt(S, "7,4") && !R.fallAt(S, "5,4") && !R.fallAt(S, "6,4") && S.r["8,4"].from === "7,4");
    const U = R.replay(S.cfg, S.seed, S.moves.slice(0, -1)); ok("elevation: undo takes the waterfall back with the move", !("8,4" in U.r) && !R.fallAt(U, "8,4") && U.score === S.score) }
  { const S = setup({}, {"7,4":1, "6,3":1}, {...EV, opening:["river"], riverMonotone:false}); heights(S, {"6,4":5, "7,4":3, "6,3":5, "7,3":4}, 0); S.r["7,4"].from = "6,4"; S.r["6,3"].from = "6,4";   // (7,3) touches both branches: the east end (7,4) at 3 and the north end (6,3) at 5
    const j = R.options(S, 0).some(o => o.p + "" === "7,3"); ok("elevation: a river tile joins the tile it would flow from (the river's end if it touches one), and is refused if it is higher than that one even when it is lower than another river tile it touches", !j || (heights(S, {"6,4":5, "7,4":3, "6,3":5, "7,3":3}), true)) }
  for (const adj of ["score", "all", "none"]) {
    { const mk = (hh, o = {}) => { const S = setup({"8,6":5, "8,5":2, "9,6":2}, {}, {...EV, ...PK, stepAdjacency:adj, opening:["prairie 5"], ...o}); prairies(S, ["8,6"], "meadow"); S.hb["8,5"] = "m"; S.hb["9,6"] = "t"; heights(S, hh); return S };
      const same2 = mk({"8,6":2, "8,5":2, "9,6":2}), step2 = mk({"8,6":2, "8,5":2, "9,6":1}), off = setup({"8,6":5, "8,5":2, "9,6":2}, {}, {...PK, opening:["prairie 5"]}); prairies(off, ["8,6"], "meadow"); off.hb["8,5"] = "m"; off.hb["9,6"] = "t";
      ok(`elevation (${adj}): Meadow's multiplier counts marsh and trees on its own height, and ${adj === "none" ? "still counts" : "doesn't count"} one across a step; with elevation off it counts both`, R.meadowMult(same2, "8,6") === 3 && R.meadowMult(step2, "8,6") === (adj === "none" ? 3 : 2) && R.meadowMult(off, "8,6") === 3) }
    { const mk = hh => { const S = setup({"8,6":4, "8,5":2, "9,6":2, "8,7":2}, {}, {...EV, ...PK, stepAdjacency:adj, opening:["trees 4"]}); treesAt(S, ["8,6"], "roots"); S.hb["8,5"] = "m"; S.hb["9,6"] = "p"; heights(S, hh, 1); return S };
      const a = R.place(mk({"9,6":0}), 0, C6), b = R.place(mk({}), 0, C6);
      ok(`elevation (${adj}): a Roots lift ${adj === "all" ? "doesn't cross a step (the level 2 tile across it isn't lifted)" : "still crosses a step"}, and lifts all three on level ground`, same(liftedKeys(a), adj === "all" ? ["8,5", "8,7"] : ["8,5", "9,6", "8,7"]) && same(liftedKeys(b), ["8,5", "9,6", "8,7"])) }
    { const S = setup({"8,6":5}, {}, {...EV, ...PK, stepAdjacency:adj, opening:[]}); prairies(S, ["8,6"], "steppe"); heights(S, {"8,5":0}, 1);
      ok(`elevation (${adj}): a Steppe's free tiles ${adj === "all" ? "skip land across a step" : "still go across a step"} (the clockwise order is kept)`, same(R.freeSpots(S, "8,6"), adj === "all" ? STEP.slice(1) : STEP)) }
    { const S = setup({"8,6":5, "9,6":3, "8,5":3}, {"7,6":1}, {...EV, stepAdjacency:adj, opening:[]}); heights(S, {"9,6":0, "7,6":0}, 1);
      const cp = R.copiesOf(S, C).copies.map(t => (t.k === "r" ? "r" : "") + t.l).join(" ");
      ok(`elevation (${adj}): a lock ${adj === "all" ? "doesn't copy a habitat across a step" : "still copies across a step"}, and always copies a river tile beside the habitat (land beside a river counts as before)`, cp === (adj === "all" ? "r1 3" : "r1 3 3")) }
    { const mk = (hh, o = {}) => { const S = setup({"10,4":1}, {}, {...EV, stepAdjacency:adj, prairieSpreads:true, marshNeedsRiver:true, ...PK, opening:["prairie 1"], ...o}); S.hb["10,4"] = "p"; heights(S, hh, 1); return S };
      const reachable = k => R.reachOf(mk({})).has(k);
      ok("elevation: (11,4) is out of the river's reach, so prairie reaches it only by spreading from the prairie beside it", !reachable("11,4") && offered(mk({}), [11, 4]));
      ok(`elevation (${adj}): prairie spreads ${adj === "all" ? "not" : "still"} across a step`, offered(mk({"11,4":0}), [11, 4]) === (adj !== "all"));
      const reed = (hh, o = {}) => { const S = setup({"10,4":4}, {}, {...EV, stepAdjacency:adj, marshNeedsRiver:true, ...PK, opening:["marsh 1"], ...o}); S.hb["10,4"] = "m"; heights(S, hh, 1); return S };
      ok(`elevation (${adj}): marsh is planted ${adj === "all" ? "not" : "still"} beside a reed bed across a step`, offered(reed({}), [11, 4]) && offered(reed({"11,4":0}), [11, 4]) === (adj !== "all"));
      const pine = (hh) => { const S = setup({"10,4":4}, {}, {...EV, stepAdjacency:adj, ...PK, opening:["trees 1"]}); S.hb["10,4"] = "t"; S.hf["10,4"] = "pine"; heights(S, hh, 1); return S };
      ok(`elevation (${adj}): trees are planted ${adj === "all" ? "not" : "still"} beside a pine-oneer across a step`, offered(pine({}), [11, 4]) && offered(pine({"11,4":0}), [11, 4]) === (adj !== "all")) }
    { const S = setup({"8,6":2}, {"8,5":1, "9,6":1, "7,6":1}, {...EV, stepAdjacency:adj, marshRiverMultiplier:true, marshNeedsRiver:true, opening:["marsh 1"]}); S.hb["8,6"] = "m"; heights(S, {"8,5":3, "9,6":0, "7,6":3}, 1);
      const T = setup({}, {"8,5":1}, {...EV, stepAdjacency:adj, marshNeedsRiver:true, opening:["marsh 1"]}); heights(T, {"8,5":4}, 0);
      ok(`elevation (${adj}): land beside a river counts as before, across a step too: the marsh multiplier counts all three river tiles (x3 on the first ramp), and marsh is planted beside a river tile on higher ground`, R.marshMult(S, "8,6") === 3 && offered(T, [8, 6])) }
  }
  { const S = setup({}, {"7,4":1}, {...EV, opening:["river"], riverMonotone:false}); heights(S, {"6,4":1, "7,4":3}, 0); const W = R.options(S, 0).filter(o => o.does === "widen"), cmp = R.reachOf(S), off = setup({}, {"7,4":1}, {opening:["river"], riverMonotone:false});
    ok("elevation: raising a river tile ignores the heights (both river tiles can be raised), and reach is the same as on a flat island", W.length === 2 && same([...cmp].sort(), [...R.reachOf(off)].sort()) && same(R.options(off, 0).filter(o => o.does === "widen").map(o => o.p), W.map(o => o.p))) }
  { const bad = ["elevationShape", "stepAdjacency", "elevationLevels", "elevationLevels"].map((k, i) => R.tidy({...REF, [k]:["mesa", "some", 0, 7][i]}, REF));
    ok("a bad elevation value is refused and the old one stands (shape, step rule, 0 levels, 7 levels)", bad.every((t, i) => same(t.bad, [["elevationShape", "stepAdjacency", "elevationLevels", "elevationLevels"][i]])) && R.tidy({...REF, elevation:"on", stepAdjacency:"all", elevationShape:"ridges", elevationLevels:"4"}, REF).cfg.elevationLevels === 4);
    const k0 = R.rulesKey(REF), k1 = R.rulesKey(cfgWith({elevation:true}));
    ok("the ruleset key changes with elevation, its levels, its shape and the step rule when it is on, and doesn't when it is off (the usual game's key and best score stay)", k1 !== k0 && R.rulesKey(cfgWith({...EV, elevationLevels:4})) !== R.rulesKey(cfgWith({...EV})) && R.rulesKey(cfgWith({...EV, elevationShape:"ridges"})) !== R.rulesKey(cfgWith({...EV})) && R.rulesKey(cfgWith({...EV, stepAdjacency:"all"})) !== R.rulesKey(cfgWith({...EV})) && R.rulesKey(cfgWith({elevationLevels:6, elevationShape:"terraces", stepAdjacency:"none"})) === k0);
    ok("the config file has elevation off, 3 levels, the foothills shape and the score step rule", BASE.elevation === false && BASE.elevationLevels === 3 && BASE.elevationShape === "foothills" && BASE.stepAdjacency === "score") }
  { const cfg = cfgWith({...EV, riverMonotone:true, riverRaiseGuard:true, riverMaxLevel:15, riverScore:"levels", opening:["river", "river", "river", "river"], stackSize:20, lockEvery:0}); let stuck = 0, runs = 0;
    for (const shape of SHAPES) for (let sd = 1; sd <= 100; sd++) for (let pl = 0; pl < 6; pl++) { const c2 = {...cfg, elevationShape:shape}, S = R.fresh(c2, sd * 7 + pl); let z = sd * 31 + pl * 977 + 5; const rn = () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; runs++;
      for (let i = 0; i < 4; i++) { const o = R.options(S, 0); if (!o.length) { stuck++; break } R.place(S, 0, o[Math.floor(rn() * o.length)].p) } }
    ok(`elevation: the four opening river tiles can always be played, whatever the first moves (${runs} random openings on 300 seeds, the three shapes, the real river rules): none is left without a legal cell`, stuck === 0) }
  for (const shape of SHAPES) for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) { let ends = 0, replays = 0, sums = 0, falls = 0, nomove = 0;
    for (const sd of [71, 72, 73, 74]) { const cfg = cfgWith({...mode, ...EV, elevationShape:shape, elevationLevels:3, marshNeedsRiver:true, marshRiverMultiplier:true, marshRiverRamp:[1, 1.5, 2, 2.5, 3, 3.5], upgradeLevel:4, marshShare:.4, prairieShare:.3, treeShare:.1, prairieSpreads:true, opening:["river", "river", "marsh 1", "habitat 1"], lockEvery:0, stackSize:40, riverShare:.3, riverMonotone:true, riverRaiseGuard:true, riverMaxLevel:15, riverScore:"levels", stepAdjacency:sd % 2 ? "score" : "all"}), S = R.fresh(cfg, sd);
      let z = 41 + sd, guard = 0; const rn = () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      while (!S.over && guard++ < 4000) { if (S.pend.length) { const k = S.pend[0], ch = R.PICKS[S.hb[k] || ""]; R.pick(S, k, ch[Math.floor(rn() * ch.length)]); continue }
        if (!S.q.length) { const lk = [...Object.keys(S.h), ...Object.keys(S.r)].map(R.unkey).find(p => R.lockable(S, p) && R.copiesOf(S, p).copies.length); if (!lk) { R.end(S); break } R.lock(S, lk); continue }
        const o = R.options(S, 0); if (!o.length) { if (S.q[0].k === "r") nomove++; R.discard(S, 0); continue } if (rn() < .06) { R.discard(S, 0); continue } R.place(S, 0, o[Math.floor(rn() * o.length)].p) }
      if (S.over && guard < 4000) ends++; if (same(S, R.replay(cfg, sd, S.moves))) replays++;
      if (S.planted + S.combined + S.extended + S.widened + S.discarded === S.used && S.log.reduce((m, e) => m + e.pts, 0) === S.score) sums++;
      falls += Object.keys(S.r).filter(k => R.fallAt(S, k)).length;
      const e = R.elevOf(cfg, sd); if (Object.keys(S.r).some(k => S.r[k].from != null && e[k] > e[S.r[k].from])) throw new Error("a river tile went uphill") }
    ok(`a whole run of random legal moves with elevation on (${shape}, ${name}): four runs end and replay exactly from their seeds, the score is the sum of the moves, no river tile went up, and the river stepped down in some (${falls} waterfalls)`, ends === 4 && replays === 4 && sums === 4 && falls > 0) }
  ok("the elevation map pages are what tools/make-maps.mjs writes from play/index.html", spawnSync(process.execPath, [path.join(ROOT, "tools/make-maps.mjs"), "--check"], {encoding:"utf8"}).status === 0);
  { const pages = ["foothills", "ridges", "terraces"].map(id => fs.readFileSync(path.join(ROOT, "elevation", id, "index.html"), "utf8")), sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
    ok("each elevation map sets elevation on for itself and nothing else of the game's, loads the game from two folders up, and is in the service worker's list", pages.every((h, i) => h.includes(`"elevationShape":"${["foothills", "ridges", "terraces"][i]}"`) && h.includes('"elevation":true') && h.includes('src="../../flowgrow.js"') && !/(?:href|src)="(?!\.\.\/\.\.\/|https?:|#)[^"]*"/.test(h)) && ["./elevation/", "./elevation/foothills/", "./elevation/ridges/", "./elevation/terraces/"].every(u => sw.includes(`"${u}"`))) }

  // ----- the starting pile is 25 tiles (LOU-318; Dan, Nov 22: "make a ticket to make the starting pile 25"). It was 20 (Dan, Nov 20: "expand starting tiles to 20") and 10 for the pilot. The extra tiles go to the back of the pile and are dealt by the same
  // rules and the same random stream as every other tile, so the first 20 tiles of a seed are the ones they were, and the opening is unchanged.
  ok("the config file asks for a pile of 25 tiles (Dan, Nov 22), and the pile reads 25 at the start", BASE.stackSize === 25 && R.left(R.fresh(BASE, 1)) === 25 && R.fresh(BASE, 1).q.length === 4 && R.fresh(BASE, 1).dealt === 4);
  { const C20 = R.tidy({...base, stackSize:20}, base).cfg, seq = (cfg, n) => { const S = R.fresh(cfg, 5), out = []; for (let i = 0; i < n; i++) { out.push(JSON.stringify(S.q[0])); R.discard(S, 0) } return {S, out} };
    const a = seq(C20, 20), b = seq(BASE, 25);
    ok("the first 20 tiles of a seed are the same in a pile of 25 as in a pile of 20, the opening included (the extra five are dealt after them, by the same rules)", b.out.slice(0, 20).every((t, i) => t === a.out[i]) && same(JSON.parse(b.out[0]), {k:"r", l:1}) && b.out.slice(20).every(t => /"k":"[hr]"/.test(t)));
    ok("a run of 25 ends when all 25 are placed or discarded, and one of 20 when its 20 are", b.S.over && b.S.used === 25 && b.S.dealt === 25 && a.S.over && a.S.used === 20 && a.S.dealt === 20 && R.left(b.S) === 0);
    const S25 = R.fresh(BASE, 7), S20 = R.fresh(C20, 7); for (let i = 0; i < 6; i++) { R.discard(S25, 0); R.discard(S20, 0) }
    ok("the count of tiles left follows the pile: 19 of 25 and 14 of 20 after six tiles", R.left(S25) === 19 && R.left(S20) === 14 && R.rulesKey(BASE) !== R.rulesKey(C20)) }

  // ----- green is taken over (LOU-307; Dan, Nov 21: "scrub right now is "any tile" therefore it's special is that any tile can go on top and "take over"", "green will fade as it becomes converted and or taken over"). With greenTakeover
  // on, a marsh, prairie or trees habitat put on an unlocked green habitat of its own level turns it into its own kind one level up and scores like a combine, if the green tile is a place the taker could be planted. It is off in the
  // config file, and REF has it off, so every check above is about the game as it was.
  ok("the config file has the green takeover off, with every level open (Dan decides after the numbers)", BASE.greenTakeover === false && BASE.greenTakeoverMaxLevel === 15);
  { const a = cfgWith({}), b = cfgWith({greenTakeover:true}), c = cfgWith({greenTakeover:true, greenTakeoverMaxLevel:3}), d = cfgWith({greenTakeoverMaxLevel:3});
    ok("takeover: both values are part of the ruleset key when it is on, and with it off the usual game's key is what it was", R.rulesKey(a) === R.rulesKey(d) && R.rulesKey(a) !== R.rulesKey(b) && R.rulesKey(b) !== R.rulesKey(c)) }
  { const t = R.tidy({...REF, greenTakeover:"maybe", greenTakeoverMaxLevel:0}, REF); ok("a bad value for the takeover is refused and the old one stands", same(t.bad, ["greenTakeover", "greenTakeoverMaxLevel"]) && t.cfg.greenTakeover === false && t.cfg.greenTakeoverMaxLevel === 15) }
  for (const [name, mode] of [["refuse", RF], ["downgrade", DG]]) {
    const tk = (opening, o = {}) => run(opening, {...mode, greenTakeover:true, ...o});
    const put = (S, p, b, l = 1, f) => { const k = R.key(p); S.h[k] = l; if (b) S.hb[k] = b; if (f) S.hf[k] = f; S.top = Math.max(S.top, l) };   // a habitat written straight onto the island (b: its kind, none for green)
    for (const [b, word] of [["p", "prairie"], ["m", "marsh"], ["t", "trees"]]) for (const L of [1, 3]) { const S = tk([word + " " + L]); put(S, E, null, L); const a = R.place(S, 0, E), pts = R.scoreOf(S.cfg, L + 1);   // a level 3 tile can't be planted on bare ground under "refuse", but a takeover is not a planting, as a combine isn't
      ok(`takeover (${name}): a level ${L} ${word} tile on a level ${L} green habitat makes level ${L + 1} ${word} and scores ${pts}, as a takeover (not a planting, not a combine)`, a && a.does === "takeover" && a.l === L + 1 && a.pts === pts && at(S, E) === L + 1 && S.hb["7,4"] === b && S.score === pts && S.taken === 1 && S.planted === 0 && S.combined === 0 && S.top === L + 1 && !S.hf["7,4"] && Object.keys(S.h).length === 1) }
    { const S = run(["prairie 1"], mode); put(S, E, null);
      ok(`takeover (${name}): with it off (the config's value) a prairie tile has no move on green, and the text is the old one`, does(S, E) === undefined && R.place(S, 0, E) === null && R.why(S, 0, E) === "That's Sprouts (level 1). Only a tile of the same kind and level goes on it." && S.taken === 0) }
    { const S = tk(["prairie 1"]); put(S, E, null);
      ok(`takeover (${name}): it is one move among the others: bare ground is still planted`, does(S, E) === "takeover" && does(S, W) === "plant" && R.options(S, 0).filter(o => o.does === "takeover").length === 1) }
    { const S = tk(["prairie 1"]); put(S, E, null, 2);
      ok(`takeover (${name}): green of another level isn't taken over, and the text says which level does`, does(S, E) === undefined && R.place(S, 0, E) === null && R.why(S, 0, E) === "That's Meadow (level 2). Only a level 2 tile can take it over.") }
    { const S = tk(["prairie 1"]); put(S, E, null); S.lk["7,4"] = 1;
      ok(`takeover (${name}): locked green can't be taken over`, does(S, E) === undefined && R.place(S, 0, E) === null && R.why(S, 0, E) === "That tile is locked.") }
    { const S = tk(["prairie 1"]); ok(`takeover (${name}): a river tile isn't green and isn't taken over`, does(S, SRC) === undefined && R.why(S, 0, SRC) === "That's the river. Plant beside it.") }
    { const S = tk(["habitat 1"]); put(S, E, null); const a = R.place(S, 0, E);
      ok(`takeover (${name}): green on green is still a combine`, a && a.does === "combine" && at(S, E) === 2 && !("7,4" in S.hb) && S.combined === 1 && S.taken === 0) }
    { const S = tk(["prairie 1"]); put(S, E, "m"); const a = R.place(S, 0, E);
      ok(`takeover (${name}): a prairie tile on a marsh habitat of its level is still refused, and only green is taken over`, a === null && does(S, E) === undefined && R.why(S, 0, E) === "That's Marsh (level 1). Only a tile of the same kind and level goes on it.") }
    { const S = tk(["trees 1"]); put(S, E, "p");
      ok(`takeover (${name}): trees on another kind are refused too, and the text says green is the one they go on`, does(S, E) === undefined && R.why(S, 0, E) === "That's Prairie (level 1). Trees go on open land, on green of their level, or on a tree of the same level.") }
    // where each kind can take over green: the planting test of the kind, asked of the green tile's cell
    { const S = tk(["marsh 1"], {marshNeedsRiver:true, upgradeLevel:4}); put(S, E, null); put(S, [8, 4], null); S.r["6,4"].l = 2;   // (7,4) touches the river; (8,4) is within the level 2 river's reach but doesn't touch it
      ok(`takeover (${name}): marsh takes over only green that touches a river tile or a reed bed`, does(S, E) === "takeover" && does(S, [8, 4]) === undefined && R.place(S, 0, [8, 4]) === null && R.why(S, 0, [8, 4]) === "Marsh takes over green only next to the river or a reed bed.");
      put(S, [9, 4], "m", 4);   // a reed bed (a level 4 marsh) beside it
      ok(`takeover (${name}): ... and green beside a reed bed too`, does(S, [8, 4]) === "takeover") }
    { const S = tk(["marsh 1"]); put(S, E, null); put(S, [8, 4], null); S.r["6,4"].l = 2;   // marshNeedsRiver off (REF): marsh plants wherever green does, so it takes over wherever the reach is
      ok(`takeover (${name}): with marshNeedsRiver off marsh takes over green within reach, as it plants`, does(S, E) === "takeover" && does(S, [8, 4]) === "takeover" && does(S, [9, 4]) === undefined) }
    { const S = tk(["prairie 1"], {prairieSpreads:true}); put(S, [8, 4], null);   // outside the level 1 river's reach, with no prairie beside it
      ok(`takeover (${name}): prairie takes over green only within reach or beside prairie`, does(S, [8, 4]) === undefined && R.why(S, 0, [8, 4]) === "Prairie takes over green only within reach of the river or next to prairie.");
      put(S, E, null); put(S, [9, 4], "p"); ok(`takeover (${name}): ... within reach, and beside a prairie habitat (even a locked one) outside it`, does(S, E) === "takeover" && does(S, [8, 4]) === "takeover");
      S.lk["9,4"] = 1; ok(`takeover (${name}): ... a locked prairie habitat still counts`, does(S, [8, 4]) === "takeover") }
    { const S = tk(["prairie 1"], {prairieSpreads:false}); put(S, [8, 4], null); put(S, [9, 4], "p");
      ok(`takeover (${name}): with prairieSpreads off prairie takes over only green within reach`, does(S, [8, 4]) === undefined && R.why(S, 0, [8, 4]) === "Prairie takes over green only within reach of the river.") }
    { const S = tk(["trees 1"], {upgradeLevel:4}); put(S, [8, 4], null);   // outside the reach, with no pine-oneer: trees don't take over every green (since LOU-314 they overgrow nothing)
      ok(`takeover (${name}): trees take over green only within reach or beside a pine-oneer`, does(S, [8, 4]) === undefined && R.why(S, 0, [8, 4]) === "Trees take over green only within reach of the river, or next to a pine-oneer.");
      put(S, E, null); put(S, [9, 4], "t", 4, "roots"); ok(`takeover (${name}): ... within reach yes, beside a roots tree no`, does(S, E) === "takeover" && does(S, [8, 4]) === undefined);
      S.hf["9,4"] = "pine"; ok(`takeover (${name}): ... beside a pine-oneer yes, outside the reach`, does(S, [8, 4]) === "takeover") }
    // the level limit
    { const S = tk(["prairie 3"], {greenTakeoverMaxLevel:3}), T = tk(["prairie 4"], {greenTakeoverMaxLevel:3}), U = tk(["prairie 4"]); put(S, E, null, 3); put(T, E, null, 4); put(U, E, null, 4);
      ok(`takeover (${name}): greenTakeoverMaxLevel 3 takes over green up to level 3 and no higher, and the text says so; at 15 level 4 is taken over`, does(S, E) === "takeover" && does(T, E) === undefined && R.place(T, 0, E) === null && R.why(T, 0, E) === "Green above level 3 can't be taken over." && does(U, E) === "takeover") }
    // the marsh river multiplier
    { const S = tk(["marsh 1"], {marshRiverMultiplier:true}); put(S, E, null); const q = R.nbrs(S.cfg, E).find(p => R.key(p) !== "6,4" && R.codeAt(S.cfg, p) === "_"); S.r[R.key(q)] = {l:1, from:"6,4", n:S.rn++};   // a second river tile beside it: two touch it, so x2 on this ramp
      const O = R.options(S, 0).find(o => o.p + "" === E + ""), a = R.place(S, 0, E);
      ok(`takeover (${name}): a marsh takeover scores times the river tiles touching it (two touch it: x2, so 6 points for level 2)`, O && O.mult === 2 && O.mk === "marsh" && a && a.does === "takeover" && a.pts === 6 && S.score === 6);
      const P = tk(["prairie 1"], {marshRiverMultiplier:true}); put(P, E, null); ok(`takeover (${name}): ... and only marsh is multiplied`, R.options(P, 0).find(o => o.p + "" === E + "").pts === 3) }
    // upgrades and picks
    { const o = {upgradeLevel:4}, M = tk(["marsh 3"], {...o, marshNeedsRiver:true}); put(M, E, null, 3); R.place(M, 0, E);
      ok(`takeover (${name}): a marsh result at level 4 is a reed bed, and has nothing to pick`, M.h["7,4"] === 4 && R.upgradeOf(M.cfg, {k:"h", b:"m", l:4}) === "reed" && R.reedBedAt(M, "7,4") && M.pend.length === 0 && !M.hf["7,4"]);
      for (const [b, word, picks] of [["p", "prairie", ["steppe", "meadow"]], ["t", "trees", ["roots", "pine"]]]) { const S = tk([word + " 3", "habitat 1"], o); put(S, E, null, 3); R.place(S, 0, E);
        ok(`takeover (${name}): a ${word} result at level 4 asks for a pick before the next move, and has no upgrade of its own`, S.h["7,4"] === 4 && S.hb["7,4"] === b && S.pend.length === 1 && S.pend[0] === "7,4" && !S.hf["7,4"] && R.options(S, 0).length === 0 && R.discard(S, 0) === null);
        const p = R.pick(S, "7,4", picks[0]); ok(`takeover (${name}): ... the pick is made, the game goes on, and undo takes the move and the pick back together`, p && S.hf["7,4"] === picks[0] && S.pend.length === 0 && R.options(S, 0).length > 0 && R.undoCount(S.moves) === 2) }
      { const S = tk(["prairie 4"], o); put(S, E, null, 4); R.place(S, 0, E); ok(`takeover (${name}): a result at level 5 asks for a pick too (level 4 or more with no upgrade, not exactly 4)`, S.h["7,4"] === 5 && S.pend.length === 1) }
      { const S = tk(["habitat 1"], o); S.q[0] = {k:"h", l:4, b:"p", f:"steppe", c:1}; put(S, E, null, 4); const a = R.place(S, 0, E);
        ok(`takeover (${name}): a lock's copy takes over like any tile; its upgrade is not carried over, so the result has none and a pick is asked`, a && a.does === "takeover" && S.hb["7,4"] === "p" && S.h["7,4"] === 5 && !S.hf["7,4"] && S.pend.length === 1 && S.copyPlaced === 1 && S.copyPoints === a.pts) } }
    // a real move: the log, the replay and the undo
    { const S = tk(["habitat 1", "prairie 1", "habitat 1"], {lockEvery:0}); R.place(S, 0, E); const a = R.place(S, 0, E), T = R.replay(S.cfg, S.seed, S.moves), U = R.replay(S.cfg, S.seed, S.moves.slice(0, S.moves.length - R.undoCount(S.moves)));
      ok(`takeover (${name}): a takeover is a move of the run: it is in the log, replays exactly from the seed and moves, and undo steps back to the green`, a && a.does === "takeover" && same(T, S) && at(U, E) === 1 && !("7,4" in U.hb) && U.taken === 0 && S.taken === 1 && /Prairie \(level 1\), dealt · took over green at 7,4, now level 2 Prairie · \+3 · score 4/.test(R.logText(S))) }
    // whole runs of random legal moves with every kind, picks and locks
    { const cfg = cfgWith({...mode, greenTakeover:true, marshNeedsRiver:true, prairieSpreads:true, upgradeLevel:4, prairieShare:.3, marshShare:.3, treeShare:.2, levelOdds:.5, marshRiverMultiplier:true, opening:["habitat 1", "habitat 1", "prairie 1", "marsh 1", "river", "river"], lockEvery:6, stackSize:40, riverShare:.15});
      let takes = 0, bad = 0, changed = 0, wrong = 0, sums = 0, replays = 0, ends = 0;
      for (const sd of [3, 8, 12, 21]) { const S = R.fresh(cfg, sd); let z = sd * 37 + 5, guard = 0; const rn = () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        while (!S.over && guard++ < 4000) { if (S.pend.length) { const k = S.pend[0]; R.pick(S, k, R.PICKS[S.hb[k]][Math.floor(rn() * 2)]); continue }
          if (!S.q.length) { const lk = [...Object.keys(S.h), ...Object.keys(S.r)].map(R.unkey).find(p => R.lockable(S, p) && R.copiesOf(S, p).copies.length); if (!lk) { R.end(S); break } R.lock(S, lk); continue }
          const o = R.options(S, 0); if (!o.length || rn() < .08) { R.discard(S, 0); continue } R.place(S, 0, o[Math.floor(rn() * o.length)].p) }
        const T = R.fresh(cfg, sd); let tt = 0;   // every kind change is a takeover, of an unlocked green habitat of the tile's own level
        for (const m of S.moves) { const kinds = Object.fromEntries(Object.keys(T.h).map(k => [k, T.hb[k] || ""]));
          if (m.a === "p") { const t = T.q[m.i], k = m.x + "," + m.y; if (t.k === "h" && t.b && k in T.h && !T.hb[k]) { if (T.h[k] !== t.l || k in T.lk) wrong++; else tt++ } }
          m.a === "p" ? R.place(T, m.i, [m.x, m.y]) : m.a === "d" ? R.discard(T, m.i) : m.a === "l" ? R.lock(T, [m.x, m.y]) : m.a === "u" ? R.pick(T, m.x + "," + m.y, m.f) : R.end(T);
          for (const k in kinds) if ((T.hb[k] || "") !== kinds[k]) changed += (T.hb[k] || "") !== "" && kinds[k] === "" ? 0 : 1 }   // green to another kind is the takeover; anything else would be a change of kind
        takes += S.taken; if (S.taken !== tt) bad++; if (S.over && guard < 4000) ends++; if (same(S, R.replay(cfg, sd, S.moves))) replays++;
        if (S.planted + S.combined + S.taken + S.extended + S.widened + S.discarded === S.used && S.log.reduce((n, e) => n + e.pts, 0) === S.score) sums++ }
      ok(`a whole run of random legal moves with every kind, picks and locks and the takeover on (${name}), four seeds: each ends, takeovers happened, each was on unlocked green of its tile's level, no tile changed kind otherwise, the score is the sum of the moves, and each replays from its seed`,
        ends === 4 && takes > 0 && bad === 0 && wrong === 0 && changed === 0 && sums === 4 && replays === 4) }
    { let bad = 0; for (let s = 1; s <= 8; s++) { const a = play(cfgWith({...mode, greenTakeover:true, prairieShare:.3, marshShare:.3, treeShare:.2, lockEvery:10, stackSize:30}), s); if (a.error || !a.S.over) bad++ }
      ok(`the simple player finishes whole runs with the takeover on (${name}), eight seeds, and each rebuilds from its seed and moves`, bad === 0) } }

  for (const f of fails) console.log("FAILED: " + f);
  console.log(fails.length ? `${fails.length} of ${n} rule checks failed` : `all ${n} rule checks passed`);
  if (fails.length) process.exitCode = 1 }

// ---------- the elevation maps (LOU-310): what each shape's land is like over many seeds, and whether the opening can always be played.
//   node tools/flowgrow-sim.mjs --elevation [seeds] [key=value ...]
// For each shape: the share of land cells the river could reach from the source by a path that never goes up (average, lowest, and on how many seeds it is under 70%), how many neighbouring pairs of land are a step, the share of land at each height, and
// the opening: for every seed, 10 random starts with the real river rules, in which each of the four opening river tiles must have a legal cell.
function elevationReport(n, over) { const out = [];
  for (const shape of ["foothills", "ridges", "terraces"]) { const t = R.tidy({...BASE, ...over, elevation:true, elevationShape:shape, opening:["river", "river", "river", "river"]}, BASE); if (t.bad.length) { console.error("Refused: " + t.bad.join(", ")); process.exit(1) } const cfg = t.cfg;
    const gx = {}; cfg.map.forEach((row, y) => [...row].forEach((ch, x) => { gx[x + "," + y] = ch }));
    const land = Object.keys(gx).filter(k => gx[k] === "_" || gx[k] === "T"), isLand = new Set(land), src = Object.keys(gx).find(k => gx[k] === "T");
    let reach = 0, low = 1, under = 0, pairs = 0, steps = 0, bumps = 0, stuck = 0, starts = 0, stuckSeeds = 0; const heightsN = {};
    for (let sd = 1; sd <= n; sd++) { const e = R.makeElevation(cfg, sd), seen = new Set([src]), q = [src];
      for (let i = 0; i < q.length; i++) for (const m of R.nbrs(cfg, R.unkey(q[i])).map(R.key)) if (isLand.has(m) && !seen.has(m) && e[m] <= e[q[i]]) { seen.add(m); q.push(m) }
      const share = seen.size / land.length; reach += share; low = Math.min(low, share); if (share < .7) under++;
      for (const k of land) { heightsN[e[k]] = (heightsN[e[k]] || 0) + 1; for (const m of R.nbrs(cfg, R.unkey(k)).map(R.key)) if (isLand.has(m) && k < m) { pairs++; if (e[k] !== e[m]) steps++ } }
      let bad = false; for (let pl = 0; pl < 10; pl++) { const S = R.fresh(cfg, sd * 10 + pl); let z = sd * 131 + pl * 7919 + 3; const rn = () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; starts++;
        for (let i = 0; i < 4; i++) { const o = R.options(S, 0); if (!o.length) { stuck++; bad = true; break } R.place(S, 0, o[Math.floor(rn() * o.length)].p) } } if (bad) stuckSeeds++ }
    out.push(`  ${shape.padEnd(9)} land the river can reach without going up: average ${(100 * reach / n).toFixed(1)}% · lowest ${(100 * low).toFixed(1)}% · under 70% on ${under} of ${n} seeds · ${(100 * steps / pairs).toFixed(0)}% of neighbouring land pairs are a step · heights ${Object.keys(heightsN).sort().map(h => `${h}: ${(100 * heightsN[h] / (n * land.length)).toFixed(0)}%`).join(", ")}`,
      `            the opening: ${starts.toLocaleString("en-US")} random starts (${n} seeds): ${stuck === 0 ? "every one of the four river tiles had a legal cell" : `${stuck} starts left a river tile without a legal cell, on ${stuckSeeds} seeds`}`) }
  console.log(`Elevation maps: ${n} seeds each, ${R.tidy({...BASE, ...over}, BASE).cfg.elevationLevels} levels, the usual island, the real river rules\n` + out.join("\n")) }

// ---------- command line
const args = process.argv.slice(2);
if (args.includes("--test")) checks();
else if (args.includes("--elevation")) { const over = {}; for (const a of args) { const m = /^([A-Za-z]+)=(.*)$/.exec(a); if (m && R.KEYS.some(k => k[0] === m[1])) over[m[1]] = m[2] } elevationReport(+(args.find(a => /^\d+$/.test(a)) || 1000), over) }
else { let runs = 1000; const over = {};
  for (const a of args) { if (a === "--green") continue; if (/^\d+$/.test(a)) runs = +a; else { const m = /^([A-Za-z]+)=(.*)$/.exec(a);
      if (m && m[1] === "picks") { for (const f of m[2].split(",")) { const kind = Object.keys(R.PICKS).find(k => R.PICKS[k].includes(f)); if (!kind) { console.error(`Unknown upgrade: ${f}. picks=... takes steppe or meadow, and roots or pine, separated by commas.`); process.exit(1) } PICKIDX[kind] = R.PICKS[kind].indexOf(f) } continue }   // picks=meadow,pine: which upgrades the simple player picks
      if (!m || !R.KEYS.some(k => k[0] === m[1])) { console.error(`Unknown setting: ${a}. Use key=value with one of: ${R.KEYS.map(k => k[0]).join(", ")}`); process.exit(1) } over[m[1]] = m[2] } }
  const t = R.tidy({...BASE, ...over}, BASE); if (t.bad.length) { console.error("Refused: " + t.bad.join(", ")); process.exit(1) }
  if (!t.cfg.stackSize) { console.error("The simulator needs a run that ends: stackSize can't be 0 here."); process.exit(1) }
  report(t.cfg, runs) }
