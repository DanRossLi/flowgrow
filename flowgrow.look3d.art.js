// Flowgrow 3D look, step 3 (LOU-311): what grows on a tile, and the animals. Loaded after flowgrow.look3d.js, which calls content() for every tile it builds.
//
// The techniques are the reference prototype's (Dan's 19-tile island): shapes made of merged low-poly blobs and limbs with vertex colours, seeded per tile so a tile always looks the same, and one small
// animal per tile. A tile's plants are built once, in the tile's own coordinates (the ground is y = 0), cached by what makes them look different, and copied into each tile that has the same key; only the
// ground under them depends on the neighbours.
//
// THE ART FOR LEVELS 8 TO 15 AND FOR THE FOUR KINDS IS A PROPOSAL, not agreed (LOU-311 section 7; CANON.md wins). Anything Dan hasn't picked is marked "placeholder, see Linear". Nothing man-made is drawn:
// plants, rock, water, soil and animals only.
(() => {
"use strict";
const F = window.Flowgrow3D, T = window.THREE, U = F.util, {Batch, GT, put, rng, lin, hsh, pick, clamp} = U;
GT.disc = U.tpl(new T.CircleGeometry(1, 14).rotateX(-Math.PI / 2));   // a flat disc facing up: water, lily pads

// ---------- state of the tile being built (the builders below draw into CB, around the tile's own centre)
let CB = null, DET = 1, CG = GT.ico1, PT = GT.cone2, LK = false, SZ = 1, SW = 1, R = null, INFO = null, LOWPOLY = false;
const cnt = n => Math.max(1, Math.round(n * DET));
const glow = f => { CB.gl = 10; f(); CB.gl = 0 };   // what is drawn in f lights itself a little at night (pond water, mushroom caps, seed heads): the core's tile shader reads the flag
const ccache = {}, cl = hex => ccache[hex] || (ccache[hex] = lin(hex));
const _c = new T.Color();
function jit(hex, r, a) { _c.set(hex); _c.offsetHSL((r() - .5) * .03, (r() - .5) * .08, (r() - .5) * (a || .08)); _c.convertSRGBToLinear(); return {r:_c.r, g:_c.g, b:_c.b} }
const GREY = {r:.2, g:.24, b:.19};
const tint = c => LK ? {r:c.r * .45 + GREY.r * .55, g:c.g * .45 + GREY.g * .55, b:c.b * .45 + GREY.b * .55} : c;   // a locked tile is frozen: grey-green
const P = (geo, x, y, z, sx, sy, sz, col, ry, rx, rz, am) => put(CB, geo, x, y, z, sx, sy, sz, tint(col), ry, rx, rz, am == null ? SW : am);
const UP = new T.Vector3(0, 1, 0), _D = new T.Vector3(), _Q = new T.Quaternion(), _M = new T.Matrix4(), _V = new T.Vector3(), _S = new T.Vector3();
function limb(x0, y0, z0, x1, y1, z1, r0, col, tp) { _D.set(x1 - x0, y1 - y0, z1 - z0); const len = _D.length(); if (len < 1e-4) return; _D.normalize(); _Q.setFromUnitVectors(UP, _D);
  _M.compose(_V.set(x0, y0, z0), _Q, _S.set(r0, len, r0)); CB.add(tp || GT.trunk, _M, tint(col), SW) }
function scatter(n, Rr, minD) { const a = [], N = cnt(n); let tries = 0; while (a.length < N && tries < 1500) { tries++; const ang = R() * 6.2832, rr = Math.sqrt(R()) * Rr, x = Math.cos(ang) * rr, z = Math.sin(ang) * rr; let ok = true;
    for (let i = 0; i < a.length; i++) { const dx = a[i].x - x, dz = a[i].z - z; if (dx * dx + dz * dz < minD * minD) { ok = false; break } } if (ok) a.push({x, z}) } return a }

// ---------- small plants
const GREENS = ["#3da648", "#2f9640", "#52b94e", "#278a3a"], PINES = ["#1d6b43", "#27794e", "#165a39"], GRN = ["#3f9a3a", "#4cab40", "#348a33"], GOLD = ["#c9b24a", "#d8c25a", "#b8a23e", "#e0cf70"];
function sprout(x, y, z) { const h = .07 + R() * .07; P(GT.cyl, x, y, z, .012, h, .012, jit("#6fae52", R)); P(GT.ico0, x - .03, y + h, z, .05, .016, .03, jit("#a6e47f", R), R() * 3, 0, .5); P(GT.ico0, x + .03, y + h * .95, z, .05, .016, .03, jit("#8fd470", R), R() * 3, 0, -.5); P(GT.ico0, x, y + .012, z, .06, .02, .06, jit("#7a5a3a", R), 0, 0, 0, 0) }
function tuft(x, y, z, s, pal, bend) { s = s || 1; const n = cnt(8), P2 = pal || ["#5cc23c", "#48b034", "#78d04a"];
  for (let k = 0; k < n; k++) { const a = R() * 6.28, h = (.14 + R() * .2) * s, l = (.18 + R() * .3) * (bend || 1); P(GT.blade, x + Math.cos(a) * .03, y, z + Math.sin(a) * .03, .028 * s, h, .028 * s, jit(pick(P2, R), R), 0, Math.cos(a) * l, Math.sin(a) * l) } }
function fstem(x, y, z, h, th) { const lx = (R() - .5) * .22, lz = (R() - .5) * .22, c = jit(pick(GRN, R), R), mx = x + lx * h * .3, mz = z + lz * h * .3, tx = x + lx * h, tz = z + lz * h;
  limb(x, y, z, mx, y + h * .5, mz, th || .0085, c, GT.stem4); limb(mx, y + h * .5, mz, tx, y + h, tz, (th || .0085) * .75, c, GT.stem4); return {x:tx, y:y + h, z:tz} }
function fleaf(x, y, z, h, n, len, w) { for (let i = 0; i < n; i++) { const f = .08 + R() * .4, a = R() * 6.28; P(PT, x, y + h * f, z, w, len * (.7 + R() * .6), w * .3, jit(pick(GRN, R), R), a, 1.05 + R() * .3, 0) } }
function petals(cx, cy, cz, n, len, w, pal, lean) { for (let k = 0; k < n; k++) { const a = k * 6.283 / n + (R() - .5) * .2; P(PT, cx, cy, cz, w, len * (.88 + R() * .24), w * .28, jit(pick(pal, R), R, .06), a, lean + (R() - .5) * .14, 0) } }
const FLORA = ["daisy", "daisy", "poppy", "tulip", "spike", "spike", "cosmos", "corn", "dandelion", "buttercup", "aster"];
function flower(x, y, z, tall) { const hs = (tall || 1) * (.75 + R() * .55), sp = pick(FLORA, R); let h, t;
  if (tall > 1.3 && R() < .22) { h = (.45 + R() * .22) * hs * .9; t = fstem(x, y, z, h, .014); fleaf(x, y, z, h, 3, .14, .045); P(CG, t.x, t.y, t.z, .052, .016, .052, cl("#47290f"), 0, .45, 0); petals(t.x, t.y - .004, t.z, 14, .065, .017, ["#ffc61a", "#ffb300", "#ffd23a"], 1.25); return }
  if (sp === "poppy") { h = (.28 + R() * .16) * hs; t = fstem(x, y, z, h, .007); fleaf(x, y, z, h, 2, .1, .018); petals(t.x, t.y, t.z, 5, .055, .032, ["#e8392b", "#f0503a", "#d92a22"], .8); P(GT.ico0, t.x, t.y + .012, t.z, .014, .012, .014, cl("#2b1a1a")) }
  else if (sp === "tulip") { h = (.22 + R() * .13) * hs; t = fstem(x, y, z, h, .01); const c = jit(pick(["#ff7aa8", "#ffd23a", "#ef4e5c", "#ff9a4a"], R), R); for (let k = 0; k < 3; k++) { const a = k * 2.094 + R(); P(CG, t.x + Math.cos(a) * .011, t.y + .026, t.z + Math.sin(a) * .011, .017, .04, .011, c, a, .22, 0) } fleaf(x, y, z, h, 2, .16, .02) }
  else if (sp === "spike") { h = (.3 + R() * .26) * hs; t = fstem(x, y, z, h, .008); const pal = pick([["#9b6ee0", "#b58cf0", "#7a5bd0"], ["#5f7be8", "#7d96f2", "#4a64d0"], ["#ee79b8", "#f79bcb", "#d85ca2"]], R); fleaf(x, y, z, h, 3, .1, .016);
    const nb = cnt(8); for (let k = 0; k < nb; k++) { const f = .58 + .42 * k / nb, a = k * 2.4 + R(), sz = .022 * (1 - .55 * k / nb) + .006, px = x + (t.x - x) * f, pz = z + (t.z - z) * f; P(GT.ico0, px + Math.cos(a) * .016 * (1 - .4 * k / nb), y + h * f, pz + Math.sin(a) * .016 * (1 - .4 * k / nb), sz, sz * 1.2, sz, jit(pick(pal, R), R, .06), R() * 6) } }
  else if (sp === "corn") { h = (.24 + R() * .16) * hs; t = fstem(x, y, z, h, .007); fleaf(x, y, z, h, 2, .1, .012); petals(t.x, t.y, t.z, 8, .04, .012, ["#5b7fe8", "#7a98f0", "#4a6cd8"], 1.2); P(GT.ico0, t.x, t.y + .006, t.z, .012, .008, .012, cl("#2a2f6a")) }
  else if (sp === "dandelion") { h = (.1 + R() * .1) * hs; t = fstem(x, y, z, h, .007); fleaf(x, y, z, h * .4, 3, .08, .018); if (R() < .55) { P(GT.ico0, t.x, t.y + .005, t.z, .026, .012, .026, cl("#ffd21e")); petals(t.x, t.y + .004, t.z, 8, .03, .007, ["#ffd21e", "#ffc400"], 1.35) } else glow(() => P(CG, t.x, t.y + .02, t.z, .032, .032, .032, cl("#f1f1ea"), R() * 6)) }
  else if (sp === "buttercup") { h = (.1 + R() * .08) * hs; t = fstem(x, y, z, h, .006); fleaf(x, y, z, h, 2, .05, .012); petals(t.x, t.y, t.z, 5, .026, .016, ["#ffd83a"], .9) }
  else { h = (.14 + R() * .16) * hs; t = fstem(x, y, z, h); fleaf(x, y, z, h, 2, .08, .016); const aster = sp === "aster"; petals(t.x, t.y, t.z, aster ? 11 : sp === "cosmos" ? 8 : 10, .052 * (sp === "cosmos" ? 1.2 : 1), .013, aster ? ["#b48cf0", "#cfa8ff", "#9d72e6"] : sp === "cosmos" ? ["#ff8fb8", "#ffb3d1", "#e866a0"] : ["#ffffff", "#fff4dc"], 1.3); P(GT.ico0, t.x, t.y + .004, t.z, .02, .011, .02, cl("#f2bd1f")) } }
function shrub(x, y, z, rad) { const c = jit(pick(GREENS, R), R, .12); P(CG, x, y + rad * .55, z, rad, rad * .72, rad, c, R() * 6); P(CG, x + rad * .55, y + rad * .35, z + rad * .2, rad * .6, rad * .5, rad * .6, jit(pick(GREENS, R), R, .12), R() * 6); P(CG, x - rad * .4, y + rad * .3, z - rad * .4, rad * .55, rad * .45, rad * .55, jit(pick(GREENS, R), R, .12), R() * 6) }
function berryShrub(x, y, z, rad, pink) { shrub(x, y, z, rad); for (let i = 0; i < cnt(7); i++) { const a = R() * 6.28, e = R() * .9; P(GT.ico0, x + Math.cos(a) * rad * .9, y + rad * .55 + Math.sin(e) * rad * .45, z + Math.sin(a) * rad * .9, .03, .03, .03, cl(pink ? pick(["#ff9fc0", "#ffffff", "#ffd0e0"], R) : "#d8344a")) } }
function rock(x, y, z, s, c) { P(GT.dod, x, y + s * .35, z, s, s * .7, s * .85, jit(c || pick(["#8d9aa0", "#a2adaf", "#7f8b90", "#b1b6aa"], R), R, .1), R() * 6, R() * .4, R() * .4, 0) }
function mushroom(x, y, z, s) { P(GT.cyl, x, y, z, .02 * s, .07 * s, .02 * s, cl("#efe6d2"), 0, 0, 0, 0); glow(() => { P(CG, x, y + .07 * s, z, .055 * s, .035 * s, .055 * s, cl(pick(["#e0564a", "#f2a03d", "#d9684f"], R)), 0, 0, 0, 0); P(GT.ico0, x + .02 * s, y + .095 * s, z, .009 * s, .006 * s, .009 * s, cl("#ffffff"), 0, 0, 0, 0) }) }
function fern(x, y, z, s) { s = s || 1; for (let i = 0; i < cnt(8); i++) { const a = i * .8 + R() * .3, c = jit(pick(["#3f9e3c", "#318f36", "#55b447"], R), R), l1 = .15 * s, l2 = .12 * s, ln = .8; P(PT, x, y + .01, z, .04 * s, l1, .012 * s, c, a, ln, 0);
    const ex = x + Math.sin(a) * Math.sin(ln) * l1, ey = y + .01 + Math.cos(ln) * l1, ez = z + Math.cos(a) * Math.sin(ln) * l1; P(PT, ex, ey, ez, .034 * s, l2, .01 * s, c, a, 1.45, 0) } }
function logPile(x, y, z, len, rad, ang) { P(GT.cyl, x, y + rad, z, rad, len, rad, jit("#6d5036", R, .06), ang, 0, Math.PI / 2); P(CG, x, y + rad * 1.8, z, len * .28, rad * .35, rad * .7, jit("#4e9a3a", R), ang) }

// ---------- trees: limbs and crowns of blobs, seeded; species are the reference's
const OAK = ["#2f8a35", "#3e9d3e", "#277a31", "#55ae45"], MAPLE = ["#d9582b", "#e8892e", "#f0b83c", "#c4402a"], CHERRY = ["#f6b3c9", "#f9c9d8", "#ee9bb7", "#fbd8e2"], BIRCHP = ["#7fc23f", "#6bb338", "#98d24c", "#5aa631"],
  SPRUCEP = ["#17593a", "#1e6a42", "#124d33", "#277a4b"], FIRP = ["#1d6b43", "#27794e", "#165a39"], POPLARP = ["#3a9a3a", "#4aa83f", "#2c8634", "#63b447"], WILLOWP = ["#7bbd45", "#68ad3c", "#92cc52", "#74b640"], DEEP = ["#1f7a45", "#2a8a50", "#186b3c", "#34995a"];
function crown(cx, cy, cz, rx, ry, rz, n, pal, blob) { for (let i = 0; i < cnt(n); i++) { const u = R() * 2 - 1, a = R() * 6.283, q = Math.sqrt(1 - u * u) * Math.cbrt(R()), px = Math.cos(a) * q, pz = Math.sin(a) * q, py = u * Math.cbrt(R());
    _c.set(pick(pal, R)); _c.offsetHSL((R() - .5) * .03, (R() - .5) * .06, py * .08 + (R() - .5) * .05); _c.convertSRGBToLinear(); const c = {r:_c.r, g:_c.g, b:_c.b}, sz = blob * (.75 + R() * .5), bx = cx + px * rx, by = cy + py * ry, bz = cz + pz * rz;
    P(CG, bx, by, bz, sz, sz * .8, sz, c, R() * 6, R() * .5, R() * .5) } }
function oakLike(x, y, z, h, rad, pal, k) { k = k || 1; const bark = jit("#6d5036", R, .08), bark2 = jit("#7d6044", R, .08), lean = (R() - .5) * .1, th = h * (.36 + R() * .08), tr = rad * .15, tx = x + lean * th, tz = z + lean * th * .5;
  limb(x, y, z, tx, y + th, tz, tr, bark); limb(x, y + th * .5, z, tx, y + th, tz, tr * .8, bark2);
  const nb = Math.max(2, Math.round((3 + R() * 2) * k * Math.min(1, DET + .3)));
  for (let j = 0; j < nb; j++) { const a2 = j * 6.283 / nb + R(), bh = th * (.5 + R() * .45), ex = x + Math.cos(a2) * rad * .58, ey = y + th + rad * (.2 + R() * .4), ez = z + Math.sin(a2) * rad * .58;
    limb(x + lean * bh, y + bh, z + lean * bh * .5, ex, ey, ez, tr * .42, bark2); crown(ex, ey + rad * .12, ez, rad * .42, rad * .32, rad * .42, 5 * k, pal, rad * .34) }
  crown(tx, y + th + rad * .55, tz, rad * .66, rad * .5, rad * .66, 9 * k, pal, rad * .42) }
function birch(x, y, z, h, rad) { const lean = (R() - .5) * .14, tr = .02 + h * .014, tx = x + lean * h * .8, tz = z + lean * h * .4, top = y + h * .85, wh = cl("#ebe7db"); limb(x, y, z, tx, top, tz, tr, wh);
  for (let i = 0; i < cnt(7); i++) { const f = .06 + R() * .78; P(GT.cyl, x + (tx - x) * f, y + h * .85 * f, z + (tz - z) * f, tr * (1 - f * .45) * 1.14, .015 + R() * .025, tr * (1 - f * .45) * 1.14, cl("#2e2c29")) }
  crown(tx, y + h * .76, tz, rad * .55, h * .24, rad * .55, 12, BIRCHP, rad * .3) }
function spruce(x, y, z, h, rad, pal) { limb(x, y, z, x, y + h * .4, z, rad * .1, jit("#5e4330", R, .06)); const tiers = quality3() === "low" ? 4 : 7;
  for (let t = 0; t < tiers; t++) { const f = t / tiers, yy = y + h * (.1 + f * .66), rr = rad * (1 - f * .85) * (.9 + R() * .2), nbr = Math.max(4, 7 - ((t / 2) | 0));
    for (let j = 0; j < Math.max(3, cnt(nbr)); j++) { const a = j * 6.283 / nbr + t * .6 + R() * .25, ln = rr * (.85 + R() * .3); P(PT, x, yy + (R() - .5) * .03, z, ln * .3, ln, ln * .12, jit(pick(pal, R), R, .12), a, 1.5 + R() * .25, 0) }
    P(GT.blade, x, yy, z, rr * .35, h * .11, rr * .35, jit(pick(pal, R), R, .1), R() * 3) }
  P(GT.blade, x, y + h * .84, z, rad * .1, h * .18, rad * .1, jit("#3f9a58", R, .06), 0) }
function poplar(x, y, z, h, rad) { limb(x, y, z, x, y + h * .3, z, rad * .1, jit("#7b6448", R, .06)); crown(x, y + h * .6, z, rad * .42, h * .36, rad * .42, 16, POPLARP, rad * .3) }
function willow(x, y, z, h, rad) { const lean = (R() - .5) * .2, th = h * .45, tx = x + lean * th, tz = z + lean * th, yc = y + th + rad * .35; limb(x, y, z, tx, y + th, tz, rad * .15, jit("#6a5a40", R, .06)); crown(tx, yc, tz, rad * .7, rad * .3, rad * .7, 10, WILLOWP, rad * .36);
  for (let i = 0; i < cnt(22); i++) { const a = i * .21 + R() * .15, rr = rad * (.5 + R() * .55), ln = h * (.28 + R() * .24); P(PT, tx + Math.cos(a) * rr, yc, tz + Math.sin(a) * rr, .026 + R() * .014, ln, .026 + R() * .014, jit(pick(WILLOWP, R), R, .1), 0, Math.PI) } }
function snag(x, y, z, h) { const bark = jit("#8a7b69", R, .06); limb(x, y, z, x + .03, y + h, z, h * .05, bark); for (let i = 0; i < 4; i++) { const a = i * 1.3 + R(), f = .4 + R() * .45; limb(x, y + h * f, z, x + Math.cos(a) * h * .28, y + h * (f + .18), z + Math.sin(a) * h * .28, h * .02, bark) } }
function tree(sp, x, y, z, h, rad, k) { h *= SZ; rad *= SZ;
  if (INFO) { const top = y + (sp === "spruce" ? h * 1.15 : sp === "fir" ? h * 1.0 : sp === "birch" ? h * .96 : sp === "poplar" ? h * 1.02 : sp === "snag" ? h : sp === "willow" ? h * .62 : h * .4 + rad * 1.1);   // the tallest tree: where an owl or a woodpecker sits
    if (!INFO.perch || top > INFO.perch.top) INFO.perch = {x, z, top, mid:y + h * .3, tr:Math.max(.02, rad * .13)} }
  if (sp === "oak") oakLike(x, y, z, h, rad, OAK, k); else if (sp === "maple") oakLike(x, y, z, h, rad, MAPLE, k); else if (sp === "cherry") oakLike(x, y, z, h, rad * .95, CHERRY, k);
  else if (sp === "deep") oakLike(x, y, z, h, rad, DEEP, k); else if (sp === "birch") birch(x, y, z, h, rad); else if (sp === "spruce") spruce(x, y, z, h * 1.15, rad * .85, SPRUCEP); else if (sp === "fir") spruce(x, y, z, h * 1.05, rad * .75, FIRP);
  else if (sp === "poplar") poplar(x, y, z, h * 1.1, rad * .7); else if (sp === "willow") willow(x, y, z, h, rad); else snag(x, y, z, h) }
let quality3 = () => "med";

// ---------- reeds, water, the spring
const REEDC = ["#5fa63a", "#74b345", "#4d9633", "#8cbd4a", "#68a83e", "#a7b954"];
function reedStem(x, y, z, h, kind) { const lx = (R() - .5) * .2, lz = (R() - .5) * .2, c = jit(pick(REEDC, R), R, .1), tx = x + lx * h, tz = z + lz * h, ty = y + h;
  limb(x, y, z, x + lx * h * .35, y + h * .55, z + lz * h * .35, .0085, c, GT.stem4); limb(x + lx * h * .35, y + h * .55, z + lz * h * .35, tx, ty, tz, .0055, c, GT.stem4);
  if (kind === "cat") { P(GT.cyl, tx, ty - .07, tz, .016, .085, .016, jit("#5c3a21", R, .08), 0, lz * 1.2, lx * 1.2); P(PT, tx, ty + .012, tz, .004, .05, .004, jit("#c9b078", R, .06), 0, lz * 1.2, lx * 1.2) }
  else if (kind === "plume") glow(() => P(CG, tx, ty + .01, tz, .016, .055, .016, jit(pick(["#cbb581", "#b39f84", "#d8c79a"], R), R, .08), R() * 6, lz * 1.3, lx * 1.3));
  else if (kind === "iris") { petals(tx, ty, tz, 3, .045, .024, ["#ffd01f", "#f7bd10"], 1.95); petals(tx, ty + .004, tz, 3, .03, .016, ["#f2b30d"], .55) } }
function reedBed(n, Rr, hMax, ex) { const s = scatter(n, Rr, .064); for (const p of s) { if (ex && (p.x - ex.x) * (p.x - ex.x) + (p.z - ex.z) * (p.z - ex.z) < ex.r * ex.r) continue; const d = Math.hypot(p.x, p.z) / Rr, base = hMax * (1 - .5 * d * d), ns = 2 + ((R() * 3) | 0) * (DET > .6 ? 1 : 0);
    for (let k = 0; k < ns; k++) { const q = R(), kind = q < .34 ? "cat" : q < .58 ? "plume" : q < .66 ? "iris" : "blade"; reedStem(p.x + (R() - .5) * .045, 0, p.z + (R() - .5) * .045, base * (.55 + R() * .55), kind) } } }
// an organic green pond: a wobbly outline (never a circle), wet mud round it, and water from a deep green-teal to a pale shore. A fan of triangles with a colour at each corner; INFO.pond remembers the first one
// (a duck swims in it, a frog sits on its edge).
function pond(x, y, z, rx, rz) { const n = 16, p1 = R() * 6.28, p2 = R() * 6.28, p3 = R() * 6.28, rad = a => 1 + .17 * Math.sin(2 * a + p1) + .1 * Math.sin(3 * a + p2) + .05 * Math.sin(5 * a + p3);
  const deep = jit("#2c9580", R, .04), pale = jit("#6fd0a8", R, .04), mud = jit("#7a7340", R, .05), mudOut = jit("#8c8a52", R, .05), yw = y + .012, ym = y + .004;
  const pt = (a, k, yy) => [x + Math.cos(a) * rx * rad(a) * k, yy, z + Math.sin(a) * rz * rad(a) * k];
  const tri = (a, ca, b, cb, c, cc) => { const cr = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]); if (cr > 0) { const t = b, tc = cb; b = c; cb = cc; c = t; cc = tc } for (const [p, col] of [[a, ca], [b, cb], [c, cc]]) { const k = tint(col); CB.vert(p[0], p[1], p[2], 0, 1, 0, [k.r, k.g, k.b]) } };
  for (let i = 0; i < n; i++) { const a0 = i / n * 6.2832, a1 = (i + 1) / n * 6.2832, w0 = pt(a0, 1, yw), w1 = pt(a1, 1, yw), m0 = pt(a0, 1.24, ym), m1 = pt(a1, 1.24, ym);
    glow(() => tri([x, yw, z], deep, w0, pale, w1, pale)); tri(w0, mud, m0, mudOut, m1, mudOut); tri(w0, mud, m1, mudOut, w1, mud) }
  if (INFO && !INFO.pond) INFO.pond = {x, z, y:yw, rx:rx * .9, rz:rz * .9} }
