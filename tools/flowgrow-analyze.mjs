#!/usr/bin/env node
// What a saved run did. A developer tool: it is not part of the game and nothing here is loaded by a page.
//
//   node tools/flowgrow-analyze.mjs search-best.json              describe a run saved by tools/flowgrow-search.mjs
//   node tools/flowgrow-analyze.mjs search-best.json maxLevel=7   key=value changes add to, or override, the ones the run was found with
//
// It replays the moves with the game's own rules (flowgrow.config.js and flowgrow.js, loaded as the simulator loads them) and prints where
// the points came from (planted or combined, copies or dealt tiles), what each placement left on the island, which tiles were locked and
// how many copies each banked, and the final island. No packages: plain Node 18 or newer.
import fs from "fs"; import path from "path"; import {fileURLToPath} from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const die = msg => { console.error(msg); process.exit(1) };
const window = {FLOWGROW_SIM: true};
for (const f of ["flowgrow.config.js", "flowgrow.js"]) new Function("window", fs.readFileSync(path.join(ROOT, f), "utf8"))(window);
const R = window.Flowgrow.rules, base = window.FLOWGROW;

const [file, ...rest] = process.argv.slice(2); if (!file) die("Usage: node tools/flowgrow-analyze.mjs <run.json> [key=value ...]");
let run; try { run = JSON.parse(fs.readFileSync(file, "utf8")) } catch (e) { die(`Can't read ${file}: ${e.message}`) }
const over = {...(run.over || {})};
for (const a of rest) { const m = /^([A-Za-z]+)=(.*)$/.exec(a); if (!m || !R.KEYS.some(k => k[0] === m[1])) die(`Unknown setting ${a}. Use key=value with one of: ${R.KEYS.map(k => k[0]).join(", ")}`); over[m[1]] = m[2] }
const made = R.tidy({...base, ...over}, base); if (made.bad.length) die("Refused: " + made.bad.join(", "));
const CFG = made.cfg;
if (run.rules && run.rules !== R.rulesKey(CFG)) console.log("Note: these are not the rules the run was found under (the game's rules or the config changed since). It may not replay.\n");
let S; try { S = R.replay(CFG, run.seed, run.moves) } catch (e) { die(`The run doesn't replay under these rules: ${e.message}\nIt was found with: ${JSON.stringify(run.over || {})}. Pass those as key=value to replay it.`) }

console.log(`seed ${run.seed} · replayed score ${S.score} (saved ${run.score}) · ${S.moves.length} moves · locks ${S.lockUsed} · top level ${S.top} · over ${S.over}`);
const by = {}, lv = {}, lockLv = {}, lockCopies = {};
for (const e of S.log) { if (e.did === "plant" || e.did === "combine" || (e.did === "widen" && e.pts)) { const k = e.did + (e.t.c ? " of copies" : " of dealt tiles"); by[k] = (by[k] || 0) + e.pts; const key = e.did + " to level " + e.l; lv[key] = (lv[key] || 0) + 1 }
  if (e.did === "lock") { const key = (e.t.k === "r" ? "river " : "habitat ") + "L" + e.t.l; lockLv[key] = (lockLv[key] || 0) + 1; lockCopies[key] = (lockCopies[key] || 0) + e.copies.length } }
