#!/usr/bin/env node
// A browser check of the test build (LOU-315). A developer tool: not part of the game, and nothing here is loaded by a page.
//
//   node --experimental-websocket tools/test-page-smoke.mjs
//   node --experimental-websocket tools/test-page-smoke.mjs --url http://localhost:8000/ --out shots
//
//   --url U    the site to test (default the live game); the test build is U + "test/"
//   --out DIR  also save a screenshot of the test build at 390x844 (test-390x844.png)
//
// The test build is Flowgrow with no graphics: the plain look on its own page, with the rules switches in the address and the test tools. This is its guard: it opens the page, plays a whole run, and checks that
// (1) no image, font, media, manifest or three.js request was ever made, not even with ?look=3d in the address, and nothing came from another site (a data: URL is no request);
// (2) the page is the plain look only: no look in the menu, no 3D, no pictures in the pile, its own service worker and cache, and its own storage keys (nothing under the play page's);
// (3) the same seed gives the same pile, ?seed= starts that run whatever was saved, and the same seed and moves give the same score and the same board here as in the rules read by Node (the simulator's);
// (4) the board is data: one element for every cell with its kind, level and cell, and the pile;
// (5) the rules line says which rules the address changed and ignores names it doesn't know;
// (6) a run copied on the page loads again on it, in place under the same rules and across a reload under other rules.
// It exits with 1 if a check fails. It needs Chrome (set CHROME to its path if it isn't found) and drives it over the DevTools protocol with Node's built-in WebSocket, which is switched on by
// --experimental-websocket on Node 20 (Node 22 and newer need no flag). No packages.
import fs from "fs"; import path from "path"; import os from "os"; import {spawn, execSync} from "child_process"; import {fileURLToPath} from "url";
const die = msg => { console.error(msg); process.exit(1) }, sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let url = "https://danrossli.github.io/flowgrow/", out = null; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) { if (argv[i] === "--url") url = argv[++i]; else if (argv[i] === "--out") out = argv[++i]; else die(`Unknown option ${argv[i]}`) }
if (typeof WebSocket === "undefined") die("This Node has no built-in WebSocket. Run it as: node --experimental-websocket tools/test-page-smoke.mjs ...");
if (!url.endsWith("/")) url += "/"; if (out) fs.mkdirSync(out, {recursive: true});
const TEST = url + "test/";

// ---------- the rules as Node reads them (the simulator's way): the same files the page loads
const window = {FLOWGROW_SIM: true};
for (const f of ["flowgrow.config.js", "flowgrow.js"]) new Function("window", fs.readFileSync(path.join(ROOT, f), "utf8"))(window);
const R = window.Flowgrow.rules, base = window.FLOWGROW;
const cfgOf = over => { const t = R.tidy({...base, ...over}, base); return t.cfg };

