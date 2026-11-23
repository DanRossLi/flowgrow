#!/usr/bin/env node
// A browser check of the endgame page (LOU-319). A developer tool: not part of the game, and nothing here is loaded by a page.
//
//   node --experimental-websocket tools/endgame-smoke.mjs
//   node --experimental-websocket tools/endgame-smoke.mjs --url http://localhost:8000/ --out shots
//
//   --url U    the site to test (default the live game); the endgame page is U + "endgame/", the play page U + "play/", the test build U + "test/"
//   --out DIR  also save screenshots at 390x844 (endgame.png in the 3D look, locks-hidden.png, painted.png, simple.png, details.png, menu.png)
//
// /endgame/ shows a finished, very good island without playing: a static run, made by real play, that the page replays through the game's own rules. It checks that:
// (1) the page shows the run: it names itself "endgame", has replayed it to the score and top level in endgame/run.js, is over, has no pile or Undo, no result sheet by itself, and says what the island is on its card;
// (2) it is the same island in every look: ?look=3d, ?look=painted and ?look=simple (no graphics) all show the same board, and a bare visit opens the 3D look (or, on a machine that can't keep up, a simpler look);
// (3) it is static and can't be played: tapping tiles changes nothing (not the board, the score or the moves) and only says what the tile is, a reload gives the same island, and rules or a seed in the address are ignored;
// (4) the padlock button hides and shows the locks without changing the run (and remembers the choice), the Details sheet shows the result and how it was made and closes three ways, the menu has no New run;
// (5) it never touches the play page's saved keys: a run and a best score saved by the play page are still there, byte for byte, after a visit that used every control;
// (6) "Open in the test build" shows the same island there, with no graphics, and "Play your own" goes to the play page;
// (7) nothing is asked of another site, and there are no page errors.
// It exits with 1 if a check fails. It needs Chrome (set CHROME to its path if it isn't found) and drives it over the DevTools protocol with Node's built-in WebSocket, which is switched on by
// --experimental-websocket on Node 20 (Node 22 and newer need no flag). No packages.
import fs from "fs"; import path from "path"; import os from "os"; import {spawn, execSync} from "child_process"; import {fileURLToPath} from "url";
const die = msg => { console.error(msg); process.exit(1) }, sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let url = "https://danrossli.github.io/flowgrow/", out = null; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) { if (argv[i] === "--url") url = argv[++i]; else if (argv[i] === "--out") out = argv[++i]; else die(`Unknown option ${argv[i]}`) }
if (typeof WebSocket === "undefined") die("This Node has no built-in WebSocket. Run it as: node --experimental-websocket tools/endgame-smoke.mjs ...");
if (!url.endsWith("/")) url += "/"; if (out) fs.mkdirSync(out, {recursive: true});
const END = url + "endgame/", PLAY = url + "play/", TEST = url + "test/", ORIGIN = new URL(url).origin;

const window = {FLOWGROW_SIM: true};
for (const f of ["flowgrow.config.js", "flowgrow.js"]) new Function("window", fs.readFileSync(path.join(ROOT, f), "utf8"))(window);
const R = window.Flowgrow.rules, base = window.FLOWGROW, CFG0 = R.tidy(base, base).cfg, RK = R.rulesKey(CFG0);
const runW = {}; new Function("window", fs.readFileSync(path.join(ROOT, "endgame/run.js"), "utf8"))(runW); const E = runW.FLOWGROW_ENDGAME;