console.log("points from:", Object.entries(by).map(([k, v]) => `${k} ${v}`).join(" · "));
const low = S.log.filter(e => e.did === "plant" && e.l < e.t.l);   // bare ground mode "downgrade": tiles planted as level 1 (they are inside the "plant" points above)
if (low.length) console.log(`planted as level 1 (bareGroundMode downgrade): ${low.length} tiles, ${low.filter(e => e.t.c).length} of them copies, ${low.reduce((s, e) => s + e.pts, 0)} points`);
console.log("placements:", Object.entries(lv).sort((a, b) => a[0].localeCompare(b[0], undefined, {numeric: true})).map(([k, v]) => `${k}: ${v}`).join(" · "));
console.log("locks (count, average copies banked):", Object.entries(lockLv).sort().map(([k, v]) => `${k}: ${v} (${(lockCopies[k] / v).toFixed(1)})`).join(" · "));
const top = Math.max(S.top, 1);
console.log(`final island: ${Object.keys(S.h).length} habitats, ${Object.keys(S.r).length} river tiles, ${Object.keys(S.lk).length} locked. Habitats by level:`, Array.from({length: top}, (_, i) => `L${i + 1}:${Object.values(S.h).filter(v => v === i + 1).length}`).join(" "));
// What the plant rules of LOU-301 did in this run (replayed move by move): marsh tiles with nothing to plant them on, and prairie planted beyond the river's reach.
if (CFG.marshNeedsRiver || CFG.prairieSpreads) { const T = R.fresh(CFG, run.seed), m = {marshTurns:0, marshNoBank:0, marshDiscards:0, prairieTurns:0, spreadOffered:0, spreadPlanted:0};
  for (const mv of run.moves) { const t = (mv.a === "p" || mv.a === "d") && T.q[mv.i];
    if (t && t.k === "h" && (t.b === "m" || t.b === "p")) { const pl = R.options(T, mv.i).filter(x => x.does === "plant"), reach = R.reachOf(T);
      if (t.b === "m") { m.marshTurns++; if (!pl.length) m.marshNoBank++; if (mv.a === "d") m.marshDiscards++ }
      else { m.prairieTurns++; const beyond = pl.filter(x => !reach.has(R.key(x.p))).map(x => R.key(x.p)); m.spreadOffered += beyond.length; if (mv.a === "p" && beyond.includes(mv.x + "," + mv.y)) m.spreadPlanted++ } }
    mv.a === "p" ? R.place(T, mv.i, [mv.x, mv.y]) : mv.a === "d" ? R.discard(T, mv.i) : mv.a === "l" ? R.lock(T, [mv.x, mv.y]) : mv.a === "u" ? R.pick(T, mv.x + "," + mv.y, mv.f) : R.end(T) }
  const land = CFG.map.join("").split("_").length - 1, empty = land - Object.keys(S.h).length - (Object.keys(S.r).length - 1);
  console.log(`marsh: ${m.marshTurns} marsh tiles in hand, nothing to plant on in ${m.marshNoBank} of those turns, ${m.marshDiscards} discarded · prairie: ${m.prairieTurns} in hand, ${m.spreadPlanted} planted beyond the river's reach, ${m.prairieTurns ? (m.spreadOffered / m.prairieTurns).toFixed(1) : 0} extra tiles offered per prairie tile in hand · island: ${empty} of ${land} land cells empty at the end`) }
// What trees did in this run (LOU-302, LOU-314; replayed move by move): tree tiles in hand, how many had no legal spot and how many were discarded, how many were planted and how many combined, and the points from them.
if (CFG.treeShare > 0 || S.log.some(e => e.t && e.t.b === "t")) { const T = R.fresh(CFG, run.seed), m = {turns:0, copies:0, none:0, discarded:0, planted:0, combined:0, pts:0};
  for (const mv of run.moves) { const t = (mv.a === "p" || mv.a === "d") && T.q[mv.i], tree = t && t.k === "h" && t.b === "t";
    if (tree) { m.turns++; if (t.c) m.copies++; if (!R.options(T, mv.i).length) m.none++; if (mv.a === "d") m.discarded++ }
    const r = mv.a === "p" ? R.place(T, mv.i, [mv.x, mv.y]) : mv.a === "d" ? R.discard(T, mv.i) : mv.a === "l" ? R.lock(T, [mv.x, mv.y]) : mv.a === "u" ? R.pick(T, mv.x + "," + mv.y, mv.f) : R.end(T);
    if (tree && mv.a === "p") { if (r.does === "plant") m.planted++; else m.combined++; m.pts += r.pts } }
  console.log(`trees: ${m.turns} tree tiles in hand (${m.copies} copies), ${m.none} with no legal spot, ${m.discarded} discarded · ${m.planted} planted, ${m.combined} combined onto a tree · ${m.pts} points from them · ${Object.values(S.hb).filter(b => b === "t").length} tree habitats at the end`) }