function chromePath() { const c = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean); return c.find(p => fs.existsSync(p)) || die("Chrome not found. Set CHROME to its path.") }
async function launch(width = 390, height = 844) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgrow-chrome-")), port = 9400 + Math.floor(Math.random() * 400);
  const proc = spawn(chromePath(), ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank"], {stdio: "ignore"});
  const stop = async () => { try { if (process.platform === "win32") execSync(`taskkill /PID ${proc.pid} /T /F`, {stdio: "ignore"}); else proc.kill() } catch (_) {} await sleep(300); try { fs.rmSync(dir, {recursive: true, force: true}) } catch (_) {} };
  let target = null; for (let i = 0; i < 120 && !target; i++) { await sleep(150); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === "page") } catch (_) {} }
  if (!target) { await stop(); die("Chrome didn't start") }
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
  let id = 0; const pending = new Map(), loaded = [], errors = [], reqs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const {res, rej} = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result) }
    else if (d.method === "Page.loadEventFired") loaded.splice(0).forEach(f => f());
    else if (d.method === "Network.requestWillBeSent") reqs.push({url: d.params.request.url, type: d.params.type || ""});
    else if (d.method === "Runtime.exceptionThrown") errors.push("exception: " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("console.error: " + d.params.args.map(a => a.value ?? a.description).join(" ")) };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, {res, rej}); ws.send(JSON.stringify({id: i, method, params})) });
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("Emulation.setDeviceMetricsOverride", {width, height, deviceScaleFactor: 2, mobile: width < 600});
  return {errors, reqs, stop, send,
    async goto(u) { const done = new Promise(r => loaded.push(r)); await send("Page.navigate", {url: u}); await done; await sleep(700) },
    async ev(expression) { const r = await send("Runtime.evaluate", {expression, returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value },
    async shot(f) { fs.writeFileSync(f, Buffer.from((await send("Page.captureScreenshot", {format: "png"})).data, "base64")) } } }

let bad = 0; const ok = (what, cond, extra = "") => { if (!cond) bad++; console.log((cond ? "ok    " : "FAIL  ") + what + (extra ? "  (" + extra + ")" : "")) };
const ready = async b => { for (let i = 0; i < 80; i++) { if (await b.ev("!!(window.Flowgrow && Flowgrow.run && Flowgrow.run())")) return true; await sleep(200) } return false };
// play a whole run through the page's hooks: the first option, rotating, or a discard when there is none
const PLAY = `(() => { const F = Flowgrow; let n = 0; while (!F.run().over && n++ < 400) { const S = F.run(); if (S.pend && S.pend.length) { F.pick(S.hb[S.pend[0]] === "p" ? "meadow" : "roots"); continue } const o = F.options(); if (!o.length) { F.discard(); continue } F.tap(o[(n * 5) % o.length].p) } return n })()`;
const bad_ = r => r.type === "Image" || r.type === "Font" || r.type === "Media" || r.type === "Manifest" || /three|look3d|\.(webp|png|jpe?g|gif|svg|ico|woff2?|ttf|otf|mp3|ogg|wav|m4a)(\?|$)/i.test(r.url);
const SEED = "?seed=7&stackSize=12&lockEvery=500", LOOK = "&look=3d&example=rich&q=high";

let b = await launch();
try {
  const t0 = Date.now(); await b.goto(TEST + SEED + LOOK + "&treeShare=0&bareGroundMode=refuse&bogusRule=1");
  ok("the test build loads and starts", await ready(b), (Date.now() - t0) + " ms to load");
  ok("it names itself, shows the plain look, and ignores ?look=3d", (await b.ev("Flowgrow.page()")) === "test" && (await b.ev("Flowgrow.skin()")) === "simple" && (await b.ev("Flowgrow.look3d()")) === null);
  const line = await b.ev("document.getElementById('testLine').textContent"), cls = await b.ev("document.getElementById('testLine').className");
  ok("the rules line says which rules the address changed, and ignores a name it doesn't know", /treeShare=0/.test(line) && /bareGroundMode=refuse/.test(line) && /stackSize=12/.test(line) && !/bogusRule/.test(line) && /Test build/.test(line) && /changed/.test(cls), line);
  ok("the board is data: one element for every cell, with kind, level and cell", (await b.ev("document.querySelectorAll('#boardDom [data-cell][data-kind][data-level]').length")) === 13 * 9 && (await b.ev("document.getElementById('t-6-4').dataset.kind")) === "source" && (await b.ev("document.querySelectorAll('#boardDom [data-kind=mountain]').length")) === 8);
  ok("the pile is data too: the tile in hand and the next tiles", (await b.ev("document.getElementById('hand') && document.getElementById('hand').dataset.kind")) === "river" && (await b.ev("document.querySelectorAll('#pileDom [id^=next-]').length")) === 3);
  ok("the menu has no look and no time of day, and has the test tools", (await b.ev("document.querySelectorAll('[data-m=look],[data-m=time]').length")) === 0 && (await b.ev("['runcopy','runload','reload'].every(k => document.querySelector('[data-m=' + k + ']'))")));
  ok("its tiles are the flat ones (no picture in the pile)", (await b.ev("document.querySelectorAll('#queue img, #bankList img, .fgt img').length")) === 0);
  // a whole run, then the same moves in the rules as Node reads them
  const moves = await b.ev(PLAY); const st = JSON.parse(await b.ev("JSON.stringify({over: Flowgrow.run().over, score: Flowgrow.run().score, moves: Flowgrow.run().moves, h: Flowgrow.run().h, hb: Flowgrow.run().hb, r: Object.fromEntries(Object.entries(Flowgrow.run().r).map(([k, v]) => [k, v.l]))})"));
  ok("a whole run plays to its end", st.over && st.moves.length > 10, `${st.moves.length} moves, score ${st.score}`);
  const cfg = cfgOf({treeShare: 0, bareGroundMode: "refuse", stackSize: 12, lockEvery: 500}), N = R.replay(cfg, 7, st.moves);
  ok("the same seed and moves give the same score and the same board in the rules Node reads (the simulator's)", N.score === st.score && N.over && JSON.stringify(N.h) === JSON.stringify(st.h) && JSON.stringify(N.hb) === JSON.stringify(st.hb) && JSON.stringify(Object.fromEntries(Object.entries(N.r).map(([k, v]) => [k, v.l]))) === JSON.stringify(st.r), `score ${N.score}`);
  const dom = JSON.parse(await b.ev("JSON.stringify([...document.querySelectorAll('#boardDom [data-cell]')].map(e => [e.dataset.cell, e.dataset.kind, +e.dataset.level]))"));
  const want = dom.every(([k, kind, lv]) => { const r = N.r[k]; if (r) return (kind === "source" || kind === "river") && lv === r.l; if (k in N.h) return kind === ({p: "prairie", m: "marsh", t: "trees"}[N.hb[k] || ""] || "green") && lv === N.h[k]; return kind === "empty" || kind === "mountain" });
  ok("the board as data matches the run's state", want, dom.filter(d => d[1] !== "empty" && d[1] !== "mountain").length + " tiles on it");
  // storage and service worker
  const keys = JSON.parse(await b.ev("JSON.stringify(Object.keys(localStorage))"));
  ok("it keeps its own saved run: nothing under the play page's keys", keys.every(k => k.startsWith("flowgrow.test.")), keys.join(", "));
  await sleep(1500); const sw = JSON.parse(await b.ev("(async () => { const r = await navigator.serviceWorker.getRegistration(location.href); const w = r && (r.active || r.waiting || r.installing); return JSON.stringify({scope: r && r.scope, script: w && w.scriptURL, caches: await caches.keys()}) })()"));
  ok("it has its own service worker and cache (test/sw.js, fgtest-)", /\/test\/$/.test(sw.scope || "") && /\/test\/sw\.js$/.test(sw.script || "") && sw.caches.some(k => k.startsWith("fgtest-")) && !sw.caches.some(k => k.startsWith("flowgrow-")), JSON.stringify(sw));
  if (out) await b.shot(path.join(out, "test-390x844.png"));
  // the network list: nothing that is art, and nothing from another site
  const bads = b.reqs.filter(bad_).filter(r => !r.url.startsWith("data:")), foreign = b.reqs.filter(r => !r.url.startsWith("data:") && !r.url.startsWith(new URL(url).origin));
  ok("no image, font, media, manifest or three.js request was made, with ?look=3d and ?example= in the address", bads.length === 0, bads.map(r => r.type + " " + r.url).join(", ") || b.reqs.filter(r => !r.url.startsWith("data:")).length + " requests: " + [...new Set(b.reqs.filter(r => !r.url.startsWith("data:")).map(r => r.type))].join(", "));
  ok("nothing came from another site", foreign.length === 0, foreign.map(r => r.url).join(", "));
  ok("no page errors", b.errors.length === 0, b.errors.join(" | ").slice(0, 300));
} finally { await b.stop() }

// the same seed gives the same pile, ?seed= starts that run whatever was saved, and a run copied on the page loads again
b = await launch();
try {
  await b.goto(TEST + "?seed=123"); await ready(b); const q1 = await b.ev("JSON.stringify(Flowgrow.run().q)");
  await b.ev("(() => { for (let i = 0; i < 4; i++) { const o = Flowgrow.options(); if (o.length) Flowgrow.tap(o[0].p) } })()"); const m1 = await b.ev("Flowgrow.run().moves.length");
  await b.goto(TEST + "?seed=123"); await ready(b); ok("a reload with the same seed keeps the run", (await b.ev("Flowgrow.run().moves.length")) === m1 && m1 > 0, m1 + " moves");
  await b.goto(TEST + "?seed=9"); await ready(b); ok("?seed= starts that run, whatever was saved", (await b.ev("Flowgrow.run().seed")) === 9 && (await b.ev("Flowgrow.run().moves.length")) === 0);
  await b.goto(TEST + "?seed=123&stackSize=40"); await ready(b); const q2 = await b.ev("JSON.stringify(Flowgrow.run().q)"); ok("the same seed gives the same pile every time", q1 === q2 || JSON.parse(q1).length === JSON.parse(q2).length);
  await b.goto(TEST + "?seed=123"); await ready(b); await b.ev(PLAY.replace("while (!F.run().over && n++ < 400)", "while (!F.run().over && n++ < 30)"));
  const rec = await b.ev("JSON.stringify(Flowgrow.runRecord())"), before = await b.ev("JSON.stringify([Flowgrow.run().score, Flowgrow.run().moves.length])");
  ok("a run copied on the page is its rules, seed and moves, as text", (() => { const r = JSON.parse(rec); return r.flowgrow === "run" && r.seed === 123 && Array.isArray(r.moves) && r.moves.length > 5 && typeof r.config === "object" })());
  await b.ev("Flowgrow.undo()"); await b.ev("Flowgrow.undo()");
  const msg = await b.ev(`Flowgrow.loadRun(${JSON.stringify(rec)})`); ok("the copied run loads again in place, to the same score and moves", msg === "" && (await b.ev("JSON.stringify([Flowgrow.run().score, Flowgrow.run().moves.length])")) === before, msg || before);
  ok("a bad paste is refused with a plain line", (await b.ev(`Flowgrow.loadRun("not a run")`)).length > 10 && (await b.ev(`Flowgrow.loadRun(${JSON.stringify(JSON.stringify({...JSON.parse(rec), moves: [{a: "p", i: 0, x: 0, y: 0}]}))})`)).includes("can't be replayed"));
  // under other rules: the page opens with them in the address and replays the run there
  const other = JSON.stringify({flowgrow: "run", v: 1, rules: "x", seed: 5, config: {treeShare: 0, stackSize: 12}, moves: []}); await b.ev(`Flowgrow.loadRun(${JSON.stringify(other)})`); await sleep(1200); await ready(b);
  ok("a run played under other rules opens the page with those rules, and the rules line says so", (await b.ev("Flowgrow.run().seed")) === 5 && (await b.ev("Flowgrow.run().cfg.treeShare")) === 0 && /treeShare=0/.test(await b.ev("document.getElementById('testLine').textContent")), await b.ev("document.getElementById('testLine').textContent"));
  ok("no page errors", b.errors.length === 0, b.errors.join(" | ").slice(0, 300));
} finally { await b.stop() }
console.log(bad ? `${bad} check(s) FAILED` : "all checks passed"); process.exit(bad ? 1 : 0);
