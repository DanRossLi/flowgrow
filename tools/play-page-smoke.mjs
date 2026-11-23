#!/usr/bin/env node
// A browser check of the play page (LOU-316). A developer tool: not part of the game, and nothing here is loaded by a page.
//
//   node --experimental-websocket tools/play-page-smoke.mjs
//   node --experimental-websocket tools/play-page-smoke.mjs --url http://localhost:8000/ --out shots
//
//   --url U    the site to test (default the live game); the play page is U + "play/", the test build U + "test/"
//   --out DIR  also save screenshots of the play page at 390x844 (day.png, gold.png, night.png, grown.png) and the numbers it measured (numbers.txt)
//
// The play page is the public Flowgrow with the graphics: the 3D look by default, one game for a player (no look switch, no rules or seed in the address), a quiet fallback to simpler looks, a first-run intro, a
// share-ready head and a developer's door (?dev=1). It checks that:
// (1) the bare address redirects to the play page (or to the test build when the link carries rules or a seed), keeping the query string and the hash;
// (2) the page opens on the 3D look, has no look row, and ignores ?look=, ?seed= and rules in the address (until ?dev=1, which gives ?look= and ?seed= and keeps its own saved run);
// (3) the same seed and moves give the same score on the play page, on the test build and in the rules Node reads (the simulator's), and a finished run calls onRunEnd with its seed, rules, moves and score;
// (4) with WebGL blocked, and with the frame rate forced low, the page drops quietly to a simpler look in the same run, and the run continues; reduced motion shows a still picture;
// (5) the first-run screens show once and can be skipped; an old run saved by older rules is dropped with a plain line; a run is saved under the play page's own keys, never the test build's;
// (6) the head is share-ready (title, description, icon, theme colour, a 1200x630 preview image), the service worker installs, every file it lists exists, the elevation maps still work, and no page errors;
// (7) the numbers it reports: weight, time to the first board, and frames per second at 390x844 on q=med (under software GL if that is all this machine has, which is far slower than a phone).
// It exits with 1 if a check fails. It needs Chrome (set CHROME to its path if it isn't found) and drives it over the DevTools protocol with Node's built-in WebSocket, which is switched on by
// --experimental-websocket on Node 20 (Node 22 and newer need no flag). No packages.
import fs from "fs"; import path from "path"; import os from "os"; import {spawn, execSync} from "child_process"; import {fileURLToPath} from "url";
const die = msg => { console.error(msg); process.exit(1) }, sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let url = "https://danrossli.github.io/flowgrow/", out = null; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) { if (argv[i] === "--url") url = argv[++i]; else if (argv[i] === "--out") out = argv[++i]; else die(`Unknown option ${argv[i]}`) }
if (typeof WebSocket === "undefined") die("This Node has no built-in WebSocket. Run it as: node --experimental-websocket tools/play-page-smoke.mjs ...");
if (!url.endsWith("/")) url += "/"; if (out) fs.mkdirSync(out, {recursive: true});
const PLAY = url + "play/", TEST = url + "test/", ORIGIN = new URL(url).origin;

const window = {FLOWGROW_SIM: true};
for (const f of ["flowgrow.config.js", "flowgrow.js"]) new Function("window", fs.readFileSync(path.join(ROOT, f), "utf8"))(window);
const R = window.Flowgrow.rules, base = window.FLOWGROW, CFG0 = R.tidy(base, base).cfg;

