// Flowgrow 3D look, step 4 (LOU-311): the day and night. Loaded after flowgrow.look3d.js, which hands mount() the scene's objects and calls update() every frame.
//
// It is cosmetic only: it shows no clock and no countdown, and it never touches a rule, a score, a save or a tap. The cycle changes uniforms and a few colours each frame and never rebuilds a mesh.
// Dan, Nov 22: the clock is the default driver ("I'm not sure about the day/night driver (clock vs tied to the pile) and I'd like the clock as the default for now"); "progress" (the pile is the day) is an option.
//
// A day is look3d.dayLength seconds (240). Its phase t runs 0 to 1: dawn 0.00 to 0.12, day 0.12 to 0.45, golden hour 0.45 to 0.58, dusk 0.58 to 0.68, night 0.68 to 0.92, pre-dawn 0.92 to 1.00, and the run
// starts at t = 0.20 (morning). Every colour comes from the palette table (the build spec's starting values, tuned by eye) and blends with a smoothstep between the moments, so nothing pops.
//
// The sky is never on screen at the fixed angle (the camera looks 34 degrees down at the sea), so the sun, moon and stars show on the water: the moon's glitter and mirrored stars (in the sea shader), and
// the sea, horizon, light and sky tint. The sky shader below still draws the discs and the stars, for a wider window or a different angle in the config.
(() => {
"use strict";
const F = window.Flowgrow3D, T = window.THREE, U = F.util, {clamp, sstep, rng} = U, D2R = Math.PI / 180;

// ---------- the palette: [sky top, horizon, sea shallow, sea deep, foam, main light colour, main light intensity, hemisphere sky, hemisphere ground, hemisphere intensity, clouds, exposure].
// The main light is the sun by day and the moon at night (one shadow-casting light, so one shadow map). Golden is the demo's gold; the others are the spec's table.
const RAW = {
  dawn:   {top:"#6f8fc4", hor:"#ffc9a8", shallow:"#86d9c0", deep:"#2f8f8d", foam:"#fff1e4", sun:"#ffd9b8", si:1.0, hs:"#b9cdee", hg:"#7a8f5a", hi:.55, cloud:"#ffd9c4", exp:1.0},
  day:    {top:"#8ec9e8", hor:"#eaf6ee", shallow:"#7fe0bd", deep:"#2b9a8e", foam:"#f4fffb", sun:"#fff1d6", si:1.5, hs:"#cfe8ff", hg:"#7f9a55", hi:.72, cloud:"#ffffff", exp:.98},
  golden: {top:"#5f95bd", hor:"#ffd6a2", shallow:"#78d9b0", deep:"#2a9088", foam:"#fff3df", sun:"#ffc88a", si:1.7, hs:"#ffe2c2", hg:"#8d8f55", hi:.6, cloud:"#ffd7ae", exp:1.0},
  dusk:   {top:"#4a5a96", hor:"#f08a78", shallow:"#4f9fa8", deep:"#1f5f7a", foam:"#f0dcd8", sun:"#ff9f7a", si:.8, hs:"#8a8fc4", hg:"#5d6a50", hi:.45, cloud:"#d79ba2", exp:1.05},
  night:  {top:"#0b1736", hor:"#1d3a5e", shallow:"#2c6f86", deep:"#0d3350", foam:"#9ab6cc", sun:"#a9c4ff", si:.22, hs:"#3a4f86", hg:"#2c452a", hi:.42, cloud:"#6b7fa3", exp:1.18}   // night: the spec's values, with the ground colour a greener and the hemisphere a little stronger and the exposure a little higher (tuned by eye) so the board stays green and readable
};
const PAL = {}; for (const k in RAW) { const r = RAW[k], c = {}; for (const f in r) c[f] = typeof r[f] === "string" ? new T.Color(r[f]) : r[f]; PAL[k] = c }
// the moments the palette is pinned to, in time: dawn at .06, day from .20 to .37, golden at .515, dusk at .63, night from .74 to .90, and dawn again at 1.06 (.06 the next morning)
const KEYS = [[.06, "dawn"], [.20, "day"], [.37, "day"], [.515, "golden"], [.63, "dusk"], [.74, "night"], [.90, "night"], [1.06, "dawn"]];
const PHASES = [[0, "dawn"], [.12, "day"], [.45, "golden"], [.58, "dusk"], [.68, "night"], [.92, "predawn"]];
const HOLD = {day:.30, gold:.515, golden:.515, night:.80, dawn:.06, dusk:.63};   // where a held moment sits on the clock
const NOTE = {cycle:"Auto", day:"Day", gold:"Golden hour", night:"Night", pause:"Paused", progress:"Follows the pile"}, MODES = ["cycle", "day", "gold", "night", "pause"];

function mount(X) {
  const {scene, renderer, C3, QS, dayState, seaU, riverMat, sky, cloudMat, clouds, sun, hemi, lab, midX, midZ, uWind, uGlow, uTime, pointScale} = X;
  const cur = {}; for (const f of ["top", "hor", "shallow", "deep", "foam", "sun", "hs", "hg", "cloud"]) cur[f] = new T.Color();
  const mem = X.mem || {get: () => null, set() {}};
  const dayLength = Math.max(20, +C3.dayLength || 240), reduced = () => !!X.reduced();

  // ---------- the driver: a mode, and the time t (0 to 1). cycle: t runs. progress: t follows the pile (morning at the first tile, night when the pile is empty). A held moment (day, gold, night, dawn, dusk or a number)
  // is glided to (a quick time-lapse, forwards, with no pop) and held. pause holds where it is.
  let mode = "cycle", t = +C3.startPhase || .2, goal = null, applied = "", lastNight = -1;
  const holdT = m => typeof m === "number" ? m : HOLD[m];
  function setMode(m, snap) { if (typeof m === "string" && m.startsWith("fixed:")) m = m.slice(6); if (m === "golden") m = "gold";
    if (!(m === "cycle" || m === "progress" || m === "pause" || typeof m === "number" || HOLD[m] != null)) return false;
    mode = m; goal = m === "cycle" || m === "pause" || m === "progress" ? null : (((holdT(m) % 1) + 1) % 1);
    if (snap && goal != null) { t = goal; goal = null } if (snap && m === "progress") t = progressT(); applied = ""; return true }
  const progressT = () => { const p = X.progress(); return p == null ? t : .2 + .6 * clamp(p, 0, 1) };
  // the first mode: ?time= beats the Menu's remembered choice, which beats the config; reduced motion and the low tier start in day
  { const q = QS.get("time"), m0 = mem.get("time3d"), cfgMode = C3.dayNight || "cycle"; let first = cfgMode, explicit = false;
    if (q != null) { const n = parseFloat(q); first = q !== "" && isFinite(n) && /^[0-9.]+$/.test(q) ? n : q; explicit = true } else if (m0) first = m0.startsWith("n:") ? parseFloat(m0.slice(2)) : m0;
    if (!explicit && !m0 && (reduced() || X.quality() === "low") && (first === "cycle" || first === "progress")) first = "day";
    if (!setMode(first, true)) setMode("cycle", true) }

  // ---------- the colours, light and sky at time t
  const lerpPal = (a, b, u, out) => { for (const f of ["top", "hor", "shallow", "deep", "foam", "sun", "hs", "hg", "cloud"]) out[f].copy(a[f]).lerp(b[f], u); for (const f of ["si", "hi", "exp"]) out[f] = a[f] + (b[f] - a[f]) * u };
  const phaseOf = x => { let n = PHASES[0][1]; for (const [a, p] of PHASES) if (x >= a) n = p; return n };
  const sunElev = x => x < .28 ? 52 * Math.sin(Math.PI / 2 * Math.pow(x / .28, 1.2)) * D2R : x < .66 ? 52 * Math.cos(Math.PI / 2 * Math.pow((x - .28) / .38, .55)) * D2R : -20 * Math.sin(Math.PI * clamp((x - .66) / .34, 0, 1)) * D2R;
  const sunAz = x => (120 + 48 * clamp(x / .66, 0, 1)) * D2R, vec = (e, a, v) => v.set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)).normalize();
  const E_LOW = 15 * D2R, E_NIGHT = 44 * D2R, A_NIGHT = 150 * D2R, LIGHT_R = 27;
  const sunV = new T.Vector3(), moonV = new T.Vector3(), lightV = new T.Vector3();
  function apply() { const tt = t < .06 ? t + 1 : t; let i = 0; while (i < KEYS.length - 2 && tt >= KEYS[i + 1][0]) i++;
    const A = KEYS[i], B2 = KEYS[i + 1], u = A[1] === B2[1] ? 0 : sstep(0, 1, (tt - A[0]) / (B2[0] - A[0])); lerpPal(PAL[A[1]], PAL[B2[1]], u, cur);
    const night = sstep(.6, .74, tt) * (1 - sstep(.9, 1.04, tt)), dusk = sstep(.52, .62, tt) * (1 - sstep(.64, .74, tt)), dawn = tt > .5 ? sstep(.92, 1.06, tt) : 1 - sstep(.06, .18, tt);
    dayState.t = t; dayState.phase = phaseOf(t); dayState.night01 = night; dayState.dusk01 = dusk; dayState.dawn01 = dawn; dayState.mode = typeof mode === "number" ? "fixed" : mode;
    // the sun's true direction (it sets), the moon's (an arc in front of the camera, where its glitter shows on the sea behind the island), and the main light: the sun by day, then, as the sun goes, the
    // same general direction from a higher angle for the moon, so the lit sides stay the same and shadows never jump
    const eS = sunElev(t), aS = sunAz(t); vec(eS, aS, sunV); dayState.sunDir.copy(sunV);
    const pn = clamp((tt - .62) / .42, 0, 1); vec((18 + 26 * Math.sin(Math.PI * pn)) * D2R, (205 + 55 * pn) * D2R, moonV); dayState.moonDir.copy(moonV);
    vec(Math.max(E_LOW, eS) * (1 - night) + E_NIGHT * night, aS * (1 - night) + A_NIGHT * night, lightV);
    sun.position.set(midX + lightV.x * LIGHT_R, lightV.y * LIGHT_R, midZ + lightV.z * LIGHT_R); sun.color.copy(cur.sun); sun.intensity = cur.si;
    hemi.color.copy(cur.hs); hemi.groundColor.copy(cur.hg); hemi.intensity = cur.hi; renderer.toneMappingExposure = cur.exp; renderer.setClearColor(cur.hor);
    seaU.shallow.value.copy(cur.shallow); seaU.deep.value.copy(cur.deep); seaU.horizon.value.copy(cur.hor); seaU.foamC.value.copy(cur.foam); seaU.night.value = night; seaU.moonDir.value.copy(moonV);
    riverMat.uniforms.night.value = night; uWind.value = 1 - .6 * night; uGlow.value = .55 * night;
    skyU.top.value.copy(cur.top); skyU.hor.value.copy(cur.hor); skyU.sunDir.value.copy(sunV); skyU.sunC.value.copy(cur.sun); skyU.moonDir.value.copy(moonV); skyU.night.value = night;
    cloudMat.color.copy(cur.cloud); cloudMat.emissive.copy(cur.cloud).multiplyScalar(.32); if (clouds[1]) clouds[1].visible = night < .55;
    if (night !== lastNight) { const n = night > .5; if (lab.classList.contains("night") !== n) lab.classList.toggle("night", n); lastNight = night }
    applied = t.toFixed(4) + "|" + X.quality() }

  // ---------- the sky: gradient, sun and moon discs with a halo, and stars (never on screen at the fixed angle, see the top of this file; off when the camera can't see it)
  const skyU = {top:{value:new T.Color(RAW.day.top)}, hor:{value:new T.Color(RAW.day.hor)}, sunDir:{value:new T.Vector3()}, sunC:{value:new T.Color(RAW.day.sun)}, moonDir:{value:new T.Vector3()}, night:{value:0}, t:uTime};
  sky.material.dispose(); sky.material = new T.ShaderMaterial({uniforms:skyU, side:T.BackSide, depthWrite:false, vertexShader:"varying vec3 vD;void main(){vD=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader:"uniform vec3 top;uniform vec3 hor;uniform vec3 sunDir;uniform vec3 sunC;uniform vec3 moonDir;uniform float night;uniform float t;varying vec3 vD;float hs(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}" +
      "void main(){vec3 d=normalize(vD);float h=clamp(d.y,0.,1.);vec3 col=mix(hor,top,pow(h,.5));float s=max(dot(d,normalize(sunDir)),0.);col+=sunC*(smoothstep(.9995,.9999,s)*1.5+pow(s,60.)*.5+pow(s,7.)*.12);" +
      "float m=max(dot(d,normalize(moonDir)),0.);col+=vec3(.8,.88,1.)*(smoothstep(.9996,.9999,m)*1.2+pow(m,90.)*.35)*night;" +
      "if(night>.02&&d.y>.02){vec2 q=d.xz/(d.y+.25)*60.;float hh=hs(floor(q));float tw=.6+.4*sin(t*2.+hh*50.);col+=vec3(.9,.95,1.)*step(.975,hh)*smoothstep(.5,.05,length(fract(q)-.5))*tw*night*smoothstep(.02,.25,d.y);}gl_FragColor=vec4(col,1.);}"});
  sky.visible = Math.PI / 2 - C3.polar <= C3.fov * D2R / 2 + .02;   // only when the top of the picture can reach the horizon

  // ---------- fireflies: points that wander over the green, wet and wooded tiles and blink. By day none, at dusk some, at night three times as many; all of it in the vertex shader (no work per frame on the CPU).
  const ffU = {uT:uTime, uNight:{value:0}, uScale:pointScale};
  const ffMat = new T.ShaderMaterial({uniforms:ffU, transparent:true, depthWrite:false, blending:T.AdditiveBlending,
    vertexShader:"attribute float aPh;attribute float aRank;attribute float aR;attribute float aSz;uniform float uT;uniform float uNight;uniform float uScale;varying float vA;" +
      "void main(){vec3 p=position+vec3(sin(uT*.6+aPh*3.)*aR,sin(uT*.9+aPh*5.)*aR*.45,cos(uT*.5+aPh*2.)*aR);float on=smoothstep(aRank*.7,aRank*.7+.25,uNight);float b=.35+.65*pow(.5+.5*sin(uT*(1.1+aPh*.15)+aPh*9.),2.);vA=on*b;" +
      "vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=aSz*uScale/-mv.z*(.6+.4*b)*step(.01,on);}",
    fragmentShader:"varying float vA;void main(){float r=length(gl_PointCoord-.5)*2.;float a=smoothstep(1.,0.,r);a*=a;gl_FragColor=vec4(vec3(.8,1.,.45)*1.7,a*vA);}"});
  const ffGeo = new T.BufferGeometry(), ff = new T.Points(ffGeo, ffMat); ff.frustumCulled = false; ff.renderOrder = 6; ff.visible = false; scene.add(ff);
  let spots = [];
  function buildFireflies() { const q = X.quality(), cap = q === "high" ? 420 : q === "med" ? 240 : 0; ffGeo.dispose(); if (!cap || !spots.length) { ff.visible = false; return }
    const r = rng(77), pos = [], ph = [], rk = [], rr = [], sz = [], mult = q === "high" ? 2 : 1; let total = 0; for (const s of spots) total += s.n * mult; const k = Math.min(1, cap / Math.max(1, total));
    for (const s of spots) { const n = Math.max(1, Math.round(s.n * mult * k)); for (let i = 0; i < n; i++) { const a = r() * 6.283, rad = Math.sqrt(r()) * .62; pos.push(s.x + Math.cos(a) * rad, s.y + .12 + r() * .6, s.z + Math.sin(a) * rad); ph.push(r() * 6.283); rk.push(r()); rr.push(.08 + r() * .22); sz.push(.075 + r() * .06) } }
    ffGeo.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); ffGeo.setAttribute("aPh", new T.Float32BufferAttribute(ph, 1)); ffGeo.setAttribute("aRank", new T.Float32BufferAttribute(rk, 1)); ffGeo.setAttribute("aR", new T.Float32BufferAttribute(rr, 1)); ffGeo.setAttribute("aSz", new T.Float32BufferAttribute(sz, 1)); ff.visible = true }

  // ---------- every frame: advance the clock, then write the colours, only when the time (or the quality) changed
  function update(dt) { const still = reduced();
    if (mode === "cycle") t = (t + dt / dayLength) % 1;
    else if (mode === "progress") { const g = progressT(); let d = g - t; if (Math.abs(d) < 1e-4) t = g; else t += Math.sign(d) * Math.min(Math.abs(d), (still ? 9 : .03) * dt) }
    else if (goal != null) { let d = ((goal - t) % 1 + 1) % 1; if (still || d < 1e-4) { t = goal; goal = null } else { const step = Math.min(d, .22 * dt); t = (t + step) % 1; if (step >= d) goal = null } }   // forwards through the day, like a time-lapse
    let ch = false; if (applied !== t.toFixed(4) + "|" + X.quality()) { apply(); ch = true } ffU.uNight.value = dayState.night01; return ch }   // true when the colours changed (a frame is needed)

  function setSpots(list) { spots = list; buildFireflies() }
  function setQuality() { applied = ""; buildFireflies() }
  const noteOf = () => NOTE[typeof mode === "number" ? "pause" : mode] || "Auto";
  const api = {update, setSpots, setQuality,
    // the Menu's control: Auto, Day, Golden hour, Night, Pause, round again. No clock, no scrubber.
    cycle() { const i = Math.max(0, MODES.indexOf(mode === "pause" || typeof mode === "number" ? "pause" : mode)), next = MODES[(i + 1) % MODES.length]; if (next === "pause") { mode = "pause"; goal = null } else setMode(next, false); mem.set("time3d", next); return api.note() },
    note() { const i = Math.max(0, MODES.indexOf(mode === "pause" || typeof mode === "number" ? "pause" : mode)); return noteOf() + ". Tap for " + NOTE[MODES[(i + 1) % MODES.length]] },
    // for tests: a mode name or a number (held at once)
    setTime(v) { setMode(v, true); applied = ""; apply(); return api.getTime() },
    getTime() { return {t, phase:dayState.phase, mode:dayState.mode, night:dayState.night01, dusk:dayState.dusk01, dawn:dayState.dawn01} },
    dispose() { scene.remove(ff); ffGeo.dispose(); ffMat.dispose() }};
  apply(); return api;
}

F.sky = {mount};
})();
