#!/usr/bin/env node
// The endgame island (LOU-319; Dan, Nov 23: "an example of a finished very good map ... a statically generated map but uses real game play to generate"). A developer tool: it is not part of the game and
// nothing here is loaded by a page.
//
// /endgame/ shows a finished, very good island without playing it. The island is static (the same one every time, nothing random when the page opens) and it is made by real play: a run that
// tools/flowgrow-search.mjs found by playing the game's own rules (flowgrow.config.js and flowgrow.js are loaded here exactly as the simulator loads them). A run is its seed and its moves, so this tool keeps those in
// endgame/run.js and the page replays them through the rules: the island is built by the game and never drawn by hand.
//
//   node tools/flowgrow-endgame.mjs run.json [more.json ...]   say what each saved run's island is made of (a run file is what flowgrow-search.mjs saves with --out)
//   node tools/flowgrow-endgame.mjs --use run.json             make the endgame island from that run: write endgame/run.js, and endgame/index.html from play/index.html
//   node tools/flowgrow-endgame.mjs --check                    say whether endgame/ is up to date (the simulator's rule checks run this): the page is what this tool writes from play/index.html, and the run
//                                                              still replays, under the game's rules as they are now, to the score it was saved with
//
// To make a new endgame island (after a rule change, or to try another run):
//   node tools/flowgrow-search.mjs --workers 10 --seconds 300 --seed 495454692 --out best.json     (any seed: 5 minutes on 10 processes finds a run of about 1,100 to 1,200 points)
//   node tools/flowgrow-endgame.mjs best.json other.json                                            (compare the islands)
//   node tools/flowgrow-endgame.mjs --use best.json
// No packages: plain Node 18 or newer.
import fs from "fs"; import path from "path"; import {fileURLToPath} from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const die = msg => { console.error(msg); process.exit(1) };
const window = {FLOWGROW_SIM: true};
for (const f of ["flowgrow.config.js", "flowgrow.js"]) new Function("window", fs.readFileSync(path.join(ROOT, f), "utf8"))(window);
const R = window.Flowgrow.rules, base = window.FLOWGROW, CFG = R.tidy(base, base).cfg, RK = R.rulesKey(CFG);
const RUN_JS = path.join(ROOT, "endgame/run.js"), PAGE = path.join(ROOT, "endgame/index.html"), PLAY = path.join(ROOT, "play/index.html");

// ---------- what an island is made of
const KIND = {"": "green", p: "prairie", m: "marsh", t: "trees"};
function describe(S) {
  const kinds = {green: 0, prairie: 0, marsh: 0, trees: 0}, levels = {}, ups = {};
  for (const k of Object.keys(S.h)) { kinds[KIND[S.hb[k] || ""]]++; levels[S.h[k]] = (levels[S.h[k]] || 0) + 1; if (S.hf[k]) ups[S.hf[k]] = (ups[S.hf[k]] || 0) + 1 }
  const rivers = Object.keys(S.r).length;
  let free = 0, total = 0; for (let y = 0; y < CFG.map.length; y++) for (let x = 0; x < CFG.map[0].length; x++) if (R.codeAt(CFG, [x, y]) !== "B") { total++; if (!(x + "," + y in S.h) && !(x + "," + y in S.r)) free++ }
  return {score: S.score, top: S.top, moves: S.moves.length, locks: S.lockUsed, habitats: Object.keys(S.h).length, rivers, kinds, levels, ups, locked: Object.keys(S.lk).length, empty: free, land: total, filled: Math.round(100 * (total - free) / total), over: S.over} }
const line = d => `${d.score} points · top level ${d.top} · ${d.moves} moves · ${d.locks} locks · ${d.habitats} habitats + ${d.rivers} river tiles on ${d.land} land cells (${d.filled}% filled, ${d.empty} empty)`
  + `\n   kinds: ${Object.entries(d.kinds).map(([k, n]) => k + " " + n).join(" · ")}\n   levels: ${Object.keys(d.levels).sort((a, b) => a - b).map(l => "L" + l + " " + d.levels[l]).join(" · ")}\n   upgrades: ${Object.keys(d.ups).length ? Object.entries(d.ups).map(([k, n]) => k + " " + n).join(" · ") : "none"} · locked tiles ${d.locked}`;

// A saved run (from flowgrow-search.mjs) replayed under the game's rules as they are now. Runs found under other settings (run.over) don't count: the endgame island is the usual game.
function replayFile(file) { let run; try { run = JSON.parse(fs.readFileSync(file, "utf8")) } catch (e) { die(`Can't read ${file}: ${e.message}`) }
  if (run.over && Object.keys(run.over).length) die(`${file} was found with changed settings (${JSON.stringify(run.over)}): the endgame island is the game as it is, so make the run without key=value settings.`);
  let S; try { S = R.replay(CFG, run.seed, run.moves) } catch (e) { die(`${file} doesn't replay under the game's rules now: ${e.message}\nMake it again with tools/flowgrow-search.mjs.`) }
  if (!S.over) die(`${file} is not a finished run.`); return {run, S} }

