#!/usr/bin/env node
// The elevation map pages (LOU-310; Dan, Nov 21: "do LOU-310 but make it a separate map, create 2-3 different variations"). A developer tool, not part of the game.
//
// Each map is its own page, /elevation/<id>/, so the usual game is never touched. A map page is play/index.html (the play page, LOU-316) with its own title, its paths two folders up, and one small script that
// switches elevation on for that page (and names it); the game itself (flowgrow.js, flowgrow.css, the config) is the same file for every page. There is no build step for the game:
// this script only copies the page and is run by hand.
//
//   node tools/make-maps.mjs           write elevation/index.html and elevation/<id>/index.html from play/index.html
//   node tools/make-maps.mjs --check   say whether they are up to date with play/index.html (the simulator's rule checks run this)
//
// To add or change a map, edit MAPS here, run this, and add the new page to the LOCAL list in sw.js.
import fs from "fs"; import path from "path"; import {fileURLToPath} from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MAPS = [
  {id:"foothills", name:"Foothills", line:"The land falls away from the source in rings, with some bumps.", set:{elevation:true, elevationShape:"foothills"}},
  {id:"ridges", name:"Ridges", line:"Ridges run out from the source, with lower land between them.", set:{elevation:true, elevationShape:"ridges"}},
  {id:"terraces", name:"Terraces", line:"Broad flat tiers fall away in one direction, with sharp steps between.", set:{elevation:true, elevationShape:"terraces"}},
];

// A map's page: the play page with the title, the paths and the override script changed. Line endings are whatever the play page has.
export function pageFor(indexHtml, m) {
  const eol = indexHtml.includes("\r\n") ? "\r\n" : "\n", must = (s, a, b) => { if (!s.includes(a)) throw new Error("make-maps: play/index.html has no " + a); return s.replace(a, () => b) };
  let s = must(indexHtml, "<title>Flowgrow</title>", `<title>Flowgrow · ${m.name}</title>`);
  s = s.replace(/\b(href|src)="((?!https?:|\/|#|data:)[^"]*)"/g, (_, a, u) => `${a}="../${u}"`);   // the play page's paths are one folder up (../x): a map page is one folder deeper
  s = must(s, '<script src="../../flowgrow.config.js"></script>', `<script src="../../flowgrow.config.js"></script>${eol}<script>window.FLOWGROW_NAME = ${JSON.stringify(m.name)}; Object.assign(window.FLOWGROW, ${JSON.stringify(m.set)});</script>`);
  return s }

// The list page, /elevation/: one card for each map.
export function indexFor(eol = "\r\n") {
  return [`<!doctype html>`, `<html lang="en">`, `<head>`, `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`,
    `<title>Flowgrow · Elevation maps</title>`, `<meta name="robots" content="noindex">`, `<meta name="theme-color" content="#cfe3ea">`, `<link rel="stylesheet" href="../fonts/fonts.css">`, `<style>`,
    `body{margin:0;background:#cfe3ea;font-family:'M PLUS Rounded 1c',Nunito,sans-serif;color:#24434a}`, `main{max-width:430px;margin:0 auto;padding:28px 18px 40px}`, `h1{font-size:26px;margin:0 0 4px}`,
    `p{margin:6px 0 16px;line-height:1.4}`, `a.card{display:block;background:rgba(255,255,255,.85);border-radius:22px;padding:16px 18px;margin:0 0 12px;text-decoration:none;color:inherit;box-shadow:0 2px 10px rgba(40,80,90,.12)}`,
    `a.card b{display:block;font-size:20px}`, `a.card span{color:#52707a}`, `a.back{color:#2c6e99}`, `</style>`, `</head>`, `<body><main>`, `<h1>Elevation maps</h1>`,
    `<p>The same island and the same tiles as the usual game, with heights (LOU-310): a river can go level or down a step, never up, and a step down is a waterfall. Three ways the land can be shaped. Each map has its own saved run and best score.</p>`,
    ...MAPS.map(m => `<a class="card" href="${m.id}/"><b>${m.name}</b><span>${m.line}</span></a>`), `<p><a class="back" href="../">Back to the usual game</a></p>`, `</main></body>`, `</html>`, ``].join(eol) }

export function files() {
  const html = fs.readFileSync(path.join(ROOT, "play", "index.html"), "utf8"), out = {"elevation/index.html": indexFor(html.includes("\r\n") ? "\r\n" : "\n")};
  for (const m of MAPS) out[`elevation/${m.id}/index.html`] = pageFor(html, m);
  return out }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const want = files(), check = process.argv.includes("--check"); let stale = 0;
  for (const [f, text] of Object.entries(want)) { const p = path.join(ROOT, f), have = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
    if (check) { if (have !== text) { stale++; console.log("out of date: " + f) } }
    else { fs.mkdirSync(path.dirname(p), {recursive: true}); fs.writeFileSync(p, text); console.log("wrote " + f) } }
  if (check) { console.log(stale ? `${stale} page(s) out of date: run node tools/make-maps.mjs` : "the elevation pages are up to date"); process.exitCode = stale ? 1 : 0 } }
