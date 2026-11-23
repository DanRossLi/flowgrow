#!/usr/bin/env node
// A browser check of the tile holder's pictures (LOU-312). A developer tool: not part of the game, and nothing here is loaded by a page.
//
//   node --experimental-websocket tools/holder-smoke.mjs
//   node --experimental-websocket tools/holder-smoke.mjs --url http://localhost:8000/ --out shots
//
//   --url U    the site to test (default the live game); it tests the play page, U + "play/?dev=1"
//   --out DIR  also save screenshots of the holder with all five kinds in view (holder-390x844.png, holder-1280x800.png)
//
// It sets a pile with all five kinds in view (the tile in hand and the next three, and a copy of the fifth at the back of the pile, with a level 3 copy and a raised river copy beside it), through the page's test hook
// (Flowgrow.run() is the live state, Flowgrow.show() redraws it), and checks that: each of the five kinds shows its sprite in the hand, the next three and the back of the pile; a level 2 or higher tile still shows its flat
// tile and number; a sprite has its level number baked in, so it carries no pill, and every tile in the holder says its level in its accessible label; the sprites are 40 KB or less each and 250 KB or less in all; a sprite that fails to load falls back to the flat tile (the holder is never empty); the
// picture never takes a tap and the one in hand bobs unless the player asks for less motion; the holder fits the window (no sideways scroll) and sits above the Menu, Lock, Discard and Undo buttons, at 390x844, 360x640 and
// 1280x800. It exits with 1 if a check fails.
//
// It needs Chrome (set CHROME to its path if it isn't found) and drives it over the DevTools protocol with Node's built-in WebSocket, which is switched on by --experimental-websocket on Node 20 (Node 22 and newer need no
// flag). No packages.
import fs from "fs"; import path from "path"; import os from "os"; import {spawn, execSync} from "child_process";
const die = msg => { console.error(msg); process.exit(1) }, sleep = ms => new Promise(r => setTimeout(r, ms));
let url = "https://danrossli.github.io/flowgrow/", out = null; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) { if (argv[i] === "--url") url = argv[++i]; else if (argv[i] === "--out") out = argv[++i]; else die(`Unknown option ${argv[i]}`) }
if (typeof WebSocket === "undefined") die("This Node has no built-in WebSocket. Run it as: node --experimental-websocket tools/holder-smoke.mjs ...");
if (!url.endsWith("/")) url += "/"; if (out) fs.mkdirSync(out, {recursive: true});

