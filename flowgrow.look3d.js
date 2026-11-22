// Flowgrow 3D look (LOU-311; Dan, Nov 22: "this looks good, can you provide very detailed instructions in linear to make it for flowgrow. some changes, you do not need the rotation. include day/night cycles.
// everything else looks great."). A third look, ?look=3d, next to simple and painted. It draws the game's own state as a small living island, seen from a fixed angle: nothing here rotates the camera.
//
// It is loaded only when the look is asked for (see enter3d in flowgrow.js), after the vendored three.js (vendor/three.r128.min.js). It never changes the game: it reads the state through the bridge flowgrow.js
// hands to mount(), and the only thing it ever does to the game is call tap() with the cell the player touched. Every number is in flowgrow.config.js under look3d.
//
// What is where (built in six steps, one commit each):
//   1. this file: mounting, the renderer, the scene, the controller flowgrow.js talks to, window.__flowgrow3d.
//   2. the fixed camera, the blended ground, the soil sides, the sea, the river, the rings and the labels, and picking by the ground.
//   3. what grows on a tile (flowgrow.look3d.art.js), the animals and the animations when the game changes.
//   4. the day and night cycle (flowgrow.look3d.sky.js).
//   5. quality tiers, level of detail and the numbers (stats).
//   6. the docs and the browser smoke test.
(() => {
"use strict";
const G = window, T = G.THREE;

// ---------- the look's numbers: flowgrow.config.js look3d, with these as the fallback if a value is missing
const DEFAULTS = {quality:"auto", dayNight:"cycle", dayLength:240, startPhase:.2, azimuth:.62, polar:.98, fov:30, nearTilesAcross:4,
  budget:{triangles:250000, drawCalls:150, fps:30}, shadowMap:{low:0, med:1024, high:2048}, pixelRatio:{touch:1.5, other:2}};
const merge = (a, b) => { const o = {...a}; if (b) for (const k in b) o[k] = b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) ? merge(a[k] || {}, b[k]) : b[k]; return o };
const C3 = merge(DEFAULTS, G.FLOWGROW && G.FLOWGROW.look3d);
const QS = new URLSearchParams(location.search);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- quality tiers: ?q=low|med|high, or the config's value ("auto" waits for a frame-time probe, step 5; until then it is med)
const TIERS = ["low", "med", "high"];
const pickQuality = () => { const q = QS.get("q") || C3.quality; return TIERS.includes(q) ? q : "med" };

function mount(B) {
  if (!T) return null;
  const board = B.board, cv3 = document.createElement("canvas"); cv3.id = "cv3d"; cv3.setAttribute("aria-label", "The island, drawn in 3D"); board.insertBefore(cv3, B.cv.nextSibling);
  let renderer; try { renderer = new T.WebGLRenderer({canvas:cv3, antialias:true, alpha:false, powerPreference:"high-performance"}) } catch (_) { cv3.remove(); return null }
  const coarse = !!(matchMedia && matchMedia("(pointer:coarse)").matches);
  let quality = pickQuality(), alive = true, w = 0, h = 0;
  renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = .98;
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(C3.fov, 1, .5, 1000);
  scene.background = new T.Color("#bfe3dc");
  // the opening of the look: nothing is drawn yet but the sky colour. Step 2 puts the island in.

  function resize() { if (!alive) return; w = board.clientWidth; h = board.clientHeight; if (!w || !h) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? C3.pixelRatio.touch : C3.pixelRatio.other)); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix() }
  let frames = 0, fpsT = performance.now(), fps = 0;
  function draw() { if (!alive || !w) return; renderer.render(scene, camera); frames++;
    const n = performance.now(); if (n - fpsT >= 1000) { fps = frames * 1000 / (n - fpsT); frames = 0; fpsT = n } }
  const stats = () => { const i = renderer.info; return {quality, triangles:i.render.triangles, calls:i.render.calls, fps:Math.round(fps * 10) / 10, geometries:i.memory.geometries, textures:i.memory.textures, width:w, height:h} };
  const ctl = {draw, resize, sync() {}, scr: p => [0, 0], look() {}, toggleFit() {},
    unmount() { alive = false; delete G.__flowgrow3d; renderer.dispose(); cv3.remove() }};
  // sample(n): draw a frame and read an n by n grid of pixels back, for the browser smoke test (a drawing buffer can only be read in the task that drew it)
  const sample = (n = 12) => { renderer.render(scene, camera); const gl = renderer.getContext(), px = new Uint8Array(4), out = [], W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { gl.readPixels(Math.floor((i + .5) * W / n), Math.floor((j + .5) * H / n), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.push([px[0], px[1], px[2]]) } return out };
  G.__flowgrow3d = {setTime() {}, getTime: () => 0, setQuality(q) { if (TIERS.includes(q)) quality = q }, stats, sample, renderer, scene, camera};
  resize();
  return ctl;
}

G.Flowgrow3D = {mount};
})();