// What the reed bed did in this run (LOU-304; replayed move by move): marsh tiles that reached the upgrade level, marsh planted only because of a reed bed, and the reed beds left at the end.
if (CFG.upgradeLevel > 0) { const T = R.fresh(CFG, run.seed), up = CFG.upgradeLevel, m = {inHand:0, planted:0, viaReed:0, rescued:0, reached:0};
  for (const mv of run.moves) { const t = (mv.a === "p" || mv.a === "d") && T.q[mv.i], marsh = t && t.k === "h" && t.b === "m";
    if (marsh) { m.inHand++; const pl = R.options(T, mv.i).filter(x => x.does === "plant"), via = CFG.marshNeedsRiver ? pl.filter(x => !R.nbrs(CFG, x.p).some(q => R.key(q) in T.r)) : [];
      if (via.length && via.length === pl.length) m.rescued++; if (mv.a === "p" && !((mv.x + "," + mv.y) in T.h)) { m.planted++; if (via.some(x => R.key(x.p) === mv.x + "," + mv.y)) m.viaReed++ } }
    const r = mv.a === "p" ? R.place(T, mv.i, [mv.x, mv.y]) : mv.a === "d" ? R.discard(T, mv.i) : mv.a === "l" ? R.lock(T, [mv.x, mv.y]) : mv.a === "u" ? R.pick(T, mv.x + "," + mv.y, mv.f) : R.end(T);
    if (marsh && mv.a === "p" && r && ((r.does === "combine" && r.l === up) || (r.does === "plant" && r.l >= up))) m.reached++ }
  console.log(`reed beds: ${m.reached} marsh tiles reached level ${up}, ${Object.keys(S.h).filter(k => S.hb[k] === "m" && S.h[k] >= up).length} reed beds on the island at the end · ${m.planted} marsh planted, ${m.viaReed} of them only because of a reed bed (${m.rescued} marsh tiles had no other place to plant) · ${m.inHand} marsh tiles in hand`) }
// What the picks and the prairie and tree upgrades did in this run (LOU-305, LOU-306; replayed move by move).
if (CFG.upgradeLevel > 0) { const T = R.fresh(CFG, run.seed), o = {steppeUps:0, meadowUps:0, meadowExtra:0, meadowCap:0, rootsUps:0, lifted:0, chainMax:0, chainPts:0, maxMove:0, pineTrees:0, free:0}, picks = {};
  for (const e of S.log) if (e.did === "pick") { const k = e.t.b + ":" + e.f; picks[k] = (picks[k] || 0) + 1 }
  for (const mv of run.moves) { if (mv.a === "p") { const t = T.q[mv.i], up = T.hf[mv.x + "," + mv.y], r = R.place(T, mv.i, [mv.x, mv.y]);
      if (r.does === "combine") { if (up === "steppe") o.steppeUps++; if (up === "roots") o.rootsUps++; if (up === "meadow") { o.meadowUps++; if (r.mult > 1) { o.meadowExtra += r.pts - r.pts / r.mult; if (r.mult === CFG.meadowMax) o.meadowCap++ } } }
      o.free += r.free.length; if (r.lifts.length) { o.lifted += r.lifts.length; o.chainMax = Math.max(o.chainMax, r.lifts.length); o.chainPts += r.liftPts; o.maxMove = Math.max(o.maxMove, r.pts) }
      if (r.does === "plant" && t.b === "t") o.pineTrees++ }
    else mv.a === "d" ? R.discard(T, mv.i) : mv.a === "l" ? R.lock(T, [mv.x, mv.y]) : mv.a === "u" ? R.pick(T, mv.x + "," + mv.y, mv.f) : R.end(T) }
  const label = {"p:steppe":"prairie steppe", "p:meadow":"prairie meadow", "t:roots":"trees roots", "t:pine":"trees pine-oneer"}, got = Object.entries(picks).map(([k, v]) => `${label[k]} ${v}`).join(" · ") || "none";
  if (CFG.prairieShare > 0 || CFG.treeShare > 0) console.log(`upgrade picks: ${got} · steppe ${o.steppeUps} level-ups, ${o.free} free tiles · meadow ${o.meadowUps} level-ups, ${Math.round(o.meadowExtra)} extra points from the multiplier (at the ×${CFG.meadowMax} cap ${o.meadowCap} times) · roots ${o.rootsUps} level-ups lifting ${o.lifted} tiles for ${o.chainPts} points (longest chain ${o.chainMax} tiles, most points in one move ${o.maxMove}) · ${o.pineTrees} trees planted`) }