function pad(x, y, z, s) { P(GT.disc, x, y, z, s, 1, s, jit("#5cae5a", R, .05), R() * 6, 0, 0, 0) }
function heron(x, y, z, ang, sc) { const fx = Math.sin(ang), fz = Math.cos(ang), leg = cl("#c9a05a"), gr = jit("#8fa3b5", R, .04), wh = cl("#eef0f0");
  limb(x + fz * .018, y, z - fx * .018, x + fz * .012, y + .2 * sc, z - fx * .012, .007 * sc, leg, GT.stem4); limb(x - fz * .018, y, z + fx * .018, x - fz * .012, y + .2 * sc, z + fx * .012, .007 * sc, leg, GT.stem4);
  P(CG, x, y + .26 * sc, z, .05 * sc, .048 * sc, .095 * sc, gr, ang); P(CG, x + fx * .03 * sc, y + .255 * sc, z + fz * .03 * sc, .042 * sc, .04 * sc, .06 * sc, wh, ang);
  const n0 = [x + fx * .07 * sc, y + .285 * sc, z + fz * .07 * sc], n1 = [x + fx * .1 * sc, y + .36 * sc, z + fz * .1 * sc], n2 = [x + fx * .05 * sc, y + .43 * sc, z + fz * .05 * sc], n3 = [x + fx * .075 * sc, y + .5 * sc, z + fz * .075 * sc];
  limb(n0[0], n0[1], n0[2], n1[0], n1[1], n1[2], .012 * sc, wh); limb(n1[0], n1[1], n1[2], n2[0], n2[1], n2[2], .011 * sc, wh); limb(n2[0], n2[1], n2[2], n3[0], n3[1], n3[2], .011 * sc, wh);
  P(CG, n3[0], n3[1] + .01 * sc, n3[2], .017 * sc, .014 * sc, .024 * sc, wh, ang); P(PT, n3[0] + fx * .014 * sc, n3[1] + .008 * sc, n3[2] + fz * .014 * sc, .007 * sc, .075 * sc, .007 * sc, cl("#e8a23a"), ang, 1.5, 0) }

