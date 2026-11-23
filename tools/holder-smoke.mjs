#!/usr/bin/env node
// A browser check of the tile holder: its pictures (LOU-312; the river's seven, LOU-313) and, since LOU-317, the pile floating over the island (the tile in hand, the next two, the stack of slabs and Discard). A developer tool: not part of the game,
// and nothing here is loaded by a page.
//
//   node --experimental-websocket tools/holder-smoke.mjs
//   node --experimental-websocket tools/holder-smoke.mjs --url http://localhost:8000/ --out shots
//
//   --url U    the site to test (default the live game); it tests the play page, U + "play/?dev=1"
//   --out DIR  also save screenshots of the holder (holder-390x844.png, holder-1280x800.png)
//
// It sets a pile with kinds in view (the tile in hand and the next two: river, green and prairie; a marsh behind them; and at the back of the pile, which the menu lists, a trees copy, a level 3 copy, a raised river
// copy and an upgraded prairie copy), through the page's test hook (Flowgrow.run() is the live state, Flowgrow.show() redraws it), and checks that: the hand and the next two show their sprites; a level 2 or higher tile
// still shows its flat tile and number; a sprite has its level number baked in, so it carries no pill, and every tile in the holder says its level in its accessible label; the tile in hand is the largest and the next two
// shrink in order; the count says "N left" and the stack has one slab for every tile left; Discard sits beside the tile in hand with a touch target of 44 px or more; the pile stays inside the window (no sideways scroll), clear
// of the top line and no taller than about 210 px at 390x844; the sprites are 40 KB or less each and 250 KB or less in all; a sprite that fails to load falls back to the flat tile (the holder is never empty); the picture
// never takes a tap and the one in hand bobs unless the player asks for less motion (then nothing bobs or glides); at 390x844, 360x640 and 1280x800. It exits with 1 if a check fails.
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
// the pile: river, green, prairie, marsh in the queue (the hand, the next two, and the first one behind them); at the back, a trees copy, a level 3 green copy, a raised river copy and an upgraded prairie copy
const STATE = `(() => { const S = Flowgrow.run(); S.q = [{k:"r", l:1}, {k:"h", l:1}, {k:"h", l:1, b:"p"}, {k:"h", l:1, b:"m"}]; S.bank = [{k:"h", l:1, b:"t", c:1}, {k:"h", l:3, c:1}, {k:"r", l:2, c:1}, {k:"h", l:4, b:"p", f:"steppe", c:1}]; Flowgrow.show(S.h); return true })()`;
const READ = `JSON.stringify({q: [...document.querySelectorAll("#queue .fgt")].map(e => ({slot: [...e.classList].find(c => /^s\\d$/.test(c)), art: (e.querySelector("img.fgart") || {src: ""}).src.split("/").pop(), flat: !!e.querySelector("canvas"), pill: e.querySelector(".fgl") ? getComputedStyle(e.querySelector(".fgl")).display !== "none" && e.querySelector(".fgl").textContent : null, num: e.querySelector(".fgnum") ? e.querySelector(".fgnum").textContent : null, label: e.getAttribute("aria-label"), role: e.getAttribute("role"), w: Math.round(e.getBoundingClientRect().width)})),
  bank: [...document.querySelectorAll("#bankList .fgt")].map(e => ({art: (e.querySelector("img.fgart") || {src: ""}).src.split("/").pop(), flat: !!e.querySelector("canvas"), pill: e.querySelector(".fgl") ? e.querySelector(".fgl").textContent : null, num: e.querySelector(".fgnum") ? e.querySelector(".fgnum").textContent : null, label: e.getAttribute("aria-label"), role: e.getAttribute("role")})),
  dock: (() => { const r = document.getElementById("actions").getBoundingClientRect(), t = document.getElementById("top").getBoundingClientRect(), d = document.getElementById("discardBtn").getBoundingClientRect(), g = document.getElementById("grab").getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, topBottom: t.bottom, discRight: d.right, discW: d.width, discH: d.height, grabLeft: g.left, scroll: document.documentElement.scrollWidth > innerWidth, vh: innerHeight} })(),
  stack: {slabs: document.querySelectorAll("#stack polygon").length / 3, chip: document.getElementById("leftT").textContent, left: Flowgrow.rules.left(Flowgrow.run()), hidden: document.getElementById("stack").hidden},
  name: document.getElementById("hName").textContent})`;
const ready = async b => { for (let i = 0; i < 80; i++) { if (await b.ev("!!(window.Flowgrow && Flowgrow.run && Flowgrow.run())")) return true; await sleep(200) } return false };