const GL = ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl"], NOGL = ["--disable-gpu", "--disable-3d-apis", "--disable-webgl", "--disable-software-rasterizer"];
function chromePath() { const c = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean); return c.find(p => fs.existsSync(p)) || die("Chrome not found. Set CHROME to its path.") }
async function launch({width = 390, height = 844, dpr = 2, args = GL, reduce = false, before = ""} = {}) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgrow-chrome-")), port = 9400 + Math.floor(Math.random() * 400);
  const proc = spawn(chromePath(), ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", ...args, "about:blank"], {stdio: "ignore"});
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
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("Emulation.setDeviceMetricsOverride", {width, height, deviceScaleFactor: dpr, mobile: width < 600});
  if (reduce) await send("Emulation.setEmulatedMedia", {features: [{name: "prefers-reduced-motion", value: "reduce"}]});
  if (before) await send("Page.addScriptToEvaluateOnNewDocument", {source: before});
  return {errors, reqs, stop, send,
    async goto(u) { const done = new Promise(r => loaded.push(r)); await send("Page.navigate", {url: u}); await done; await sleep(500) },
    async ev(expression) { const r = await send("Runtime.evaluate", {expression, returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value },
    async shot(f) { fs.writeFileSync(f, Buffer.from((await send("Page.captureScreenshot", {format: "png"})).data, "base64")) } } }

let bad = 0; const ok = (what, cond, extra = "") => { if (!cond) bad++; console.log((cond ? "ok    " : "FAIL  ") + what + (extra ? "  (" + extra + ")" : "")) };
const ready = async b => { for (let i = 0; i < 100; i++) { if (await b.ev("!!(window.Flowgrow && Flowgrow.run && Flowgrow.run())")) return true; await sleep(200) } return false };
const until = async (b, expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await b.ev(expr)) return true; await sleep(250) } return false };
const SKIP = "localStorage.setItem('flowgrow.intro', '1');";   // a page that has been played before: no first-run screens
// play moves through the page's hooks: the first option, rotating, or a discard when there is none; n moves, or to the end (the End button when the pile is empty)
const PLAYN = n => `(() => { const F = Flowgrow; let k = 0; while (!F.run().over && F.run().moves.length < ${n} && k++ < 600) { const S = F.run(); if (S.pend && S.pend.length) { F.pick(S.hb[S.pend[0]] === "p" ? "meadow" : "roots"); continue }
  if (!S.q.length) { const e = document.getElementById("endYes"); if (e && !document.getElementById("endq").hidden) { e.click(); continue } break } const o = F.options(); if (!o.length) { F.discard(); continue } F.tap(o[(k * 5) % o.length].p) } return F.run().moves.length })()`;
const numbers = {};

// ------------------------------------------------------------------------------------------------ 1. the bare address
let b = await launch({before: SKIP});
try {
  await b.goto(url + "?look=3d&q=low#hash"); await sleep(800); const u1 = new URL(await b.ev("location.href"));
  ok("the bare address redirects to the play page, keeping the query string and the hash", u1.pathname.endsWith("/play/") && u1.search === "?look=3d&q=low" && u1.hash === "#hash", u1.pathname + u1.search + u1.hash);
  await b.goto(url + "?treeShare=0&seed=7"); await sleep(800); const u2 = new URL(await b.ev("location.href"));
  ok("a link with rules or a seed is a test link: it goes to the test build, with its query string", u2.pathname.endsWith("/test/") && u2.search === "?treeShare=0&seed=7", u2.pathname + u2.search);
  await b.goto(url); await sleep(800); ok("the bare address with nothing on it goes to the play page", new URL(await b.ev("location.href")).pathname.endsWith("/play/"));
} finally { await b.stop() }