// What the marsh river multiplier did in this run (LOU-309; replayed move by move): the marsh scores by multiplier, the points marsh earned, the largest single marsh score, and what the busiest marsh tile earned in all.
if (CFG.marshRiverMultiplier) { const T = R.fresh(CFG, run.seed), o = {b:{}, pts:0, big:0, tile:{}};   // b: how many marsh scores had each multiplier (keyed by the multiplier: the ramp can have halves)
  const add = (k, m, p) => { o.b[m] = (o.b[m] || 0) + 1; o.pts += p; o.big = Math.max(o.big, p); o.tile[k] = (o.tile[k] || 0) + p };
  for (const mv of run.moves) { if (mv.a === "p") { const t = T.q[mv.i], kk = mv.x + "," + mv.y, was = T.hb[kk], r = R.place(T, mv.i, [mv.x, mv.y]);
      if (r.does === "plant" && t.b === "m") add(kk, r.mult || 1, r.pts); else if (r.does === "combine" && was === "m") add(kk, r.mult || 1, r.pts);
      for (const L of r.lifts) if (T.hb[L.k] === "m") add(L.k, R.marshMult(T, L.k), L.pts) }   // the river doesn't change in a move, so this is the multiplier the lift was paid (a tile can rise twice in one move)
    else mv.a === "d" ? R.discard(T, mv.i) : mv.a === "l" ? R.lock(T, [mv.x, mv.y]) : mv.a === "u" ? R.pick(T, mv.x + "," + mv.y, mv.f) : R.end(T) }
  const hot = Object.entries(o.tile).sort((a, b) => b[1] - a[1])[0];
  const steps = [...new Set([1, ...CFG.marshRiverRamp])].sort((x, y) => x - y);
  console.log(`marsh multiplier: ${Object.values(o.b).reduce((a, b) => a + b, 0)} marsh scores: ${steps.map(v => `x${v} ${o.b[v] || 0}`).join(" · ")} · ${o.pts} points from marsh (${Math.round(100 * o.pts / Math.max(1, S.score))}% of ${S.score}) · the largest single marsh score ${o.big} · the busiest marsh tile ${hot ? `(${hot[0]}) earned ${hot[1]} over the run` : "none"}`) }
// The river's shape (LOU-309): its tiles, its longest path from the source, its branches (tiles with more than one tile flowing from them) and its bends (a tile whose direction from the one it flows from differs from that tile's own).
{ const rv = S.r, ks = Object.keys(rv), kids = {}, cube = k => { const p = R.unkey(k); return [p[0] - (p[1] - (p[1] & 1)) / 2, p[1]] }, dirOf = (a, b) => { const p = cube(a), q = cube(b); return (q[0] - p[0]) + "," + (q[1] - p[1]) };
  for (const k of ks) { const f = rv[k].from; if (f != null) (kids[f] = kids[f] || []).push(k) }
  const depth = k => 1 + Math.max(0, ...(kids[k] || []).map(depth)), root = ks.find(k => rv[k].from == null);
  let bends = 0, steps = 0; for (const k of ks) { const p = rv[k].from, g = p != null ? rv[p].from : null; if (p != null && g != null) { steps++; if (dirOf(g, p) !== dirOf(p, k)) bends++ } }
  console.log(`river: ${ks.length} tiles with the source · longest path ${root ? depth(root) : 0} tiles · ${Object.values(kids).filter(a => a.length > 1).length} branches · ${bends} bends in ${steps} steps (${steps ? Math.round(100 * bends / steps) : 0}% of the steps turn)`) }