function chromePath() { const c = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean); return c.find(p => fs.existsSync(p)) || die("Chrome not found. Set CHROME to its path.") }
async function launch(width, height, {reduce = false, block = []} = {}) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgrow-chrome-")), port = 9400 + Math.floor(Math.random() * 400);
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
  await send("Page.enable"); await send("Runtime.enable"); await send("Emulation.setDeviceMetricsOverride", {width, height, deviceScaleFactor: 2, mobile: width < 600});
  if (reduce) await send("Emulation.setEmulatedMedia", {features: [{name: "prefers-reduced-motion", value: "reduce"}]});
  if (block.length) { await send("Network.enable"); await send("Network.setBlockedURLs", {urls: block}) }
  return {errors, stop,
    async goto(u) { const done = new Promise(r => loaded.push(r)); await send("Page.navigate", {url: u}); await done; await sleep(1500) },
    async ev(expression) { const r = await send("Runtime.evaluate", {expression, returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value },
    async shot(f) { fs.writeFileSync(f, Buffer.from((await send("Page.captureScreenshot", {format: "png"})).data, "base64")) } } }

let bad = 0; const ok = (what, cond, extra = "") => { if (!cond) bad++; console.log((cond ? "ok    " : "FAIL  ") + what + (extra ? "  (" + extra + ")" : "")) };
// the pile: river, green, prairie, marsh in the queue (the hand and the next three); at the back, a trees copy, a level 3 green copy, a raised river copy and an upgraded prairie copy
const STATE = `(() => { const S = Flowgrow.run(); S.q = [{k:"r", l:1}, {k:"h", l:1}, {k:"h", l:1, b:"p"}, {k:"h", l:1, b:"m"}]; S.bank = [{k:"h", l:1, b:"t", c:1}, {k:"h", l:3, c:1}, {k:"r", l:2, c:1}, {k:"h", l:4, b:"p", f:"steppe", c:1}]; Flowgrow.show(S.h); return true })()`;
const READ = `JSON.stringify({q: [...document.querySelectorAll("#queue .fgt")].map(e => ({art: (e.querySelector("img.fgart") || {src: ""}).src.split("/").pop(), flat: !!e.querySelector("canvas"), pill: e.querySelector(".fgl") ? getComputedStyle(e.querySelector(".fgl")).display !== "none" && e.querySelector(".fgl").textContent : null, label: e.getAttribute("aria-label"), role: e.getAttribute("role"), w: Math.round(e.getBoundingClientRect().width)})),
  bank: [...document.querySelectorAll("#bankList .fgt")].map(e => ({art: (e.querySelector("img.fgart") || {src: ""}).src.split("/").pop(), flat: !!e.querySelector("canvas"), pill: e.querySelector(".fgl") ? e.querySelector(".fgl").textContent : null, label: e.getAttribute("aria-label"), role: e.getAttribute("role")})),
  pile: (() => { const r = document.querySelector(".fgpile").getBoundingClientRect(), b = document.querySelector(".fgbtns").getBoundingClientRect(); return {left: r.left, right: r.right, bottom: r.bottom, btnTop: b.top, scroll: document.documentElement.scrollWidth > innerWidth} })()})`;
const ready = async b => { for (let i = 0; i < 80; i++) { if (await b.ev("!!(window.Flowgrow && Flowgrow.run && Flowgrow.run())")) return true; await sleep(200) } return false };

for (const [w, h, look] of [[390, 844, "simple"], [390, 844, "3d"], [360, 640, "simple"], [1280, 800, "simple"]]) { const b = await launch(w, h); const tag = `${w}x${h} ${look}`;
  try { await b.goto(`${url}play/?dev=1&look=${look}&q=low&seed=5&time=day`); ok(`${tag}: the page starts`, await ready(b)); await sleep(1200); await b.ev(STATE); await sleep(800);
    const d = JSON.parse(await b.ev(READ)), kinds = ["river.webp", "green.webp", "prairie.webp", "marsh.webp"];
    ok(`${tag}: the hand and the next three show the river, green, prairie and marsh sprites`, d.q.length === 4 && d.q.every((t, i) => t.art === kinds[i]), d.q.map(t => t.art || "flat").join(", "));
    ok(`${tag}: the trees copy at the back of the pile shows its sprite`, d.bank[0] && d.bank[0].art === "trees.webp", d.bank.map(t => t.art || "flat").join(", "));
    ok(`${tag}: a level 3 copy, a raised river copy and an upgraded copy keep the flat tile`, d.bank.slice(1).every(t => !t.art && t.flat), JSON.stringify(d.bank.slice(1)));
    ok(`${tag}: a sprite has its number baked into the picture, so no pill is drawn over it`, d.q.every(t => t.pill === null) && d.bank[0].pill === null, JSON.stringify(d.q.map(t => t.pill)));
    ok(`${tag}: every tile in the holder has an accessible label that says its level`, [...d.q, ...d.bank].every(t => t.role === "img" && /level \d/.test(t.label || "")) && d.q.every(t => /level 1/.test(t.label)) && [1, 3, 2, 4].every((l, i) => new RegExp("level " + l).test(d.bank[i].label)), [...d.q, ...d.bank].map(t => t.label).join(" | "));
    ok(`${tag}: the tile in hand is the largest and all fit`, d.q[0].w > d.q[1].w && d.pile.left >= 0 && d.pile.right <= w && !d.pile.scroll, `${d.q[0].w}px hand, ${d.q[1].w}px next; sideways scroll ${d.pile.scroll}`);
    ok(`${tag}: the holder sits above Menu, Lock, Discard and Undo`, d.pile.bottom <= d.pile.btnTop + 1, `holder ends ${Math.round(d.pile.bottom)}, buttons start ${Math.round(d.pile.btnTop)}`);
    if (look === "simple") { const a = await b.ev(`(() => { const im = document.querySelector("#queue .fgt.now img.fgart"), c = getComputedStyle(im); return JSON.stringify({events: c.pointerEvents, anim: c.animationName}) })()`); const c = JSON.parse(a);
      ok(`${tag}: the picture never takes a tap, and the one in hand bobs`, c.events === "none" && c.anim === "fgbob", JSON.stringify(c)) }
    if (out && w !== 360 && look === "simple") await b.shot(path.join(out, `holder-${w}x${h}.png`));
    ok(`${tag}: no page errors`, b.errors.length === 0, b.errors.join(" | ").slice(0, 300)) } finally { await b.stop() } }
// sizes: 40 KB or less each, 250 KB or less in all
{ const b = await launch(390, 844); try { await b.goto(`${url}play/?dev=1&look=simple&seed=5`); const sizes = await b.ev(`(async () => { const o = {}; for (const k of ["river", "green", "prairie", "marsh", "trees"]) { const r = await fetch("../art/pile/" + k + ".webp"); o[k] = r.ok ? (await r.arrayBuffer()).byteLength : -1 } return JSON.stringify(o) })()`), s = JSON.parse(sizes), total = Object.values(s).reduce((a, v) => a + Math.max(0, v), 0);
    ok("each sprite is 40 KB or less and all five 250 KB or less", Object.values(s).every(v => v > 0 && v <= 40 * 1024) && total <= 250 * 1024, Object.entries(s).map(([k, v]) => `${k} ${(v / 1024).toFixed(1)} KB`).join(", ") + `, ${(total / 1024).toFixed(1)} KB in all`) } finally { await b.stop() } }
// a sprite that fails to load: its tile is drawn flat and the holder is never empty
{ const b = await launch(390, 844, {block: ["*art/pile/green.webp*"]}); try { await b.goto(`${url}play/?dev=1&look=simple&q=low&seed=5`); await ready(b); await sleep(1200); await b.ev(STATE); await sleep(800); const d = JSON.parse(await b.ev(READ));
    ok("a sprite that fails to load falls back to the flat tile, and the rest still show", d.q.length === 4 && !d.q[1].art && d.q[1].flat && d.q[0].art === "river.webp" && d.q[2].art === "prairie.webp", d.q.map(t => t.art || "flat").join(", "));
    ok("  no page errors", b.errors.filter(e => !/Failed to load resource|ERR_BLOCKED/.test(e)).length === 0, b.errors.join(" | ").slice(0, 300)) } finally { await b.stop() } }
// less motion: the bob stops
{ const b = await launch(390, 844, {reduce: true}); try { await b.goto(`${url}play/?dev=1&look=simple&q=low&seed=5`); await ready(b); await sleep(1200); await b.ev(STATE); await sleep(800);
    const an = await b.ev(`getComputedStyle(document.querySelector("#queue .fgt.now img.fgart")).animationName`); ok("with reduced motion the picture in hand doesn't bob", an === "none", an) } finally { await b.stop() } }
console.log(bad ? `${bad} check(s) FAILED` : "all checks passed"); process.exit(bad ? 1 : 0);