// ------------------------------------------------------------------------------------------------ 2. the play page: 3D by default, one game
b = await launch({before: SKIP});
try {
  const t0 = Date.now(); await b.goto(PLAY + "?look=simple&seed=7&treeShare=0&stackSize=3&q=low&time=day"); ok("the play page starts", await ready(b), (Date.now() - t0) + " ms");
  const saw3d = await until(b, "Flowgrow.skin() === '3d'", 15000); ok("it opens on the 3D look, whatever ?look= says", saw3d && (await b.ev("Flowgrow.page()")) === "play");
  ok("it has no look row in the menu (and the day is still there)", (await b.ev("document.querySelectorAll('[data-m=look]').length")) === 0 && (await b.ev("document.querySelectorAll('[data-m=time]').length")) === 1);
  const run = JSON.parse(await b.ev("JSON.stringify({seed: Flowgrow.run().seed, tree: Flowgrow.run().cfg.treeShare, stack: Flowgrow.run().cfg.stackSize, dev: !!document.querySelector('#devLine:not([hidden])')})"));
  ok("it ignores ?seed= and rules in the address (?treeShare=0&stackSize=3)", run.seed !== 7 && run.tree === CFG0.treeShare && run.stack === CFG0.stackSize && !run.dev, JSON.stringify(run));
  numbers.mode = await b.ev("Flowgrow.run().cfg.mode"); ok("the config has a mode, \"free\"", numbers.mode === "free");
  const ver = await until(b, "/^v\\d+$/.test(document.getElementById('mVer').textContent)", 5000); ok("a small version shows in the menu only", ver && !/v\d+/.test(await b.ev("document.getElementById('top').textContent")), await b.ev("document.getElementById('mVer').textContent"));
  const keys = JSON.parse(await b.ev("JSON.stringify(Object.keys(localStorage))")); ok("it saves under the play page's keys, never the test build's or a developer's", !keys.some(k => k.startsWith("flowgrow.test.") || k.startsWith("flowgrow.dev.")), keys.join(", "));
  ok("no look is remembered (a player has no look to pick)", !keys.includes("flowgrow.look"));
  ok("no page errors", b.errors.length === 0, b.errors.join(" | ").slice(0, 300));
} finally { await b.stop() }

// ------------------------------------------------------------------------------------------------ 3. the developer's door, and the same run on every page
let scoreDev, movesDev;
b = await launch({before: SKIP});
try {
  await b.goto(PLAY + "?dev=1&look=simple&seed=7"); await ready(b);
  ok("?dev=1 gives ?look= and ?seed=, shows a dev line and keeps its own saved run", (await b.ev("Flowgrow.skin()")) === "simple" && (await b.ev("Flowgrow.run().seed")) === 7 && (await b.ev("document.getElementById('devLine').hidden")) === false && /dev · look simple · seed 7/.test(await b.ev("document.getElementById('devLine').textContent")));
  await b.ev(PLAYN(20)); const keys = JSON.parse(await b.ev("JSON.stringify(Object.keys(localStorage))"));
  ok("a developer's run is under flowgrow.dev.* and a player's keys are untouched", keys.some(k => k.startsWith("flowgrow.dev.run.")) && !keys.some(k => k.startsWith("flowgrow.run.") || k.startsWith("flowgrow.best.")), keys.join(", "));
  movesDev = JSON.parse(await b.ev("JSON.stringify(Flowgrow.run().moves)")); scoreDev = await b.ev("Flowgrow.run().score");
  await b.ev("window.__ended = null; Flowgrow.onRunEnd = r => { window.__ended = r }"); await b.ev(PLAYN(9999));
  const end = JSON.parse(await b.ev("JSON.stringify(window.__ended)"));
  ok("a run that ends calls onRunEnd with its seed, rules, moves, score and mode", end && end.flowgrow === "run" && end.seed === 7 && Array.isArray(end.moves) && end.moves.length > 20 && typeof end.score === "number" && end.mode === "free" && typeof end.rules === "string" && typeof end.config === "object", end ? `${end.moves.length} moves, score ${end.score}` : "not called");
  ok("no page errors", b.errors.length === 0, b.errors.join(" | ").slice(0, 300));
} finally { await b.stop() }
b = await launch();
try {
  await b.goto(TEST + "?seed=7"); await ready(b); await b.ev(PLAYN(20)); const scoreTest = await b.ev("Flowgrow.run().score"), movesTest = JSON.parse(await b.ev("JSON.stringify(Flowgrow.run().moves)"));
  const N = R.replay(CFG0, 7, movesDev.slice(0, 20));
  ok("the same seed and moves give the same score on the play page, on the test build and in the rules Node reads", JSON.stringify(movesTest) === JSON.stringify(movesDev.slice(0, 20)) && scoreTest === N.score && scoreDev !== undefined, `score ${N.score} on all three; ${movesTest.length} moves`);
} finally { await b.stop() }

