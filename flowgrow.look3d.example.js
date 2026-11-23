// Flowgrow 3D look: example islands, for looking at (LOU-311). Dan, Nov 22: "give me an example map where everything is very filled out and the ecosystem is rich".
// ?look=3d&example=rich draws this island in place of the run's own state. It is loaded only when ?example= is in the address. Nothing here touches the game: no move, no save, no score, no pile, and a tap
// only says what the island is. The look reads these fields as it reads the game's: h the levels, hb the kinds ("p", "m", "t"; green has none), hf the upgrades, r the river tiles (their level and the tile each
// one flows from) and lk the locked tiles.
(() => {
"use strict";
const F = window.Flowgrow3D, fr = v => v - Math.floor(v), hs = (a, b) => fr(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);

// The rich island: a river from the source in three branches (its levels rise downstream, so it widens), marsh on its banks, prairie in belts away from it, forest on the outside and round the mountains, every free land
// cell grown, four old giants (levels 9 to 12, with the gold rim), an upgrade on every prairie and tree habitat that has reached level 4 (a marsh one is a reed bed), and three tiles frozen by a lock.
function rich(X) { const {cfg, W, H, step} = X, map = cfg.map, k = (c, r) => c + "," + r, h = {}, hb = {}, hf = {}, rv = {}, lk = {}, inb = p => p[0] >= 0 && p[1] >= 0 && p[0] < W && p[1] < H;
  let src = null; for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (map[r][c] === "T") src = [c, r]; if (!src) src = [W >> 1, H >> 1];
  // the river: each branch is a run of steps from the source (0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE) and the level of each tile; a level never falls downstream
  rv[k(src[0], src[1])] = {l:3, from:null};
  for (const br of [{d:[0, 5, 0, 5, 0, 5, 0, 5], l:[3, 3, 4, 4, 5, 5, 6, 6]}, {d:[1, 1, 2, 1], l:[3, 3, 4, 4]}, {d:[4, 5, 4, 4], l:[3, 4, 4, 5]}]) { let p = src, from = k(src[0], src[1]);
    for (let i = 0; i < br.d.length; i++) { p = step(p, br.d[i]); if (!inb(p) || map[p[1]][p[0]] === "B") break; const key = k(p[0], p[1]); if (key in rv) { from = key; continue } rv[key] = {l:br.l[i], from}; from = key } }
  // how far each cell is from the river and from a mountain, in steps (a breadth-first walk over the six neighbours)
  const dist = starts => { const d = {}, q = []; for (const s of starts) { d[s] = 0; q.push(s) }
    while (q.length) { const s = q.shift(), [c, r] = s.split(",").map(Number); for (let i = 0; i < 6; i++) { const p = step([c, r], i), key = k(p[0], p[1]); if (!inb(p) || key in d) continue; d[key] = d[s] + 1; q.push(key) } } return d };
  const mtn = []; for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (map[r][c] === "B") mtn.push(k(c, r));
  const dr = dist(Object.keys(rv)), dm = mtn.length ? dist(mtn) : {}, giants = {"5,3":12, "8,6":10, "3,3":9, "9,4":11};
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const key = k(c, r); if (map[r][c] !== "_" || key in rv) continue;
    const a = hs(c, r), b = hs(c + 9.1, r - 4.3), d1 = dr[key] == null ? 9 : dr[key], d2 = dm[key] == null ? 9 : dm[key];
    // marsh must touch the river; forest round the mountains; prairie and green in the middle; forest again on the outside
    const kind = d1 === 1 && a < .82 ? "m" : d2 === 1 && a < .75 ? "t" : d1 <= 3 ? (a < .55 ? "p" : a < .8 ? "g" : "t") : (a < .5 ? "t" : a < .75 ? "g" : "p");
    let l = Math.round((d1 === 1 ? 5.2 : d1 === 2 ? 4.4 : d1 === 3 ? 3.8 : 4.6) + (b - .5) * 4.2); l = Math.max(1, Math.min(8, l)); if (giants[key]) l = giants[key];
    h[key] = l; if (kind !== "g") hb[key] = kind;
    if (l >= 4 && kind === "p") hf[key] = hs(c + 3, r + 1) < .5 ? "steppe" : "meadow"; if (l >= 4 && kind === "t") hf[key] = hs(c - 2, r + 7) < .5 ? "roots" : "pine" }
  for (const key of ["4,2", "8,2", "7,7"]) if (h[key] >= 3) lk[key] = 1;
  return {h, hb, hf, r:rv, lk} }

F.example = {rich};
})();