// ---------- what each kind of tile is made of
const GD = {pebble:6};   // ground detail counts (placeholder, see Linear)
function pebbles(n, Rr) { for (const p of scatter(n, Rr, .1)) P(GT.dod, p.x, .006, p.z, .014 + R() * .014, .01, .013 + R() * .01, jit(pick(["#a9a79c", "#b6b3a6", "#999689"], R), R, .1), R() * 6, R() * .4, R() * .4, 0) }
// green: the reference's seven levels. Placeholders, see Linear: levels 1 to 7 are the agreed placeholder ladder (LOU-298); 8 to 15 keep the level 7 look and grow (fillGreen's size).
function fillGreen(L) { const y = 0; let i, s;
  if (L === 1) { for (const p of scatter(11, .62, .2)) sprout(p.x, y, p.z); for (const p of scatter(5, .6, .3)) tuft(p.x, y, p.z, .6) }
  else if (L === 2) { for (const p of scatter(15, .64, .17)) tuft(p.x, y, p.z, 1); for (const p of scatter(10, .62, .2)) flower(p.x, y, p.z) }
  else if (L === 3) { s = scatter(7, .6, .3); for (i = 0; i < s.length; i++) { const rd = .14 + R() * .11; if (i % 3 === 2) shrub(s[i].x, y, s[i].z, rd); else berryShrub(s[i].x, y, s[i].z, rd, i % 3 === 1) } s = scatter(2, .5, .5); for (i = 0; i < s.length; i++) tree(i ? "birch" : "oak", s[i].x, y, s[i].z, .38, .12);
    for (const p of scatter(6, .64, .2)) tuft(p.x, y, p.z, .9); for (const p of scatter(4, .6, .22)) flower(p.x, y, p.z) }
  else if (L === 4) { const sp4 = ["birch", "oak", "birch", "poplar", "oak", "cherry"]; s = scatter(6, .58, .34); for (i = 0; i < s.length; i++) tree(sp4[i % 6], s[i].x, y, s[i].z, .6 + R() * .2, .17 + R() * .04); for (const p of scatter(4, .62, .2)) fern(p.x, y, p.z, .7); for (const p of scatter(3, .62, .2)) shrub(p.x, y, p.z, .09 + R() * .05) }
  else if (L === 5) { const sp5 = ["oak", "cherry", "maple", "birch", "oak", "poplar"]; s = scatter(5, .56, .5); for (i = 0; i < s.length; i++) tree(sp5[i % 6], s[i].x, y, s[i].z, .9 + R() * .2, .28 + R() * .04); for (const p of scatter(5, .62, .22)) fern(p.x, y, p.z, .9); for (const p of scatter(3, .62, .22)) shrub(p.x, y, p.z, .1 + R() * .05) }
  else if (L === 6) { const sp6 = ["oak", "spruce", "birch", "fir", "oak", "poplar", "maple", "spruce", "oak", "snag"]; s = scatter(10, .58, .4); for (i = 0; i < s.length; i++) tree(sp6[i % 10], s[i].x, y, s[i].z, 1.15 + R() * .4, .3 + R() * .06); for (const p of scatter(8, .64, .2)) fern(p.x, y, p.z, 1);
    for (const p of scatter(3, .64, .2)) tuft(p.x, y, p.z, .8); logPile(-.15, y, .55, .4, .045, .5); rock(.45, y, .5, .09, "#7d8f78"); for (i = 0; i < cnt(5); i++) mushroom(-.3 + i * .12, y, .55 + (R() - .5) * .05, .8 + R() * .5) }
  else { tree("oak", 0, y, 0, 2.5, .85, 1.8); const sp7 = ["oak", "spruce", "maple", "fir", "oak", "spruce", "birch", "oak"]; for (i = 0; i < cnt(8); i++) { const a = i * .785 + R() * .3, rr = .6 + R() * .05; tree(sp7[i % 8], Math.cos(a) * rr, y, Math.sin(a) * rr, 1.4 + R() * .6, .34 + R() * .08) }
    for (i = 0; i < cnt(8); i++) { const a5 = R() * 6.28, r5 = .3 + R() * .3; fern(Math.cos(a5) * r5, y, Math.sin(a5) * r5, 1.1) } for (i = 0; i < cnt(6); i++) { const a3 = R() * 6.28, r3 = .3 + R() * .25; mushroom(Math.cos(a3) * r3, y, Math.sin(a3) * r3, .9 + R() * .7) }
    for (i = 0; i < 3; i++) { const a4 = R() * 6.28; rock(Math.cos(a4) * .45, y, Math.sin(a4) * .45, .1 + R() * .06, "#7d8f78") } logPile(.1, y, -.45, .45, .05, 2.2);
    const bk = jit("#6d5036", R, .05), hd = Math.sin(.6), hz = Math.cos(.6); P(CG, hd * .105, y + .3, hz * .105, .075, .118, .03, bk, .6); P(CG, hd * .118, y + .3, hz * .118, .058, .098, .03, cl("#120c06"), .6);   // the hollow in the old oak
    for (i = 0; i < 4; i++) { const ra = i * 1.5 + .3; limb(Math.cos(ra) * .34, y + .01, Math.sin(ra) * .34, Math.cos(ra) * .08, y + .32, Math.sin(ra) * .08, .055, bk) } } }