// ---------- the page: play/index.html with the title, the card, the sheet and the menu of a finished island. Line endings are whatever the play page has.
function pageFor(play) {
  const eol = play.includes("\r\n") ? "\r\n" : "\n", L = s => s.split("\n").join(eol), must = (s, a, b) => { if (!s.includes(a)) throw new Error("flowgrow-endgame: play/index.html has no " + a.slice(0, 80)); return s.replace(a, () => b) };
  let s = play;
  s = must(s, "<title>Flowgrow</title>", "<title>Flowgrow · Endgame</title>");
  s = must(s, '<meta name="description" content="Flowgrow: grow an island from your river. Place tiles, combine the same level, and let the river reach more land.">', '<meta name="description" content="A finished Flowgrow island: what a very good run looks like, found by real play of the game\'s own rules.">');
  s = s.replace(/<!-- THE PLAY PAGE[\s\S]*?-->/, () => L(`<!-- THE ENDGAME PAGE (LOU-319): a finished, very good island to look at without playing. It is written by tools/flowgrow-endgame.mjs from play/index.html (so it never drifts from the play page's markup) and shows the static run in
     endgame/run.js, which the page replays through the game's own rules. It opens on the whole island in the 3D look (?look=simple is the same island with no graphics, ?look=painted the painted one). The pile, Undo and the lock
     card are in the markup only because the page's script expects them; the endgame styles hide them. It keeps its own saved keys and never touches the play page's run. -->`));
  s = must(s, '<div class="app fg" id="app">', '<div class="app fg endgame" id="app">');
  s = must(s, '    <div class="fgcarry" id="carry"', L(`    <div class="egcard" id="egCard" role="region" aria-label="About this island">
      <span><i class="egtag">Endgame example</i><b id="egT"></b><small id="egS"></small></span>
      <div class="egrow"><button type="button" class="egplay" id="egPlay" onclick="location.href='../play/'">Play your own</button><button type="button" id="egMore">Details</button></div>
    </div>
    <div class="fgcarry" id="carry"`));
  s = must(s, '<button type="button" id="menuBtn"', L(`<button type="button" id="lockTog" class="fgg" aria-label="Hide the locks" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></button>
      <button type="button" id="menuBtn"`));
  s = must(s, '<div class="dname">Flowgrow</div>', '<div class="dname">Flowgrow · Endgame example</div>');
  s = must(s, '<h2 id="winTitle">Every tile is placed</h2>', '<h2 id="winTitle">A finished island</h2>');
  s = must(s, '        <ul id="wGoals"></ul>', L(`        <ul id="wGoals"></ul>
        <p class="egmade" id="egMade"></p>`));
  s = must(s, '<button type="button" class="dnext" id="again"><b>Play again</b></button>', '<button type="button" class="dnext" id="again"><b>Play your own island</b></button>');
  s = must(s, '<div class="dlinks"><button type="button" id="copyLog">Copy run log</button></div>', '<div class="dlinks"><button type="button" id="copyLog">Copy run log</button><button type="button" id="egBack">Back to the island</button></div>');
  s = must(s, '<div class="mhead"><b>Flowgrow</b><span id="mSeed"></span></div>', '<div class="mhead"><b>Flowgrow · Endgame</b><span id="mSeed"></span></div>');
  s = must(s, '<p class="fghow">Place tiles near your river. Two tiles of the same level make the next level. River tiles reach more land.</p>', '<p class="fghow">A finished island: the result of a very good run, made by real play of the game\'s own rules. Drag to look around and pinch to zoom. Tap a tile to see what it is. A padlock is a locked tile.</p>');
  s = must(s, '<p class="fghow" id="howLock">', '<p class="fghow" id="howLock" hidden>');
  const mrow = (m, svg, title, note) => `<button type="button" class="mrow" data-m="${m}"><i class="mico"><svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg></i><span>${title}<small${note.id ? ` id="${note.id}"` : ""}>${note.text || ""}</small></span></button>`;
  const newRow = /\r?\n    <button type="button" class="mrow rust" data-m="new">[\s\S]*?<\/button>/;
  if (!newRow.test(s)) throw new Error("flowgrow-endgame: play/index.html has no New run row");
  s = s.replace(newRow, () => L("\n    " + [
    mrow("look", '<circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/>', "Look", {id: "lookNote", text: "3D"}),
    mrow("runcopy", '<path d="M8 4h9v14H8z"/><path d="M5 8v12h9"/>', "Copy run", {text: "Seed and moves, as text"}),
    mrow("totest", '<path d="M10 3h4M11 3v6l-5 9a2 2 0 0 0 2 3h8a2 2 0 0 0 2-3l-5-9V3"/>', "Open in the test build", {text: "The same island, no graphics"}),
    mrow("toplay", '<path d="M8 5l11 7-11 7z"/>', "Play your own island", {text: "A new run in the game"})].join("\n    ")));
  s = must(s, 'window.FLOWGROW_PAGE = "play";', 'window.FLOWGROW_PAGE = "endgame";');
  s = must(s, '<script src="../flowgrow.js"></script>', '<script src="run.js"></script>' + eol + '<script src="../flowgrow.js"></script>');
  return s }

