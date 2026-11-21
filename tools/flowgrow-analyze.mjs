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
for (const e of S.log) { if (e.did === "plant" || e.did === "combine" || e.did === "overgrow" || (e.did === "widen" && e.pts)) { const k = e.did + (e.t.c ? " of copies" : " of dealt tiles"); by[k] = (by[k] || 0) + e.pts; const key = e.did + " to level " + e.l; lv[key] = (lv[key] || 0) + 1 }
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
    mv.a === "p" ? R.place(T, mv.i, [mv.x, mv.y]) : mv.a === "d" ? R.discard(T, mv.i) : mv.a === "l" ? R.lock(T, [mv.x, mv.y]) : R.end(T) }
  const land = CFG.map.join("").split("_").length - 1, empty = land - Object.keys(S.h).length - (Object.keys(S.r).length - 1);
  console.log(`marsh: ${m.marshTurns} marsh tiles in hand, nothing to plant on in ${m.marshNoBank} of those turns, ${m.marshDiscards} discarded · prairie: ${m.prairieTurns} in hand, ${m.spreadPlanted} planted beyond the river's reach, ${m.prairieTurns ? (m.spreadOffered / m.prairieTurns).toFixed(1) : 0} extra tiles offered per prairie tile in hand · island: ${empty} of ${land} land cells empty at the end`) }
// What trees did in this run (LOU-302; replayed move by move): tree tiles in hand, how many had no legal target and how many were discarded, and what the overgrows took.
if (CFG.treeShare > 0 || S.log.some(e => e.t && e.t.b === "t")) { const T = R.fresh(CFG, run.seed), m = {turns:0, copies:0, none:0, discarded:0, grew:{"":0, p:0, m:0}, pts:0, plain:0};
  for (const mv of run.moves) { const t = (mv.a === "p" || mv.a === "d") && T.q[mv.i], tree = t && t.k === "h" && t.b === "t";
    if (tree) { m.turns++; if (t.c) m.copies++; if (!R.options(T, mv.i).length) m.none++; if (mv.a === "d") m.discarded++ }
    const r = mv.a === "p" ? R.place(T, mv.i, [mv.x, mv.y]) : mv.a === "d" ? R.discard(T, mv.i) : mv.a === "l" ? R.lock(T, [mv.x, mv.y]) : R.end(T);
    if (tree && mv.a === "p") { if (r.does === "overgrow") { m.grew[r.from]++; m.pts += r.pts } else m.plain++ } }
  const grew = m.grew[""] + m.grew.p + m.grew.m;
  console.log(`trees: ${m.turns} tree tiles in hand (${m.copies} copies), ${m.none} with no legal target, ${m.discarded} discarded · ${grew} overgrows (${m.grew[""]} green, ${m.grew.p} prairie, ${m.grew.m} marsh) for ${m.pts} points · ${m.plain} tree-on-tree combines · ${Object.values(S.hb).filter(b => b === "t").length} tree habitats at the end`) }
const W = CFG.map[0].length, H = CFG.map.length, rows = [];
for (let y = 0; y < H; y++) { let r = y & 1 ? " " : ""; for (let x = 0; x < W; x++) { const k = x + "," + y, code = CFG.map[y][x], lk = k in S.lk;
  r += (code === "B" ? "^^" : k in S.r ? (lk ? "~" : "w") + S.r[k].l : k in S.h ? (lk ? "#" : S.hb[k] || "h") + S.h[k] : "..") + " " } rows.push(r) }
console.log("island (hN green habitat of level N, pN prairie, mN marsh, tN trees, #N locked habitat, wN river, ~N locked river, ^^ mountain):\n" + rows.join("\n"));