// prairie: open grass (placeholder, see Linear). Warm yellow-green, golden higher up; tall grass, wildflowers and seed heads. steppe: wind-bent grass and tiny seedlings. meadow: a dense flower carpet (bees come in the animals).
function fillPrairie(L, up) { const y = 0, t = Math.min(L, 7), bend = up === "steppe" ? 2.2 : 1;
  for (const p of scatter(8 + t * 3, .64, .17)) tuft(p.x, y, p.z, .9 + t * .12, GOLD, bend);
  for (const p of scatter(3 + t * 2, .62, .2)) { const h = .22 + R() * .18 + t * .03, lx = (R() - .5) * .2 * bend, c = jit(pick(GOLD, R), R, .1); limb(p.x, y, p.z, p.x + lx * h, y + h, p.z, .006, c, GT.stem4); P(CG, p.x + lx * h, y + h + .012, p.z, .012, .045, .012, jit("#c7a63a", R, .08), R() * 6) }   // seed heads
  for (const p of scatter(2 + t * 2, .62, .22)) flower(p.x, y, p.z, 1.1);
  if (t >= 5) for (const p of scatter(3, .6, .3)) shrub(p.x, y, p.z, .1 + R() * .05);
  if (up === "steppe") for (const p of scatter(7, .6, .15)) sprout(p.x, y, p.z);
  if (up === "meadow") for (const p of scatter(24, .64, .12)) flower(p.x, y, p.z, 1.3) }
