#!/usr/bin/env node
// Replay a saved run in the real page, through its own taps and buttons, and read the score back off the page. A developer tool: it is
// not part of the game and nothing here is loaded by a page.
//
//   node --experimental-websocket tools/flowgrow-replay.mjs search-best.json
//   node --experimental-websocket tools/flowgrow-replay.mjs search-best.json --url http://localhost:8000/ --out replay
//
//   --url U    the site to play it on (default the live game); it plays on the test build, U + "test/", with the key=value changes the run was found under put in its address.
//   --out DIR  also save a screenshot of the finished island (island.png) and the run log the page produces (run-log.txt)
//
// It needs Chrome (set CHROME to its path if it isn't found) and drives it over the DevTools protocol with Node's built-in WebSocket,
// which is switched on by --experimental-websocket on Node 20 (Node 22 and newer need no flag). No packages.
import fs from "fs"; import path from "path"; import os from "os"; import {spawn, execSync} from "child_process";
const die = msg => { console.error(msg); process.exit(1) }, sleep = ms => new Promise(r => setTimeout(r, ms));
let file = null, url = "https://danrossli.github.io/flowgrow/", out = null; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) { if (argv[i] === "--url") url = argv[++i]; else if (argv[i] === "--out") out = argv[++i]; else if (!file && !argv[i].startsWith("--")) file = argv[i]; else die(`Unknown option ${argv[i]}`) }
if (!file) die("Usage: node --experimental-websocket tools/flowgrow-replay.mjs <run.json> [--url URL] [--out DIR]");
if (typeof WebSocket === "undefined") die("This Node has no built-in WebSocket. Run it as: node --experimental-websocket tools/flowgrow-replay.mjs ...");
let run; try { run = JSON.parse(fs.readFileSync(file, "utf8")) } catch (e) { die(`Can't read ${file}: ${e.message}`) }
if (!url.endsWith("/")) url += "/";

function chromePath() { const c = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean); return c.find(p => fs.existsSync(p)) || die("Chrome not found. Set CHROME to its path.") }
async function launch() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgrow-chrome-")), port = 9400 + Math.floor(Math.random() * 400);
  const proc = spawn(chromePath(), ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank"], {stdio: "ignore"});
  const stop = async () => { try { if (process.platform === "win32") execSync(`taskkill /PID ${proc.pid} /T /F`, {stdio: "ignore"}); else proc.kill() } catch (_) {} await sleep(300); try { fs.rmSync(dir, {recursive: true, force: true}) } catch (_) {} };
  let target = null; for (let i = 0; i < 120 && !target; i++) { await sleep(150); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === "page") } catch (_) {} }
  if (!target) { await stop(); die("Chrome didn't start") }
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
  let id = 0; const pending = new Map(), loaded = [], errors = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const {res, rej} = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result) }
    else if (d.method === "Page.loadEventFired") loaded.splice(0).forEach(f => f()); else if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text) };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, {res, rej}); ws.send(JSON.stringify({id: i, method, params})) });
  await send("Page.enable"); await send("Runtime.enable"); await send("Emulation.setDeviceMetricsOverride", {width: 390, height: 844, deviceScaleFactor: 2, mobile: true}); await send("Emulation.setEmulatedMedia", {features: [{name: "prefers-reduced-motion", value: "reduce"}]});
  return {errors, stop,
    async goto(u) { const done = new Promise(r => loaded.push(r)); await send("Page.navigate", {url: u}); await done; await sleep(900) },
    async ev(expression) { const r = await send("Runtime.evaluate", {expression, returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value },
    async shot(f) { fs.writeFileSync(f, Buffer.from((await send("Page.captureScreenshot", {format: "png"})).data, "base64")) } } }

const b = await launch(); let failed = false;
try {
  await b.goto(`${url}test/?seed=${run.seed}` + Object.entries(run.over || {}).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join(""));   // the test build: the plain look, with the run's rules in the address
  if (!(await b.ev("typeof Flowgrow !== 'undefined' && !!Flowgrow.run()"))) throw new Error("That page isn't Flowgrow.");
  const last = run.moves[run.moves.length - 1], body = last.a === "e" ? run.moves.slice(0, -1) : run.moves; let n = 0;
  for (const m of body) { const before = await b.ev("Flowgrow.run().moves.length");
    if (m.a === "p") await b.ev(`Flowgrow.tap([${m.x}, ${m.y}])`); else if (m.a === "d") await b.ev("document.getElementById('discardBtn').click()");
    else if (m.a === "l") { await b.ev(`Flowgrow.tap([${m.x}, ${m.y}])`); await b.ev("document.getElementById('lockYes').click()") }
    else if (m.a === "u") await b.ev(`document.querySelector('#pickq [data-f="${m.f}"]').click()`);
    n++; if ((await b.ev("Flowgrow.run().moves.length")) !== before + 1) throw new Error(`The page didn't take move ${n} (${JSON.stringify(m)}). Its rules are not the ones this run was found under.`) }
  const over = await b.ev("Flowgrow.run().over");
  if (out) { fs.mkdirSync(out, {recursive: true}); await b.ev("document.querySelector('[data-m=zoom]').click()"); await sleep(1200); await b.ev("Flowgrow.look([6, 4])"); await sleep(400); await b.shot(path.join(out, "island.png")) }
  if (!over) await b.ev("document.getElementById('endYes').click()"); await sleep(1200);
  const fin = await b.ev("(() => { const S = Flowgrow.run(); return {score: S.score, over: S.over, top: S.top, moves: S.moves.length, locks: S.lockUsed, sheet: document.getElementById('wScore').innerText, log: Flowgrow.rules.logText(S)} })()");
  console.log(`page: ${fin.score} points, top level ${fin.top}, ${fin.locks} locks, ${fin.moves} moves (${fin.sheet.replace(/\s+/g, " ")})`);
  if (out) fs.writeFileSync(path.join(out, "run-log.txt"), fin.log);
  if (fin.score === run.score) console.log(`MATCH: the page scores ${fin.score}, the same as the saved run.`); else { failed = true; console.log(`MISMATCH: the page scores ${fin.score}, the saved run ${run.score}.`) }
  if (b.errors.length) { failed = true; console.log("page errors:", b.errors) }
} catch (e) { failed = true; console.error(e.message) } finally { await b.stop() }
process.exit(failed ? 1 : 0);
