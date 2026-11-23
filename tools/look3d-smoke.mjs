#!/usr/bin/env node
// A browser smoke test of the 3D look (LOU-311). A developer tool: not part of the game, and nothing here is loaded by a page.
//
//   node --experimental-websocket tools/look3d-smoke.mjs
//   node --experimental-websocket tools/look3d-smoke.mjs --url http://localhost:8000/ --out shots
//
//   --url U    the page to test (default the live game)
//   --out DIR  also save screenshots of day, golden hour and night at 390x844 (day.png, gold.png, night.png)
//
// It loads ?look=3d&time=night&q=low in headless Chrome (software GL, so it needs no graphics card), plays three moves by tapping the canvas, and checks that the page logged no errors, that the canvas is not blank,
// that nothing was loaded from another site, that the camera never leaves its fixed angle and that the day and night can be held (?time=). It then plays the same twenty moves in ?look=simple and ?look=3d with the same
// seed and checks that the moves and the score come out the same, move for move. It exits with 1 if a check fails.
//
// It needs Chrome (set CHROME to its path if it isn't found) and drives it over the DevTools protocol with Node's built-in WebSocket, which is switched on by --experimental-websocket on Node 20 (Node 22 and newer
// need no flag). No packages.
import fs from "fs"; import path from "path"; import os from "os"; import {spawn, execSync} from "child_process";
const die = msg => { console.error(msg); process.exit(1) }, sleep = ms => new Promise(r => setTimeout(r, ms));
let url = "https://danrossli.github.io/flowgrow/", out = null; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) { if (argv[i] === "--url") url = argv[++i]; else if (argv[i] === "--out") out = argv[++i]; else die(`Unknown option ${argv[i]}`) }
if (typeof WebSocket === "undefined") die("This Node has no built-in WebSocket. Run it as: node --experimental-websocket tools/look3d-smoke.mjs ...");
if (!url.endsWith("/")) url += "/"; if (out) fs.mkdirSync(out, {recursive: true});

function chromePath() { const c = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean); return c.find(p => fs.existsSync(p)) || die("Chrome not found. Set CHROME to its path.") }
async function launch(width = 390, height = 844, dpr = 2) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgrow-chrome-")), port = 9400 + Math.floor(Math.random() * 400);
  const proc = spawn(chromePath(), ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "about:blank"], {stdio: "ignore"});
  const stop = async () => { try { if (process.platform === "win32") execSync(`taskkill /PID ${proc.pid} /T /F`, {stdio: "ignore"}); else proc.kill() } catch (_) {} await sleep(300); try { fs.rmSync(dir, {recursive: true, force: true}) } catch (_) {} };
  let target = null; for (let i = 0; i < 120 && !target; i++) { await sleep(150); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === "page") } catch (_) {} }
  if (!target) { await stop(); die("Chrome didn't start") }
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
  let id = 0; const pending = new Map(), loaded = [], errors = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const {res, rej} = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result) }
    else if (d.method === "Page.loadEventFired") loaded.splice(0).forEach(f => f());
    else if (d.method === "Runtime.exceptionThrown") errors.push("exception: " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("console.error: " + d.params.args.map(a => a.value ?? a.description).join(" ")) };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, {res, rej}); ws.send(JSON.stringify({id: i, method, params})) });
  await send("Page.enable"); await send("Runtime.enable"); await send("Emulation.setDeviceMetricsOverride", {width, height, deviceScaleFactor: dpr, mobile: width < 600}); await send("Emulation.setTouchEmulationEnabled", {enabled: width < 600, maxTouchPoints: 5});
  return {errors, stop,
    async goto(u) { const done = new Promise(r => loaded.push(r)); await send("Page.navigate", {url: u}); await done; await sleep(900) },
    async ev(expression) { const r = await send("Runtime.evaluate", {expression, returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value },
    async shot(f) { fs.writeFileSync(f, Buffer.from((await send("Page.captureScreenshot", {format: "png"})).data, "base64")) },
    async drag(x0, y0, x1, y1) { await send("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [{x: x0, y: y0}]}); for (let i = 1; i <= 8; i++) { await sleep(30); await send("Input.dispatchTouchEvent", {type: "touchMove", touchPoints: [{x: x0 + (x1 - x0) * i / 8, y: y0 + (y1 - y0) * i / 8}]}) } await send("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []}) },
    async tap(x, y) { await send("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [{x, y}]}); await sleep(40); await send("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []}); await sleep(150) } } }