// ------------------------------------------------------------------------------------------------ 4. the fallback, quiet and automatic
b = await launch({before: SKIP});
try {
  await b.goto(PLAY + "?dev=1&fps=5"); await ready(b); await b.ev(PLAYN(6)); const mv = await b.ev("Flowgrow.run().moves.length"), seed = await b.ev("Flowgrow.run().seed");
  const down = await until(b, "Flowgrow.skin() === 'simple'", 40000);
  ok("with the frame rate forced low the page drops from 3D to the painted look and then the plain look, in the same run", down && (await b.ev("Flowgrow.run().moves.length")) === mv && (await b.ev("Flowgrow.run().seed")) === seed && mv > 0, `${mv} moves kept, now ${await b.ev("Flowgrow.skin()")}`);
  ok("it said nothing about it (no message, no error screen)", !(await b.ev("document.getElementById('msg').textContent")) || !/3D|look|slow|lite/i.test(await b.ev("document.getElementById('msg').textContent")));
  await b.ev(PLAYN(10)); ok("the run goes on in the plain look", (await b.ev("Flowgrow.run().moves.length")) >= mv + 1);
  ok("no page errors", b.errors.length === 0, b.errors.join(" | ").slice(0, 300));
} finally { await b.stop() }
b = await launch({args: NOGL, before: SKIP});
try {
  await b.goto(PLAY); await ready(b); const dropped = await until(b, "Flowgrow.skin() !== '3d' && Flowgrow.look3d() === null", 15000); await sleep(1500);
  const msg = await b.ev("document.getElementById('msg').textContent");
  ok("with WebGL blocked the page drops to a simpler look, quietly", dropped && (await b.ev("['painted','simple'].includes(Flowgrow.skin())")) && !/3D|WebGL|can't|couldn't/i.test(msg), `now ${await b.ev("Flowgrow.skin()")}; message "${msg}"`);
  await b.ev(PLAYN(8)); ok("the run goes on", (await b.ev("Flowgrow.run().moves.length")) >= 1);
  ok("no page errors", b.errors.filter(e => !/WebGL|GPU|context/i.test(e)).length === 0, b.errors.join(" | ").slice(0, 300));
} finally { await b.stop() }
b = await launch({reduce: true, before: SKIP});
try {
  await b.goto(PLAY + "?dev=1&look=3d&time=night&q=med"); await ready(b); await until(b, "!!Flowgrow.look3d()", 20000); await sleep(2500); const f1 = await b.ev("window.__flowgrow3d.stats().frameTotal"); await sleep(2500); const f2 = await b.ev("window.__flowgrow3d.stats().frameTotal");
  ok("with reduced motion the 3D look is a still picture: no frames are drawn until something changes", f2 === f1, `${f1} frames, then ${f2}`);
  ok("and the day is held, not running", (await b.ev("window.__flowgrow3d.getTime().mode")) !== "cycle", await b.ev("window.__flowgrow3d.getTime().mode"));
} finally { await b.stop() }