// marsh: wet ground with standing water, reeds, cattails and lilies (placeholder, see Linear). A reed bed (the upgrade) is the reference's very dense reed tile and a heron.
function fillMarsh(L, up) { const y = 0, t = Math.min(L, 7), bed = up === "reed";
  const nw = bed ? 2 : 1 + (t > 2 ? 1 : 0) + (t > 4 ? 1 : 0); for (let i = 0; i < nw; i++) { const a = R() * 6.28, rr = .15 + R() * .3, pr = .14 + R() * .1 + t * .01; pond(Math.cos(a) * rr, y + i * .005, Math.sin(a) * rr, pr * 1.2, pr); if (R() < .6) pad(Math.cos(a) * rr + .05, y + .03 + i * .005, Math.sin(a) * rr, .055) }
  reedBed(bed ? 70 : 14 + t * 5, .68, bed ? 1.05 : .5 + t * .06, bed ? {x:.22, z:.12, r:.3} : null); if (!bed) for (const p of scatter(4, .62, .2)) tuft(p.x, y, p.z, .8);
  for (const p of scatter(3, .6, .3)) rock(p.x, y, p.z, .04 + R() * .03, "#7d8f78"); if (t >= 4 && !bed) tree("willow", .4, y, -.4, .75, .34); if (bed) heron(.18, y + .012, .1, .9, 1.15) }
