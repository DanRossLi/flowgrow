#!/usr/bin/env node
// Flowgrow search. A developer tool: it is not part of the game and nothing here is loaded by a page.
//
// It looks for the highest score a run can reach on one seed, with the game's own rules: flowgrow.config.js and flowgrow.js are
// loaded here exactly as the simulator loads them, so a rule change in the game is a rule change in the search. No packages: plain
// Node 18 or newer.
//
//   node tools/flowgrow-search.mjs                                 2 minutes on 1 core
//   node tools/flowgrow-search.mjs --workers 8 --seconds 300       8 cores for 5 minutes
//   node tools/flowgrow-search.mjs maxLevel=7 riverMonotone=false  any config value can be changed as key=value, to test a rule
//
//   --seconds N    how long to search (default 120)
//   --workers N    how many processes to run at once, each with its own random numbers (default 1)
//   --method M     policy, nrpa or mix (default mix: workers alternate, and a single process does policy first and nrpa after)
//   --seed N       the seed the pile is dealt from (default 495454692, the run Dan pasted on Nov 20)
//   --out FILE     where the best run is saved (default search-best.json)
//   --from A,B     start from saved runs: the policy search starts from their knobs, the nrpa search from their moves
//
// The two methods:
//   policy  a hand-built "sweep" player with a dozen knobs (when to grow, which tile to lock, whether to widen, ...) tuned by random
//           search and hill climbing. It finds strong runs fast, but its strategy is built in, so a rule that changes the shape of the
//           game may need its knobs rethought.
//   nrpa    nested rollout policy adaptation: it learns which moves to prefer from its own best runs and knows nothing about strategy,
//           so it is slower but fair to a new rule. Locks are used when the pile is empty, the way a player uses them.
//
// What it saves: {seed, score, top, locks, moves, log, over, rules, method}. "over" is the key=value changes the run was found with, and
// "log" is the run log the page copies. See tools/flowgrow-analyze.mjs (what a run did) and tools/flowgrow-replay.mjs (in the real page).
import fs from "fs"; import path from "path"; import {fileURLToPath} from "url"; import {fork} from "child_process";
const HERE = fileURLToPath(import.meta.url), ROOT = path.resolve(path.dirname(HERE), "..");
const die = msg => { console.error(msg); process.exit(1) };

// ---------- the game's rules, loaded as they are
const window = {FLOWGROW_SIM: true};
for (const f of ["flowgrow.config.js", "flowgrow.js"]) new Function("window", fs.readFileSync(path.join(ROOT, f), "utf8"))(window);
const R = window.Flowgrow.rules, base = window.FLOWGROW;

// ---------- the command line
const opt = {seconds: 120, workers: 1, method: "mix", seed: 495454692, out: "search-best.json", from: ""}, over = {}, argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) { const a = argv[i];
  if (a.startsWith("--")) { const k = a.slice(2); if (!(k in opt)) die(`Unknown option ${a}`); const v = argv[++i]; if (v === undefined) die(`${a} needs a value`);
    opt[k] = typeof opt[k] === "number" ? +v : v; if (typeof opt[k] === "number" && !Number.isFinite(opt[k])) die(`${a} needs a number`) }
  else { const m = /^([A-Za-z]+)=(.*)$/.exec(a); if (!m || !R.KEYS.some(k => k[0] === m[1])) die(`Unknown setting ${a}. Use key=value with one of: ${R.KEYS.map(k => k[0]).join(", ")}`); over[m[1]] = m[2] } }