// ------------------------------------------------------------------------------------------------ 5. the first run, and an old run
b = await launch();
try {
  await b.goto(PLAY + "?q=low"); await ready(b); await sleep(1000);
  const shown = await b.ev("!document.getElementById('intro').hidden"); const titles = [];
  if (shown) { for (let i = 0; i < 3; i++) { titles.push(await b.ev("document.getElementById('introT').textContent")); await b.ev("document.getElementById('introGo').click()") } }
  ok("the first visit shows three screens (place a tile, match two of the same level, grow the river), and the last button plays", shown && titles.length === 3 && /place/i.test(titles[0]) && /match/i.test(titles[1]) && /river/i.test(titles[2]) && (await b.ev("document.getElementById('intro').hidden")), titles.join(" / "));
  ok("it remembers, and never shows again", (await b.ev("localStorage.getItem('flowgrow.intro')")) === "1");
  await b.goto(PLAY + "?q=low"); await ready(b); await sleep(800); ok("a second visit shows no intro", (await b.ev("document.getElementById('intro').hidden")) === true);
} finally { await b.stop() }
b = await launch();
try {
  await b.goto(PLAY + "?q=low"); await ready(b); await sleep(600); await b.ev("document.getElementById('introSkip').click()");
  ok("the screens can be skipped, and that is remembered too", (await b.ev("document.getElementById('intro').hidden")) && (await b.ev("localStorage.getItem('flowgrow.intro')")) === "1");
} finally { await b.stop() }
b = await launch({before: SKIP + "localStorage.setItem('flowgrow.run.v12.zzz', JSON.stringify({seed: 3, moves: [{a:'p', i:0, x:7, y:4}], at: Date.now(), rules: 'zzz'}));"});
try {
  await b.goto(PLAY + "?q=low"); await ready(b); const msg = await b.ev("document.getElementById('msg').textContent");
  ok("a run saved by older rules is dropped with a plain line, and the key is gone", /older version of the rules/.test(msg) && (await b.ev("localStorage.getItem('flowgrow.run.v12.zzz')")) === null, msg);
} finally { await b.stop() }

// ------------------------------------------------------------------------------------------------ 6. the head, the service worker, the maps
b = await launch({before: SKIP});
try {
  await b.goto(PLAY + "?q=low"); await ready(b);
  const head = JSON.parse(await b.ev("JSON.stringify({title: document.title, desc: (document.querySelector('meta[name=description]')||{}).content, ogt: (document.querySelector('meta[property=\"og:title\"]')||{}).content, ogd: (document.querySelector('meta[property=\"og:description\"]')||{}).content, ogi: (document.querySelector('meta[property=\"og:image\"]')||{}).content, tw: (document.querySelector('meta[name=\"twitter:card\"]')||{}).content, theme: (document.querySelector('meta[name=theme-color]')||{}).content, icon: !!document.querySelector('link[rel=icon]'), apple: !!document.querySelector('link[rel=apple-touch-icon]')})"));
  ok("the head is share-ready: title, description, icon, theme colour and a preview image", head.title === "Flowgrow" && head.desc && head.ogt === "Flowgrow" && head.ogd && /\/share\.png$/.test(head.ogi || "") && head.tw === "summary_large_image" && head.theme && head.icon && head.apple, head.ogi);
  const img = JSON.parse(await b.ev(`(async () => { const r = await fetch("../share.png"); const bm = await createImageBitmap(await r.blob()); return JSON.stringify({status: r.status, type: r.headers.get("content-type"), w: bm.width, h: bm.height}) })()`));
  ok("the preview image is 1200x630", img.status === 200 && /png/.test(img.type) && img.w === 1200 && img.h === 630, JSON.stringify(img));
  await sleep(2500); const sw = JSON.parse(await b.ev("(async () => { const r = await navigator.serviceWorker.getRegistration(location.href); const w = r && (r.active || r.waiting || r.installing); return JSON.stringify({scope: r && r.scope, script: w && w.scriptURL, caches: await caches.keys()}) })()"));
  ok("the service worker installs and caches the game (flowgrow-*)", /\/flowgrow\/$|\/$/.test(sw.scope || "") && /\/sw\.js$/.test(sw.script || "") && sw.caches.some(k => k.startsWith("flowgrow-v")), JSON.stringify(sw));
  const swText = await (await fetch(url + "sw.js")).text(), list = [...swText.match(/const LOCAL = \[(.*?)\];/s)[1].matchAll(/"\.\/([^"]*)"/g)].map(m => m[1]); let missing = [];
  for (const p of list) { try { const r = await fetch(url + p); if (!r.ok) missing.push(p) } catch (_) { missing.push(p) } }
  ok("every file the service worker lists exists", list.length > 20 && missing.length === 0, `${list.length} files${missing.length ? ", missing " + missing.join(", ") : ""}`);
  ok("play/ is in the service worker's list", list.includes("play/"));
  ok("no page errors", b.errors.length === 0, b.errors.join(" | ").slice(0, 300));
} finally { await b.stop() }
b = await launch({before: SKIP});
try {
  await b.goto(url + "elevation/foothills/?q=low"); await ready(b); const e = JSON.parse(await b.ev("JSON.stringify({elev: Flowgrow.run().cfg.elevation, shape: Flowgrow.run().cfg.elevationShape, title: document.title})"));
  ok("an elevation map still works (its own rules, from the play page's)", e.elev === true && e.shape === "foothills" && /Foothills/.test(e.title) && b.errors.length === 0, JSON.stringify(e) + (b.errors.length ? " " + b.errors[0] : ""));
} finally { await b.stop() }

