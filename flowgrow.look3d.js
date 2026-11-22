// Flowgrow 3D look (LOU-311; Dan, Nov 22: "this looks good, can you provide very detailed instructions in linear to make it for flowgrow. some changes, you do not need the rotation. include day/night cycles.
// everything else looks great."). A third look, ?look=3d, next to simple and painted. It draws the game's own state as a small living island, seen from a fixed angle: nothing here rotates the camera.
//
// It is loaded only when the look is asked for (see enter3d in flowgrow.js), after the vendored three.js (vendor/three.r128.min.js). It never changes the game: it reads the state through the bridge flowgrow.js
// hands to mount(), and the only thing it ever does to the game is call tap() with the cell the player touched. Every number is in flowgrow.config.js under look3d.
//
// What is where (built in six steps, one commit each):
//   1. mounting, the renderer, the controller flowgrow.js talks to, window.__flowgrow3d.
//   2. (this file) the fixed camera, the blended ground, the soil sides, the sea, the river, the rings and the labels, and picking by the ground.
//   3. what grows on a tile (flowgrow.look3d.art.js), the animals and the animations when the game changes.
//   4. the day and night cycle (flowgrow.look3d.sky.js).
//   5. quality tiers, level of detail and the numbers (stats).
//   6. the docs and the browser smoke test.
//
// The look follows the reference prototype's techniques (a demo island of 19 fixed tiles): ground that is one continuous surface blended from the tile centres, terrarium soil layers on the outside edge, a
// world-aligned grass field that carries on across tile borders, a ribbon river and a hex-distance sea. Here every cell is the game's own cell, and a tile's mesh is built once and rebuilt only when that tile
// (or a neighbour, for the ground) changes.
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
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) };

// ---------- quality tiers: ?q=low|med|high, or the config's value ("auto" waits for a frame-time probe, step 5; until then it is med)
const TIERS = ["low", "med", "high"];
const pickQuality = () => { const q = QS.get("q") || C3.quality; return TIERS.includes(q) ? q : "med" };
// What each tier draws (steps 3 and 5 read the rest): n the rows of the sector triangulation of a tile's top, grass the density of the grass field.
const TIER = {low:{n:3, grass:.45}, med:{n:4, grass:.75}, high:{n:5, grass:1}};

// ---------- small tools
const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } };
const lin = hex => new T.Color(hex).convertSRGBToLinear();
const hsh = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v) };
const pick = (arr, r) => arr[(r() * arr.length) | 0];

// ---------- Batch: many small shapes merged into one geometry, each vertex with a colour and a sway weight (the wind moves the top of a plant and not its foot). Templates are non-indexed position arrays
// made once; add() transforms one by a matrix straight into the batch, with a flat normal for each face. Everything is in world coordinates, so a tile's mesh sits at the origin.
const tpl = g => { const n = g.index ? g.toNonIndexed() : g; return n.attributes.position.array };
const GT = {ico0:tpl(new T.IcosahedronGeometry(1, 0)), ico1:tpl(new T.IcosahedronGeometry(1, 1)), dod:tpl(new T.DodecahedronGeometry(1, 0)), cyl:tpl(new T.CylinderGeometry(1, 1, 1, 6).translate(0, .5, 0)),
  cone:tpl(new T.ConeGeometry(1, 1, 7).translate(0, .5, 0)), cone2:tpl(new T.ConeGeometry(1, 1, 5).translate(0, .5, 0)), blade:tpl(new T.ConeGeometry(1, 1, 3).translate(0, .5, 0)),
  trunk:tpl(new T.CylinderGeometry(.6, 1, 1, 8).translate(0, .5, 0)), stem4:tpl(new T.CylinderGeometry(.55, 1, 1, 4).translate(0, .5, 0))};
function Batch(y0) { this.p = []; this.n = []; this.c = []; this.s = []; this.y0 = y0 || 0 }
Batch.prototype.add = function (tp, m, col, amount) {
  const e = m.elements, p = this.p, nn = this.n, cc = this.c, ss = this.s, base = p.length, am = amount == null ? 1 : amount;
  for (let i = 0; i < tp.length; i += 3) { const x = tp[i], y = tp[i + 1], z = tp[i + 2];
    p.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]) }
  for (let i = base; i < p.length; i += 9) { const ax = p[i + 3] - p[i], ay = p[i + 4] - p[i + 1], az = p[i + 5] - p[i + 2], bx = p[i + 6] - p[i], by = p[i + 7] - p[i + 1], bz = p[i + 8] - p[i + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; nn.push(nx, ny, nz, nx, ny, nz, nx, ny, nz) }
  for (let i = base; i < p.length; i += 3) { cc.push(col.r, col.g, col.b); ss.push(am ? am * clamp((p[i + 1] - this.y0) / .55, 0, 1) : 0) } };
// one vertex given outright (the ground's top and the soil walls have their own normals)
Batch.prototype.vert = function (x, y, z, nx, ny, nz, c) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(c[0], c[1], c[2]); this.s.push(0) };
// copy another batch into this one, moved by (ox, oy, oz): a tile's plants are built once around their own origin and copied into each tile that has the same look
Batch.prototype.append = function (o, ox, oy, oz) { const op = o.p, p = this.p, n = this.n, c = this.c, s = this.s;
  for (let i = 0; i < op.length; i += 3) p.push(op[i] + ox, op[i + 1] + oy, op[i + 2] + oz);
  for (let i = 0; i < o.n.length; i++) n.push(o.n[i]); for (let i = 0; i < o.c.length; i++) c.push(o.c[i]); for (let i = 0; i < o.s.length; i++) s.push(o.s[i]) };
Batch.prototype.geometry = function () { const g = new T.BufferGeometry();
  g.setAttribute("position", new T.BufferAttribute(new Float32Array(this.p), 3)); g.setAttribute("normal", new T.BufferAttribute(new Float32Array(this.n), 3));
  g.setAttribute("color", new T.BufferAttribute(new Float32Array(this.c), 3)); g.setAttribute("aSway", new T.BufferAttribute(new Float32Array(this.s), 1)); g.computeBoundingSphere(); return g };
const _M = new T.Matrix4(), _Q = new T.Quaternion(), _V = new T.Vector3(), _S = new T.Vector3(), _E = new T.Euler();
// put a template at x, y, z, scaled sx, sy, sz, turned ry (about up), rx and rz, in a colour; amount is how much the wind moves it (0 for a rock)
function put(b, geo, x, y, z, sx, sy, sz, col, ry, rx, rz, amount) { _E.set(rx || 0, ry || 0, rz || 0, "YXZ"); _Q.setFromEuler(_E); _M.compose(_V.set(x, y, z), _Q, _S.set(sx, sy, sz)); b.add(geo, _M, col, amount) }

// ---------- the world: pointy-top hexes of circumradius 1, x spacing sqrt 3, z spacing 1.5, rows going towards the camera: the game's own odd-r cells
const SQ = Math.sqrt(3);
const cellX = (c, r) => (c + ((r & 1) ? .5 : 0)) * SQ, cellZ = r => r * 1.5;
// the cell a world point is in (cube rounding), as [column, row]
function cellOf(x, z) { const q = SQ / 3 * x - z / 3, r = 2 / 3 * z, y = -q - r; let rx = Math.round(q), ry = Math.round(y), rz = Math.round(r);
  const dx = Math.abs(rx - q), dy = Math.abs(ry - y), dz = Math.abs(rz - r); if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry; return [rx + (rz - (rz & 1)) / 2, rz] }

// ground levels: the top of a land tile is ELAND (strata STRATA_E, then the sod), marsh a little lower, a river bed lower still, rock high; a height of the elevation rule (LOU-310) raises a cell by ESTEP
const ELAND = .62, EMARSH = .52, ERIVER = .38, EROCK = 1.05, ESPRING = .72, ESTEP = .18, STRATA_E = .36, SEA_Y = .07, RIVER_Y = .45;
// top colours (sRGB) by kind: placeholders for the art of step 3. Land the river reaches is only a little greener than bare ground (the one hint of reach outside the tap rings).
const TOPC = {bare:"#a8b068", reach:"#74b44c", g:"#56b434", p:"#b9b84a", m:"#4f9c72", t:"#2f8d48", river:"#b0bc6a", rock:"#8f918c", source:"#8ab360"};
const SOIL = [0, 0, 0]; { const c = new T.Color("#4a3220").convertSRGBToLinear(); SOIL[0] = c.r; SOIL[1] = c.g; SOIL[2] = c.b }
// the soil on the outside edge, from the bottom up (colour, share of the strata): a terrarium cut. "land" is the reference's.
const STRATA = {land:[["#9b958b", .2], ["#c0834e", .27], ["#8c5b37", .28], ["#4d3321", .25]], wet:[["#77735f", .22], ["#7c5f3f", .3], ["#56432d", .28], ["#3a2d1f", .2]], river:[["#c9b27c", .4], ["#b99a67", .35], ["#9a7a4e", .25]]};
// the soft wobble that keeps the island's outline from being a clean hexagon; it is a function of the world position so the tops and walls of neighbouring cells agree
const wob = (X, Z) => [(Math.sin(X * 7.1 + Z * 3.3) + Math.sin(Z * 5.7 - X * 2.1)) * .017, (Math.sin(Z * 6.3 + X * 4.1) + Math.sin(X * 5.3 - Z * 2.7)) * .017];
const hexd = (x, z) => { x = Math.abs(x); z = Math.abs(z); return Math.max(x, x * .5 + z * .8660254) - .8660254 };   // the distance out from a hex's edge (negative inside)

// The level of a ring or label in the game's own colours (the simple look's): gold for combine, teal for a river raise, blue for extend, green for plant, deep green for overgrow.
const RING = {plant:{c:[.3, .8, .42], a:.8, f:.1, w:.06}, extend:{c:[.2, .58, .95], a:.8, f:.2, w:.06}, combine:{c:[.95, .72, .15], a:.95, f:.13, w:.085}, widen:{c:[.14, .72, .62], a:.95, f:.13, w:.08},
  overgrow:{c:[.08, .42, .24], a:.95, f:.12, w:.075}, pick:{c:[.95, .72, .15], a:1, f:.16, w:.1}, lockable:{c:[.98, .92, .7], a:.95, f:.1, w:.07}, copy:{c:[.25, .78, .68], a:.95, f:.1, w:.075}, high:{c:[.55, .6, .62], a:.8, f:.05, w:.05}};