if (!["policy", "nrpa", "mix"].includes(opt.method)) die("--method is policy, nrpa or mix");
const made = R.tidy({...base, ...over}, base); if (made.bad.length) die("Refused: " + made.bad.join(", "));
const CFG = made.cfg, WORKER = +process.env.FLOWGROW_SEARCH_WORKER || 0, T0 = Date.now();
let rs = ((WORKER + 1) * 2654435761) >>> 0;
const rnd = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = Math.imul(rs ^ (rs >>> 15), rs | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
const saved = opt.from.split(",").filter(Boolean).map(f => { try { return JSON.parse(fs.readFileSync(f, "utf8")) } catch (e) { return die(`Can't read ${f}: ${e.message}`) } });

// ---------- many workers: this process only starts them and keeps the best run they send back
if (!WORKER && opt.workers > 1) {
  let best = {score: -1}; const kids = [];
  for (let w = 1; w <= opt.workers; w++) {
    const k = fork(HERE, argv, {env: {...process.env, FLOWGROW_SEARCH_WORKER: String(w)}, stdio: ["ignore", "inherit", "inherit", "ipc"]});
    k.on("message", b => { if (b.score > best.score) { best = b; fs.writeFileSync(opt.out, JSON.stringify(best));
      console.log(`${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}s  best ${b.score}  (worker ${w}, ${b.method}; top level ${b.top}, ${b.locks} locks, ${b.moves.length} moves)`) } });
    kids.push(new Promise(done => k.on("exit", done))) }
  await Promise.all(kids); summary(best); process.exit(0) }

// ---------- what every method does: remember the best run
let best = {score: -1}, lastSave = 0;
function record(S, method, params) { if (S.score <= best.score) return;
  best = {seed: opt.seed, score: S.score, top: S.top, locks: S.lockUsed, moves: S.moves, over, rules: R.rulesKey(CFG), method, ...(params ? {params} : {}), log: R.logText(S)};
  if (process.send) process.send(best); else if (Date.now() - lastSave > 1500) { fs.writeFileSync(opt.out, JSON.stringify(best)); lastSave = Date.now() } }
function summary(b) { if (b.score < 0) die("No run was found.");
  fs.writeFileSync(opt.out, JSON.stringify(b));
  console.log(`\nbest ${b.score} points: top level ${b.top}, ${b.locks} locks, ${b.moves.length} moves (${b.method}). Saved to ${opt.out}.`);
  console.log(`What it did:  node tools/flowgrow-analyze.mjs ${opt.out}\nIn the page:  node --experimental-websocket tools/flowgrow-replay.mjs ${opt.out}`) }

const CAP = 1500, SC = l => R.scoreOf(CFG, l), K = p => p[0] + "," + p[1], nbrs = p => R.nbrs(CFG, p), has = (S, q) => (K(q) in S.h) || (K(q) in S.r);
const SRC = R.unkey(Object.keys(R.fresh(CFG, opt.seed).r)[0]);

// ====================================================================================================================================
// policy: a hand-built sweep player with knobs, tuned by random search and hill climbing
// ====================================================================================================================================
function policySearch(until) {
  const unl = (S, q) => { const k = K(q); return (k in S.h || k in S.r) && !(k in S.lk) };
  const bestExtend = (S, opts, P) => { let b = null, bs = -1e9; for (const o of opts) { if (o.does !== "extend") continue; const s = R.opens(S, 0, o) * 2 - P.riverCost + rnd() * P.noise; if (s > bs) { bs = s; b = o } } return b };
  function handle(S, P, last) { const t = S.q[0], opts = R.options(S, 0);
    if (t.k === "r") {                      // a river tile: build a spine first (spine), then widen; copies only extend when land is short (plMin)
      if (!t.c) { const w = opts.find(o => o.does === "widen"), e = bestExtend(S, opts, P); if (e && Object.keys(S.r).length < P.spine) return R.place(S, 0, e.p);
        if (w) return R.place(S, 0, w.p); return e ? R.place(S, 0, e.p) : R.discard(S, 0) }
      if (R.plantable(S).length < P.plMin) { const e = bestExtend(S, opts, P); if (e) return R.place(S, 0, e.p) }
      const w2 = opts.find(o => o.does === "widen"); if (w2 && rnd() < P.widenCopy) return R.place(S, 0, w2.p); return R.discard(S, 0) }
    const nHab = Object.keys(S.h).length, comb = opts.filter(o => o.does === "combine"), plant = opts.filter(o => o.does === "plant");
    const wantPlant = comb.length === 0 || (nHab < P.grow && !(!t.c && S.dealt > P.dealtPlant)) || (t.l >= P.hiPlant && nHab < P.growHi);
    if (!wantPlant) { let b = null, bs = -1e9; for (const o of comb) { const adj = last && R.hexDist(o.p, last) === 1 ? P.adj : 0, u = nbrs(o.p).filter(q => unl(S, q)).length, s = adj + P.cu * u + rnd() * P.noise; if (s > bs) { bs = s; b = o } } return R.place(S, 0, b.p) }
    if (plant.length) { let b = null, bs = -1e9; for (const o of plant) { const hn = nbrs(o.p).filter(q => K(q) in S.h).length, rn = nbrs(o.p).filter(q => K(q) in S.r).length; if (hn + rn === 0) continue;
      const s = 3 * hn + rn - .1 * R.hexDist(o.p, SRC) + rnd() * P.noise; if (s > bs) { bs = s; b = o } } if (b) return R.place(S, 0, b.p) }
    return R.discard(S, 0) }
  function chooseLock(S, P) { let best = null, bs = -1e9;       // the tile whose copies are worth most, minus what freezing it costs
    for (const k of [...Object.keys(S.h), ...(P.lockRiver ? Object.keys(S.r) : [])]) { const p = R.unkey(k); if (!R.lockable(S, p)) continue;
      const L = k in S.h ? S.h[k] : S.r[k].l, g = R.copiesOf(S, p); let gain = 0, n = 0; for (const t of g.copies) if (t.k === "h") { gain += SC(t.l + 1); n++ } if (!n) continue;
      const s = gain - P.kappa * g.high.length * SC(L + 1) + P.mu * L - P.river * (k in S.r ? 1 : 0) + rnd() * P.noise; if (s > bs) { bs = s; best = p } }
    return best }
  function play(P) { const S = R.fresh(CFG, opt.seed); let last = null, guard = 0;
    while (!S.over && guard++ < CAP) { if (S.q.length) { if (!handle(S, P, last)) break } else { const x = chooseLock(S, P); if (!x) { R.end(S); break } R.lock(S, x); last = x } }
    return S }
  const rr = (a, b) => a + rnd() * (b - a), ri = (a, b) => Math.floor(rr(a, b + 1));
  const sample = () => ({spine: ri(0, 6), widenCopy: rnd(), grow: ri(6, 90), hiPlant: ri(2, 9), growHi: ri(10, 100), dealtPlant: ri(2, 10), plMin: ri(3, 40), riverCost: rr(0, 6),
    noise: rr(0, 3), adj: rr(0, 6), cu: rr(0, 3), kappa: rr(0, 1.2), mu: rr(0, 6), lockRiver: rnd() < .5 ? 1 : 0, river: rr(0, 8)});
  const mutate = P => { const Q = {...P}, s = sample(); for (const k of Object.keys(Q)) if (rnd() < .3) Q[k] = s[k]; return Q };
  let bestP = null, bestScore = -1; for (const b of saved) if (b.params) { bestP = b.params; bestScore = b.score }
  while (Date.now() < until) { const P = bestP && rnd() < .6 ? mutate(bestP) : sample(), S = play(P); record(S, "policy", P); if (S.score > bestScore) { bestScore = S.score; bestP = P } } }

// ====================================================================================================================================
// nrpa: nested rollout policy adaptation. A move is chosen with probability proportional to exp(prior + learned weight); the weights
// move towards the best run found at each level. Locks are used when the pile is empty. A move's code is stable between runs, so what
// is learned carries over.
// ====================================================================================================================================
function nrpaSearch(until, level, N) {
  const ALPHA = 1.0;
  function legal(S) { const mv = []; if (S.over) return mv;
    if (S.q.length) { const t = S.q[0], tag = t.k + t.l, copy = !!t.c, nHab = Object.keys(S.h).length;
      for (const o of R.options(S, 0)) { let bias = 0;
        if (t.k === "h") { if (o.does === "combine") bias = 2 * Math.log(1 + o.pts); else { if (!nbrs(o.p).some(q => has(S, q))) continue; bias = 2 * Math.log(1 + o.pts) - 1 + (nHab < 12 ? 1 : 0) } }
        else bias = o.does === "widen" ? 1.5 : copy ? -1 : .5;
        mv.push({code: tag + ":" + o.does + ":" + K(o.p), bias, o}) }
      mv.push({code: tag + ":d", bias: t.k === "r" ? (copy ? 1.5 : -1) : -3, d: true})
    } else { let any = false;
      for (const k of [...Object.keys(S.h), ...Object.keys(S.r)]) { const p = R.unkey(k); if (!R.lockable(S, p)) continue; const g = R.copiesOf(S, p), habs = g.copies.filter(t => t.k === "h"); if (!habs.length) continue;
        mv.push({code: "L:" + k, bias: .12 * habs.reduce((s, t) => s + SC(t.l + 1), 0) + .4 * g.copies.length, lock: p}); any = true }
      mv.push({code: "E", bias: any ? -8 : 0, end: true}) }
    return mv }
  const apply = (S, m) => m.o ? R.place(S, 0, m.o.p) : m.d ? R.discard(S, 0) : m.lock ? R.lock(S, m.lock) : R.end(S);
  const weights = (mv, pol) => { let z = 0; const w = mv.map(m => { const v = Math.exp(m.bias + (pol.get(m.code) || 0)); z += v; return v }); return {w, z} };
  function playout(pol) { const S = R.fresh(CFG, opt.seed), seq = []; let n = 0;
    while (!S.over && n++ < CAP) { const mv = legal(S); if (!mv.length) break; const {w, z} = weights(mv, pol); let x = rnd() * z, i = 0; for (; i < mv.length - 1; i++) { x -= w[i]; if (x < 0) break }
      if (!apply(S, mv[i])) break; seq.push(mv[i].code) }
    record(S, "nrpa"); return {score: S.score, seq} }
  function adapt(pol, seq) { const np = new Map(pol), S = R.fresh(CFG, opt.seed);
    for (const code of seq) { const mv = legal(S); if (!mv.length) break; const {w, z} = weights(mv, pol); let pick = null;
      mv.forEach((m, i) => { np.set(m.code, (np.get(m.code) || 0) - ALPHA * w[i] / z); if (m.code === code) pick = m }); np.set(code, (np.get(code) || 0) + ALPHA); if (!pick || !apply(S, pick)) break }
    return np }
  function nrpa(lv, pol) { if (lv === 0) return playout(pol); let b = {score: -1, seq: []};
    for (let i = 0; i < N && Date.now() < until; i++) { const r = nrpa(lv - 1, new Map(pol)); if (r.score >= b.score) b = r; pol = adapt(pol, b.seq) }
    return b }
  // a saved run, as the codes the search uses (a move the search wouldn't offer ends the seeding there)
  function toCodes(moves) { const S = R.fresh(CFG, opt.seed), codes = [];
    try { for (const m of moves) { if (m.a === "p") { const t = S.q[m.i], o = R.options(S, m.i).find(o => o.p[0] === m.x && o.p[1] === m.y); codes.push(t.k + t.l + ":" + o.does + ":" + m.x + "," + m.y); R.place(S, m.i, [m.x, m.y]) }
      else if (m.a === "d") { codes.push(S.q[m.i].k + S.q[m.i].l + ":d"); R.discard(S, m.i) } else if (m.a === "l") { codes.push("L:" + m.x + "," + m.y); R.lock(S, [m.x, m.y]) } else { codes.push("E"); R.end(S) } } } catch (e) {}
    return codes }
  let pol0 = new Map(); for (const b of saved) { const codes = toCodes(b.moves); for (let i = 0; i < 15; i++) pol0 = adapt(pol0, codes) }
  while (Date.now() < until) nrpa(level, new Map(pol0)) }

// ---------- run
const total = opt.seconds * 1000, W = WORKER || 1, method = opt.method === "mix" ? (WORKER ? (WORKER % 2 ? "policy" : "nrpa") : "both") : opt.method;
if (method === "policy" || method === "both") policySearch(T0 + (method === "both" ? total * .6 : total));
if (method === "nrpa" || method === "both") nrpaSearch(T0 + total, 3, 12);
if (WORKER) process.exit(0); else summary(best);
