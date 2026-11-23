#!/usr/bin/env node
// Bakes the tile sprites of the pile holder. A developer tool: not part of the game, and nothing here is loaded by a page.
//   the habitats (LOU-312, LOU-313): art/pile/green.webp, prairie.webp, marsh.webp and trees.webp (and, as a measure for their common scale, the level 1 river tile, which is drawn but no longer written: the river has
//   its own set)
//   --set river (LOU-313): art/pile/river-1.webp to river-7.webp, one for each of the river's seven stages, from tools/river-tiles.html, with no number in them (the page draws the level on the sprite)
//
//   node --experimental-websocket tools/bake-pile-sprites.mjs
//   node --experimental-websocket tools/bake-pile-sprites.mjs --out art/pile --frames shots --time prairie=14.2
//   node --experimental-websocket tools/bake-pile-sprites.mjs --numeral 2 --out shots/level2
//
//   --out DIR       where the sprites go (default art/pile, made if it is missing)
//   --set NAME      habitats (the default) or river
//   --size N        the size in pixels of each 3D picture before it is scaled down (default 2048)
//   --frames DIR    also save the five full-size 3D pictures there (river.png ... trees.png), to look at what was baked
//   --time NAME=S   draw that tile at S seconds of animation time instead of its default (repeatable; see TIMES below; the river's are river-1 to river-7)
//   --numeral N     the level number pressed into the ground at the front of every tile (default 1; 0 for none, which gives the plain tiles with all their plants)
//   --query Q       more parameters for the bake page, to try the numeral out: numx and numz (where it lies, tile-local; the default is 0.02 and 0.74), numshadow (the shadow's opacity, 0.6) and
//                   numspread (how far the shadow spreads round the digits, in canvas pixels, 1.5); the spec's shadow is numshadow=0.42&numspread=0. For example --query "numx=0.33&numz=0.6"
//
// It serves this folder from a small web server on a free port, opens tools/pile-tiles.html?bake=1 in headless Chrome (software GL, so it needs no graphics card) and takes one picture of each level 1 tile with the same
// fixed close-up camera (azimuth 0.5, polar 0.9, distance 5.6, field of view 30), on a transparent canvas, with no sea, sky, labels or selection ring. The numeral is a flat plane on the ground (pale cream with an olive
// shadow, the game's own M PLUS Rounded 1c from fonts/), and the ground round it is kept clear: plants, stones, mushrooms and animals are left out of a patch of 0.36 round its centre, a tree that reaches into it is
// slid out, and nothing else in the art changes. The animals move with time, so each tile is drawn at its own moment (TIMES), picked so that its animals are in view, near the front and out of the patch. In the page it then finds the pixels each tile covers, takes ONE scale and ONE margin from the union of the five (so the tiles keep their size
// relative to each other and sit side by side as a set), puts each tile on a 256x256 transparent image with its ground contact point at the same place (the centre of the tile's underside), adds a soft blurred ground
// shadow behind it, scales it down in halving steps (a clean average, no jagged edges) and encodes WebP with alpha, lowering the quality until the file is 40 KB or less. 1 KB here is 1000 bytes.
//
// It prints each file's size and the total, checks the files it wrote (they decode, the corners are transparent and nothing touches the edge), and exits with 1 if a file is over 40 KB, the total is over 250 KB or
// a check fails. It is safe to run again: the same picture comes out every time. It needs Chrome (set CHROME to its path if it isn't found) and drives it over the DevTools protocol with Node's built-in WebSocket,
// which is switched on by --experimental-websocket on Node 20 (Node 22 and newer need no flag). No packages.
import fs from "fs"; import path from "path"; import os from "os"; import http from "http"; import {fileURLToPath} from "url"; import {spawn, execSync} from "child_process";
const die = msg => { console.error(msg); process.exit(1) }, fail = msg => { throw new Error(msg) }, sleep = ms => new Promise(r => setTimeout(r, ms));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETS = {habitats: {page: "pile-tiles.html", names: ["river", "green", "prairie", "marsh", "trees"], write: ["green", "prairie", "marsh", "trees"], totalLimit: 250000},
  river: {page: "river-tiles.html", names: ["river-1", "river-2", "river-3", "river-4", "river-5", "river-6", "river-7"], totalLimit: 280000}};