// trees (deep green, dark soil): from a sapling up (placeholder, see Linear). roots: roots coming out of the ground and reaching towards the neighbours. pine-oneer: young pines.
function fillTrees(L, up) { const y = 0, t = Math.min(L, 7), sp = ["deep", "spruce", "oak", "fir", "deep", "birch", "spruce"], pn = up === "pine";
  if (t === 7) { tree("deep", 0, y, 0, 2.5, .85, 1.8); for (let i = 0; i < cnt(6); i++) { const a = i * 1.05 + R() * .3, rr = .6 + R() * .05; tree(sp[i % 7], Math.cos(a) * rr, y, Math.sin(a) * rr, 1.4 + R() * .5, .34 + R() * .08) } }
  else { const n = [1, 2, 3, 4, 5, 8][t - 1] || 5, s = scatter(n, .56, t < 3 ? .3 : .38); for (let i = 0; i < s.length; i++) { const h = [.3, .4, .5, .62, .85, 1.1][t - 1] + R() * .15; tree(pn ? (i % 2 ? "spruce" : "fir") : sp[i % 7], s[i].x, y, s[i].z, h, [.1, .12, .14, .17, .26, .3][t - 1]) } }
  for (const p of scatter(2 + t, .62, .2)) fern(p.x, y, p.z, .5 + t * .08); for (let i = 0; i < cnt(2 + t); i++) { const a = R() * 6.28, r = .2 + R() * .4; mushroom(Math.cos(a) * r, y, Math.sin(a) * r, .7 + R() * .5) }
  if (up === "roots") for (let i = 0; i < 5; i++) { const a = i * 1.26 + .4, bk = jit("#6b4a2e", R, .08); limb(0, y + .05, 0, Math.cos(a) * .42, y + .015, Math.sin(a) * .42, .045, bk); limb(Math.cos(a) * .42, y + .015, Math.sin(a) * .42, Math.cos(a + .35) * .74, y + .004, Math.sin(a + .35) * .74, .025, bk) } }
// the prestige of levels 8 to 15 (placeholder, see Linear): a thin gold rim on the tile's base from 8, a second rim from 12; the plants get larger and denser. Nothing is invented but light.
function rim(rr, w, col) { for (let i = 0; i < 6; i++) { const a0 = (60 * i - 90) * Math.PI / 180, a1 = (60 * (i + 1) - 90) * Math.PI / 180, x0 = Math.cos(a0) * rr, z0 = Math.sin(a0) * rr, x1 = Math.cos(a1) * rr, z1 = Math.sin(a1) * rr;
    for (let s = 0; s < 4; s++) { const t0 = s / 4, t1 = (s + 1) / 4, ax = x0 + (x1 - x0) * t0, az = z0 + (z1 - z0) * t0, bx = x0 + (x1 - x0) * t1, bz = z0 + (z1 - z0) * t1; limb(ax, .02, az, bx, .02, bz, w, col, GT.stem4) } } }
function mountain() { const y = 0; const s = [[0, 0, .62], [-.3, .2, .42], [.32, -.1, .46], [.1, .35, .34], [-.2, -.3, .36]]; for (let i = 0; i < s.length; i++) { const [x, z, sc] = s[i], c = jit(pick(["#8f918c", "#9a9b95", "#82857f"], R), R, .08);
    P(GT.dod, x, y + sc * .2, z, sc * 1.15, sc * 1.25, sc * 1.05, c, R() * 6, R() * .3, R() * .3, 0); if (i === 0) P(GT.dod, 0, y + sc * 1.1, 0, sc * .7, sc * .9, sc * .65, jit("#a7a9a3", R, .06), R() * 6, 0, 0, 0) }
  for (let i = 0; i < cnt(5); i++) { const a = i * 1.4 + R(), rr = .55 + R() * .12; tree(R() < .5 ? "spruce" : "fir", Math.cos(a) * rr, y, Math.sin(a) * rr, .5 + R() * .3, .12 + R() * .05) } }
function spring() { const y = 0; for (let i = 0; i < 7; i++) { const sa = -1.1 - i * .4 + R() * .2, sr = .5 + R() * .18; rock(Math.cos(sa) * sr, y, Math.sin(sa) * sr - .05, .16 + R() * .14) } rock(.05, y + .14, -.58, .2, "#9aa6a9");
  pond(.05, y + .05, .05, .3, .26); for (let i = 0; i < cnt(3); i++) { const a = R() * 6.28; rock(Math.cos(a) * .36, y, Math.sin(a) * .34, .04 + R() * .03) } tree("spruce", -.55, y, .5, .9, .22); tree("fir", .5, y, .55, .7, .19) }
function emptyLand(d) { pebbles(d.reach ? 4 : 8, .7); if (!d.reach) { rock(-.3, 0, .2, .1); rock(.35, 0, -.25, .07) } for (const p of scatter(d.reach ? 3 : 1, .6, .3)) tuft(p.x, 0, p.z, .6); if (d.reach) for (const p of scatter(3, .6, .3)) flower(p.x, 0, p.z, .8) }
function riverBank(d) { pebbles(5, .7); for (let i = 0; i < cnt(3); i++) { const a = R() * 6.28, r = .62 + R() * .1; rock(Math.cos(a) * r, 0, Math.sin(a) * r, .03 + R() * .03, pick(["#bfae86", "#a89a7a", "#c9b88c"], R)) }
  if (d.fall) for (let i = 0; i < cnt(6); i++) { const a = R() * 6.28, r = .3 + R() * .3; P(GT.ico0, Math.cos(a) * r, .1, Math.sin(a) * r, .035, .03, .035, cl("#f4fffb"), R() * 6, 0, 0, 0) } }

// where a level pill sits above the tile's ground: low, at the foot of the tile (the core puts it to the right and in front), so it stays with its tile whatever grows on it
const pillH = d => d.level ? .12 : .3;
// the cache: a tile's plants only depend on what it is, so identical tiles share one local batch (a few variants for variety), copied into the tile's mesh around its centre
const CACHE = new Map();
function build(d, variant, quality, dens) { const key = [d.code, d.kind, Math.min(d.level, 15), d.up, d.locked ? 1 : 0, d.river, d.reach, d.fall ? 1 : 0, variant, quality, dens.toFixed(2)].join("|"); let b = CACHE.get(key); if (b) return b;
  b = new Batch(0); INFO = b.info = {perch:null, pond:null}; CB = b; DET = dens; CG = quality === "high" ? GT.ico1 : GT.ico0; PT = quality === "high" ? GT.cone2 : GT.blade; LK = !!d.locked; SW = LK ? 0 : 1; SZ = d.level > 7 ? 1 + .25 * Math.min(8, d.level - 7) / 8 : 1;
  let seed = 1337 + variant * 977; for (let i = 0; i < key.length; i++) seed = (Math.imul(seed, 31) + key.charCodeAt(i)) | 0; R = rng(seed);
  quality3 = () => quality;
  if (d.code === "B") mountain(); else if (d.code === "T") spring();
  else if (d.river) riverBank(d); else if (d.level) { const L = d.level, ll = Math.min(L, 7); if (d.kind === "g") fillGreen(ll); else if (d.kind === "p") fillPrairie(L, d.up); else if (d.kind === "m") fillMarsh(L, d.up); else fillTrees(L, d.up);
    if (L >= 8) { rim(.86, .012, cl("#f2c14e")); if (L >= 12) rim(.8, .009, cl("#ffe9a8")) } } else emptyLand(d);
  CB = null; INFO = null; b.p = Float32Array.from(b.p); b.n = Float32Array.from(b.n); b.c = Float32Array.from(b.c); b.s = Float32Array.from(b.s);   // kept as typed arrays: a cached look is small
  CACHE.set(key, b); return b }
