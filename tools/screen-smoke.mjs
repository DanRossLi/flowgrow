#!/usr/bin/env node
// A browser check of the game screen and the way it is played (LOU-317). A developer tool: not part of the game, and nothing here is loaded by a page.
//
//   node --experimental-websocket tools/screen-smoke.mjs
//   node --experimental-websocket tools/screen-smoke.mjs --url http://localhost:8000/ --out shots
//
//   --url U    the site to test (default the live game); it tests the play page, U + "play/?dev=1"
//   --out DIR  also save screenshots (screen-<look>-start.png, -rings.png, -carrying.png, -lock.png, -end.png)
//
// It plays on the plain look and on the 3D look at 390x844 with real touches (Chrome's touch emulation), and checks that: the top line is the score with Undo and Menu and nothing else (no Tiles left, no Top level, no
// zoom button), every icon button has a label, Undo is dimmed until there is a move; there is no Lock button and no panel over the island; the island sits between the top line and the pile; a tap on land places the
// tile in hand; a drag lifts the tile, which snaps over a cell it can go to with a tag with its points and lights the cell, and lets go to place it; a drop on a cell that can't take it, or anywhere else, puts it back
// and places nothing; a drop on Discard discards (the button lights as the drop target); press and hold on a tile opens the lock card after a ring fills, and the lift is not a tap; right-click does the same; a quick tap
// on a tile is a placement and not a lock; the 3D look has no white pill over the island for what the tile in hand can do (the points are text inside the rings); and a whole run plays to its end with the pile empty and
// the result sheet up. With reduced motion nothing glides. It exits with 1 if a check fails.
//
// It needs Chrome (set CHROME to its path if it isn't found) and drives it over the DevTools protocol with Node's built-in WebSocket, which is switched on by --experimental-websocket on Node 20 (Node 22 and newer need no
// flag). No packages.
import fs from "fs"; import path from "path"; import os from "os"; import {spawn, execSync} from "child_process";
const die = msg => { console.error(msg); process.exit(1) }, sleep = ms => new Promise(r => setTimeout(r, ms));
let url = "https://danrossli.github.io/flowgrow/", out = null; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) { if (argv[i] === "--url") url = argv[++i]; else if (argv[i] === "--out") out = argv[++i]; else die(`Unknown option ${argv[i]}`) }
if (typeof WebSocket === "undefined") die("This Node has no built-in WebSocket. Run it as: node --experimental-websocket tools/screen-smoke.mjs ...");
if (!url.endsWith("/")) url += "/"; if (out) fs.mkdirSync(out, {recursive: true});