for (const [w, h, look] of [[390, 844, "simple"], [390, 844, "3d"], [360, 640, "simple"], [1280, 800, "simple"]]) { const b = await launch(w, h); const tag = `${w}x${h} ${look}`;
  try { await b.goto(`${url}play/?dev=1&look=${look}&q=low&seed=5&time=day`); ok(`${tag}: the page starts`, await ready(b)); await sleep(1200); await b.ev(STATE); await sleep(800);
    const d = JSON.parse(await b.ev(READ)), kinds = ["river-1.webp", "green.webp", "prairie.webp"];
    ok(`${tag}: the hand and the next two show the river (stage 1), green and prairie sprites (the marsh behind them is the stack's)`, d.q.length === 3 && d.q.every((t, i) => t.art === kinds[i] && t.slot === "s" + i), d.q.map(t => (t.art || "flat") + "@" + t.slot).join(", "));
    ok(`${tag}: the trees copy at the back of the pile (in the menu) shows its sprite`, d.bank[0] && d.bank[0].art === "trees.webp", d.bank.map(t => t.art || "flat").join(", "));
    ok(`${tag}: a level 3 copy and an upgraded copy keep the flat tile, and a raised river copy shows its stage's picture (river-2) with its level on it`, !d.bank[1].art && d.bank[1].flat && d.bank[2].art === "river-2.webp" && d.bank[2].num === "2" && !d.bank[3].art && d.bank[3].flat, JSON.stringify(d.bank.slice(1)));
    ok(`${tag}: a sprite has its number in the picture (baked in for a habitat, drawn on for a river tile), so no pill is drawn over it`, d.q.every(t => t.pill === null) && d.bank[0].pill === null && d.bank[2].pill === null && d.q[0].num === "1" && d.q[1].num === null, JSON.stringify(d.q.map(t => t.pill + "/" + t.num)));
    ok(`${tag}: every tile in the holder has an accessible label that says its level`, [...d.q, ...d.bank].every(t => t.role === "img" && /level \d/.test(t.label || "")) && d.q.every(t => /level 1/.test(t.label)) && [1, 3, 2, 4].every((l, i) => new RegExp("level " + l).test(d.bank[i].label)), [...d.q, ...d.bank].map(t => t.label).join(" | "));
    ok(`${tag}: the tile in hand is the largest and the next two shrink in order`, d.q[0].w > d.q[1].w && d.q[1].w > d.q[2].w, d.q.map(t => t.w + "px").join(", "));
    ok(`${tag}: the name above the hand says what it is, with its level`, /River tile · level 1/.test(d.name), d.name);
    const want = Math.min(d.stack.left, 24);
    ok(`${tag}: the count says how many tiles are left, and the stack has a slab for each (up to 24)`, d.stack.chip === d.stack.left + " left" && d.stack.slabs === want && !d.stack.hidden, `${d.stack.chip}, ${d.stack.slabs} slabs`);
    ok(`${tag}: Discard sits beside the tile in hand with a touch target of 44 px or more`, d.dock.discRight <= d.dock.grabLeft + 1 && d.dock.discW >= 44 && d.dock.discH >= 44, `${Math.round(d.dock.discW)}x${Math.round(d.dock.discH)} px, right edge ${Math.round(d.dock.discRight)}, hand starts ${Math.round(d.dock.grabLeft)}`);
    ok(`${tag}: the pile stays inside the window, clear of the top line, and no taller than about 210 px`, d.dock.left >= 0 && d.dock.right <= w && d.dock.bottom <= d.dock.vh + 1 && d.dock.top >= d.dock.topBottom && !d.dock.scroll && (w !== 390 || d.dock.bottom - d.dock.top <= 216), `pile ${Math.round(d.dock.top)} to ${Math.round(d.dock.bottom)} of ${d.dock.vh}, top line ends ${Math.round(d.dock.topBottom)}; sideways scroll ${d.dock.scroll}`);
    { const c = JSON.parse(await b.ev(`JSON.stringify({events: getComputedStyle(document.querySelector("#queue .fgt.s0 .fgart, #queue .fgt.s0 canvas")).pointerEvents, anim: getComputedStyle(document.querySelector("#queue .fgt.s0 .fgin")).animationName, lock: !!document.getElementById("lockBtn"), tilesLeft: !!document.getElementById("hLeft"), top: !!document.getElementById("hTop"), fit: !!document.getElementById("fitBtn")})`));
      ok(`${tag}: no Lock button, no "Tiles left" or "Top level" up top, and no zoom button over the island`, !c.lock && !c.tilesLeft && !c.top && !c.fit, JSON.stringify(c));
      if (look === "simple") ok(`${tag}: the picture never takes a tap, and the one in hand bobs`, c.events === "none" && c.anim === "fgb0", JSON.stringify(c)) }
    if (out && w !== 360 && look === "simple") await b.shot(path.join(out, `holder-${w}x${h}.png`));
    ok(`${tag}: no page errors`, b.errors.length === 0, b.errors.join(" | ").slice(0, 300)) } finally { await b.stop() } }