// what grows on a tile: the cached batch for its look, built around the tile's own origin (the core copies it into the tile, or keeps it as a mesh of its own while the tile springs up). The batch's info says where
// the tallest tree and the first pond are (an owl, a woodpecker, a duck and a frog use them). ctx.detail is the core's global thinning (1 is all of it).
function content(cl, d, ctx) { const dens = (ctx.quality === "high" ? 1 : ctx.quality === "med" ? .65 : .35) * (ctx.detail || 1); return build(d, cl.i % 3, ctx.quality, dens) }

// ---------- animals: one small animal on each tile by day and one by night, each a merged template (positions, normals, colours) that the core poses every frame; the swap follows the time of day.
// Placeholders, see Linear: which animal lives on what is a proposal (pairFor below).
const AB = {}, ANIMAL_SCALE = 2.2;   // placeholder: the animals are small, this makes them readable at the playing zoom
let WINGS = [];
function mk(name, lod, fn, scale) { const key = name + lod; if (AB[key]) return AB[key]; const b = new Batch(0); CB = b; INFO = null; DET = 1; CG = GT.ico1; LK = false; SW = 0; LOWPOLY = !lod; R = rng(name.length * 977 + 5); WINGS = []; fn(); CB = null; LOWPOLY = false;
  const nv = b.p.length / 3, wing = WINGS.length ? new Float32Array(nv) : null; for (const [a, z] of WINGS) for (let i = a; i < z; i++) wing[i] = 1;
  return AB[key] = {p:new Float32Array(b.p), n:new Float32Array(b.n), c:new Float32Array(b.c), wing, scale:(scale || 1) * ANIMAL_SCALE} }