SETS.river.write = SETS.river.names;
let SET = "habitats"; for (let i = 2; i < process.argv.length - 1; i++) if (process.argv[i] === "--set") SET = process.argv[i + 1];
if (!SETS[SET]) { console.error("--set needs habitats or river"); process.exit(1) }
const NAMES = SETS[SET].names, WRITE = SETS[SET].write;
// the moment (seconds of animation time) each tile is drawn at: the animals are a function of time alone, so this fixes where they are. Each was picked by looking, from times where the animals are in the front half of the
// tile and clear of the tall plants: the ladybug on open soil (green), the rabbit sitting in a gap with a butterfly beside it (prairie), the frog and the dragonfly over the reeds (marsh), the squirrel upright beside its
// sapling (trees), both dragonflies and the butterfly over the grass and the stream (river). To pick again, open tools/pile-tiles.html?bake=1&size=1024 and try __bake.shot(i, t) (i = 0 to 4 in the order of NAMES)
// with __bake.animals(i, t), which says where each animal is at t; the canvas shows the picture.
const TIMES = SET === "river" ? {"river-1": 71.0, "river-2": 71.0, "river-3": 71.0, "river-4": 71.0, "river-5": 71.0, "river-6": 71.0, "river-7": 71.0} : {river: 71.035, green: 76.6, prairie: 87.7, marsh: 193.7, trees: 285.62};   // the river's: to be picked by looking (--frames, then __bake.animals)
const LIMIT_EACH = 40000, LIMIT_TOTAL = SETS[SET].totalLimit;   // bytes (1 KB = 1000 bytes)
const SPRITE = 256, PAD = 10;                     // the image size and the margin kept round the five tiles together, in pixels of the sprite
let outDir = path.join(root, "art", "pile"), framesDir = null, size = 2048, numeral = "1", query = ""; const argv = process.argv.slice(2), times = {...TIMES};
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--set") i++; else if (argv[i] === "--out") outDir = path.resolve(argv[++i]); else if (argv[i] === "--frames") framesDir = path.resolve(argv[++i]); else if (argv[i] === "--size") size = +argv[++i] || die("--size needs a number");
  else if (argv[i] === "--query") query = String(argv[++i] ?? "").replace(/^[?&]+/, "");
  else if (argv[i] === "--numeral") { numeral = String(argv[++i] ?? ""); if (!/^\d{1,3}$/.test(numeral)) die("--numeral needs a number of one to three digits (0 for none)") }
  else if (argv[i] === "--time") { const m = /^(\w+)=([\d.]+)$/.exec(argv[++i] || ""); if (!m || !NAMES.includes(m[1])) die("--time needs NAME=SECONDS, NAME one of " + NAMES.join(", ")); times[m[1]] = +m[2] }
  else die(`Unknown option ${argv[i]}`);
}
if (typeof WebSocket === "undefined") die("This Node has no built-in WebSocket. Run it as: node --experimental-websocket tools/bake-pile-sprites.mjs");

function chromePath() { const c = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean); return c.find(p => fs.existsSync(p)) || die("Chrome not found. Set CHROME to its path.") }
// a small web server for this folder on a free port, so the page and vendor/three.r128.min.js load from the same origin
function serve() { const types = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".webp": "image/webp"};
  const server = http.createServer((req, res) => { try { const p = path.join(root, decodeURIComponent(new URL(req.url, "http://localhost").pathname));
      if (p !== root && !p.startsWith(root + path.sep)) { res.writeHead(403); return res.end() }
      fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end("not found") } res.writeHead(200, {"content-type": types[path.extname(p)] || "application/octet-stream", "cache-control": "no-store"}); res.end(data) }) } catch (_) { res.writeHead(400); res.end() } });
  return new Promise(res => server.listen(0, "127.0.0.1", () => res(server))) }