// the river's seven stages: each level has the nearest stage's picture, with its level drawn on it (LOU-313)
{ const b = await launch(390, 844); try { await b.goto(`${url}play/?dev=1&look=simple&q=low&seed=5`); await ready(b); await sleep(1200);
    const map = JSON.parse(await b.ev(`JSON.stringify(Array.from({length: 15}, (_, i) => Flowgrow.rules.riverStage(i + 1)))`));
    ok("levels 1 to 15 have the stages 1, 2, 3, 4, 4, 5, 5, 5, 6, 6, 6, 6, 6, 6, 7", JSON.stringify(map) === JSON.stringify([1, 2, 3, 4, 4, 5, 5, 5, 6, 6, 6, 6, 6, 6, 7]), map.join(","));
    for (const levels of [[1, 2, 3], [4, 6, 9], [15, 5, 12]]) { await b.ev(`(() => { const S = Flowgrow.run(); S.q = ${JSON.stringify(levels)}.map(l => ({k: "r", l})).concat([{k: "h", l: 1}]); S.bank = []; Flowgrow.show(S.h); return true })()`); await sleep(1500);
      const r = JSON.parse(await b.ev(`JSON.stringify([...document.querySelectorAll("#queue .fgt")].map(e => ({art: (e.querySelector("img.fgart") || {src: ""}).src.split("/").pop(), num: e.querySelector(".fgnum") ? e.querySelector(".fgnum").textContent : null, label: e.getAttribute("aria-label")})))`));
      ok(`river levels ${levels.join(", ")} show their stage's picture with their level drawn on it`, r.length === 3 && r.every((t, i) => t.art === "river-" + map[levels[i] - 1] + ".webp" && t.num === String(levels[i]) && new RegExp("level " + levels[i]).test(t.label || "")), JSON.stringify(r));
      if (out) await b.shot(path.join(out, `river-stages-${levels.join("-")}.png`)) }
    ok("no page errors", b.errors.length === 0, b.errors.join(" | ").slice(0, 300)) } finally { await b.stop() } }
// sizes: 40 KB or less each, 250 KB or less in all
{ const b = await launch(390, 844); try { await b.goto(`${url}play/?dev=1&look=simple&seed=5`); const sizes = await b.ev(`(async () => { const o = {}; for (const k of ["river-1", "river-2", "river-3", "river-4", "river-5", "river-6", "river-7", "green", "prairie", "marsh", "trees"]) { const r = await fetch("../art/pile/" + k + ".webp"); o[k] = r.ok ? (await r.arrayBuffer()).byteLength : -1 } return JSON.stringify(o) })()`), s = JSON.parse(sizes), total = Object.values(s).reduce((a, v) => a + Math.max(0, v), 0);
    { const hab = ["green", "prairie", "marsh", "trees"], riv = Object.keys(s).filter(k => /^river-/.test(k)), sum = ks => ks.reduce((a, k) => a + Math.max(0, s[k]), 0);
      ok("each sprite is 40 KB or less, the four habitats 250 KB or less in all and the seven river stages 280 KB or less in all", Object.values(s).every(v => v > 0 && v <= 40 * 1024) && riv.length === 7 && sum(hab) <= 250 * 1024 && sum(riv) <= 280 * 1024, Object.entries(s).map(([k, v]) => `${k} ${(v / 1024).toFixed(1)} KB`).join(", ") + `; habitats ${(sum(hab) / 1024).toFixed(1)} KB, river ${(sum(riv) / 1024).toFixed(1)} KB`) } } finally { await b.stop() } }
// a sprite that fails to load: its tile is drawn flat and the holder is never empty
{ const b = await launch(390, 844, {block: ["*art/pile/green.webp*"]}); try { await b.goto(`${url}play/?dev=1&look=simple&q=low&seed=5`); await ready(b); await sleep(1200); await b.ev(STATE); await sleep(800); const d = JSON.parse(await b.ev(READ));
    ok("a sprite that fails to load falls back to the flat tile, and the rest still show", d.q.length === 3 && !d.q[1].art && d.q[1].flat && d.q[0].art === "river-1.webp" && d.q[2].art === "prairie.webp", d.q.map(t => t.art || "flat").join(", "));
    ok("  no page errors", b.errors.filter(e => !/Failed to load resource|ERR_BLOCKED/.test(e)).length === 0, b.errors.join(" | ").slice(0, 300)) } finally { await b.stop() } }
// less motion: nothing bobs or glides
{ const b = await launch(390, 844, {reduce: true}); try { await b.goto(`${url}play/?dev=1&look=simple&q=low&seed=5`); await ready(b); await sleep(1200); await b.ev(STATE); await sleep(800);
    const r = JSON.parse(await b.ev(`JSON.stringify({bob: getComputedStyle(document.querySelector("#queue .fgt.s0 .fgin")).animationName, stack: getComputedStyle(document.getElementById("stack")).animationName, glide: getComputedStyle(document.querySelector("#queue .fgt.s0")).transitionDuration})`));
    ok("with reduced motion nothing bobs and the tiles don't glide", r.bob === "none" && r.stack === "none" && /^0s(, 0s)*$/.test(r.glide), JSON.stringify(r)) } finally { await b.stop() } }
console.log(bad ? `${bad} check(s) FAILED` : "all checks passed"); process.exit(bad ? 1 : 0);