const GL = ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl"];
function chromePath() { const c = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean); return c.find(p => fs.existsSync(p)) || die("Chrome not found. Set CHROME to its path.") }
async function launch({width = 390, height = 844, dpr = 2, args = GL} = {}) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgrow-chrome-")), port = 9400 + Math.floor(Math.random() * 400);
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
  return {errors, reqs, stop, send,
    async goto(u) { const done = new Promise(r => loaded.push(r)); await send("Page.navigate", {url: u}); await done; await sleep(500) },
    async ev(expression) { const r = await send("Runtime.evaluate", {expression, returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value },
    async click(x, y) { await send("Input.dispatchMouseEvent", {type: "mouseMoved", x, y}); await send("Input.dispatchMouseEvent", {type: "mousePressed", x, y, button: "left", clickCount: 1}); await sleep(30); await send("Input.dispatchMouseEvent", {type: "mouseReleased", x, y, button: "left", clickCount: 1}); await sleep(150) },
    async shot(f) { fs.writeFileSync(f, Buffer.from((await send("Page.captureScreenshot", {format: "png"})).data, "base64")) } } }

let bad = 0; const ok = (what, cond, extra = "") => { if (!cond) bad++; console.log((cond ? "ok    " : "FAIL  ") + what + (extra ? "  (" + extra + ")" : "")) };
const until = async (b, expr, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await b.ev(expr)) return true } catch (_) {} await sleep(250) } return false };   // (a page that is navigating away has no context to ask: that is just "not yet")
const ready = (b, look) => until(b, `!!(window.Flowgrow && Flowgrow.run && Flowgrow.run() && Flowgrow.page() === "endgame"${look === "3d" ? ' && Flowgrow.skin() === "3d" && !!Flowgrow.look3d()' : look ? ` && Flowgrow.skin() === "${look}"` : ""})`, 60000);
const settled = async b => { await until(b, `!window.__flowgrow3d || (s => s.queued === 0 && s.popping === 0)(window.__flowgrow3d.stats())`, 90000); await sleep(1500) };
const sig = b => b.ev(`(() => { const S = Flowgrow.run(); return JSON.stringify([Object.keys(S.h).sort().map(k => [k, S.h[k], S.hb[k] || "", S.hf[k] || ""]), Object.keys(S.r).sort().map(k => [k, S.r[k].l, S.r[k].from]), Object.keys(S.lk).length, S.score, S.top, S.moves.length]) })()`);
const WANT_SIG = (() => { const S = R.replay(CFG0, E.seed, E.moves); return JSON.stringify([Object.keys(S.h).sort().map(k => [k, S.h[k], S.hb[k] || "", S.hf[k] || ""]), Object.keys(S.r).sort().map(k => [k, S.r[k].l, S.r[k].from]), Object.keys(S.lk).length, S.score, S.top, S.moves.length]) })();
const WANT = R.replay(CFG0, E.seed, E.moves);