const W = CFG.map[0].length, H = CFG.map.length, rows = [];
for (let y = 0; y < H; y++) { let r = y & 1 ? " " : ""; for (let x = 0; x < W; x++) { const k = x + "," + y, code = CFG.map[y][x], lk = k in S.lk;
  r += (code === "B" ? "^^" : k in S.r ? (lk ? "~" : "w") + S.r[k].l : k in S.h ? (lk ? "#" : S.hb[k] || "h") + S.h[k] : "..") + " " } rows.push(r) }
console.log("island (hN green habitat of level N, pN prairie, mN marsh, tN trees, #N locked habitat, wN river, ~N locked river, ^^ mountain):\n" + rows.join("\n"));
// What elevation did in this run (LOU-310; replayed move by move): the river's waterfalls and length, the river tiles that had no legal cell and were discarded, what height the river tiles sit at, and what the step rule did to Meadow.
if (CFG.elevation) { const T = R.fresh(CFG, run.seed), o = {meadowUps:0, lowered:0};
  for (const mv of run.moves) { if (mv.a === "p") { const kk = mv.x + "," + mv.y, up = T.hf[kk]; let n0 = 0; for (const q of R.nbrs(CFG, [mv.x, mv.y]).map(R.key)) if (T.hb[q] === "m" || T.hb[q] === "t") n0++;
      const r = R.place(T, mv.i, [mv.x, mv.y]); if (r.does === "combine" && up === "meadow") { o.meadowUps++; if ((r.mult || 1) < Math.min(CFG.meadowMax, 1 + n0)) o.lowered++ } }
    else mv.a === "d" ? R.discard(T, mv.i) : mv.a === "l" ? R.lock(T, [mv.x, mv.y]) : mv.a === "u" ? R.pick(T, mv.x + "," + mv.y, mv.f) : R.end(T) }
  const E = R.elevOf(CFG, run.seed), falls = Object.keys(S.r).filter(k => R.fallAt(S, k)), rd = S.log.filter(e => e.did === "discard" && e.t && e.t.k === "r").length, hs = {}; for (const k in S.r) hs[E[k]] = (hs[E[k]] || 0) + 1;
  console.log(`elevation: ${CFG.elevationShape}, ${CFG.elevationLevels} levels, step rule ${CFG.stepAdjacency} · ${falls.length} waterfalls on a river of ${Object.keys(S.r).length} tiles (river tiles by height: ${Object.keys(hs).sort().map(h => `${h}: ${hs[h]}`).join(", ")}) · ${rd} river tiles discarded with no legal cell · Meadow: ${o.meadowUps} level-ups, ${o.lowered} multipliers lowered by a step`);
  const hrows = []; for (let y = 0; y < H; y++) { let r = y & 1 ? " " : ""; for (let x = 0; x < W; x++) { const k = x + "," + y; r += (CFG.map[y][x] === "B" ? "^" : k in S.r ? (R.fallAt(S, k) ? "v" : "w") : k in S.h ? "h" : ".") + (CFG.map[y][x] === "B" ? "^" : E[k]) + " " } hrows.push(r) }
  console.log("heights (wN river at height N, vN river tile that stepped down to N, hN habitat on height N, .N empty land at height N, ^^ mountain):\n" + hrows.join("\n")) }