function mount(B) {
  if (!T) return null;
  const board = B.board, cfg = B.cfg, GRID = B.grid, W = B.W, H = B.H, rules = B.rules, unkey = B.unkey, step = B.step;
  const cv3 = document.createElement("canvas"); cv3.id = "cv3d"; cv3.setAttribute("aria-label", "The island, drawn in 3D"); board.insertBefore(cv3, B.cv.nextSibling);
  let renderer; try { renderer = new T.WebGLRenderer({canvas:cv3, antialias:true, alpha:false, powerPreference:"high-performance"}) } catch (_) { cv3.remove(); return null }
  const coarse = !!(matchMedia && matchMedia("(pointer:coarse)").matches);
  let quality = pickQuality(), alive = true, w = 0, h = 0, topH = 0, dtLast = 0, detail = 1;   // detail: how much of the plants and grass is drawn (1 is all of it; step 5 lowers it if a late game would pass the triangle budget)
  const reduced = () => !!B.reduce;
  renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = .98; renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(C3.fov, 1, 1, 1400), uTime = {value:0};

  // ---------- layout: every cell of the game's island, in reading order. A cell's index is row * W + column.
  const cells = [], idx = new Int32Array(W * H).fill(-1);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const k = c + "," + r; idx[r * W + c] = cells.length; cells.push({i:cells.length, k, c, r, x:cellX(c, r), z:cellZ(r), code:cfg.map[r][c], sig:"", mesh:null, d:null}) }
  const cellAt = (c, r) => c >= 0 && r >= 0 && c < W && r < H ? cells[idx[r * W + c]] : null;
  for (const cl of cells) cl.nbc = (GRID.nb[cl.k] || []).map(q => { const p = unkey(q); return cellAt(p[0], p[1]) });
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9; for (const cl of cells) { minX = Math.min(minX, cl.x); maxX = Math.max(maxX, cl.x); minZ = Math.min(minZ, cl.z); maxZ = Math.max(maxZ, cl.z) }
  const midX = (minX + maxX) / 2, midZ = (minZ + maxZ) / 2, halfX = (maxX - minX) / 2 + SQ / 2, halfZ = (maxZ - minZ) / 2 + 1;
  const srcCell = cells.find(cl => cl.code === "T") || cells[0];

  // ---------- what each cell looks like now, from the game's state; a signature finds the cells that changed
  let S = B.state(), reach = new Set(), elev = null;
  function describe(cl) { const k = cl.k, rv = S.r[k], hl = S.h[k] || 0, hb = S.hb[k] || "";
    return {code:cl.code, river:rv ? rv.l : 0, from:rv ? rv.from : null, level:hl, kind:hl ? (hb || "g") : "", up:hl ? (B.upgradeOf(cfg, {k:"h", b:hb || undefined, l:hl, f:S.hf[k]}) || "") : "", locked:k in S.lk, reach:reach.has(k) ? 1 : 0, elev:elev ? elev[k] : 0,
      fall:rv && rv.from != null && elev && elev[rv.from] > elev[k] ? 1 : 0} }   // fall: a river tile that steps down from the one it flows from (the elevation rule)
  const sigOf = d => d.code + "|" + d.river + "|" + d.level + "|" + d.kind + "|" + d.up + "|" + (d.locked ? 1 : 0) + "|" + d.reach + "|" + d.elev + "|" + d.fall;

  // ---------- the ground: one continuous surface. Each cell has a height and a colour; surf(x, z) blends them with Gaussian weights across the nearby cell centres (height variance .2, colour .4), so there
  // is no hard border between tiles. Only a cell and its six neighbours can change a cell's ground, so only those are rebuilt when a tile changes.
  const CH = new Float32Array(cells.length), CR = new Float32Array(cells.length), CG = new Float32Array(cells.length), CB = new Float32Array(cells.length), CGR = new Float32Array(cells.length);   // height, linear colour, greenness
  const ccache = {}, cc = hex => ccache[hex] || (ccache[hex] = lin(hex)), tmpC = new T.Color();
  function groundOf(cl, d) {
    let hgt = ELAND, col = d.reach ? TOPC.reach : TOPC.bare, gr = d.reach ? .55 : .3;
    if (d.code === "B") { hgt = EROCK; col = TOPC.rock; gr = 0 } else if (d.code === "T") { hgt = ESPRING; col = TOPC.source; gr = .3 }
    else if (d.river) { hgt = ERIVER; col = TOPC.river; gr = .2 } else if (d.level) { col = TOPC[d.kind]; gr = d.kind === "m" ? .6 : 1; if (d.kind === "m") hgt = EMARSH }
    if (d.code !== "B") hgt += ESTEP * d.elev;
    tmpC.copy(cc(col)); if (d.level > 1) tmpC.multiplyScalar(1 - .012 * Math.min(d.level, 12));
    if (d.locked) { tmpC.lerp(cc("#8d9a86"), .45); gr *= .8 }   // a locked tile is frozen: greyer and drier
    CH[cl.i] = hgt; CR[cl.i] = tmpC.r; CG[cl.i] = tmpC.g; CB[cl.i] = tmpC.b; CGR[cl.i] = gr }
  const outS = [0, 0, 0, 0];
  function surf(x, z) { const row0 = Math.round(z / 1.5); let sw = 0, sh = 0, cw = 0, cr = 0, cg = 0, cb = 0;
    for (let r = row0 - 2; r <= row0 + 2; r++) { if (r < 0 || r >= H) continue; const c0 = Math.round(x / SQ - ((r & 1) ? .5 : 0));
      for (let c = c0 - 2; c <= c0 + 2; c++) { if (c < 0 || c >= W) continue; const i = r * W + c, dx = x - cellX(c, r), dz = z - r * 1.5, d2 = dx * dx + dz * dz; if (d2 > 3.6) continue;
        const w1 = Math.exp(-d2 / .2); sw += w1; sh += w1 * CH[i]; const w2 = Math.exp(-d2 / .4); cw += w2; cr += w2 * CR[i]; cg += w2 * CG[i]; cb += w2 * CB[i] } }
    if (sw < 1e-9) { outS[0] = ELAND; outS[1] = outS[2] = outS[3] = .2; return outS } outS[0] = sh / sw; outS[1] = cr / cw; outS[2] = cg / cw; outS[3] = cb / cw; return outS }
  const heightAt = (x, z) => surf(x, z)[0];
  function greenAt(x, z) { const row0 = Math.round(z / 1.5); let cw = 0, gg = 0;   // how green the ground is around a point, blended like the colour
    for (let r = row0 - 2; r <= row0 + 2; r++) { if (r < 0 || r >= H) continue; const c0 = Math.round(x / SQ - ((r & 1) ? .5 : 0));
      for (let c = c0 - 2; c <= c0 + 2; c++) { if (c < 0 || c >= W) continue; const i = r * W + c, dx = x - cellX(c, r), dz = z - r * 1.5, d2 = dx * dx + dz * dz; if (d2 > 3.6) continue; const w2 = Math.exp(-d2 / .4); cw += w2; gg += w2 * CGR[i] } }
    return cw > 0 ? gg / cw : 0 }

  // the river's path as segments between tile centres (see buildRiver), so the grass can keep off it
  let riverSegs = [];
  function riverD2(X, Z) { let m = 1e9; for (const s of riverSegs) { const vx = s.bx - s.ax, vz = s.bz - s.az, l2 = vx * vx + vz * vz || 1, t = clamp(((X - s.ax) * vx + (Z - s.az) * vz) / l2, 0, 1), dx = X - (s.ax + vx * t), dz = Z - (s.az + vz * t), d = dx * dx + dz * dz; if (d < m) m = d } return m }

  // ---------- one tile's mesh: the top (sector triangles sampled from the ground, smooth normals), the soil walls on the island's outer edge, and the grass field. Step 3 adds what grows on it.
  const tileMat = new T.MeshStandardMaterial({vertexColors:true, roughness:.92, metalness:0});
  tileMat.onBeforeCompile = sh => { sh.uniforms.uTime = uTime;
    sh.vertexShader = "uniform float uTime;\nattribute float aSway;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n transformed.x += sin(uTime*1.7 + position.x*4. + position.z*3.)*.018*aSway;\n transformed.z += cos(uTime*1.4 + position.z*4. + position.x*2.)*.014*aSway;") };
  const islandGroup = new T.Group(); scene.add(islandGroup);
  const GRN = ["#3f9a3a", "#4fae40", "#68bb45", "#5aa83e"].map(lin), GRD = ["#9bc653", "#b3c968"].map(lin), DRIFT = ["#ffffff", "#ffd84a", "#ff9ec4", "#b98cf0"].map(lin), STEM = lin("#4f9a44");
  const shade = (c, k) => ({r:c.r * k, g:c.g * k, b:c.b * k});
  function buildTile(cl, d) { const q = TIER[quality], N = q.n, b = new Batch(0), cx = cl.x, cz = cl.z;
    // a vertex of the ground at (cx + x, cz + z): the world position (with the wobble), the normal from finite differences of the surface, and the colour
    const memo = new Map(), V = (x, z) => { const mk = Math.round(x * 1000) + "," + Math.round(z * 1000); let v = memo.get(mk); if (v) return v;
      const X = cx + x, Z = cz + z, s = surf(X, Z), hgt = s[0], e = .012, hx = (heightAt(X + e, Z) - heightAt(X - e, Z)) / (2 * e), hz = (heightAt(X, Z + e) - heightAt(X, Z - e)) / (2 * e), nl = Math.hypot(hx, 1, hz);
      const un = 1 + .06 * Math.sin(X * 5.1 + Z * 3.7) * Math.sin(Z * 4.3 - X * 2.9) + .03 * Math.sin(X * 13 + Z * 9), wv = wob(X, Z);   // a little unevenness in the colour
      v = {x:X + wv[0], y:hgt, z:Z + wv[1], nx:-hx / nl, ny:1 / nl, nz:-hz / nl, c:[s[1] * un, s[2] * un, s[3] * un]}; memo.set(mk, v); return v };
    const tri = (a, bb, c2) => { const cr = (bb[0] - a[0]) * (c2[1] - a[1]) - (bb[1] - a[1]) * (c2[0] - a[0]); if (cr > 0) { const t = bb; bb = c2; c2 = t }
      for (const p of [a, bb, c2]) { const v = V(p[0], p[1]); b.vert(v.x, v.y, v.z, v.nx, v.ny, v.nz, v.c) } };
    for (let sec = 0; sec < 6; sec++) { const a0 = Math.PI / 2 + sec * Math.PI / 3, a1 = a0 + Math.PI / 3, c0 = [Math.cos(a0), Math.sin(a0)], c1 = [Math.cos(a1), Math.sin(a1)];
      const P = (i, j) => [(i / N) * c0[0] + (j / N) * c1[0], (i / N) * c0[1] + (j / N) * c1[1]];
      for (let i = 0; i < N; i++) for (let j = 0; j < N - i; j++) { tri(P(i, j), P(i + 1, j), P(i, j + 1)); if (i + j < N - 1) tri(P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)) } }
    // the soil walls, only on an edge with no cell beyond it (the island's outer edge). Edge i runs from corner i to corner i + 1 and faces direction (7 - i) % 6 (0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE). The wall is
    // split at the same points as the top's edge so the two share their vertices.
    const L = STRATA[d.river ? "river" : d.kind === "m" ? "wet" : "land"], E = STRATA_E, rr = rng(cl.i * 7919 + 13);
    const quad = (p0, p1, p2, p3, nx, nz) => { for (const t of [[p0, p1, p2], [p0, p2, p3]]) { const ax = t[1].x - t[0].x, ay = t[1].y - t[0].y, az = t[1].z - t[0].z, bx = t[2].x - t[0].x, by = t[2].y - t[0].y, bz = t[2].z - t[0].z;
        const out = (ay * bz - az * by) * nx + (az * bx - ax * bz) * 0 + (ax * by - ay * bx) * nz > 0, o = out ? t : [t[0], t[2], t[1]]; for (const p of o) b.vert(p.x, p.y, p.z, nx, 0, nz, p.c) } };
    for (let i = 0; i < 6; i++) { const nbp = step([cl.c, cl.r], (7 - i) % 6); if (nbp[0] >= 0 && nbp[1] >= 0 && nbp[0] < W && nbp[1] < H) continue;
      const aa = (60 * i - 90) * Math.PI / 180, bb = (60 * (i + 1) - 90) * Math.PI / 180, am = (aa + bb) / 2, onx = Math.cos(am), onz = Math.sin(am);
      for (let m = 0; m < N; m++) { const t0 = m / N, t1 = (m + 1) / N, A = V(Math.cos(aa) * (1 - t0) + Math.cos(bb) * t0, Math.sin(aa) * (1 - t0) + Math.sin(bb) * t0), Bn = V(Math.cos(aa) * (1 - t1) + Math.cos(bb) * t1, Math.sin(aa) * (1 - t1) + Math.sin(bb) * t1);
        const col = (v, k) => v.c.map(x => x * k), pt = (v, y, c) => ({x:v.x, y, z:v.z, c});
        quad(pt(A, A.y, col(A, .55)), pt(Bn, Bn.y, col(Bn, .55)), pt(Bn, E, SOIL), pt(A, E, SOIL), onx, onz);   // the sod: grass colour into dark soil, down to the strata
        let yTop = E; for (let j = L.length - 1; j >= 0; j--) { const hh = E * L[j][1], lc = cc(L[j][0]), f = .93 + rr() * .14, c3 = [lc.r * f, lc.g * f, lc.b * f];   // then the layers, the top of the strata down to 0
          quad(pt(A, yTop, c3), pt(Bn, yTop, c3), pt(Bn, yTop - hh, c3), pt(A, yTop - hh, c3), onx, onz); yTop -= hh } } }
    // the grass field: a world-aligned jittered grid, so it carries on across tile borders. A grid point belongs to the cell it falls in. It keeps off the river and off rock.
    if (d.code !== "B" && d.kind !== "m") { const sp = .165 / Math.sqrt(q.grass), r = rng(cl.i * 131 + 7), near = d.river || cl.nbc.some(n => n && n.d && (n.d.river || n.d.code === "T")), per = quality === "low" ? 2 : 3;
      const gx0 = Math.floor((cx - 1) / sp), gx1 = Math.ceil((cx + 1) / sp), gz0 = Math.floor((cz - 1) / sp), gz1 = Math.ceil((cz + 1) / sp);
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        const X = (gx + hsh(gx, gz)) * sp, Z = (gz + hsh(gz + 7.3, gx - 3.1)) * sp, lx = X - cx, lz = Z - cz, ax = Math.abs(lx); if (ax > .866 || ax * .5 + .866 * Math.abs(lz) > .866) continue;
        if (hsh(gx + 11.7, gz - 5.3) > greenAt(X, Z) * .92) continue; if (near && riverD2(X, Z) < .36) continue;
        const gh = heightAt(X, Z), nzv = Math.sin(X * 1.3 + Z * .7) * Math.sin(Z * 1.9 - X * .8), dry = hsh(gx * 1.7, gz * 2.3) < .12 && d.kind !== "t";
        const base = dry ? GRD[hsh(gz, gx) < .5 ? 0 : 1] : GRN[Math.min(3, Math.max(0, Math.floor((nzv * .5 + .5) * 4)))], sc = .75 + hsh(gx, gz * 1.3) * .7;
        for (let k = 0; k < per; k++) { const a = hsh(k, gx + gz) * 6.28, hh = (.08 + hsh(gz, k + gx) * .11) * sc, lean = .2 + hsh(k * 3, gz) * .5; put(b, GT.blade, X + Math.cos(a) * .015, gh, Z + Math.sin(a) * .015, .016, hh, .01, shade(base, .9 + r() * .2), a, lean, 0) }
        const dn = Math.sin(X * .9 + 1.3) * Math.sin(Z * 1.1 - .4); if (dn > .35 && hsh(gx + 3.1, gz + 9.7) < .35) { const hh2 = .06 + hsh(gx, gz) * .08;
          put(b, GT.blade, X, gh, Z, .006, hh2, .006, STEM, 0, 0, 0); put(b, GT.ico0, X, gh + hh2, Z, .016, .012, .016, DRIFT[Math.floor((Math.sin(X * .7 + Z * .5) * .5 + .5) * 3.99)], hsh(gx, gz) * 6) } } }
    // what grows on the tile (flowgrow.look3d.art.js): built once for each look of a tile and copied in, so a tile that looks like another one costs only the copy
    const art = G.Flowgrow3D && G.Flowgrow3D.art, pb = art && art.content ? art.content(cl, d, {quality, detail}) : null; cl.info = pb ? pb.info : null;
    return {b, pb} }
  // a tile's mesh: its ground and its plants merged into one. A tile that has just grown keeps its plants as a mesh of their own for a moment (they spring up out of the ground, see popTick) and is merged
  // when the spring is over, so a tile is one draw call except while it is being celebrated.
  const pops = [], POPLEN = .9;
  function dropPop(cl) { const p = cl.pop; if (!p) return; islandGroup.remove(p.mesh); p.mesh.geometry.dispose(); const i = pops.indexOf(p); if (i >= 0) pops.splice(i, 1); cl.pop = null }
  function refreshTile(cl, anim) { if (cl.mesh) { islandGroup.remove(cl.mesh); cl.mesh.geometry.dispose(); cl.mesh = null }
    if (anim || !cl.pop) dropPop(cl);   // a tile that is still springing up keeps its spring when only its ground is rebuilt (because a neighbour changed)
    const t = buildTile(cl, cl.d), gy = CH[cl.i];
    if (anim && t.pb && t.pb.p.length && !reduced()) { const pm = new T.Mesh(t.pb.geometry(), tileMat); pm.position.set(cl.x, gy, cl.z); pm.scale.set(.01, .01, .01); pm.castShadow = true; pm.receiveShadow = true; islandGroup.add(pm);
      const rec = {cl, mesh:pm, t0:uTime.value, gy, drop:anim > 1 ? .4 : 0}; cl.pop = rec; pops.push(rec) }
    else if (t.pb && !cl.pop) t.b.append(t.pb, cl.x, gy, cl.z);
    const m = new T.Mesh(t.b.geometry(), tileMat); m.castShadow = true; m.receiveShadow = true; m.userData.cell = cl; islandGroup.add(m); cl.mesh = m }
  // the spring: the plants grow out of the ground with an elastic overshoot (a plant dropped on bare land also falls in from a little above)
  const elastic = a => a <= 0 ? 0 : a >= 1 ? 1 : Math.pow(2, -10 * a) * Math.sin((a * 10 - .75) * 2.0944) + 1;
  function popTick() { for (let i = pops.length - 1; i >= 0; i--) { const p = pops[i], a = (uTime.value - p.t0) / POPLEN;
      if (a >= 1) { const cl = p.cl; dropPop(cl); refreshTile(cl, 0); continue }
      const e = elastic(a), sy = Math.max(.01, e), sx = Math.max(.01, .55 + .45 * Math.min(1, e) + .18 * Math.max(0, e - 1)); p.mesh.scale.set(sx, sy, sx); p.mesh.position.y = p.gy + p.drop * (1 - sstep(0, .38, a)) } }

  // sparks (one points mesh, one draw call): a few soft lights that fly up from a tile that has grown and fall back. And a ring that spreads over the ground from it.
  const MAXP = 200, pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3), pSz = new Float32Array(MAXP), pAl = new Float32Array(MAXP), sparks = [], pU = {scale:{value:400}};
  const pGeo = new T.BufferGeometry(); for (const [nm, ar, n] of [["position", pPos, 3], ["aCol", pCol, 3], ["aSize", pSz, 1], ["aAlpha", pAl, 1]]) pGeo.setAttribute(nm, new T.BufferAttribute(ar, n).setUsage(T.DynamicDrawUsage));
  const pMesh = new T.Points(pGeo, new T.ShaderMaterial({uniforms:pU, transparent:true, depthWrite:false, blending:T.AdditiveBlending,
    vertexShader:"attribute vec3 aCol;attribute float aSize;attribute float aAlpha;uniform float scale;varying vec3 vC;varying float vA;void main(){vC=aCol;vA=aAlpha;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=aSize*scale/-mv.z;}",
    fragmentShader:"varying vec3 vC;varying float vA;void main(){float r=length(gl_PointCoord-.5)*2.;float a=smoothstep(1.,.2,r)*vA;if(a<.01)discard;gl_FragColor=vec4(vC*a,a);}"}));
  pMesh.frustumCulled = false; pMesh.renderOrder = 6; pGeo.setDrawRange(0, 0); scene.add(pMesh);
  const BURST = {g:["#a6e47f", "#fff4b0"], p:["#f2d45a", "#fff3b0"], m:["#7be0c2", "#c8f6ff"], t:["#5fd08f", "#d8ffc8"], r:["#8fe6ff", "#ffffff"], gold:["#f2c14e", "#fff3c0"], frost:["#ffffff", "#cfe8ff"]};
  function burst(cl, key, n) { const pal = BURST[key] || BURST.g, rr = Math.random; for (let i = 0; i < n && sparks.length < MAXP; i++) { const a = rr() * 6.28, sp = .25 + rr() * .7, c = new T.Color(pal[rr() < .5 ? 0 : 1]);
      sparks.push({x:cl.x + Math.cos(a) * .2, y:CH[cl.i] + .25 + rr() * .2, z:cl.z + Math.sin(a) * .2, vx:Math.cos(a) * sp, vy:1.1 + rr() * 1.5, vz:Math.sin(a) * sp, age:0, life:.7 + rr() * .7, size:.045 + rr() * .06, r:c.r, g:c.g, b:c.b}) } }
  function sparkTick(dt) { let n = 0; for (let i = sparks.length - 1; i >= 0; i--) { const s = sparks[i]; s.age += dt; if (s.age >= s.life) { sparks.splice(i, 1); continue } s.vy -= 3 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt }
    for (const s of sparks) { pPos[n * 3] = s.x; pPos[n * 3 + 1] = s.y; pPos[n * 3 + 2] = s.z; pCol[n * 3] = s.r; pCol[n * 3 + 1] = s.g; pCol[n * 3 + 2] = s.b; pSz[n] = s.size; pAl[n] = 1 - s.age / s.life; n++ }
    if (n || pGeo.drawRange.count) { pGeo.setDrawRange(0, n); for (const k in pGeo.attributes) pGeo.attributes[k].needsUpdate = true } }
  const pulseGeo = new T.RingGeometry(.78, .9, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2), pulses = [];
  for (let i = 0; i < 6; i++) { const m = new T.Mesh(pulseGeo, new T.MeshBasicMaterial({transparent:true, depthWrite:false, side:T.DoubleSide, opacity:0, polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-4})); m.visible = false; m.renderOrder = 5; scene.add(m); pulses.push({m, t0:0, on:false}) }
  function pulse(cl, hex) { const p = pulses.find(q => !q.on) || pulses[0]; p.on = true; p.t0 = uTime.value; p.m.material.color.copy(lin(hex)); p.m.position.set(cl.x, CH[cl.i] + .14, cl.z); p.m.visible = true }
  function pulseTick() { for (const p of pulses) { if (!p.on) continue; const a = (uTime.value - p.t0) / .85; if (a >= 1) { p.on = false; p.m.visible = false; continue } const s = .62 + .75 * a; p.m.scale.set(s, 1, s); p.m.material.opacity = Math.pow(1 - a, 1.4) * .95 } }
  // what a change looks like: a plant, a level or a river tile that grows springs up with sparks and a ring in its own colours; a lock is a pale ring and a few white sparks
  const RINGC = {g:"#48c04f", p:"#d9b83a", m:"#38b59a", t:"#1f8a52", r:"#52d3c6", gold:"#f2c14e", frost:"#cfe8ff"};
  function celebrate(cl, what) { if (reduced()) return; const d = cl.d, k = what === "frost" ? "frost" : d.river ? "r" : d.level >= 8 ? "gold" : d.kind || "g"; burst(cl, k, k === "frost" ? 10 : d.level >= 8 ? 26 : 16); pulse(cl, RINGC[k] || RINGC.g) }

  // ---------- the day's state, read by everything that depends on the time of day (step 4 drives it from the clock: night 0 is full day, 1 is deep night). Until then it is day.
  const dayState = {t:.2, night:0};

  // ---------- the animals. The art module makes each animal's shape (a small merged template), says who lives on what and how each one moves; here every animal on the island is posed by the CPU each frame into
  // ONE dynamic mesh, so any number of them is one draw call. By day each tile's day animal is out and by night its night animal (the swap follows dayState.night). None on the low tier. Cosmetic only.
  const zooMat = new T.MeshStandardMaterial({vertexColors:true, roughness:.82, metalness:0});
  let zoo = [], zooCap = 0, zPos = null, zNor = null, zCol = null, zGeo = null, zMesh = null, zooNight = -1;
  function buildZoo() { const art = G.Flowgrow3D && G.Flowgrow3D.art, list = []; let nv = 0;
    if (art && art.animal && quality !== "low") for (const cl of cells) { const d = cl.d; if (!d) continue; const pr = art.pairFor(d); if (!pr) continue;
      for (let s = 0; s < 2; s++) { let name = pr[s]; const info = cl.info || {}; if ((name === "owl" || name === "woodpecker") && !info.perch) name = s ? "hedgehog" : "squirrel"; if (name === "duck" && !info.pond) name = "frog";
        const tp = art.animal(name, quality === "high" ? 1 : 0); if (!tp) continue; const rr = rng(cl.i * 53 + s * 7 + 3);
        list.push({cl, name, tp, mv:art.MOVE[name] || {r:.3, s:.1}, night:s === 1, ph:rr() * 6.28, dir:rr() < .5 ? -1 : 1, x0:cl.x, z0:cl.z, info}); nv += tp.p.length / 3 } }
    if (nv > zooCap) { zooCap = Math.ceil(nv * 1.2); zPos = new Float32Array(zooCap * 3); zNor = new Float32Array(zooCap * 3); zCol = new Float32Array(zooCap * 3); if (zMesh) { scene.remove(zMesh); zGeo.dispose() }
      zGeo = new T.BufferGeometry(); zGeo.setAttribute("position", new T.BufferAttribute(zPos, 3).setUsage(T.DynamicDrawUsage)); zGeo.setAttribute("normal", new T.BufferAttribute(zNor, 3).setUsage(T.DynamicDrawUsage)); zGeo.setAttribute("color", new T.BufferAttribute(zCol, 3).setUsage(T.DynamicDrawUsage));
      zMesh = new T.Mesh(zGeo, zooMat); zMesh.frustumCulled = false; zMesh.receiveShadow = true; scene.add(zMesh) }
    zoo = list; zooNight = -1; if (zMesh) { zMesh.visible = list.length > 0; if (!list.length) zGeo.setDrawRange(0, 0) } }
  function poseZoo(t) { if (!zMesh || !zoo.length) return; const night = dayState.night, still = reduced(); if (still && night === zooNight) return; zooNight = night; if (still) t = 0;
    let o = 0; for (const a of zoo) { const vis = a.night ? sstep(.3, .7, night) : 1 - sstep(.2, .55, night); if (vis < .02) continue;
      const mv = a.mv, info = a.info, gy = CH[a.cl.i], th0 = a.ph; let px, py, pz, hd, fl = 0;
      if (a.name === "owl" && info.perch) { const pc = info.perch; px = a.x0 + pc.x; pz = a.z0 + pc.z; py = gy + pc.top + .01; hd = th0 + Math.sin(t * .35 + th0) * 1.1 }
      else if (a.name === "woodpecker" && info.perch) { const pc = info.perch, ca = Math.cos(th0), sa = Math.sin(th0), rr = pc.tr + .02; px = a.x0 + pc.x + ca * rr; pz = a.z0 + pc.z + sa * rr; py = gy + pc.mid + Math.sin(t * 5 + th0) * .004; hd = Math.atan2(-ca, -sa) }
      else if (a.name === "duck" && info.pond) { const pd = info.pond, ra = Math.min(pd.rx, pd.rz) * .55, th = th0 + t * .13 * a.dir, x = Math.cos(th) * ra, z = Math.sin(th) * ra * .8; px = a.x0 + pd.x + x; pz = a.z0 + pd.z + z; py = gy + pd.y + .004 + Math.sin(t * 1.6 + th0) * .004; hd = Math.atan2(-Math.sin(th) * a.dir, Math.cos(th) * .8 * a.dir) }
      else if (a.name === "frog" && info.pond) { const pd = info.pond, ra = Math.max(pd.rx, pd.rz) * 1.12, th = th0 + Math.sin(t * .17 + th0) * .5, cyc = (t * .7 + th0) % 4.5, jump = cyc < .5 ? Math.sin(cyc / .5 * Math.PI) * .07 : 0; px = a.x0 + pd.x + Math.cos(th) * ra; pz = a.z0 + pd.z + Math.sin(th) * ra; py = gy + .006 + jump; hd = Math.atan2(-Math.cos(th), -Math.sin(th)) }
      else { const r = mv.r, om = mv.s / Math.max(r, .15) * a.dir, th = th0 + t * om + (mv.hop ? Math.sin(t * mv.hf * .2 + th0) * .5 : 0), x = Math.cos(th) * r, z = Math.sin(th) * r * .85 + Math.sin(th * 2.3 + th0) * .05 * r;
        px = a.x0 + x; pz = a.z0 + z; const th2 = th + .04 * a.dir, dx = Math.cos(th2) * r - x, dz = Math.sin(th2) * r * .85 + Math.sin(th2 * 2.3 + th0) * .05 * r - z; hd = Math.atan2(dx, dz); py = gy;
        if (mv.fly) { py += mv.fly + Math.sin(t * 1.3 + th0) * .05; fl = Math.sin(t * mv.ff + th0) * 1.1 } else if (mv.hop) py += Math.abs(Math.sin(t * mv.hf + th0)) * mv.hop }
      const tp = a.tp, sc = tp.scale * vis, c = Math.cos(hd), s = Math.sin(hd), pa = tp.p, na = tp.n, wg = tp.wing, nv = pa.length / 3;
      zCol.set(tp.c, o * 3);
      for (let i = 0, j = o * 3; i < nv; i++, j += 3) { const x = pa[i * 3], z = pa[i * 3 + 2]; let y = pa[i * 3 + 1]; if (wg && wg[i]) y += Math.abs(x) * fl;
        zPos[j] = (x * c + z * s) * sc + px; zPos[j + 1] = y * sc + py; zPos[j + 2] = (-x * s + z * c) * sc + pz;
        const nx = na[i * 3], nz = na[i * 3 + 2]; zNor[j] = nx * c + nz * s; zNor[j + 1] = na[i * 3 + 1]; zNor[j + 2] = -nx * s + nz * c }
      o += nv }
    zGeo.setDrawRange(0, o); const at = zGeo.attributes; at.position.needsUpdate = at.normal.needsUpdate = at.color.needsUpdate = true; zooVerts = o }
  let zooVerts = 0;

  // ---------- the sea: a plane with a hex distance field of the island's outline in a texture (the island never moves), foam along the edge, deeper colour further out. The sky behind it.
  const sdfM = 7, sdfX0 = minX - SQ / 2 - sdfM, sdfZ0 = minZ - 1 - sdfM, sdfW = maxX - minX + SQ + 2 * sdfM, sdfH = maxZ - minZ + 2 + 2 * sdfM, sdfR = 5, sdfNx = Math.ceil(sdfW * sdfR), sdfNz = Math.ceil(sdfH * sdfR), sdfMax = 7;
  const sdfData = new Uint8Array(sdfNx * sdfNz * 4);
  for (let j = 0; j < sdfNz; j++) for (let i = 0; i < sdfNx; i++) { const X = sdfX0 + (i + .5) / sdfR, Z = sdfZ0 + (j + .5) / sdfR; let dm = 1e3;
    const rw = Math.round(Z / 1.5); for (let r = Math.max(0, rw - 5); r <= Math.min(H - 1, rw + 5); r++) { const cw = Math.round(X / SQ - ((r & 1) ? .5 : 0)); for (let c = Math.max(0, cw - 6); c <= Math.min(W - 1, cw + 6); c++) dm = Math.min(dm, hexd(X - cellX(c, r), Z - r * 1.5)) }
    if (dm > 900) dm = sdfMax; const o = (j * sdfNx + i) * 4; sdfData[o] = Math.round(clamp(dm / sdfMax, 0, 1) * 255); sdfData[o + 3] = 255 }
  const sdfTex = new T.DataTexture(sdfData, sdfNx, sdfNz, T.RGBAFormat, T.UnsignedByteType); sdfTex.minFilter = sdfTex.magFilter = T.LinearFilter; sdfTex.generateMipmaps = false; sdfTex.needsUpdate = true;
  const DAY = {top:"#8ec9e8", hor:"#eaf6ee", shallow:"#7fe0bd", deep:"#2b9a8e", foam:"#f4fffb", sunC:"#fff0cf"};   // the day's palette; step 4 drives these from the clock
  const seaU = {t:uTime, sdf:{value:sdfTex}, org:{value:new T.Vector2(sdfX0, sdfZ0)}, siz:{value:new T.Vector2(sdfW, sdfH)}, dmax:{value:sdfMax}, mid:{value:new T.Vector2(midX, midZ)}, shallow:{value:new T.Color(DAY.shallow)}, deep:{value:new T.Color(DAY.deep)},
    horizon:{value:new T.Color(DAY.hor)}, foamC:{value:new T.Color(DAY.foam)}};
  const sea = new T.Mesh(new T.PlaneGeometry(1200, 1200, 1, 1), new T.ShaderMaterial({uniforms:seaU,
    vertexShader:"varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}",
    fragmentShader:"uniform float t;uniform sampler2D sdf;uniform vec2 org;uniform vec2 siz;uniform float dmax;uniform vec2 mid;uniform vec3 shallow;uniform vec3 deep;uniform vec3 horizon;uniform vec3 foamC;varying vec3 vW;" +
      "void main(){vec2 uv=(vW.xz-org)/siz;float d=texture2D(sdf,uv).r*dmax;if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.)d=dmax;" +
      "float wob=sin(vW.x*2.3+t*.9)*.06+sin(vW.z*3.1-t*1.1)*.05;float dd=d+wob;vec3 col=mix(shallow,deep,smoothstep(.05,2.8,dd));" +
      "float ring=(1.-smoothstep(0.,.32,dd))*(.55+.45*sin(dd*26.-t*1.6));col=mix(col,foamC,clamp(ring,0.,1.)*.8);" +
      "float sp=sin(vW.x*9.+t*1.3)*sin(vW.z*9.-t*1.7);col+=smoothstep(.88,1.,sp)*.1*(1.-smoothstep(0.,6.,d));col+=.012*sin(vW.x*.7+vW.z*.5+t*.4)+.008*sin(vW.x*.31-vW.z*.43+t*.3);" +
      "col=mix(col,horizon,smoothstep(40.,190.,length(vW.xz-mid)));gl_FragColor=vec4(col,1.);}"}));
  sea.rotation.x = -Math.PI / 2; sea.position.set(midX, SEA_Y, midZ); scene.add(sea);
  const skyU = {top:{value:new T.Color(DAY.top)}, hor:{value:new T.Color(DAY.hor)}, sunDir:{value:new T.Vector3(-9, 13, 6).normalize()}, sunC:{value:new T.Color(DAY.sunC)}};
  const sky = new T.Mesh(new T.SphereGeometry(900, 32, 16), new T.ShaderMaterial({uniforms:skyU, side:T.BackSide, depthWrite:false,
    vertexShader:"varying vec3 vD;void main(){vD=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader:"uniform vec3 top;uniform vec3 hor;uniform vec3 sunDir;uniform vec3 sunC;varying vec3 vD;void main(){vec3 d=normalize(vD);float h=clamp(d.y,0.,1.);vec3 col=mix(hor,top,pow(h,.5));" +
      "float s=max(dot(d,normalize(sunDir)),0.);col+=sunC*(pow(s,56.)*.6+pow(s,7.)*.14);gl_FragColor=vec4(col,1.);}"}));
  sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky);
  // clouds: a few puffs merged into one mesh each, drifting slowly (two layers at two speeds)
  const cloudMat = new T.MeshStandardMaterial({color:0xffffff, roughness:1, flatShading:true, emissive:0x8fa7b0, emissiveIntensity:.35}), clouds = [];
  { const cr = rng(5); for (let layer = 0; layer < 2; layer++) { const cb = new Batch(0);
      for (let ci = 0; ci < 5; ci++) { const n = 3 + ((cr() * 3) | 0), a = cr() * 6.28, rd = 40 + cr() * 60, px = midX + Math.cos(a) * rd, pz = midZ + Math.sin(a) * rd * .6, py = 30 + cr() * 14;
        for (let k = 0; k < n; k++) { const s = 1.5 + cr() * 1.5; put(cb, GT.ico1, px + k * 2.2 - n * 1.1, py + cr() * .8, pz + (cr() - .5) * 2, s * 1.5, s * .8, s, {r:1, g:1, b:1}, cr() * 6, 0, 0, 0) } }
      const m = new T.Mesh(cb.geometry(), cloudMat); m.frustumCulled = false; m.userData.sp = .5 + layer * .35; scene.add(m); clouds.push(m) } }
  // lights: one directional light following the sun (a shadow map on med and high), one hemisphere light
  const sun = new T.DirectionalLight(0xfff1d6, 1.5), hemi = new T.HemisphereLight(0xcfe8ff, 0x7f9a55, .72);
  sun.position.set(midX - 9 * 1.6, 13 * 1.6, midZ + 6 * 1.6); sun.target.position.set(midX, 0, midZ); scene.add(sun); scene.add(sun.target); scene.add(hemi);
  const sc2 = sun.shadow.camera; sc2.left = -halfX - 3; sc2.right = halfX + 3; sc2.top = halfZ + 4; sc2.bottom = -halfZ - 4; sc2.near = 1; sc2.far = 90; sun.shadow.bias = -.0004; sun.shadow.normalBias = .03;
  function applyQuality() { const s = C3.shadowMap[quality] || 0; renderer.shadowMap.enabled = s > 0; sun.castShadow = s > 0; if (s > 0) { sun.shadow.mapSize.set(s, s); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null } } tileMat.needsUpdate = true }
  applyQuality();

  // ---------- the river: a ribbon along the tile centres in flow order (each tile joins the one it flows from), turned smooth with Catmull-Rom. Its width follows the river's level (1 to 15: width and
  // foam only, never a different shape); where a tile steps down from the one it flows from (the elevation rule) the ribbon drops steeply and the shader whitens it: a waterfall.
  const riverMat = new T.ShaderMaterial({transparent:true, depthWrite:false, side:T.DoubleSide, uniforms:{t:uTime, cA:{value:new T.Color("#52d3c6")}, cB:{value:new T.Color("#2a97a3")}},
    vertexShader:"attribute float lvl;attribute float fall;attribute float fade;varying vec2 vUv;varying float vL;varying float vFall;varying float vFade;void main(){vUv=uv;vL=lvl;vFall=fall;vFade=fade;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader:"uniform float t;uniform vec3 cA;uniform vec3 cB;varying vec2 vUv;varying float vL;varying float vFall;varying float vFade;" +
      "void main(){float e=abs(vUv.x-.5)*2.;float deep=clamp((vL-1.)/6.,0.,1.);vec3 a=mix(cA,vec3(.16,.62,.66),deep*.7);vec3 bb=mix(cB,vec3(.1,.46,.58),deep*.7);vec3 col=mix(a,bb,smoothstep(0.,1.,e));" +
      "float calm=1.-deep*.5;float s=sin(vUv.y*7.-t*2.4*calm+sin(vUv.x*9.+t*.8)*1.4)*.5+.5;col+=smoothstep(.78,1.,s)*.16*calm;float s2=sin(vUv.y*17.-t*3.6*calm+vUv.x*5.)*.5+.5;col+=smoothstep(.9,1.,s2)*.09*calm;" +
      "float f=smoothstep(.80-deep*.08,.97,e+.035*sin(vUv.y*34.+t*2.5));col=mix(col,vec3(.94,1.,.98),f*(.85+deep*.1));" +
      "float fl=vFall*(.55+.45*sin(vUv.y*46.-t*9.+vUv.x*7.));col=mix(col,vec3(.97,1.,1.),clamp(fl,0.,1.)*.85);gl_FragColor=vec4(col,.96*vFade);}"});
  const riverMesh = new T.Mesh(new T.BufferGeometry(), riverMat); riverMesh.renderOrder = 2; riverMesh.frustumCulled = false; riverMesh.visible = false; scene.add(riverMesh);
  const rwid = l => clamp(.9 + .25 * Math.min(l - 1, 1) + .02 * Math.max(0, l - 2), .9, 1.4), riverY = cl => RIVER_Y + ESTEP * (cl.d ? cl.d.elev : 0);
  function buildRiver() { const keys = Object.keys(S.r), kids = {}, segs = [];
    for (const k of keys) { const f = S.r[k].from; if (f != null) (kids[f] = kids[f] || []).push(k) }
    const pos = [], uv = [], lv = [], fl = [], fd = [], ind = [], dist = {}, ctr = k => { const c = cells[idx[unkey(k)[1] * W + unkey(k)[0]]]; return [c.x, c.z, c] };
    const order = keys.filter(k => S.r[k].from == null); const stack = [...order]; while (stack.length) { const k = stack.shift(); if (!(k in dist)) dist[k] = 0; for (const c of kids[k] || []) { const a = ctr(k), b = ctr(c); dist[c] = dist[k] + Math.hypot(b[0] - a[0], b[1] - a[1]); stack.push(c) } }
    for (const k of keys) { const f = S.r[k].from; if (f == null) continue;
      const A = ctr(f), Bc = ctr(k), gp = S.r[f].from, P0 = gp != null ? ctr(gp) : [2 * A[0] - Bc[0], 2 * A[1] - Bc[1]], ch = kids[k] || [], P3 = ch.length === 1 ? ctr(ch[0]) : [2 * Bc[0] - A[0], 2 * Bc[1] - A[1]];
      segs.push({ax:A[0], az:A[1], bx:Bc[0], bz:Bc[1]});
      const m = 8, base = pos.length / 3, yA = riverY(A[2]), yB = riverY(Bc[2]), lA = S.r[f].l, lB = S.r[k].l, isEnd = ch.length === 0, isStart = gp == null;
      const cr = (p0, p1, p2, p3, t) => .5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
      let prev = null, run = dist[f];
      for (let i = 0; i <= m; i++) { const t = i / m, x = cr(P0[0], A[0], Bc[0], P3[0], t), z = cr(P0[1], A[1], Bc[1], P3[1], t), t2 = Math.min(1, t + .02), x2 = cr(P0[0], A[0], Bc[0], P3[0], t2), z2 = cr(P0[1], A[1], Bc[1], P3[1], t2), t1 = Math.max(0, t - .02), x1 = cr(P0[0], A[0], Bc[0], P3[0], t1), z1 = cr(P0[1], A[1], Bc[1], P3[1], t1);
        let tx = x2 - x1, tz = z2 - z1; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl; const nx = -tz, nz = tx;
        let wd = (rwid(lA) * (1 - t) + rwid(lB) * t) / 2; if (isEnd) wd *= 1 - .3 * sstep(.6, 1, t);
        const y = yA + (yB - yA) * sstep(.4, .6, t), fall = yA - yB > .01 ? Math.max(0, sstep(.34, .46, t) * (1 - sstep(.54, .66, t))) : 0, fade = isStart ? sstep(0, .35, t) : 1;
        if (prev) run += Math.hypot(x - prev[0], z - prev[1]); prev = [x, z];
        pos.push(x + nx * wd, y, z + nz * wd, x - nx * wd, y, z - nz * wd); uv.push(0, run, 1, run); const lvv = lA + (lB - lA) * t; lv.push(lvv, lvv); fl.push(fall, fall); fd.push(fade, fade);
        if (i < m) { const a = base + i * 2; ind.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) } } }
    riverSegs = segs; riverMesh.visible = pos.length > 0; const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2)); g.setAttribute("lvl", new T.Float32BufferAttribute(lv, 1)); g.setAttribute("fall", new T.Float32BufferAttribute(fl, 1)); g.setAttribute("fade", new T.Float32BufferAttribute(fd, 1)); g.setIndex(ind);
    riverMesh.geometry.dispose(); riverMesh.geometry = g }

  // ---------- rings (ground decals): the same rings the other looks draw, as thin hex outlines hugging the ground (gold combine, teal river raise, dashed-blue extend, green plant), and a faint fill. One
  // dynamic mesh with a vertex colour and alpha for each, rebuilt when the game changes. Their tags are labels (below).
  const ringMat = new T.MeshBasicMaterial({vertexColors:true, transparent:true, depthWrite:false, side:T.DoubleSide, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2}), ringMesh = new T.Mesh(new T.BufferGeometry(), ringMat); ringMesh.renderOrder = 3; ringMesh.frustumCulled = false; scene.add(ringMesh);
  const hoverMat = new T.MeshBasicMaterial({vertexColors:true, transparent:true, depthWrite:false, side:T.DoubleSide, polygonOffset:true, polygonOffsetFactor:-3, polygonOffsetUnits:-3}), hoverMesh = new T.Mesh(new T.BufferGeometry(), hoverMat); hoverMesh.renderOrder = 4; hoverMesh.frustumCulled = false; hoverMesh.visible = false; scene.add(hoverMesh);
  function ringGeom(list) { const pos = [], col = [], ind = []; const add = (x, z, r0, r1, c, a, f) => { const p = [], base = pos.length / 3, hexPts = rr => { const o = []; for (let i = 0; i < 6; i++) { const a0 = (60 * i - 90) * Math.PI / 180, a1 = (60 * (i + 1) - 90) * Math.PI / 180; for (let s = 0; s < 2; s++) { const t = s / 2; o.push([x + rr * (Math.cos(a0) * (1 - t) + Math.cos(a1) * t), z + rr * (Math.sin(a0) * (1 - t) + Math.sin(a1) * t)]) } } return o };
      const outer = hexPts(r1), inner = hexPts(r0), n = outer.length; void p;
      for (let i = 0; i < n; i++) { pos.push(outer[i][0], heightAt(outer[i][0], outer[i][1]) + .05, outer[i][1]); col.push(c[0], c[1], c[2], a) }
      for (let i = 0; i < n; i++) { pos.push(inner[i][0], heightAt(inner[i][0], inner[i][1]) + .05, inner[i][1]); col.push(c[0], c[1], c[2], a) }
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; ind.push(base + i, base + j, base + n + i, base + j, base + n + j, base + n + i) }
      if (f > 0) { const cb = pos.length / 3; pos.push(x, heightAt(x, z) + .045, z); col.push(c[0], c[1], c[2], f); for (let i = 0; i < n; i++) { pos.push(inner[i][0], heightAt(inner[i][0], inner[i][1]) + .045, inner[i][1]); col.push(c[0], c[1], c[2], f) } for (let i = 0; i < n; i++) ind.push(cb, cb + 1 + i, cb + 1 + (i + 1) % n) } };
    for (const L of list) { const R = RING[L.kind]; add(L.x, L.z, .9 - R.w * 1.3, .9, R.c, R.a, R.f) }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new T.Float32BufferAttribute(col, 4)); g.setIndex(ind); return g }
  let ringList = [];
  function buildRings() { const list = [], tags = [], opts = B.options(), lk = B.lock(), pend = S.pend[0];
    if (!S.over && !lk.mode) for (const o of opts) { const c = cellAt(o.p[0], o.p[1]); if (!c) continue; list.push({x:c.x, z:c.z, kind:o.does});
      if (o.does === "combine") tags.push({id:"o" + c.k, cell:c, text:"+" + o.pts, cls:"gold", dy:.5}); else if (o.does === "overgrow") tags.push({id:"o" + c.k, cell:c, text:"over +" + o.pts, cls:"green", dy:.5});
      else if (o.does === "widen") tags.push({id:"o" + c.k, cell:c, text:B.widenText(o), cls:"teal", dy:.4});
      else if (o.does === "plant" && (o.l < S.q[0].l || o.mult > 1)) tags.push({id:"o" + c.k, cell:c, text:(o.l < S.q[0].l ? "as " + o.l : "") + (o.mult > 1 ? (o.l < S.q[0].l ? " " : "") + "×" + o.mult : ""), cls:o.mult > 1 ? "teal" : "gold", dy:.3}) }
    if (pend) { const c = cells[idx[unkey(pend)[1] * W + unkey(pend)[0]]]; list.push({x:c.x, z:c.z, kind:"pick"}) }
    if (lk.mode) { if (!lk.sel) { for (const L of lk.list) { const c = cellAt(L.p[0], L.p[1]); list.push({x:c.x, z:c.z, kind:"lockable"}); tags.push({id:"l" + c.k, cell:c, text:L.n + (L.n === 1 ? " copy" : " copies"), cls:"gold", dy:.5}) } }
      else { const got = rules.copiesOf(S, lk.sel), c0 = cellAt(lk.sel[0], lk.sel[1]); list.push({x:c0.x, z:c0.z, kind:"lockable"}); tags.push({id:"l" + c0.k, cell:c0, text:"lock", cls:"gold", dy:.5});
        for (const k of got.from) { const p = unkey(k), c = cellAt(p[0], p[1]); list.push({x:c.x, z:c.z, kind:"copy"}); tags.push({id:"l" + c.k, cell:c, text:"copy " + (k in S.h ? S.h[k] : "river"), cls:"teal", dy:.5}) }
        for (const k of got.high) { const p = unkey(k), c = cellAt(p[0], p[1]); list.push({x:c.x, z:c.z, kind:"high"}); tags.push({id:"l" + c.k, cell:c, text:"too high", cls:"grey", dy:.5}) } } }
    ringList = list; ringMesh.geometry.dispose(); ringMesh.geometry = ringGeom(list); ringTags = tags }
  let ringTags = [];

  // ---------- labels: the white level pill on every tile and the tags of the rings, as DOM elements placed over the board from each tile's top (projected every frame the view moves). Pooled by id.
  const lab = document.createElement("div"); lab.id = "l3labels"; board.insertBefore(lab, B.top);
  if (!document.getElementById("l3css")) { const st = document.createElement("style"); st.id = "l3css";
    st.textContent = "#l3labels{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:1}.l3t{position:absolute;left:0;top:0;min-width:22px;height:22px;padding:0 7px;border-radius:11px;background:#fff;color:#24434a;font:800 13px/22px 'M PLUS Rounded 1c',Nunito,sans-serif;text-align:center;white-space:nowrap;box-shadow:0 2px 6px rgba(10,40,50,.28),0 0 0 1.5px rgba(10,40,50,.12);will-change:transform;font-variant-numeric:tabular-nums}" +
      ".l3t.p{color:#7a5a10}.l3t.m{color:#0d6a66}.l3t.t{color:#0f4f31}.l3t.r{color:#1f5f8f}.l3t.gold{color:#7a5a10}.l3t.teal{color:#0f7a66}.l3t.green{color:#0f5a33}.l3t.grey{color:#6b7b7e}.l3t.fx{background:rgba(255,243,184,.96);color:#5a3d06;font-size:15px}" +
      ".l3t svg{width:10px;height:11px;margin-right:3px;vertical-align:-1px}"; document.head.appendChild(st) }
  const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.500" width="14" height="10" rx="2.200" fill="currentColor"/><path d="M8 10.500V8a4 4 0 018 0v2.500" fill="none" stroke="currentColor" stroke-width="2.800"/></svg>';
  const pool = new Map(); let labFrame = 0; const pv = new T.Vector3();
  function label(id, text, cls, html) { let e = pool.get(id); if (!e) { e = {el:document.createElement("div"), x:-1, y:-1, seen:0, text:"", cls:""}; e.el.className = "l3t"; lab.appendChild(e.el); pool.set(id, e) }
    if (e.text !== text || e.cls !== cls || e.html !== html) { e.el.className = "l3t " + cls; if (html) e.el.innerHTML = html + text; else e.el.textContent = text; e.text = text; e.cls = cls; e.html = html }
    e.seen = labFrame; return e }
  function placeLabel(e, x, y, z, o) { pv.set(x, y, z).project(camera); if (pv.z > 1 || pv.z < -1) { e.el.style.display = "none"; return } const px = (pv.x * .5 + .5) * w, py = (-pv.y * .5 + .5) * h; if (e.el.style.display === "none") e.el.style.display = "";
    const tx = px.toFixed(1), ty = py.toFixed(1); if (e.x !== tx || e.y !== ty || (o != null && e.o !== o)) { e.x = tx; e.y = ty; e.o = o; e.el.style.transform = "translate3d(" + (px - e.el.offsetWidth / 2).toFixed(1) + "px," + (py - 11).toFixed(1) + "px,0)"; if (o != null) e.el.style.opacity = o } }
  const pillY = d => { const art = G.Flowgrow3D && G.Flowgrow3D.art; return art && art.pillH ? art.pillH(d) : .3 };   // the height of a level pill above the ground: above the tile's plants (the art says how tall they are)
  function updateLabels(T0) { labFrame++;
    for (const cl of cells) { const d = cl.d; if (!d || d.code === "B") continue; const gnd = CH[cl.i];
      if (d.level) { const cls = d.kind === "g" ? "" : d.kind; const e = label("p" + cl.k, String(d.level), cls, d.locked ? LOCK : ""); placeLabel(e, cl.x + .34, gnd + pillY(d), cl.z + .5) }   // a level pill sits at the foot of its tile, to the right and in front, so it stays with the tile whatever grows on it
      else if (d.river > 1) { const e = label("p" + cl.k, String(d.river), "r", d.locked ? LOCK : ""); placeLabel(e, cl.x, gnd + .35, cl.z) }
      else if (d.river && d.locked) { const e = label("p" + cl.k, "", "r", LOCK); placeLabel(e, cl.x, gnd + .35, cl.z) } }
    for (const t of ringTags) { const e = label(t.id, t.text, t.cls, ""); placeLabel(e, t.cell.x, CH[t.cell.i] + (t.dy || .5) + .5, t.cell.z) }
    // the points that float up from a tile (the game's own list, which this look has to clear when they are done)
    for (let i = B.fx.length - 1; i >= 0; i--) { const f = B.fx[i], a = (T0 - f.t0) / 900; if (a >= 1) { B.fx.splice(i, 1); continue } const c = cellAt(f.p[0], f.p[1]); if (!c) continue;
      const e = label("f" + i + "_" + f.t0, f.text, "fx", ""); placeLabel(e, c.x, CH[c.i] + .7 + a * .9, c.z, a < .5 ? 1 : (1 - a) / .5) }
    for (const k in B.pops) if (T0 - B.pops[k] > 400) delete B.pops[k];
    for (const [id, e] of pool) if (e.seen !== labFrame) { e.el.remove(); pool.delete(id) } }

  // ---------- the camera: perspective, FIXED azimuth and polar angle (nothing rotates it). Only the target (pan) and the distance (zoom) move. Zoom runs from "the whole island fits" to about nearTilesAcross
  // tiles across; pan is clamped so the island stays on screen.
  const AZ = C3.azimuth, POL = C3.polar, dirV = new T.Vector3(Math.sin(POL) * Math.sin(AZ), Math.cos(POL), Math.sin(POL) * Math.cos(AZ));
  const view = {tx:midX, tz:midZ, dist:90, gx:midX, gz:midZ, gd:90}, fit = {dist:90, near:24, ox:0}, tcam = new T.PerspectiveCamera(C3.fov, 1, 1, 1400), EXT = [];
  { const ys = [ELAND - .4, EROCK + .6]; for (const y of ys) for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) EXT.push(new T.Vector3(midX + sx * halfX, y, midZ + sz * halfZ)) }
  const camAt = (cam, tx, tz, dist) => { cam.position.set(tx, ELAND, tz).addScaledVector(dirV, dist); cam.lookAt(tx, ELAND, tz); cam.updateMatrixWorld(true); cam.updateProjectionMatrix() };
  function computeFit() { if (!w || !h) return; topH = B.top.offsetHeight || 0; const availW = w - 12, availH = Math.max(60, h - topH - 10); tcam.aspect = w / h; let d = 90;
    for (let it = 0; it < 5; it++) { camAt(tcam, midX, midZ, d); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const p of EXT) { pv.copy(p).project(tcam); x0 = Math.min(x0, pv.x); x1 = Math.max(x1, pv.x); y0 = Math.min(y0, pv.y); y1 = Math.max(y1, pv.y) }
      const ex = (x1 - x0) / 2 * (w / 2), ey = (y1 - y0) / 2 * (h / 2); d *= Math.max(ex / (availW / 2), ey / (availH / 2)) * 1.005 }
    fit.dist = d; camAt(tcam, midX, midZ, d); const near = nearDist(); fit.near = Math.min(near, d * .6);
    // the island's middle sits in the middle of the free part of the board: shift the picture down by half the top bar (the view offset moves the projection, not the camera)
    fit.ox = topH / 2; if (!view.init) { view.init = true; view.gd = view.dist = fit.dist } view.gd = clamp(view.gd, fit.near, fit.dist); view.dist = clamp(view.dist, fit.near, fit.dist) }
  const nearDist = () => { const widthWorld = C3.nearTilesAcross * SQ; return widthWorld / (2 * Math.tan(C3.fov * Math.PI / 360) * (w / h)) };
  function clampView() { view.gd = clamp(view.gd, fit.near, fit.dist); const f = clamp((fit.dist - view.gd) / Math.max(1e-6, fit.dist - fit.near), 0, 1), ex = f * (halfX + 1), ez = f * (halfZ + 1.5);
    view.gx = clamp(view.gx, midX - ex, midX + ex); view.gz = clamp(view.gz, midZ - ez, midZ + ez) }
  function applyCamera(snap) { clampView(); const k = snap || reduced() ? 1 : 1 - Math.pow(.0015, Math.min(dtLast, .05)); view.tx += (view.gx - view.tx) * k; view.tz += (view.gz - view.tz) * k; view.dist += (view.gd - view.dist) * k;
    camAt(camera, view.tx, view.tz, view.dist); camera.setViewOffset(w, h, 0, -fit.ox, w, h); camera.updateProjectionMatrix() }
  const ray = new T.Raycaster(), ndc = new T.Vector2(), plane = new T.Plane(new T.Vector3(0, 1, 0), -ELAND), hit = new T.Vector3();
  // the point on the ground plane under a screen position (page coordinates)
  function groundAt(cx, cy) { const r = cv3.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); return ray.ray.intersectPlane(plane, hit) ? hit : null }
  function cellAtScreen(cx, cy) { const p = groundAt(cx, cy); if (!p) return null; const c = cellOf(p.x, p.z); return cellAt(c[0], c[1]) }
  function updateFitButton() { const fb = B.fit; if (!fb) return; const zoomed = view.gd < fit.dist * .8;
    fb.innerHTML = zoomed ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M10.5 7.5v6M7.5 10.5h6"/></svg>';
    fb.setAttribute("aria-label", zoomed ? "Show the whole island" : "Zoom in"); fb.style.top = topH + 6 + "px" }
  function toggleFit() { if (view.gd < fit.dist * .8) { view.gd = fit.dist; view.gx = midX; view.gz = midZ } else { view.gd = clamp(nearDist() * 5 / C3.nearTilesAcross, fit.near, fit.dist); view.gx = srcCell.x; view.gz = srcCell.z } clampView(); updateFitButton() }

  // ---------- input: a touch that barely moves (under 8 px) is a tap on the ground cell it landed on; a drag pans (the point under the finger stays under it); two fingers pinch to zoom (and pan); the wheel
  // zooms about the pointer. Nothing here can rotate the view. Picking is by the hex ground plane, not by the meshes, so a tap always means the ground cell under the finger.
  const ptrs = new Map(); let gesture = null, hover = null;
  cv3.addEventListener("pointerdown", e => { try { cv3.setPointerCapture(e.pointerId) } catch (_) {} ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY});
    if (ptrs.size === 1) gesture = {x:e.clientX, y:e.clientY, moved:false, g0:groundAt(e.clientX, e.clientY) ? groundAt(e.clientX, e.clientY).clone() : null, tx:view.gx, tz:view.gz};
    else if (ptrs.size === 2) { const a = [...ptrs.values()]; gesture = {pinch:Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1, d0:view.gd, moved:true, cx:(a[0].x + a[1].x) / 2, cy:(a[0].y + a[1].y) / 2, tx:view.gx, tz:view.gz, g0:null} } });
  cv3.addEventListener("pointermove", e => { const p = ptrs.get(e.pointerId);
    if (!p) { if (e.pointerType === "mouse") { const c = cellAtScreen(e.clientX, e.clientY); if (c !== hover) { hover = c; setHover(c) } } return }
    p.x = e.clientX; p.y = e.clientY; if (!gesture) return;
    if (gesture.pinch && ptrs.size >= 2) { const a = [...ptrs.values()], d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1; view.gd = gesture.d0 * gesture.pinch / d; return }
    if (gesture.pinch) return;
    const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y; if (!gesture.moved && Math.hypot(dx, dy) < 8) return; gesture.moved = true;
    // pan: put the ground point that was under the finger when the drag began back under it (the camera follows at once while dragging)
    const now = groundAt(e.clientX, e.clientY); if (gesture.g0 && now) { view.gx += gesture.g0.x - now.x; view.gz += gesture.g0.z - now.z; clampView(); view.tx = view.gx; view.tz = view.gz; applyCamera(true); dirtyLabels = true } });
  const lift = (e, tapOk) => { const had = gesture; ptrs.delete(e.pointerId);
    if (had && !had.pinch && !had.moved && tapOk && ptrs.size === 0) { const c = cellAtScreen(e.clientX, e.clientY); if (c) B.tap([c.c, c.r]) }
    if (!ptrs.size) gesture = null; else if (had && had.pinch) gesture = null };
  cv3.addEventListener("pointerup", e => lift(e, true)); cv3.addEventListener("pointercancel", e => lift(e, false));
  cv3.addEventListener("pointerleave", e => { if (e.pointerType === "mouse" && hover) { hover = null; setHover(null) } });
  cv3.addEventListener("contextmenu", e => e.preventDefault());
  cv3.addEventListener("wheel", e => { e.preventDefault(); const b0 = groundAt(e.clientX, e.clientY), before = b0 ? b0.clone() : null; view.gd = clamp(view.gd * Math.exp(e.deltaY * .0015), fit.near, fit.dist); clampView();
    // zoom about the pointer: put the camera at the new distance, then move the target so the ground point under the pointer stays under it
    view.dist = view.gd; view.tx = view.gx; view.tz = view.gz; applyCamera(true); const after = before ? groundAt(e.clientX, e.clientY) : null;
    if (before && after) { view.gx += before.x - after.x; view.gz += before.z - after.z; clampView(); view.tx = view.gx; view.tz = view.gz; applyCamera(true) } dirtyLabels = true; updateFitButton() }, {passive:false});
  function setHover(c) { if (!c) { hoverMesh.visible = false; return } const L = [{x:c.x, z:c.z, kind:"pick"}]; hoverMesh.geometry.dispose(); hoverMesh.geometry = ringGeom(L); hoverMesh.visible = true }

  // ---------- the game's state, into the scene: find the cells that changed (and their neighbours, for the ground), rebuild only those; the river and the rings are cheap and rebuilt when they change
  let riverSig = null, lastSeed = null, firstSync = true;
  function syncState() { S = B.state(); const seedChanged = lastSeed !== S.seed; lastSeed = S.seed; reach = rules.reachOf(S); elev = cfg.elevation ? rules.elevOf(cfg, S.seed) : null;
    const dirty = new Set(), changed = [], born = new Map(), frozen = [], animate = !firstSync && !seedChanged; firstSync = false;
    for (const cl of cells) { const old = cl.d, d = describe(cl), sg = sigOf(d); cl.d = d;
      if (sg !== cl.sig || seedChanged) { cl.sig = sg; changed.push(cl);   // a tile that grew (a plant, a level, a river tile) springs up, a tile that was locked gets a frost ring; undo and a new island just rebuild
        if (animate && old) { if (d.level > old.level || d.river > old.river) born.set(cl, !old.level && d.level ? 2 : 1); else if (d.locked && !old.locked) frozen.push(cl) } }
      groundOf(cl, d) }
    for (const cl of changed) { dirty.add(cl); for (const n of cl.nbc) if (n) dirty.add(n) }
    const rs = Object.keys(S.r).sort().map(k => k + ":" + S.r[k].l + ":" + S.r[k].from).join(";") + "|" + (elev ? S.seed : ""); if (rs !== riverSig) { riverSig = rs; buildRiver() }
    for (const cl of dirty) refreshTile(cl, born.get(cl) || 0);
    for (const cl of born.keys()) celebrate(cl, "grow"); for (const cl of frozen) celebrate(cl, "frost");
    if (changed.length) buildZoo();
    buildRings(); dirtyLabels = true }
  let dirtyLabels = true;

  function resize() { if (!alive) return; w = board.clientWidth; h = board.clientHeight; if (!w || !h) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? C3.pixelRatio.touch : C3.pixelRatio.other)); renderer.setSize(w, h, false); pU.scale.value = renderer.getPixelRatio() * h / (2 * Math.tan(C3.fov * Math.PI / 360)); camera.aspect = w / h; computeFit(); camera.updateProjectionMatrix(); applyCamera(true); updateFitButton(); dirtyLabels = true }
  let frames = 0, fpsT = performance.now(), fps = 0, lastT = 0, lastCam = "";
  function draw(T0) { if (!alive || !w) return; const dt = lastT ? Math.min(.05, (T0 - lastT) / 1000) : 0; lastT = T0; dtLast = dt; uTime.value += dt;
    for (const c of clouds) { c.position.x += c.userData.sp * dt; if (c.position.x > 120) c.position.x = -120 }
    applyCamera(false); const cs = view.tx.toFixed(3) + view.tz.toFixed(3) + view.dist.toFixed(2); if (cs !== lastCam) { lastCam = cs; dirtyLabels = true }
    popTick(); sparkTick(dt); pulseTick(); poseZoo(uTime.value);
    ringMat.opacity = reduced() ? .9 : .72 + .26 * Math.sin(uTime.value * 3);
    renderer.render(scene, camera); if (dirtyLabels || B.fx.length || Object.keys(B.pops).length) { updateLabels(T0); dirtyLabels = false }
    frames++; const n = performance.now(); if (n - fpsT >= 1000) { fps = frames * 1000 / (n - fpsT); frames = 0; fpsT = n } }
  const stats = () => { const i = renderer.info; return {quality, detail, triangles:i.render.triangles, calls:i.render.calls, fps:Math.round(fps * 10) / 10, geometries:i.memory.geometries, textures:i.memory.textures, animals:zoo.length, animalTriangles:Math.round(zooVerts / 3), popping:pops.length, sparks:sparks.length, width:w, height:h} };
  const sample = (n = 12) => { renderer.render(scene, camera); const gl = renderer.getContext(), px = new Uint8Array(4), out = [], Wd = gl.drawingBufferWidth, Hd = gl.drawingBufferHeight;   // read an n by n grid of pixels back, for the smoke test
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { gl.readPixels(Math.floor((i + .5) * Wd / n), Math.floor((j + .5) * Hd / n), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.push([px[0], px[1], px[2]]) } return out };
  // the page coordinates of a cell's top (for tests and for the page's own helpers)
  function scr(p) { const c = cellAt(p[0], p[1]); if (!c) return [0, 0]; const r = cv3.getBoundingClientRect(); pv.set(c.x, CH[c.i] + .1, c.z).project(camera); return [r.left + (pv.x * .5 + .5) * w, r.top + (-pv.y * .5 + .5) * h] }
  function look(p, z) { const c = cellAt(p[0], p[1]); if (!c) return; view.gx = c.x; view.gz = c.z; if (z) view.gd = clamp(fit.dist / (z || 1), fit.near, fit.dist); clampView(); updateFitButton() }
  const ctl = {draw, resize, sync: syncState, scr, look, toggleFit, unmount() { alive = false; delete G.__flowgrow3d; for (const c of cells) { dropPop(c); if (c.mesh) c.mesh.geometry.dispose() } if (zGeo) zGeo.dispose(); pGeo.dispose(); renderer.dispose(); cv3.remove(); lab.remove(); B.fit && (B.fit.style.top = "") }};
  G.__flowgrow3d = {setTime() {}, getTime: () => 0, setNight(n) { dayState.night = n }, setQuality(q) { if (TIERS.includes(q) && q !== quality) { quality = q; applyQuality(); for (const cl of cells) cl.sig = ""; syncState() } }, stats, sample, renderer, scene, camera, view};
  syncState(); resize();
  return ctl;
}

G.Flowgrow3D = {mount, util:{Batch, GT, put, rng, lin, hsh, pick, clamp, sstep, tpl}};
})();