// ------------------------------------------------------------------------------------------------ 7. the numbers, and the pictures
b = await launch({before: SKIP});
try {
  await b.goto(PLAY + "?dev=1&look=3d&q=med&time=day&seed=5"); await ready(b); await until(b, "!!Flowgrow.look3d()", 30000); await sleep(4000);
  const m = JSON.parse(await b.ev(`JSON.stringify({first: (performance.getEntriesByName("fg-first-board")[0] || {}).startTime, fcp: (performance.getEntriesByName("first-contentful-paint")[0] || {}).startTime, dcl: performance.getEntriesByType("navigation")[0].domContentLoadedEventEnd,
    res: performance.getEntriesByType("resource").map(e => ({n: e.name, enc: e.encodedBodySize, dec: e.decodedBodySize, t: e.transferSize})), fps: window.__flowgrow3d.stats().fps, tri: window.__flowgrow3d.stats().triangles, calls: window.__flowgrow3d.stats().calls})`));
  const sum = k => m.res.reduce((a, r) => a + (r[k] || 0), 0); numbers.weight = {files: m.res.length, decoded: sum("dec"), encoded: sum("enc")};
  numbers.byGroup = {three: m.res.filter(r => /three/.test(r.n)).reduce((a, r) => a + r.dec, 0), look: m.res.filter(r => /look3d/.test(r.n)).reduce((a, r) => a + r.dec, 0), page: m.res.filter(r => /flowgrow\.js|flowgrow\.config|\.css|play\//.test(r.n)).reduce((a, r) => a + r.dec, 0), sprites: m.res.filter(r => /art\/pile/.test(r.n)).reduce((a, r) => a + r.dec, 0), fonts: m.res.filter(r => /fonts\//.test(r.n)).reduce((a, r) => a + r.dec, 0)};
  numbers.timing = {firstBoardMs: Math.round(m.first), firstPaintMs: Math.round(m.fcp), domContentLoadedMs: Math.round(m.dcl)}; numbers.fps = {fps: m.fps, triangles: m.tri, drawCalls: m.calls};
  console.log("      numbers: " + JSON.stringify(numbers));
  ok("the board is drawn (the plain look first, then the 3D look streams in) and the numbers are measured", m.first > 0 && m.res.length > 5, `first board ${Math.round(m.first)} ms, ${(numbers.weight.decoded / 1024).toFixed(0)} KB over ${m.res.length} files, ${m.fps} fps under this machine's GL`);
  if (out) {
    fs.writeFileSync(path.join(out, "numbers.txt"), JSON.stringify(numbers, null, 1));
    for (const [name, t] of [["day", "day"], ["gold", "gold"], ["night", "night"]]) { await b.ev(`window.__flowgrow3d.setTime(${JSON.stringify(t)})`); await sleep(2500); await b.shot(path.join(out, name + ".png")) }
  }
} finally { await b.stop() }
if (out) { b = await launch({before: SKIP});
  try { await b.goto(PLAY + "?dev=1&look=3d&q=med&time=gold&seed=3"); await ready(b); await until(b, "!!Flowgrow.look3d()", 30000); await b.ev(PLAYN(40)); await sleep(3500); await b.shot(path.join(out, "grown.png")) } finally { await b.stop() } }
console.log(bad ? `${bad} check(s) FAILED` : "all checks passed"); process.exit(bad ? 1 : 0);