// headless Chrome on a free debugging port (it picks the port itself and writes it to DevToolsActivePort), driven over the DevTools protocol
async function launch(width, height) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgrow-bake-"));
  const proc = spawn(chromePath(), ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "about:blank"], {stdio: "ignore"});
  const stop = async () => { try { if (process.platform === "win32") execSync(`taskkill /PID ${proc.pid} /T /F`, {stdio: "ignore"}); else proc.kill() } catch (_) {} await sleep(300); try { fs.rmSync(dir, {recursive: true, force: true}) } catch (_) {} };
  let port = 0, target = null; for (let i = 0; i < 200 && !target; i++) { await sleep(150);
    try { port = port || +fs.readFileSync(path.join(dir, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0]; if (port) target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === "page") } catch (_) {} }
  if (!target) { await stop(); die("Chrome didn't start") }
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
  let id = 0; const pending = new Map(), loaded = [], errors = [], requested = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const {res, rej} = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result) }
    else if (d.method === "Page.loadEventFired") loaded.splice(0).forEach(f => f());
    else if (d.method === "Network.requestWillBeSent") requested.push(d.params.request.url);
    else if (d.method === "Runtime.exceptionThrown") errors.push("exception: " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("console.error: " + d.params.args.map(a => a.value ?? a.description).join(" ")) };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, {res, rej}); ws.send(JSON.stringify({id: i, method, params})) });
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("Emulation.setDeviceMetricsOverride", {width, height, deviceScaleFactor: 1, mobile: false});
  return {errors, requested, stop,
    async goto(u) { const done = new Promise(r => loaded.push(r)); await send("Page.navigate", {url: u}); await done },
    async ev(expression) { const r = await send("Runtime.evaluate", {expression, returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value } } }

// This function runs INSIDE the page (it is sent as text), after the page has drawn a tile with window.__bake.shot(). It keeps the five pictures in memory and does the 2D work: bounding boxes, one common scale,
// the ground shadow, the scale-down and the WebP encoding. It uses only browser objects and its argument.
function inPage(opt) {
  const B = window.__bake, S = B.size, OUT = opt.sprite, frames = [], mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c };
  let fit = null;
  window.__sprites = {
    // draw tile i at time t and keep the picture: its ground contact point (the centre of the tile's underside) and the box round its visible pixels (alpha of opt.alphaMin or more)
    grab(i, t) { B.shot(i, t); const base = B.project(i, 0, 0, 0), c = mk(S, S), x = c.getContext("2d", {willReadFrequently: true}); x.drawImage(B.canvas, 0, 0);
      const d = x.getImageData(0, 0, S, S).data; let x0 = S, y0 = S, x1 = -1, y1 = -1;
      for (let y = 0; y < S; y++) for (let xx = 0; xx < S; xx++) if (d[(y * S + xx) * 4 + 3] >= opt.alphaMin) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y }
      frames[i] = {c, base, box: [x0, y0, x1 + 1, y1 + 1]}; return {base, box: frames[i].box} },
    png(i) { return frames[i].c.toDataURL("image/png") },
    // one scale and one placing for all five. Everything is measured in pixels of the 3D picture, from each tile's ground contact point.
    layout() {
      // the footprint: a ring on the ground round the tile (as the camera sees it) gives the shadow's size
      B.aim(0); const ring = [], R = opt.shadowRadius; for (let k = 0; k < 48; k++) { const a = k * Math.PI / 24; ring.push(B.project(0, Math.cos(a) * R, 0, Math.sin(a) * R)) }
      const rx = (Math.max(...ring.map(p => p[0])) - Math.min(...ring.map(p => p[0]))) / 2, ry = (Math.max(...ring.map(p => p[1])) - Math.min(...ring.map(p => p[1]))) / 2;
      const sh = {dy: ry * opt.shadowDrop, rx, ry, blur: rx * opt.shadowBlur}, ext = sh.blur * 1.5;   // the shadow's soft edge is gone (under 2% opaque) 1.5 blur radii out
      let L = -rx, Rr = rx, T = Infinity, Bt = sh.dy + ry + ext;
      frames.forEach(f => { L = Math.min(L, f.box[0] - f.base[0]); Rr = Math.max(Rr, f.box[2] - f.base[0]); T = Math.min(T, f.box[1] - f.base[1]); Bt = Math.max(Bt, f.box[3] - f.base[1]) });
      const half = Math.max(-L, Rr), s = Math.min((OUT / 2 - opt.pad) / half, (OUT - 2 * opt.pad) / (Bt - T)), xb = OUT / 2, yb = OUT / 2 - (T + Bt) / 2 * s;
      fit = {s, xb, yb, sh, union: [L, T, Rr, Bt]}; return {scale: s, base: [xb, yb], union: fit.union, shadow: sh, footprint: [rx, ry]} },
    // tile i on a transparent OUT x OUT canvas: the shadow first (behind), then the tile scaled down
    compose(i) { const f = frames[i], c = mk(OUT, OUT), g = c.getContext("2d"), {s, xb, yb, sh} = fit;
      g.save(); g.filter = "blur(" + (sh.blur * s).toFixed(2) + "px)"; g.fillStyle = "rgba(" + opt.shadowColor + "," + opt.shadowAlpha + ")"; g.beginPath(); g.ellipse(xb, yb + sh.dy * s, sh.rx * s, sh.ry * s, 0, 0, 2 * Math.PI); g.fill(); g.restore();
      let src = f.c; const final = S * s; while (src.width / 2 >= final) { const h = mk(Math.round(src.width / 2), Math.round(src.height / 2)), hx = h.getContext("2d"); hx.imageSmoothingQuality = "low"; hx.drawImage(src, 0, 0, h.width, h.height); src = h }
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; g.drawImage(src, xb - f.base[0] * s, yb - f.base[1] * s, S * s, S * s); return c },
    // WebP with alpha: the best quality that fits maxBytes (it starts at opt.q0 and steps down)
    encode(i, maxBytes) { const c = this.compose(i); let r = null;
      for (let q = opt.q0; q >= opt.qMin - 1e-9; q -= opt.qStep) { const url = c.toDataURL("image/webp", q); if (!url.startsWith("data:image/webp")) throw new Error("this Chrome cannot encode WebP");
        const b64 = url.slice(url.indexOf(",") + 1), bytes = Math.floor(b64.length * 3 / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0); r = {q: +q.toFixed(3), bytes, b64}; if (bytes <= maxBytes) break }
      return r },
    // decode a baked file again and measure it: its size, the alpha in its corners, whether any visible pixel touches the edge, and the box round what shows
    async inspect(b64) { const img = new Image(); img.src = "data:image/webp;base64," + b64; await img.decode(); const w = img.naturalWidth, h = img.naturalHeight, c = mk(w, h), x = c.getContext("2d", {willReadFrequently: true}); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, w, h).data, a = (xx, y) => d[(y * w + xx) * 4 + 3]; let edge = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { const al = a(xx, y); if (al >= opt.alphaMin) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; if (xx === 0 || y === 0 || xx === w - 1 || y === h - 1) edge++ } }
      return {w, h, corners: [a(0, 0), a(w - 1, 0), a(0, h - 1), a(w - 1, h - 1)], edge, box: [x0, y0, x1 + 1, y1 + 1]} }
  };
  return true;
}
const OPT = {sprite: SPRITE, pad: PAD, alphaMin: 10, shadowRadius: 1.0, shadowDrop: .08, shadowBlur: .08, shadowAlpha: .25, shadowColor: "28,40,34", q0: 1, qMin: .4, qStep: .01};