const A = (geo, hex, x, y, z, sx, sy, sz, rx, ry, rz) => P(LOWPOLY && geo === "ico1" ? GT.ico0 : GT[geo], x, y, z, sx, sy, sz, cl(hex), ry, rx, rz, 0);
const W = (...a) => { const v0 = CB.p.length / 3; A(...a); WINGS.push([v0, CB.p.length / 3]) };   // a wing: the core flaps it
const ANI = {
  ladybug() { A("ico1", "#d93a2b", 0, .014, 0, .022, .014, .026); A("ico0", "#1a1a1a", 0, .012, .026, .01, .008, .01); A("ico0", "#111111", -.008, .027, -.004, .005, .003, .005); A("ico0", "#111111", .008, .027, .006, .005, .003, .005) },
  rabbit() { const c = "#c9b8a0"; A("ico1", c, 0, .045, 0, .045, .04, .07); A("ico1", c, 0, .075, .07, .03, .028, .032); A("cone2", c, -.012, .09, .068, .008, .055, .005, -.25, 0, -.12); A("cone2", c, .012, .09, .068, .008, .055, .005, -.25, 0, .12); A("ico0", "#ffffff", 0, .05, -.07, .017, .017, .017); A("ico1", "#b8a58c", -.027, .02, -.03, .014, .022, .04); A("ico1", "#b8a58c", .027, .02, -.03, .014, .022, .04) },
  hedgehog() { A("ico1", "#6b4a30", 0, .04, 0, .058, .042, .078); A("ico1", "#d9b48f", 0, .03, .07, .028, .025, .035); A("ico0", "#222", 0, .034, .1, .007, .007, .007); for (let i = 0; i < 18; i++) { const a = i * 2.4, rr = .025 + (i % 5) * .006; A("cone2", "#3d2b1c", Math.sin(a) * rr * 1.1, .065 + (i % 4) * .004, Math.cos(a) * rr * 1.6 - .01, .009, .034, .009, Math.cos(a) * .7, 0, -Math.sin(a) * .7) } },
  deer() { const c = "#b5733d"; A("ico1", c, 0, .17, 0, .058, .054, .12); A("ico1", "#e6d2b0", 0, .15, .01, .05, .04, .1); for (const [x, z] of [[-.035, .07], [.035, .07], [-.035, -.07], [.035, -.07]]) A("cyl", "#5a3a22", x, .04, z, .011, .13, .011); A("cone2", c, 0, .19, .1, .026, .12, .026, .75, 0, 0);
    A("ico1", c, 0, .29, .17, .03, .03, .05, .5); A("ico1", "#2b1d14", 0, .285, .215, .012, .012, .012); A("cone2", c, -.026, .305, .16, .008, .04, .005, .3, 0, -.6); A("cone2", c, .026, .305, .16, .008, .04, .005, .3, 0, .6); for (let i = 0; i < 8; i++) A("ico0", "#fff4e0", (((i * 7) % 9) - 4) * .012, .22, ((i * 5) % 9 - 4) * .02, .007, .004, .007) },
  squirrel() { A("ico1", "#a85f2c", 0, .04, 0, .022, .03, .042, .4); A("ico1", "#e8d2b0", 0, .036, .012, .016, .02, .03, .4); A("ico1", "#a85f2c", 0, .068, .034, .02, .02, .026); A("cone2", "#7a4520", -.01, .082, .03, .006, .02, .004); A("cone2", "#7a4520", .01, .082, .03, .006, .02, .004); A("ico1", "#b86f36", 0, .08, -.045, .02, .05, .026, -.3) },
  owl() { A("ico1", "#8a6a47", 0, .03, 0, .023, .032, .02); A("ico1", "#e2d3b2", 0, .026, .012, .014, .022, .008); A("ico1", "#6e5236", -.021, .03, -.003, .007, .026, .014); A("ico1", "#6e5236", .021, .03, -.003, .007, .026, .014); A("ico1", "#8a6a47", 0, .066, 0, .021, .018, .018); A("ico0", "#ffd23a", -.007, .068, .016, .006, .006, .003); A("ico0", "#ffd23a", .007, .068, .016, .006, .006, .003); A("ico0", "#111", -.007, .068, .019, .003, .003, .002); A("ico0", "#111", .007, .068, .019, .003, .003, .002) },
  fox() { A("ico1", "#d9772b", 0, .05, 0, .03, .034, .07); A("ico1", "#f4ece0", 0, .045, .03, .02, .022, .03); A("ico1", "#d9772b", 0, .085, .08, .028, .025, .035); A("cone2", "#d9772b", 0, .08, .1, .014, .04, .012, Math.PI / 2, 0, 0); A("ico0", "#111", 0, .08, .142, .005, .005, .005); A("cone2", "#d9772b", -.016, .1, .076, .01, .032, .006, 0, 0, .2); A("cone2", "#d9772b", .016, .1, .076, .01, .032, .006, 0, 0, -.2);
    for (const [x, z] of [[-.018, .04], [.018, .04], [-.018, -.04], [.018, -.04]]) A("cyl", "#2b1d14", x, 0, z, .007, .04, .007); A("ico1", "#d9772b", 0, .05, -.12, .022, .026, .06); A("ico1", "#ffffff", 0, .05, -.17, .018, .02, .025) },
  frog() { const c = "#5aa84a"; A("ico1", c, 0, .02, 0, .032, .022, .04); A("ico1", "#6ab858", 0, .03, .03, .022, .016, .02); for (const s of [-1, 1]) { A("ico0", "#e8d44a", -.014 * s, .048, .04, .01, .01, .01); A("ico0", "#111", -.014 * s, .05, .047, .004, .005, .004); A("ico1", c, -.032 * s, .014, -.018, .012, .01, .03, 0, .5 * s, 0) } },
  duck() { A("ico1", "#d9c9a8", 0, .018, 0, .032, .022, .05); A("ico1", "#8a6a47", 0, .026, -.005, .03, .014, .036); A("ico1", "#2f8a4a", 0, .05, .042, .018, .018, .02); A("ico1", "#ffffff", 0, .04, .035, .019, .004, .019); A("cone2", "#e9a23a", 0, .048, .06, .008, .026, .006, Math.PI / 2, 0, 0) },
  lizard() { A("ico1", "#7a8a4a", 0, .012, 0, .014, .01, .04); A("ico1", "#8a9a54", 0, .013, .045, .012, .009, .016); A("cone2", "#7a4a4a", 0, .01, -.035, .008, .075, .006, -Math.PI / 2, 0, 0); for (const s of [-1, 1]) { A("cyl", "#6a7a3e", .016 * s, 0, .022, .003, .012, .003, 0, 0, .6 * s); A("cyl", "#6a7a3e", .016 * s, 0, -.018, .003, .012, .003, 0, 0, .6 * s) } },
  snail() { A("ico1", "#e6d5b8", 0, .007, 0, .011, .008, .035); A("ico1", "#c98a4a", 0, .024, -.005, .02, .02, .02); A("ico1", "#8a5a2a", 0, .028, -.005, .014, .014, .014, .5) },
  butterfly() { A("cyl", "#2a2a2a", 0, .0, -.012, .003, .03, .003, Math.PI / 2, 0, 0); W("ico0", "#ff8a3d", -.025, .004, 0, .026, .004, .02, 0, 0, .3); W("ico0", "#ff8a3d", .025, .004, 0, .026, .004, .02, 0, 0, -.3) },
  bee() { A("ico1", "#f2c21a", 0, 0, 0, .011, .01, .018); A("ico1", "#1c1c1c", 0, 0, -.006, .0115, .0105, .005); W("ico0", "#eefcff", -.012, .01, 0, .014, .002, .008); W("ico0", "#eefcff", .012, .01, 0, .014, .002, .008) },
  moth() { A("cyl", "#6a5a48", 0, 0, -.01, .003, .026, .003, Math.PI / 2, 0, 0); W("ico0", "#d8cdb8", -.022, .004, 0, .024, .004, .018, 0, 0, .3); W("ico0", "#d8cdb8", .022, .004, 0, .024, .004, .018, 0, 0, -.3) },
  dragonfly() { A("cyl", "#2f9ae8", 0, 0, 0, .006, .11, .006, Math.PI / 2, 0, 0); A("ico0", "#2f9ae8", 0, 0, .06, .011, .011, .011); for (const z of [.02, .0]) { W("ico0", "#e9fbff", -.034, .004, z, .036, .002, .01); W("ico0", "#e9fbff", .034, .004, z, .036, .002, .01) } },
  bat() { A("ico1", "#2a2630", 0, 0, 0, .012, .01, .02); W("ico0", "#2a2630", -.03, 0, 0, .034, .002, .016, 0, 0, .25); W("ico0", "#2a2630", .03, 0, 0, .034, .002, .016, 0, 0, -.25) },
  woodpecker() { A("ico1", "#1d1d1f", 0, .03, 0, .011, .028, .011); A("ico1", "#efe9d8", 0, .03, .008, .008, .02, .006); A("ico0", "#1d1d1f", 0, .06, .002, .011, .011, .011); A("ico0", "#d62a2a", 0, .066, 0, .009, .006, .009); A("cone2", "#555", 0, .06, .011, .003, .022, .003, Math.PI / 2, 0, 0) }
};
const SCALE = {};   // a scale for one kind of animal, if it needs one (all are drawn at ANIMAL_SCALE)
// who lives on what: [by day, by night] (placeholders, see Linear)
function pairFor(d) { if (d.code === "B" || d.code === "T") return null; if (d.river) return null;
  if (!d.level) return d.reach ? ["butterfly", "moth"] : ["lizard", "hedgehog"];
  const L = d.level, ll = Math.min(L, 7);
  if (d.kind === "g") return ll >= 6 ? [["woodpecker", "squirrel"][ll - 6], "owl", "bat"] : [["ladybug", "rabbit", "butterfly", "deer", "squirrel"][ll - 1], ["moth", "hedgehog", "hedgehog", "fox", "owl"][ll - 1]];
  if (d.kind === "p") return [d.up === "meadow" ? "bee" : ll > 3 ? "butterfly" : "rabbit", ll > 4 ? "fox" : "moth"];
  if (d.kind === "m") return [d.up === "reed" ? "dragonfly" : "duck", "frog"];
  return L >= 6 ? ["squirrel", "owl", "bat"] : ["squirrel", "owl"] }
// an animal's template: lod 0 is the light one (round parts are 20 triangles), 1 the full one (80). It is built once, the first time it is asked for.
function animal(name, lod) { if (!ANI[name]) return null; return mk(name, lod ? 1 : 0, ANI[name], SCALE[name]) }
// how each kind moves (the core reads it each frame): r the radius of its walk round the tile's middle and s its speed along it, hop the height and hf the rate of its hops, fly the height of its flight and ff the
// rate of its wing beats. An owl, a woodpecker, a duck and a frog don't walk: they sit in a tree or on the pond. A proposal, see Linear.
const MOVE = {ladybug:{r:.4, s:.12}, rabbit:{r:.38, s:.3, hop:.05, hf:6}, hedgehog:{r:.42, s:.14}, deer:{r:.42, s:.13}, squirrel:{r:.45, s:.35, hop:.022, hf:9}, owl:{}, fox:{r:.4, s:.2}, frog:{}, duck:{},
  lizard:{r:.38, s:.2}, snail:{r:.35, s:.05}, butterfly:{r:.45, s:.8, fly:.28, ff:14}, bee:{r:.4, s:1.7, fly:.18, ff:60}, moth:{r:.45, s:.7, fly:.25, ff:16}, dragonfly:{r:.45, s:.9, fly:.35, ff:70}, woodpecker:{}, bat:{r:.9, s:1.1, fly:1.5, ff:22}};

F.art = {content, pillH, pairFor, animal, MOVE};
})();