// ---------- endgame/run.js: the static run, as a script the page loads (window.FLOWGROW_ENDGAME)
function runJs(run, S, found, eol = "\r\n") {
  const rows = []; for (let i = 0; i < run.moves.length; i += 6) rows.push("    " + run.moves.slice(i, i + 6).map(m => JSON.stringify(m)).join(", "));
  const head = {v: 1, rules: RK, seed: run.seed, score: S.score, top: S.top, locks: S.lockUsed, moveCount: run.moves.length, found};
  const lines = ["// Flowgrow endgame island (LOU-319). Written by tools/flowgrow-endgame.mjs: do not edit by hand.",
    "// A run that tools/flowgrow-search.mjs found by playing the game's own rules, kept as its seed and its moves. /endgame/ replays them through flowgrow.js, so the island is built by the game and never drawn by hand.",
    "// The score, the top level and the rules key are what the run was when it was made: tools/flowgrow-endgame.mjs --check (and the simulator's rule checks) fail if the game's rules no longer replay it to the same score.",
    "window.FLOWGROW_ENDGAME = {", "  " + JSON.stringify(head).slice(1, -1).replace(/,"moveCount"/, ",\n  \"moveCount\"").replace(/,"found"/, ",\n  \"found\"") + ",", "  \"moves\": [", rows.join("," + "\n"), "  ]", "};", ""];
  return lines.join("\n").split("\n").join(eol) }
const loadRunJs = () => { const w = {}; new Function("window", fs.readFileSync(RUN_JS, "utf8"))(w); return w.FLOWGROW_ENDGAME };

// ---------- the three jobs
const args = process.argv.slice(2);
if (args.includes("--check")) {
  const bad = []; let d = null;
  try { const want = pageFor(fs.readFileSync(PLAY, "utf8")); if (fs.readFileSync(PAGE, "utf8") !== want) bad.push("endgame/index.html is not what this tool writes from play/index.html (run: node tools/flowgrow-endgame.mjs --use <run.json>, or --page)") } catch (e) { bad.push("endgame/index.html: " + e.message) }
  try { const E = loadRunJs(); if (!E || !Array.isArray(E.moves)) bad.push("endgame/run.js has no run");
    else { if (E.rules !== RK) bad.push(`endgame/run.js was made under other rules (${E.rules}, the game is ${RK})`);
      try { const S = R.replay(CFG, E.seed, E.moves); d = describe(S); if (!S.over) bad.push("the endgame run is not finished"); if (S.score !== E.score) bad.push(`the endgame run replays to ${S.score}, not ${E.score}`); if (S.top !== E.top || S.lockUsed !== E.locks || E.moves.length !== E.moveCount) bad.push("the endgame run's top level, locks or move count changed") }
      catch (e) { bad.push("the endgame run doesn't replay under the game's rules now: " + e.message) } } } catch (e) { bad.push("endgame/run.js: " + e.message) }
  if (bad.length) { console.error("endgame: " + bad.join("\n  ") + "\nMake the island again: node tools/flowgrow-search.mjs --workers 10 --seconds 300 --out best.json, then node tools/flowgrow-endgame.mjs --use best.json"); process.exit(1) }
  console.log("endgame is up to date: " + line(d).split("\n")[0]); process.exit(0) }
if (args.includes("--page")) { fs.writeFileSync(PAGE, pageFor(fs.readFileSync(PLAY, "utf8"))); console.log("wrote endgame/index.html from play/index.html"); process.exit(0) }
const useAt = args.indexOf("--use");
if (useAt >= 0) { const file = args[useAt + 1]; if (!file) die("--use needs a run file"); const {run, S} = replayFile(file), d = describe(S);
  const found = {method: run.method || "search", seconds: +(process.env.FLOWGROW_ENDGAME_SECONDS || 300), workers: +(process.env.FLOWGROW_ENDGAME_WORKERS || 10)};
  fs.mkdirSync(path.dirname(RUN_JS), {recursive: true}); fs.writeFileSync(RUN_JS, runJs(run, S, found)); fs.writeFileSync(PAGE, pageFor(fs.readFileSync(PLAY, "utf8")));
  console.log("wrote endgame/run.js and endgame/index.html\n" + line(d)); process.exit(0) }
const files = args.filter(a => !a.startsWith("--")); if (!files.length) die("Usage: node tools/flowgrow-endgame.mjs <run.json> [more.json ...] | --use <run.json> | --check | --page");
for (const f of files) { const {S} = replayFile(f); console.log(path.basename(f) + "\n   " + line(describe(S)) + "\n") }