function chromePath() { const c = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean); return c.find(p => fs.existsSync(p)) || die("Chrome not found. Set CHROME to its path.") }
async function launch(width, height, {reduce = false} = {}) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgrow-chrome-")), port = 9400 + Math.floor(Math.random() * 400);
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
  await send("Page.enable"); await send("Runtime.enable"); await send("Emulation.setDeviceMetricsOverride", {width, height, deviceScaleFactor: 2, mobile: true}); await send("Emulation.setTouchEmulationEnabled", {enabled: true, maxTouchPoints: 5});
  if (reduce) await send("Emulation.setEmulatedMedia", {features: [{name: "prefers-reduced-motion", value: "reduce"}]});
  const touch = (type, x, y) => send("Input.dispatchTouchEvent", {type, touchPoints: type === "touchEnd" ? [] : [{x, y, id: 1}]});
  const api = {errors, stop,
    async goto(u) { const done = new Promise(r => loaded.push(r)); await send("Page.navigate", {url: u}); await done; await sleep(1500) },
    async ev(expression) { const r = await send("Runtime.evaluate", {expression, returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value },
    async shot(f) { fs.writeFileSync(f, Buffer.from((await send("Page.captureScreenshot", {format: "png"})).data, "base64")) },
    touch, async tap(x, y) { await touch("touchStart", x, y); await sleep(50); await touch("touchEnd"); await sleep(450) },
    // a drag from one point to another in steps; end: false leaves the finger down
    async drag(from, to, {steps = 10, dwell = 50, hold = 0, end = true} = {}) { await touch("touchStart", ...from); await sleep(60);
      for (let i = 1; i <= steps; i++) { await touch("touchMove", from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps); await sleep(dwell) }
      if (hold) await sleep(hold); if (end) { await touch("touchEnd"); await sleep(450) } }};
  return api }

let bad = 0; const ok = (what, cond, extra = "") => { if (!cond) bad++; console.log((cond ? "ok    " : "FAIL  ") + what + (extra ? "  (" + extra + ")" : "")) };
const J = async (b, e) => JSON.parse(await b.ev(`JSON.stringify(${e})`));
const ready = async (b, look) => { for (let i = 0; i < 120; i++) { if (await b.ev(`!!(window.Flowgrow && Flowgrow.run && Flowgrow.run() && (${look !== "3d"} || (Flowgrow.look3d && Flowgrow.look3d())))`)) return true; await sleep(250) } return false };
const moves = b => b.ev(`Flowgrow.run().moves.length`);
const rect = (b, s) => J(b, `(() => { const e = document.querySelector(${JSON.stringify(s)}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height, r.left, r.top, r.right, r.bottom] })()`);
// a cell's place on the screen, with the camera first moved so the cell is in the free part of the screen
async function at(b, p) { await b.ev(`Flowgrow.look(${JSON.stringify(p)})`); await sleep(1100); return J(b, `Flowgrow.scr(${JSON.stringify(p)})`) }
const opts = b => J(b, `Flowgrow.options()`);

for (const look of ["simple", "3d"]) { const b = await launch(390, 844); const tag = look === "3d" ? "3D" : "plain"; const shot = async n => { if (out) await b.shot(path.join(out, `screen-${look}-${n}.png`)) };
  try {
    await b.goto(`${url}play/?dev=1&look=${look}&q=low&seed=3&time=day`); ok(`${tag}: the page starts`, await ready(b, look)); await sleep(1800);
    // ---- the screen
    const L = await J(b, `(() => { const r = s => { const e = document.querySelector(s); if (!e) return null; const q = e.getBoundingClientRect(); return {l: q.left, t: q.top, w: q.width, h: q.height, r: q.right, b: q.bottom} };
      const kids = [...document.getElementById("top").children].map(e => e.id || e.className);
      return {top: r("#top"), dock: r("#actions"), score: r("#hScore"), undo: r("#undoBtn"), menu: r("#menuBtn"), disc: r("#discardBtn"), kids, scoreSize: getComputedStyle(document.getElementById("hScore")).fontSize, undoLabel: document.getElementById("undoBtn").getAttribute("aria-label"), menuLabel: document.getElementById("menuBtn").getAttribute("aria-label"), discLabel: document.getElementById("discardBtn").getAttribute("aria-label"),
        undoOff: document.getElementById("undoBtn").disabled, stats: !!document.querySelector(".stats, .stat"), lock: !!document.getElementById("lockBtn") || !!document.querySelector(".fglock"), fit: !!document.getElementById("fitBtn"), pileCard: !!document.querySelector(".fgpile, .fgbtns, .actions"),
        leftTexts: [...document.querySelectorAll("body *")].filter(e => !e.children.length && /\\d+ left|Tiles left/.test(e.textContent)).map(e => e.id || e.className)} })()`);
    ok(`${tag}: the top line is the score, Undo and Menu, and nothing else`, L.kids.join() === "fgscore,fgsp,undoBtn,menuBtn" && !L.stats, L.kids.join());
    ok(`${tag}: the score is big (40 px) and sits at the left, Undo and Menu are 40 px glass buttons at the right`, L.scoreSize === "40px" && L.score.l < 40 && Math.round(L.undo.w) === 40 && Math.round(L.menu.w) === 40 && L.undo.l > 200 && L.menu.r <= 390 && L.menu.l > L.undo.l, `${L.scoreSize}; undo ${Math.round(L.undo.l)}, menu ${Math.round(L.menu.l)}`);
    ok(`${tag}: every icon button has a label, and Undo is dimmed with nothing to undo`, L.undoLabel === "Undo" && L.menuLabel === "Menu" && L.discLabel === "Discard this tile" && L.undoOff, `${L.undoLabel} / ${L.menuLabel} / ${L.discLabel}`);
    ok(`${tag}: no Lock button, no zoom button, no stats card and no pile card over the island`, !L.lock && !L.fit && !L.stats && !L.pileCard);
    ok(`${tag}: the only count of the tiles left is the "N left" chip`, L.leftTexts.join() === "leftT", L.leftTexts.join());
    ok(`${tag}: the pile is about 210 px or less at 390x844, and the top line is slim`, L.dock.h <= 216 && L.top.h <= 64, `pile ${Math.round(L.dock.h)} px, top line ${Math.round(L.top.h)} px`);
    if (look === "3d") { const cs = await J(b, `[[0, 0], [${"Flowgrow.run().cfg.map[0].length - 1"}, 0], [0, ${"Flowgrow.run().cfg.map.length - 1"}], [${"Flowgrow.run().cfg.map[0].length - 1"}, ${"Flowgrow.run().cfg.map.length - 1"}]].map(p => Flowgrow.scr(p))`);
      ok(`${tag}: the whole island sits between the top line and the pile`, cs.every(([x, y]) => x >= 0 && x <= 390 && y >= L.top.b - 6 && y <= L.dock.t + 6), JSON.stringify(cs.map(c => c.map(Math.round)))) }
    await shot("start");
    // ---- tap places a tile (the opening is four river tiles)
    for (let k = 0; k < 4; k++) { const o = await opts(b); if (!o.length) break; const pick = o[Math.floor(o.length / 2)], [x, y] = await at(b, pick.p), m = await moves(b); await b.tap(x, y); ok(`${tag}: a tap on land places the river tile ${k + 1}`, await moves(b) === m + 1, `${pick.does} at ${pick.p}`) }
    ok(`${tag}: Undo is lit once there is a move`, !(await b.ev(`document.getElementById("undoBtn").disabled`)));
    const hand = await J(b, `Flowgrow.run().q[0]`); ok(`${tag}: after the opening the tile in hand is a habitat`, hand.k === "h", JSON.stringify(hand));
    await sleep(500);
    // ---- the rings: a soft dashed ring on every cell the tile can go to, its points inside, no pill
    { const n = (await opts(b)).length; ok(`${tag}: the tile in hand has cells to go to`, n > 0, n + " cells");
      if (look === "3d") { const pills = await J(b, `{rings: [...document.querySelectorAll("#l3labels .l3t.rt")].length, pills: [...document.querySelectorAll("#l3labels .l3t:not(.rt):not(.lockb):not(.fx)")].map(e => e.textContent)}`);
        ok(`${tag}: what the tile can do is points as text in the rings, with no white pill over the island`, pills.rings > 0 && pills.pills.length === 0, JSON.stringify(pills)) }
      await shot("rings") }
    // ---- a drag: it lifts, snaps over a cell it can go to with its points, lights the cell, and lets go to place the tile
    { const o = await opts(b), pick = o.find(x => x.does === "plant") || o[0], [x, y] = await at(b, pick.p), g = await rect(b, "#grab"), m = await moves(b);
      await b.drag([g[0], g[1]], [x, y], {hold: 250, end: false}); await sleep(250);
      const st = await J(b, `({carrying: document.getElementById("app").classList.contains("carrying"), tag: document.getElementById("carryTag").textContent, snap: document.getElementById("carry").classList.contains("snap"), hidden: document.getElementById("carry").hidden, slot: getComputedStyle(document.getElementById("dkSlot")).display, handOp: getComputedStyle(document.querySelector("#queue .fgt.s0")).opacity, shadow: getComputedStyle(document.querySelector("#carry .fgcshadow")).display})`);
      ok(`${tag}: a drag lifts the tile out of the pile (its place shows "in hand" and is empty)`, st.carrying && !st.hidden && st.slot !== "none" && +st.handOp === 0, JSON.stringify(st));
      ok(`${tag}: over a cell it can go to the tile snaps there, with its shadow and a tag with the points ("+1 here")`, st.snap && /^(\+[\d.]+|River|Plant|wider.*) here$/.test(st.tag), st.tag);
      if (look === "3d") ok(`${tag}: the cell it hovers over is lit`, await b.ev(`!!(window.__flowgrow3d && __flowgrow3d.scene.children.find(c => c.renderOrder === 4 && c.visible))`)); await shot("carrying");
      await b.touch("touchEnd"); await sleep(600); ok(`${tag}: letting go over a cell it can go to places the tile`, await moves(b) === m + 1, `moves ${m} to ${await moves(b)}`);
      const after = await J(b, `({carrying: document.getElementById("app").classList.contains("carrying"), hidden: document.getElementById("carry").hidden, msg: document.getElementById("msg").textContent})`); ok(`${tag}: the carry is over and the next tile has glided into the hand`, !after.carrying && after.hidden, JSON.stringify(after));
      ok(`${tag}: the fifth move says once how to lock a tile (there is no Lock button)`, /Tip: press and hold a tile to lock it/.test(after.msg) && await b.ev(`!!localStorage.getItem("flowgrow.dev.tip.lock")`), after.msg) }
    // ---- a drop on a cell that can't take it places nothing, and the tile goes back
    { const far = await at(b, [0, 0]), g = await rect(b, "#grab"), m = await moves(b); await b.drag([g[0], g[1]], far, {steps: 8}); await sleep(500);
      const st = await J(b, `({carrying: document.getElementById("app").classList.contains("carrying"), hidden: document.getElementById("carry").hidden, msg: document.getElementById("msg").textContent})`);
      ok(`${tag}: a drop on a cell that can't take it places nothing and the tile goes back (the cell says why)`, await moves(b) === m && !st.carrying && st.hidden, JSON.stringify(st));
      const g2 = await rect(b, "#grab"); await b.drag([g2[0], g2[1]], [200, 20], {steps: 6}); ok(`${tag}: let go anywhere else (over the top line) it goes back too`, await moves(b) === m) }
    // ---- a tap on the tile in hand does nothing but a hint
    { const g = await rect(b, "#grab"), m = await moves(b); await b.tap(g[0], g[1]); ok(`${tag}: a tap on the tile in hand places nothing (it says how)`, await moves(b) === m && /Drag or tap/.test(await b.ev(`document.getElementById("msg").textContent`))) }
    // ---- a drop on Discard discards
    { const g = await rect(b, "#grab"), d = await rect(b, "#discardBtn"), n = await b.ev(`Flowgrow.run().discarded`); await b.drag([g[0], g[1]], [d[0], d[1]], {steps: 6, hold: 200, end: false}); await sleep(200);
      ok(`${tag}: over Discard the button lights up as the drop target`, await b.ev(`document.getElementById("discardBtn").classList.contains("drop")`));
      await b.touch("touchEnd"); await sleep(500); ok(`${tag}: dropping the tile on Discard discards it`, await b.ev(`Flowgrow.run().discarded`) === n + 1, `${n} to ${await b.ev(`Flowgrow.run().discarded`)}`) }
    { const n = await b.ev(`Flowgrow.run().discarded`); const d = await rect(b, "#discardBtn"); await b.tap(d[0], d[1]); ok(`${tag}: tapping Discard still discards the tile in hand`, await b.ev(`Flowgrow.run().discarded`) === n + 1) }
    // ---- press and hold a tile on the island to lock it
    { const S = await J(b, `({h: Object.keys(Flowgrow.run().h), r: Object.keys(Flowgrow.run().r)})`), k = (S.h[0] || S.r[S.r.length - 1]).split(",").map(Number), [x, y] = await at(b, k), m = await moves(b);
      await b.touch("touchStart", x, y); await sleep(320);
      const ring = await J(b, `({hidden: document.getElementById("holdRing").hidden, cls: document.getElementById("holdRing").className})`); ok(`${tag}: while a tile is held a ring fills under the finger`, !ring.hidden && /\bon\b/.test(ring.cls), JSON.stringify(ring));
      await sleep(450); await b.touch("touchEnd"); await sleep(500);
      const st = await J(b, `({card: !document.getElementById("lockq").hidden, title: document.getElementById("lockT").textContent, mode: Flowgrow.lockMode(), moves: Flowgrow.run().moves.length})`);
      ok(`${tag}: press and hold opens the lock card, and the lift is not a tap`, st.card && st.mode && st.moves === m, JSON.stringify(st)); await shot("lock");
      const t0 = await moves(b); await b.tap(...(await rect(b, "#lockYes")).slice(0, 2)); ok(`${tag}: confirming locks the tile`, await moves(b) === t0 + 1 && Object.keys(await J(b, `Flowgrow.run().lk`)).length === 1);
      ok(`${tag}: the locked tile is not lockable again (it says so)`, await b.ev(`(() => { const S = Flowgrow.run(); const k = Object.keys(S.lk)[0].split(",").map(Number); Flowgrow.lockTile(k); return /locked/.test(document.getElementById("msg").textContent) })()`)) }
    // ---- cancel closes the card and leaves lock mode
    { const S = await J(b, `({h: Object.keys(Flowgrow.run().h).filter(k => !(k in Flowgrow.run().lk)), r: Object.keys(Flowgrow.run().r)})`), k = (S.h[0] || S.r[0]).split(",").map(Number); await b.ev(`Flowgrow.lockTile(${JSON.stringify(k)})`); await sleep(200);
      const open = await b.ev(`!document.getElementById("lockq").hidden`); await b.tap(...(await rect(b, "#lockNo")).slice(0, 2)); ok(`${tag}: Cancel closes the lock card and leaves lock mode`, open && await b.ev(`document.getElementById("lockq").hidden && !Flowgrow.lockMode()`)) }
    // ---- right-click locks too
    { const S = await J(b, `({h: Object.keys(Flowgrow.run().h).filter(k => !(k in Flowgrow.run().lk)), r: Object.keys(Flowgrow.run().r)})`), k = (S.h[0] || S.r[0]).split(",").map(Number), [x, y] = await at(b, k);
      const hit = await b.ev(`(() => { const e = document.elementFromPoint(${x}, ${y}); e.dispatchEvent(new MouseEvent("contextmenu", {clientX: ${x}, clientY: ${y}, bubbles: true, cancelable: true, button: 2})); return e.tagName })()`); await sleep(300);
      ok(`${tag}: right-click on a tile opens the lock card`, hit === "CANVAS" && await b.ev(`!document.getElementById("lockq").hidden && Flowgrow.lockMode()`), "on " + hit); await b.tap(...(await rect(b, "#lockNo")).slice(0, 2)) }
    // ---- dragging the tile in hand while a lock card is open lets the lock go, and places the tile
    { const S = await J(b, `({h: Object.keys(Flowgrow.run().h).filter(k => !(k in Flowgrow.run().lk)), r: Object.keys(Flowgrow.run().r)})`), k = (S.h[0] || S.r[0]).split(",").map(Number); await b.ev(`Flowgrow.lockTile(${JSON.stringify(k)})`); await sleep(200);
      const o = await opts(b), [x, y] = await at(b, o[0].p), g = await rect(b, "#grab"), m = await moves(b), locks = Object.keys(await J(b, `Flowgrow.run().lk`)).length;
      await b.drag([g[0], g[1]], [x, y]); await sleep(300);
      ok(`${tag}: dragging the tile in hand while a lock card is open lets the lock go and places the tile`, await moves(b) === m + 1 && Object.keys(await J(b, `Flowgrow.run().lk`)).length === locks && await b.ev(`document.getElementById("lockq").hidden && !Flowgrow.lockMode()`)) }
    // ---- a quick tap on a tile is a placement, not a lock
    { const m = await moves(b), o = await opts(b); if (o.length) { const [x, y] = await at(b, o[0].p); await b.tap(x, y); ok(`${tag}: a quick tap on land places the tile and locks nothing`, await moves(b) === m + 1 && !(await b.ev(`Flowgrow.lockMode()`))) } }
    // ---- undo
    { const m = await moves(b); await b.tap(...(await rect(b, "#undoBtn")).slice(0, 2)); ok(`${tag}: Undo takes the last move back, and the pile is rebuilt`, await moves(b) === m - 1 && (await rect(b, "#queue .fgt.s0")) !== null) }
    // ---- a whole run to its end
    { for (let i = 0; i < 60 && !(await b.ev(`Flowgrow.run().over`)); i++) { const o = await opts(b), S = await J(b, `({q: Flowgrow.run().q.length, pend: Flowgrow.run().pend.length})`);
        if (S.pend) { await b.ev(`Flowgrow.pick(document.getElementById("pick0").dataset.f)`); continue } if (!S.q) { await b.ev(`document.getElementById("endYes").click()`); continue }
        if (o.length) await b.ev(`Flowgrow.tap(${JSON.stringify(o[o.length - 1].p)})`); else await b.ev(`Flowgrow.discard()`); await sleep(40) }
      await sleep(1200); const e = await J(b, `({over: Flowgrow.run().over, win: !document.getElementById("win").hidden, dock: getComputedStyle(document.getElementById("actions")).opacity, empty: !!document.querySelector(".fgempty"), left: document.getElementById("leftChip").hidden})`);
      ok(`${tag}: a whole run plays to its end: the result sheet is up and the pile has gone`, e.over && e.win && +e.dock === 0, JSON.stringify(e)); await shot("end") }
    ok(`${tag}: no page errors`, b.errors.length === 0, b.errors.join(" | ").slice(0, 300))
  } finally { await b.stop() } }

// the day, golden hour and night: at night the glass is a little darker
{ const b = await launch(390, 844); try { const cols = {};
    for (const t of ["day", "night"]) { await b.goto(`${url}play/?dev=1&look=3d&q=low&seed=3&time=${t}`); await ready(b, "3d"); await sleep(2500); cols[t] = await b.ev(`getComputedStyle(document.getElementById("undoBtn")).backgroundColor + " | " + document.getElementById("app").classList.contains("night")`) }
    ok("at night the glass of the buttons is darker and the screen is marked night", /true$/.test(cols.night) && /false$/.test(cols.day) && cols.day.split(" | ")[0] !== cols.night.split(" | ")[0], JSON.stringify(cols)) } finally { await b.stop() } }

// reduced motion: no glide when the tiles move up, and no bobbing
{ const b = await launch(390, 844, {reduce: true}); try { await b.goto(`${url}play/?dev=1&look=simple&q=low&seed=3`); await ready(b, "simple"); await sleep(1500);
    const r = await J(b, `(() => { const e = document.querySelector("#queue .fgt.s0"); return {bob: getComputedStyle(e.querySelector(".fgin")).animationName, glide: getComputedStyle(e).transitionDuration, stack: getComputedStyle(document.getElementById("stack")).animationName} })()`);
    ok("with reduced motion the pile doesn't bob or glide", r.bob === "none" && r.glide === "0s" && r.stack === "none", JSON.stringify(r)) } finally { await b.stop() } }
console.log(bad ? `${bad} check(s) FAILED` : "all checks passed"); process.exit(bad ? 1 : 0);