// ---------- (1) the page, (2) the looks, (3) static and not playable
{ const b = await launch(); try {
  await b.goto(END); ok("the endgame page loads and starts the game's script", await ready(b));
  const st = JSON.parse(await b.ev(`JSON.stringify({page: Flowgrow.page(), over: Flowgrow.run().over, score: Flowgrow.run().score, top: Flowgrow.run().top, moves: Flowgrow.run().moves.length, locks: Flowgrow.run().lockUsed, why: Flowgrow.endgame().why, hasRun: !!Flowgrow.endgame().run, pile: getComputedStyle(document.getElementById("actions")).display, undo: getComputedStyle(document.getElementById("undoBtn")).display, win: document.getElementById("win").hidden, won: document.getElementById("app").classList.contains("won"), card: [document.getElementById("egT").textContent, document.getElementById("egS").textContent], title: document.title, left: Flowgrow.rules.left(Flowgrow.run())})`));
  ok(`it replayed the static run through the rules: ${st.score} points, top level ${st.top}, ${st.moves} moves, ${st.locks} locks, over`, st.over && st.score === E.score && st.top === E.top && st.moves === E.moveCount && st.locks === E.locks && st.score === WANT.score && !st.why && st.hasRun, JSON.stringify(st.why));
  ok("it has no pile and no Undo, no result sheet comes up by itself, and nothing is left to place", st.pile === "none" && st.undo === "none" && st.win && !st.won && st.left === 0);
  ok("the card says what it is", st.card[0] === "A finished island" && /Top level \d+ · \d+ habitats · \d+ locks · \d+ moves/.test(st.card[1]) && /Endgame/.test(st.title), st.card.join(" | "));
  ok("the island is the same board the rules give for the run (every habitat, kind, level and upgrade, and every river tile)", await sig(b) === WANT_SIG);
  // a bare visit opens the 3D look, or a simpler one if this machine can't keep up (software GL in a headless browser often can't)
  await sleep(6000); const skin = await b.ev("Flowgrow.skin()"); ok(`a bare visit opens the 3D look, or the quiet fallback (it is ${skin})`, ["3d", "painted", "simple"].includes(skin));
  ok("no look, rules or seed in the address change the island: ?seed=7&treeShare=0&stackSize=5 shows the same island", await (async () => { await b.goto(END + "?seed=7&treeShare=0&stackSize=5&look=simple"); await ready(b, "simple"); return await sig(b) === WANT_SIG })());
  for (const look of ["3d", "painted", "simple"]) { await b.goto(END + "?look=" + look); const up = await ready(b, look); if (look === "3d") await settled(b);
    ok(`?look=${look} shows the same island${look === "simple" ? " with no graphics" : ""}`, up && await sig(b) === WANT_SIG);
    if (look === "3d" && up) { const c = JSON.parse(await b.ev(`JSON.stringify((() => { const S = Flowgrow.run(), k = Object.keys(S.h).find(k => S.hb[k] === "m"); return {k, at: Flowgrow.scr(k.split(",").map(Number))} })())`)), was = await sig(b); await b.click(c.at[0], c.at[1]); const said3 = await b.ev(`document.getElementById("msg").textContent`);
      ok(`a tap in the 3D look says what the tile is and changes nothing: ${JSON.stringify(said3)}`, /Marsh/.test(said3) && await sig(b) === was) }
    if (out) await b.shot(path.join(out, look === "3d" ? "endgame.png" : look + ".png")) }
  // simple look: no graphics asked for at all (no image, no three.js, no sprite sheet)
  { b.reqs.length = 0; await b.goto(END + "?look=simple"); await ready(b, "simple"); await sleep(1500); const art = b.reqs.filter(r => /\.(webp|png|jpg|jpeg|gif|svg)(\?|$)/i.test(r.url) && !/icon-|apple-touch|favicon/.test(r.url) || /three\.|look3d/.test(r.url));
    ok("?look=simple asks for no picture and no 3D files", art.length === 0, art.map(r => r.url.split("/").pop()).join(", ")) }
  // it can't be played: a tap says what the tile is and changes nothing
  await b.goto(END + "?look=painted"); await ready(b, "painted");
  const cells = JSON.parse(await b.ev(`JSON.stringify((() => { const S = Flowgrow.run(), pick = f => Object.keys(S.h).find(f), ks = [pick(k => S.hb[k] === "p" && k in S.lk), pick(k => S.hb[k] === "m"), pick(k => S.hb[k] === "t"), pick(k => !S.hb[k] && S.h[k] > 2), Object.keys(S.r).find(k => S.r[k].from == null)].filter(Boolean); return ks.map(k => { const p = k.split(",").map(Number); return {k, at: Flowgrow.scr(p)} }) })())`));
  const before = await sig(b), said = [];
  for (const c of cells) { await b.click(c.at[0], c.at[1]); said.push(await b.ev(`document.getElementById("msg").textContent`)) }
  ok(`tapping tiles changes nothing (board, score, moves) and says what each tile is: ${said.map(s => JSON.stringify(s)).join(", ")}`, cells.length >= 4 && await sig(b) === before && said.every(s => s.length > 3) && said.some(s => /locked/.test(s)) && said.some(s => /Marsh|Prairie|Trees|River|source|level/i.test(s)));
  await b.goto(END + "?look=painted"); await ready(b, "painted"); ok("a reload gives the same island (the page is static)", await sig(b) === WANT_SIG);
} finally { await b.stop() } }