let bad = 0; const ok = (what, cond, extra = "") => { if (!cond) bad++; console.log((cond ? "ok    " : "FAIL  ") + what + (extra ? "  (" + extra + ")" : "")) };
const ready = async b => { for (let i = 0; i < 120; i++) { if (await b.ev("!!(window.Flowgrow && Flowgrow.look3d && Flowgrow.look3d())")) return true; await sleep(250) } return false };
// twenty moves, chosen the same way each time (no random): the first, the eighth, the fifteenth ... option, a discard when there are none, the upgrade pick when one is asked for
const PLAY = `(() => { const F = Flowgrow; for (let i = 0; i < 20; i++) { const S = F.run(); if (S.over) break; if (S.pend && S.pend.length) { const k = S.pend[0]; F.pick(S.hb[k] === "p" ? "meadow" : "roots"); continue }
  const o = F.options(); if (!o.length) { F.discard(); continue } F.tap(o[(i * 7) % o.length].p) } const S = F.run(); return JSON.stringify({moves: S.moves, score: S.score}) })()`;

let b = await launch();
try {
  const t0 = Date.now(); await b.goto(`${url}?look=3d&time=night&q=low&seed=5`);
  ok("the 3D look loads and mounts", await ready(b), (Date.now() - t0) + " ms"); await sleep(2500);
  const urls = await b.ev("performance.getEntriesByType('resource').map(e => e.name)"), own = new URL(url).origin;
  ok("nothing was loaded from another site", urls.every(u => u.startsWith(own) || u.startsWith("data:") || u.startsWith("blob:")), urls.filter(u => !u.startsWith(own)).join(", "));
  ok("three.js came from this site (vendor/three.r128.min.js)", urls.some(u => u.endsWith("vendor/three.r128.min.js")));
  let made = 0; for (let i = 0; i < 3; i++) { const o = await b.ev("Flowgrow.options().map(o => o.p)"); if (!o.length) break; const [x, y] = await b.ev(`Flowgrow.scr(${JSON.stringify(o[i % o.length])})`); await b.tap(x, y); made++ }
  await sleep(1200); const run = JSON.parse(await b.ev("JSON.stringify({moves: Flowgrow.run().moves.length, skin: Flowgrow.skin()})")); ok("three moves played by tapping the canvas", made === 3 && run.moves >= 3 && run.skin === "3d", JSON.stringify(run));
  const px = await b.ev("window.__flowgrow3d.sample(12)"), lum = px.map(c => c[0] + c[1] + c[2]); ok("the canvas is not blank", new Set(px.map(c => c.join())).size > 1 && Math.max(...lum) > 30, "max brightness " + Math.max(...lum));
  // the camera never leaves its fixed angle: zoom with the wheel, drag the island with a finger, and read the angle back from the camera's place
  const angle = () => b.ev("(() => { const F = window.__flowgrow3d, v = F.view, p = F.camera.position, dx = p.x - v.tx, dy = p.y - .62, dz = p.z - v.tz, r = Math.hypot(dx, dy, dz); return JSON.stringify([+Math.acos(dy / r).toFixed(3), +Math.atan2(dx, dz).toFixed(3)]) })()").then(JSON.parse);
  const a0 = await angle(); await b.ev("(() => { const c = document.getElementById('cv3d'), r = c.getBoundingClientRect(); c.dispatchEvent(new WheelEvent('wheel', {deltaY: -500, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true})) })()"); await sleep(1200);
  await b.drag(200, 500, 120, 380); await sleep(800); const a1 = await angle(), zoomed = await b.ev("window.__flowgrow3d.view.gd");
  ok("zoom and pan work and the camera angle never changes (polar 0.98, azimuth 0.62)", JSON.stringify(a0) === "[0.98,0.62]" && JSON.stringify(a1) === "[0.98,0.62]" && zoomed < 80, `before ${JSON.stringify(a0)}, after ${JSON.stringify(a1)}, distance ${zoomed.toFixed(1)}`);
  const stats = JSON.parse(await b.ev("JSON.stringify(window.__flowgrow3d.stats())")); console.log("      stats: " + JSON.stringify({quality: stats.quality, triangles: stats.triangles, drawCalls: stats.calls}));
  const moments = {}; for (const m of ["day", "gold", "night"]) { await b.ev(`window.__flowgrow3d.setTime(${JSON.stringify(m)})`); await sleep(1500); moments[m] = JSON.parse(await b.ev("JSON.stringify(window.__flowgrow3d.getTime())")); if (out) await b.shot(path.join(out, m + ".png")) }
  ok("the day, golden hour and night can each be held", moments.day.phase === "day" && moments.gold.phase === "golden" && moments.night.phase === "night" && moments.night.night > .99, Object.entries(moments).map(([k, v]) => k + " t=" + v.t.toFixed(2)).join(", "));
  // the day goes round with no mesh rebuilt and no shader compiled: only uniforms change
  const info = () => b.ev("(() => { const i = window.__flowgrow3d.renderer.info; return JSON.stringify([i.memory.geometries, i.programs.length]) })()"); const g0 = await info(); const seen = new Set();
  for (let t = 0; t < 1; t += .05) { await b.ev(`window.__flowgrow3d.setTime(${t.toFixed(2)})`); await sleep(100); seen.add(JSON.parse(await b.ev("JSON.stringify(window.__flowgrow3d.getTime().phase)"))) } const g1 = await info();
  ok("the day goes round (dawn, day, golden, dusk, night, predawn) and rebuilds nothing", ["dawn", "day", "golden", "dusk", "night", "predawn"].every(p => seen.has(p)) && g0 === g1, `${[...seen].join(",")}; geometries and programs ${g0} -> ${g1}`);
  ok("no page errors", b.errors.length === 0, b.errors.join(" | ").slice(0, 400));
} finally { await b.stop() }
// the whole island fits at the opening view, on a phone and on a desktop window
for (const [w, h] of [[390, 844], [1280, 800]]) { b = await launch(w, h, 1); try { await b.goto(`${url}?look=3d&q=low&time=day&seed=5`); await ready(b); await sleep(1800);
    const box = await b.ev("(() => { const r = document.getElementById('cv3d').getBoundingClientRect(), pts = [[0, 0], [12, 0], [0, 8], [12, 8]].map(p => Flowgrow.scr(p)); return JSON.stringify({r: [r.left, r.top, r.right, r.bottom], pts}) })()"), d = JSON.parse(box);
    ok(`the whole island fits at the opening view at ${w}x${h}`, d.pts.every(([x, y]) => x > d.r[0] && x < d.r[2] && y > d.r[1] && y < d.r[3]), JSON.stringify(d.pts.map(p => p.map(Math.round)))) } finally { await b.stop() } }
// the same seed, the same twenty moves, in the simple look and in the 3D look: the moves and the score must match
const results = {};
for (const look of ["simple", "3d"]) { b = await launch(); try { await b.goto(`${url}?look=${look}&q=low&time=day&seed=5&stackSize=20`); if (look === "3d") await ready(b); else await sleep(800); await sleep(1500);
    results[look] = JSON.parse(await b.ev(PLAY)); await sleep(800); if (b.errors.length) { bad++; console.log("FAIL  page errors in the " + look + " look: " + b.errors.join(" | ").slice(0, 300)) } } finally { await b.stop() } }
ok("the simple look and the 3D look play the same moves and score the same", JSON.stringify(results.simple) === JSON.stringify(results["3d"]) && results.simple.moves.length > 0, `${results.simple.moves.length} moves, score ${results.simple.score} and ${results["3d"].score}`);
console.log(bad ? `${bad} check(s) FAILED` : "all checks passed"); process.exit(bad ? 1 : 0);