const server = await serve(), b = await launch(1024, 1024); let bad = 0;
const rel = f => { const r = path.relative(root, f); return r.startsWith("..") ? f : r }, ok = (what, cond, extra = "") => { if (!cond) bad++; console.log((cond ? "ok    " : "FAIL  ") + what + (extra ? "  (" + extra + ")" : "")) };
setTimeout(() => { console.error("Timed out"); b.stop().then(() => process.exit(1)) }, 10 * 60 * 1000).unref();
try {
  const origin = "http://127.0.0.1:" + server.address().port; await b.goto(`${origin}/tools/${SETS[SET].page}?bake=1&size=${size}${SET === "river" ? "" : `&numeral=${numeral}`}${query ? "&" + query : ""}`);
  let up = false; for (let i = 0; i < 240 && !up; i++) { up = await b.ev("!!(window.__bake && window.__bake.shot && window.__bake.ready)"); if (!up && await b.ev("!!(window.__bake && window.__bake.fontError)")) break; if (!up) await sleep(250) }
  if (!up) { const fe = await b.ev("window.__bake ? window.__bake.fontError : ''").catch(() => "");
    fail("The bake page did not start" + (fe ? ": " + fe : "") + (b.errors.length ? " (" + b.errors.join(" | ").slice(0, 600) + ")" : "")) }
  await b.ev(`(${inPage.toString()})(${JSON.stringify(OPT)})`);
  const grabbed = [];
  for (let i = 0; i < NAMES.length; i++) { const t0 = Date.now(); grabbed.push(await b.ev(`__sprites.grab(${i}, ${times[NAMES[i]]})`)); console.log(`drew ${NAMES[i].padEnd(8)} at ${times[NAMES[i]]} s  (${Date.now() - t0} ms)  covers ${grabbed[i].box.join(", ")}`) }
  const nm = await b.ev("JSON.stringify({on: window.__bake.numeral !== '' && window.__bake.numeral !== '0', cleared: window.__bake.cleared, gap: window.__bake.ribbonGap, num: window.__bake.num})").then(JSON.parse);
  if (nm.on) { console.log(`numeral ${numeral}: a plane ${nm.num.w} wide at tile x ${nm.num.x}, z ${nm.num.z}, ${nm.num.y} above the ground, yaw ${nm.num.yaw}; the ground is kept clear within ${nm.num.r} of its centre`);
    for (let i = 0; i < NAMES.length; i++) { const c = nm.cleared[i] || {dropped: {}, loose: 0, moved: []}, d = Object.entries(c.dropped).map(([k, v]) => `${v} ${k}`).join(", ");
      console.log(`  ${NAMES[i].padEnd(8)} cleared: ${d || "no props"}${c.loose ? `, ${c.loose} ground pieces (grass blades, pebbles, petals ...)` : ""}${c.moved.length ? `; moved: ${c.moved.map(m => `${m.what} by (${m.dx}, ${m.dz})`).join(", ")}` : ""}`) }
    console.log(`  the river's ribbon comes no nearer than ${nm.gap.toFixed(3)} to the numeral's centre`) }
  if (framesDir) { fs.mkdirSync(framesDir, {recursive: true}); for (let i = 0; i < NAMES.length; i++) fs.writeFileSync(path.join(framesDir, NAMES[i] + ".png"), Buffer.from((await b.ev(`__sprites.png(${i})`)).split(",")[1], "base64")) }
  const lay = await b.ev("__sprites.layout()");
  if (SET === "river") { const spots = []; for (let i = 0; i < NAMES.length; i++) { const q = JSON.parse(await b.ev(`(() => { __bake.aim(${i}); return JSON.stringify(__bake.project(${i}, ${nm.num.x}, ${nm.num.y}, ${nm.num.z})) })()`)); spots.push([lay.base[0] + (q[0] - grabbed[i].base[0]) * lay.scale, lay.base[1] + (q[1] - grabbed[i].base[1]) * lay.scale]) }
    console.log("the level goes (left, top, as a share of the sprite): " + spots.map(s => `${(s[0] / SPRITE * 100).toFixed(1)}% ${(s[1] / SPRITE * 100).toFixed(1)}%`).join(" · ")) }
  console.log(`one scale for all ${NAMES.length}: x${lay.scale.toFixed(4)}  ground contact point at ${lay.base.map(v => v.toFixed(1)).join(", ")}  union (from the contact point, in 3D-picture pixels) ${lay.union.map(Math.round).join(", ")}`);
  if (nm.on) { ok("the river's ribbon stays out of the numeral's patch", nm.gap >= nm.num.r, `${nm.gap.toFixed(3)} from the centre, the patch is ${nm.num.r}`);
    for (let i = 0; i < NAMES.length; i++) { const v = await b.ev(`window.__bake.numeralVisibility(${i}, ${times[NAMES[i]]})`); ok(`${NAMES[i]}: the numeral shows in full (nothing in front of it)`, v.mask > 1000 && v.frac >= .9, `${(v.frac * 100).toFixed(1)}% of its ${v.mask} pixels`) } }
  fs.mkdirSync(outDir, {recursive: true}); const rows = []; let total = 0;
  for (let i = 0; i < NAMES.length; i++) { if (!WRITE.includes(NAMES[i])) continue; const r = await b.ev(`__sprites.encode(${i}, ${LIMIT_EACH})`), file = path.join(outDir, NAMES[i] + ".webp"); fs.writeFileSync(file, Buffer.from(r.b64, "base64"));
    const info = await b.ev(`__sprites.inspect(${JSON.stringify(r.b64)})`); total += r.bytes; rows.push({name: NAMES[i], file, ...r, info}) }
  console.log("");
  for (const r of rows) { console.log(`${rel(r.file).replace(/\\/g, "/").padEnd(24)} ${String(r.bytes).padStart(6)} bytes  ${(r.bytes / 1000).toFixed(1).padStart(5)} KB  quality ${r.q}`);
    ok(`${r.name}: ${r.bytes} bytes, at most ${LIMIT_EACH}`, r.bytes <= LIMIT_EACH);
    ok(`${r.name}: ${r.info.w}x${r.info.h}, the four corners are transparent, nothing touches the edge`, r.info.w === SPRITE && r.info.h === SPRITE && r.info.corners.every(a => a === 0) && r.info.edge === 0, `corners ${r.info.corners.join("/")}, ${r.info.edge} px on the edge, shows ${r.info.box.join(", ")}`) }
  console.log(`total ${total} bytes (${(total / 1000).toFixed(1)} KB)`); ok(`the ${WRITE.length} together are ${total} bytes, at most ${LIMIT_TOTAL}`, total <= LIMIT_TOTAL);
  ok("nothing was loaded from another site", b.requested.every(u => u.startsWith(origin) || u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("about:")), b.requested.filter(u => !u.startsWith(origin) && !u.startsWith("data:") && !u.startsWith("blob:") && !u.startsWith("about:")).join(", "));
  ok("no page errors", b.errors.length === 0, b.errors.join(" | ").slice(0, 400));
} catch (e) { bad++; console.error("FAIL  " + (e && e.message || e)) } finally { await b.stop(); server.close() }
console.log(bad ? `${bad} check(s) FAILED` : "all checks passed"); process.exit(bad ? 1 : 0);