// ---------- (4) the padlock button, the Details sheet, the menu; (5) the play page's keys are never touched
{ const b = await launch(); try {
  const fake = JSON.stringify({seed: 424242, moves: [{a: "p", i: 0, x: 6, y: 3}], at: Date.now(), rules: RK}), keys = ["flowgrow.run.v14." + RK, "flowgrow.best." + RK, "flowgrow.intro"], vals = ["" + fake, "777", "1"];
  await b.goto(ORIGIN + "/robots.txt"); await b.ev(`(() => { localStorage.clear(); ${keys.map((k, i) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(vals[i])})`).join("; ")} })()`);
  await b.goto(END + "?look=painted"); await ready(b, "painted");
  const real = await b.ev(`Object.keys(Flowgrow.run().lk).length`);
  await b.ev(`document.getElementById("lockTog").click()`); await sleep(400);
  const hid = JSON.parse(await b.ev(`JSON.stringify({locks: Object.keys(Flowgrow.run().lk).length, pressed: document.getElementById("lockTog").getAttribute("aria-pressed"), label: document.getElementById("lockTog").getAttribute("aria-label"), moves: Flowgrow.run().moves.length, score: Flowgrow.run().score, saved: localStorage.getItem("flowgrow.endgame.locks"), card: document.getElementById("egS").textContent})`));
  ok(`the padlock button hides the locks (${real} to ${hid.locks}) without changing the run, and the card still says ${E.locks} locks`, real === E.locks && hid.locks === 0 && hid.pressed === "true" && /Show/.test(hid.label) && hid.moves === E.moveCount && hid.score === E.score && hid.saved === "off" && new RegExp(`${E.locks} locks`).test(hid.card));
  await b.goto(END + "?look=painted"); await ready(b, "painted"); const kept = await b.ev(`Object.keys(Flowgrow.run().lk).length`); ok("the choice is remembered for the next visit", kept === 0);
  await b.ev(`document.getElementById("lockTog").click()`); await sleep(300); const back = JSON.parse(await b.ev(`JSON.stringify({locks: Object.keys(Flowgrow.run().lk).length, pressed: document.getElementById("lockTog").getAttribute("aria-pressed"), saved: localStorage.getItem("flowgrow.endgame.locks")})`));
  ok("tapping it again shows every lock again (the real lock set comes back) and forgets the choice", back.locks === real && back.pressed === "false" && back.saved === null && real > 40, `${real} locks`);
  // Details
  await b.ev(`document.getElementById("egMore").click()`); await sleep(500);
  const sheet = JSON.parse(await b.ev(`JSON.stringify({open: !document.getElementById("win").hidden, rows: document.querySelectorAll("#wGoals li").length, score: document.getElementById("wScore").textContent, made: document.getElementById("egMade").textContent, title: document.getElementById("winTitle").textContent, again: document.getElementById("again").textContent})`));
  ok("Details opens the result sheet: the score, the rows (top level, planted and combined, river, locks, copies) and how it was made", sheet.open && sheet.rows >= 5 && sheet.score.includes(String(E.score)) && /real play/.test(sheet.made) && sheet.made.includes(String(E.seed)) && sheet.title === "A finished island" && /Play your own/.test(sheet.again), `${sheet.rows} rows · ${sheet.made.slice(0, 70)}…`);
  if (out) await b.shot(path.join(out, "details.png"));
  await b.ev(`document.getElementById("egBack").click()`); await sleep(200); const c1 = await b.ev(`document.getElementById("win").hidden`);
  await b.ev(`document.getElementById("egMore").click()`); await sleep(200); await b.ev(`document.getElementById("win").dispatchEvent(new MouseEvent("click", {bubbles: true}))`); await sleep(200); const c2 = await b.ev(`document.getElementById("win").hidden`);
  ok("the Details sheet closes with Back to the island and by tapping outside it", c1 && c2);
  // menu
  await b.ev(`document.getElementById("menuBtn").click()`); await sleep(400);
  const menu = JSON.parse(await b.ev(`JSON.stringify({rows: [...document.querySelectorAll("#menu .mrow")].filter(e => !e.hidden).map(e => e.dataset.m), conf: !!document.getElementById("mConf") && document.getElementById("mConf").hidden, head: document.querySelector("#menu .mhead b").textContent, how: document.querySelector("#menu .fghow").textContent.slice(0, 40), seed: document.getElementById("mSeed").textContent, ver: document.getElementById("mVer") ? document.getElementById("mVer").textContent : ""})`));
  ok(`the menu has Look, Copy run, Open in the test build, Play your own island, Whole island and the run log, and no New run: ${menu.rows.join(", ")}`, ["look", "runcopy", "totest", "toplay", "zoom", "log"].every(r => menu.rows.includes(r)) && !menu.rows.includes("new") && /Endgame/.test(menu.head) && menu.seed === "Seed " + E.seed, menu.head);
  if (out) await b.shot(path.join(out, "menu.png"));
  // the Look row cycles through the looks without a rule changing anything
  const looks = []; for (let i = 0; i < 3; i++) { await b.ev(`document.querySelector('#menu .mrow[data-m="look"]').click()`); await sleep(i === 1 ? 5000 : 800); await b.ev(`document.getElementById("menuBtn").click()`); looks.push(await b.ev(`Flowgrow.skin()`)); }
  ok(`the Look row cycles the looks (${looks.join(" → ")}) and the island stays the same`, new Set(looks).size >= 2 && await sig(b) === WANT_SIG && (await b.ev(`Flowgrow.run().score`)) === E.score);
  const now = await b.ev(`JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map(k => [k, localStorage.getItem(k)])))`), kept2 = JSON.parse(now);
  ok("the play page's saved run, best score and intro flag are still there, byte for byte, after a visit that used every control", keys.every((k, i) => kept2[k] === vals[i]));
  const own = await b.ev(`Object.keys(localStorage).filter(k => k.startsWith("flowgrow.") && !${JSON.stringify(keys)}.includes(k)).sort().join(",")`); ok("everything else it keeps is under its own prefix (flowgrow.endgame.)", own.split(",").filter(Boolean).every(k => k.startsWith("flowgrow.endgame.")), own);
} finally { await b.stop() } }

// ---------- (6) the other two endpoints
{ const b = await launch(); try {
  await b.goto(END + "?look=simple"); await ready(b, "simple"); await b.ev(`document.getElementById("menuBtn").click()`); await sleep(300);
  await b.ev(`document.querySelector('#menu .mrow[data-m="totest"]').click()`); const there = await until(b, `location.pathname.endsWith("/test/") && !!(window.Flowgrow && Flowgrow.run && Flowgrow.run())`, 30000);
  ok("Open in the test build opens the test build on the same island, finished, with no graphics", there && await b.ev(`Flowgrow.page() === "test" && Flowgrow.run().over && Flowgrow.run().score === ${E.score} && Flowgrow.skin() === "simple"`) && await sig(b) === WANT_SIG);
  await b.goto(END + "?look=simple"); await ready(b, "simple"); await b.ev(`document.getElementById("egPlay").click()`);
  ok("Play your own goes to the play page", await until(b, `location.pathname.endsWith("/play/")`, 20000));
  await b.goto(END + "?look=simple"); await ready(b, "simple"); await b.ev(`document.getElementById("egMore").click()`); await b.ev(`document.getElementById("again").click()`);
  ok("Play your own island on the Details sheet goes to the play page too", await until(b, `location.pathname.endsWith("/play/")`, 20000));
} finally { await b.stop() } }

// ---------- (7) nothing from other sites, no page errors
{ const b = await launch(); try {
  await b.goto(END); await ready(b); await sleep(4000); const foreign = b.reqs.filter(r => !r.url.startsWith(ORIGIN) && !r.url.startsWith("data:") && !r.url.startsWith("blob:") && !r.url.startsWith("about:"));
  ok("nothing is asked of another site", foreign.length === 0, foreign.map(r => r.url).slice(0, 3).join(", "));
  ok("no page errors on a bare visit", b.errors.length === 0, b.errors.join(" | ").slice(0, 300));
} finally { await b.stop() } }
if (bad) { console.log(`\n${bad} check${bad > 1 ? "s" : ""} failed.`); process.exit(1) } console.log("\nall endgame page checks passed.");
