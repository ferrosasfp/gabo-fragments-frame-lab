#!/usr/bin/env node
/* Gabo Fragments Frame Lab — minimal smoke test.
 *
 * This is intentionally a "static + asset + JS-parse" sanity check that runs
 * without a browser. It verifies:
 *   - all required files exist + non-trivial size
 *   - HTML references real local assets (no broken links)
 *   - GFS brand sections (mini hero, fragment hierarchy, Lisbon timeline) are present
 *   - vercel.json CSP is locked to self + jsdelivr + Google Fonts (no runtime RPC/IPFS)
 *   - app.js exposes the canonical Gabo constants (contract, range) + static data path
 *   - logo.svg parses as XML
 *
 * For a full browser e2e (DOM, three.js render, downloads), spin up the dev
 * server and run a headless Chromium harness (omitted here to keep zero deps).
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const results = [];
const pass = (name, detail = '') => { results.push({ name, ok: true, detail }); console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`); };
const fail = (name, detail = '') => { results.push({ name, ok: false, detail }); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); };

console.log('\n[1] File presence + minimum size');
const files = [
  { path: 'index.html', min: 5_000 },
  { path: 'app.js',     min: 30_000 },
  { path: 'puzzle.js',  min: 4_000 },
  { path: 'nav.js',     min: 500 },
  { path: 'styles.css', min: 8_000 },
  { path: 'logo.svg',   min: 600 },
  { path: 'serve.py',   min: 200 },
  { path: 'vercel.json', min: 800 },
  { path: 'README.md',  min: 1_000 },
  { path: 'sw.js',                  min: 800 },
  { path: 'manifest.webmanifest',   min: 300 },
  { path: 'icon-192.png',           min: 1_000 },
  { path: 'icon-512.png',           min: 1_000 },
  { path: 'icon-512-maskable.png',  min: 1_000 },
  { path: 'apple-touch-icon.png',   min: 1_000 },
];
for (const f of files) {
  const p = resolve(ROOT, f.path);
  if (!existsSync(p)) { fail(`file ${f.path}`, 'missing'); continue; }
  const sz = statSync(p).size;
  if (sz < f.min) fail(`file ${f.path}`, `too small: ${sz} bytes`);
  else pass(`file ${f.path}`, `${sz} bytes`);
}

console.log('\n[2] HTML structural checks');
const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const htmlChecks = [
  { name: 'title is Frame Lab', re: /<title>[^<]*Frame Lab/ },
  { name: 'has slabCanvas', re: /id="slabCanvas"/ },
  { name: 'has tokenInput', re: /id="tokenInput"/ },
  { name: 'has frameItBtn', re: /id="frameItBtn"/ },
  { name: 'has frame PNG export', re: /data-export="slab-png"/ },
  { name: 'has GLB export', re: /data-export="slab-glb"/ },
  { name: 'has GIF export', re: /data-export="slab-gif"/ },
  { name: 'has WebM export', re: /data-export="slab-webm"/ },
  { name: 'no wallpaper panel', re: /id="wallpaper"/, negate: true },
  { name: 'no Spanish CTA "Enmarcar"', re: /Enmarcar/, negate: true },
  { name: 'no Spanish "Marco"', re: /\bMarco\b/, negate: true },
  { name: 'no Spanish "Fragmento"', re: /Fragmento/, negate: true },
  { name: 'English CTA "Frame It"', re: />Frame It</ },
  { name: 'loads app.js module', re: /<script type="module" src="app\.js"/ },
  { name: 'loads styles.css', re: /href="styles\.css"/ },
  { name: 'importmap for three', re: /three@0\.160\.0/ },
  { name: 'preconnect jsdelivr CDN', re: /preconnect" href="https:\/\/cdn\.jsdelivr\.net"/ },
  { name: 'no dead RPC preconnect', re: /preconnect" href="https:\/\/rpc\.apechain\.com"/, negate: true },
  { name: 'non-affiliation disclaimer', re: /[Nn]ot affiliated/ },
  { name: 'Google Fonts loads Anton', re: /family=Anton/ },
  { name: 'Google Fonts loads Inter', re: /family=Inter/ },
  { name: 'no Cormorant Garamond', re: /Cormorant\+?Garamond/, negate: true },
  { name: 'no Cinzel font', re: /family=Cinzel/, negate: true },
  // GFS brand sections
  { name: 'NAV bar with GFS logo block', re: /class="logo-block">GFS</ },
  { name: 'NAV back-to-collection CTA', re: /Back to Collection/i },
  { name: 'MINI HERO "Frame any Fragment"', re: /Frame any[\s\S]*Fragment\./ },
  { name: 'Hero "Built on ApeChain" badge', re: /Built on ApeChain/ },
  { name: 'FRAGMENT HIERARCHY heading "991 Fragments. 1 Artwork."', re: /991 Fragments\.\s*1 Artwork\./ },
  { name: 'Tier 1 label "9" + "Large Fragments"', re: /class="num">9<[\s\S]*Large Fragments/ },
  { name: 'Tier 2 label "81" + "Medium Fragments"', re: /class="num">81<[\s\S]*Medium Fragments/ },
  { name: 'Tier 3 label "900" + "Micro Fragments"', re: /class="num">900<[\s\S]*Micro Fragments/ },
  // Reassemble the Genesis — sliding puzzle
  { name: 'PUZZLE section present', re: /class="puzzle-section"/ },
  { name: 'PUZZLE eyebrow "Interactive Puzzle"', re: /Interactive Puzzle/i },
  { name: 'PUZZLE heading "Reassemble the Genesis"', re: /Reassemble the Genesis/ },
  { name: 'PUZZLE difficulty container', re: /id="puzzleDifficulty"/ },
  { name: 'PUZZLE board element', re: /id="puzzleBoard"/ },
  { name: 'PUZZLE timer stat', re: /id="puzzleTime"/ },
  { name: 'PUZZLE moves stat', re: /id="puzzleMoves"/ },
  { name: 'PUZZLE shuffle button', re: /id="puzzleShuffle"/ },
  { name: 'PUZZLE show-reference toggle', re: /id="puzzleReference"/ },
  { name: 'PUZZLE win overlay', re: /id="puzzleWin"/ },
  { name: 'PUZZLE share button', re: /id="puzzleShare"/ },
  { name: 'PUZZLE placed before timeline', re: /puzzle-section[\s\S]*From Lisbon to the Chain/ },
  { name: 'PUZZLE placed after hierarchy', re: /991 Fragments\.\s*1 Artwork\.[\s\S]*puzzle-section/ },
  { name: 'loads puzzle.js module', re: /<script type="module" src="puzzle\.js"/ },
  // Timeline — From Lisbon to the Chain (verbatim)
  { name: 'Timeline heading "From Lisbon to the Chain"', re: /From Lisbon to the Chain/i },
  { name: 'Timeline step 1 title "Ape Fest Lisbon"', re: /Ape Fest Lisbon/i },
  { name: 'Timeline step 1 desc', re: /ApeChain is introduced to the world\./ },
  { name: 'Timeline step 2 title "Tile Artwork"', re: /Tile Artwork/i },
  { name: 'Timeline step 2 desc', re: /Gabo creates an original ceramic tile artwork\./ },
  { name: 'Timeline step 3 title "Photographed"', re: /Photographed/i },
  { name: 'Timeline step 3 desc', re: /Captured in high resolution to preserve every detail\./ },
  { name: 'Timeline step 4 title "Vectorized"', re: /Vectorized/i },
  { name: 'Timeline step 4 desc', re: /Digitally vectorized to maintain the essence\./ },
  { name: 'Timeline step 5 title "Fragmented"', re: /Fragmented/i },
  { name: 'Timeline step 5 desc', re: /Divided into 991 unique fragments of different sizes\./ },
  { name: 'Timeline step 6 title "Minted on ApeChain"', re: /Minted on ApeChain/i },
  { name: 'Timeline step 6 desc', re: /991 unique NFTs\. Forever on-chain\./ },
  { name: 'Timeline has inline SVG icons (currentColor)', re: /<svg viewBox="0 0 24 24"><path/ },
  // Footer structure
  { name: 'Footer brand tagline "A fragment of art. A piece of history."', re: /A fragment of art[\s\S]*A piece of history/i },
  { name: 'Footer LINKS column has OpenSea Collection', re: /OpenSea Collection/ },
  { name: 'Footer LINKS column has ApeChain Explorer', re: /ApeChain Explorer/ },
  { name: 'Footer RESOURCES column has Whitepaper (coming)', re: /Whitepaper \(coming\)/ },
  { name: 'Footer RESOURCES column has FAQ (coming)', re: /FAQ \(coming\)/ },
  { name: 'Footer DISCLAIMER mentions "Not affiliated"', re: /[Nn]ot affiliated/ },
  { name: 'Footer DISCLAIMER mentions "Built by the Society, for the Society"', re: /Built by the Society, for the Society/ },
  { name: 'Footer bottom "Made in Lisbon"', re: /Made in Lisbon/ },
];
for (const c of htmlChecks) {
  const hit = c.re.test(html);
  const ok = c.negate ? !hit : hit;
  ok ? pass(c.name) : fail(c.name);
}

console.log('\n[3] CSS palette checks (cobalt + cream — GFS brand)');
const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8');
const cssChecks = [
  // New palette
  { name: '--cobalt defined #1E3A6E', re: /--cobalt:\s*#1E3A6E/ },
  { name: '--cobalt-deep defined #0F1F40', re: /--cobalt-deep:\s*#0F1F40/ },
  { name: '--cobalt-bright defined #2E5BB0', re: /--cobalt-bright:\s*#2E5BB0/ },
  { name: '--cream defined #F5F1E8', re: /--cream:\s*#F5F1E8/ },
  { name: '--cream-2 defined #EDE6D5', re: /--cream-2:\s*#EDE6D5/ },
  { name: '--bone defined #FFFCF5', re: /--bone:\s*#FFFCF5/ },
  { name: '--ink near-black', re: /--ink:\s*#1A1A1A/ },
  { name: '--terracotta defined', re: /--terracotta:/ },
  { name: '--tile-blue defined', re: /--tile-blue:/ },
  // Typography
  { name: 'Anton heavy condensed display', re: /--font-display:[^;]*'?Anton/ },
  { name: 'Inter body font', re: /--font-body:[^;]*'?Inter/ },
  { name: 'JetBrains Mono', re: /JetBrains Mono/ },
  // Section selectors that must exist
  { name: '.nav nav bar styling', re: /\.nav\s*\{/ },
  { name: '.hero mini hero styling', re: /\.hero\s*\{/ },
  { name: '.hierarchy fragment hierarchy styling', re: /\.hierarchy\s*\{/ },
  { name: '.timeline-section styling', re: /\.timeline-section\s*\{/ },
  { name: '.timeline-step card styling', re: /\.timeline-step\s*\{/ },
  { name: '.puzzle-section styling', re: /\.puzzle-section\s*\{/ },
  { name: '.puzzle-board styling', re: /\.puzzle-board\s*\{/ },
  { name: '.puzzle-tile styling', re: /\.puzzle-tile\s*\{/ },
  { name: 'puzzle tiles use transform transition (slide)', re: /\.puzzle-tile[\s\S]*transition:[^;]*transform/ },
  { name: '.footer-cols structured footer', re: /\.footer-cols\s*\{/ },
  // Negative — silver/azulejo/serif palette must be gone
  { name: 'no --silver variables', re: /--silver/, negate: true },
  { name: 'no --pewter variable', re: /--pewter/, negate: true },
  { name: 'no --gold variable', re: /--gold/, negate: true },
  { name: 'no --azulejo variable name', re: /--azulejo:/, negate: true },
  { name: 'no Cormorant Garamond font', re: /Cormorant Garamond/, negate: true },
  { name: 'no Cinzel font', re: /Cinzel/, negate: true },
  { name: 'no --font-script (serif removed)', re: /--font-script/, negate: true },
  { name: 'no .wp- selectors (wallpaper removed)', re: /\.wp-/, negate: true },
];
for (const c of cssChecks) {
  const hit = c.re.test(css);
  const ok = c.negate ? !hit : hit;
  ok ? pass(c.name) : fail(c.name);
}

console.log('\n[4] app.js — Gabo collection constants + GFS frame');
const app = readFileSync(resolve(ROOT, 'app.js'), 'utf8');
const appChecks = [
  { name: 'GABO_FRAGMENTS constant', re: /const GABO_FRAGMENTS = \{/ },
  { name: 'correct contract address', re: /0x3d36acd9123550b9de753c7535578205b15480a2/ },
  { name: 'chain ape_chain', re: /chain:\s*"ape_chain"/ },
  { name: 'chainId 33139', re: /chainId:\s*33139/ },
  { name: 'maxId 990 (991 pieces)', re: /maxId:\s*990/ },
  { name: 'minId 0 (Genesis)', re: /minId:\s*0/ },
  { name: 'fragmentTier function', re: /function fragmentTier\(/ },
  { name: 'Genesis tier handled', re: /tier:\s*0,\s*label:\s*"Genesis"/ },
  { name: 'Tier 3 = 900 pieces', re: /tier:\s*3,\s*label:\s*"Tier 3",\s*total:\s*900/ },
  { name: 'static fragment image path', re: /fragments\/\$\{tokenId\}\.webp/ },
  { name: 'fetchFragment is the data path', re: /async function fetchFragment/ },
  { name: 'no runtime RPC fetcher', re: /fetchFromRpc/, negate: true },
  { name: 'no runtime IPFS gateway race', re: /raceImageUrls/, negate: true },
  { name: 'no dead OpenSea fetcher', re: /fetchOpenSea/, negate: true },
  { name: 'GLB export', re: /async function exportSlabGLB/ },
  { name: 'GIF export', re: /async function exportSlabGIF/ },
  { name: 'WebM export', re: /async function exportSlabWebM/ },
  { name: 'frame drawing function', re: /function drawSlabFront/ },
  { name: 'modern plaque drawing (not silver)', re: /function drawPlaque/ },
  { name: 'tile motif helper for cream mat', re: /function drawTileMotif/ },
  // Material: white color multiplier (texture renders as authored — cobalt is in the canvas)
  { name: 'white material multiplier (color: 0xffffff)', re: /color:\s*0xffffff/ },
  { name: 'refined surface roughness (0.65)', re: /roughness:\s*0\.65/ },
  { name: 'refined metalness (0.15)', re: /metalness:\s*0\.15/ },
  // GFS palette constants in JS — frame body is cobalt (painted into the texture)
  { name: 'COLOR.cobalt constant in JS', re: /cobalt:\s*"#1E3A6E"/ },
  { name: 'COLOR.cream constant in JS', re: /cream:\s*"#F5F1E8"/ },
  { name: 'COLOR.bone constant in JS', re: /bone:\s*"#FFFCF5"/ },
  // Silver liner — polished silver between cobalt frame and cream mat
  { name: 'COLOR.silver liner #C0C4CC', re: /silver:\s*"#C0C4CC"/ },
  { name: 'COLOR.silverBone plaque background', re: /silverBone:\s*"#E8EAEF"/ },
  // Negatives — old ornate frame removed
  { name: 'no drawSilverPlaque (renamed to drawPlaque)', re: /function drawSilverPlaque/, negate: true },
  { name: 'no drawCornerFlourish (ornate removed)', re: /function drawCornerFlourish/, negate: true },
  { name: 'no drawCenterCrest (ornate removed)', re: /function drawCenterCrest/, negate: true },
  { name: 'no drawFrameOrnaments (ornate removed)', re: /function drawFrameOrnaments/, negate: true },
  { name: 'no silver color hex 0xc0c4cc', re: /0xc0c4cc/, negate: true },
  { name: 'no wallpaper module (WP_DEVICES removed)', re: /WP_DEVICES/, negate: true },
  { name: 'no drawBrassPlaque', re: /drawBrassPlaque/, negate: true },
  { name: 'no exportCardPNG', re: /exportCardPNG/, negate: true },
  { name: 'no Cormorant Garamond in canvas text', re: /Cormorant Garamond/, negate: true },
  { name: 'no Cinzel in canvas text', re: /Cinzel/, negate: true },
];
for (const c of appChecks) {
  const hit = c.re.test(app);
  const ok = c.negate ? !hit : hit;
  ok ? pass(c.name) : fail(c.name);
}

console.log('\n[5] vercel.json CSP allowlist');
const vercel = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8'));
const cspHeader = vercel.headers?.[0]?.headers?.find((h) => h.key === 'Content-Security-Policy');
if (!cspHeader) {
  fail('CSP header present');
} else {
  pass('CSP header present');
  const csp = cspHeader.value;
  const cspChecks = [
    { name: 'CSP img-src self (pre-baked fragments)', re: /img-src 'self'/ },
    { name: 'CSP dropped IPFS gateway (now static)', re: /gateway\.pinata\.cloud/, negate: true },
    { name: 'CSP dropped ipfs.io (now static)', re: /ipfs\.io/, negate: true },
    { name: 'CSP dropped ApeChain RPC (now static)', re: /rpc\.apechain\.com/, negate: true },
    { name: 'CSP dropped dead OpenSea domain', re: /api\.opensea\.io/, negate: true },
    { name: 'CSP dropped dead seadn.io domain', re: /seadn\.io/, negate: true },
    { name: 'CSP dropped dead dweb.link domain', re: /dweb\.link/, negate: true },
    { name: 'CSP allows Google Fonts CSS', re: /fonts\.googleapis\.com/ },
    { name: 'CSP allows Google Fonts files', re: /fonts\.gstatic\.com/ },
    { name: 'CSP has no unsafe-inline for scripts', re: /script-src[^;]*'unsafe-inline'/, negate: true },
    { name: 'CSP forbids object-src', re: /object-src 'none'/ },
    { name: 'CSP forbids frame-ancestors', re: /frame-ancestors 'none'/ },
    { name: 'CSP allows worker self + blob (SW + gif.js)', re: /worker-src 'self' blob:/ },
  ];
  for (const c of cspChecks) {
    const hit = c.re.test(csp);
    const ok = c.negate ? !hit : hit;
    ok ? pass(c.name) : fail(c.name);
  }
}

console.log('\n[6] logo.svg parses');
const logo = readFileSync(resolve(ROOT, 'logo.svg'), 'utf8');
/<svg[^>]*viewBox/.test(logo) ? pass('logo.svg has <svg viewBox=...>') : fail('logo.svg has <svg viewBox=...>');
/<\/svg>/.test(logo) ? pass('logo.svg closes <svg>') : fail('logo.svg closes <svg>');
/GFS/.test(logo) ? pass('logo.svg includes GFS monogram') : fail('logo.svg includes GFS monogram');
/#1E3A6E/i.test(logo) ? pass('logo.svg uses cobalt #1E3A6E') : fail('logo.svg uses cobalt #1E3A6E');

console.log('\n[7] puzzle.js — sliding puzzle engine');
const puzzle = readFileSync(resolve(ROOT, 'puzzle.js'), 'utf8');
const puzzleChecks = [
  { name: 'reuses genesis-bg.webp', re: /genesis-bg\.webp/ },
  { name: 'three difficulties (3/4/5)', re: /n:\s*3[\s\S]*n:\s*4[\s\S]*n:\s*5/ },
  { name: 'SlidingPuzzle class', re: /class SlidingPuzzle/ },
  { name: 'solvable shuffle via valid moves (SHUFFLE_MOVES)', re: /SHUFFLE_MOVES/ },
  { name: 'shuffle in 150-300 range', re: /SHUFFLE_MOVES\s*=\s*(1[5-9]\d|2\d\d|300)\b/ },
  { name: 'shuffle avoids undoing previous move', re: /prevEmpty/ },
  { name: 'win detection (isSolvedState)', re: /isSolvedState/ },
  { name: 'timer M:SS formatter', re: /padStart\(2,\s*["']0["']\)/ },
  { name: 'X intent share URL', re: /twitter\.com\/intent\/tweet/ },
  { name: 'share text @thegaboeth Genesis #0', re: /@thegaboeth's Genesis #0/ },
  { name: 'share opens new tab', re: /window\.open\([^)]*_blank/ },
  { name: 'slicing technique (background-size n*100%)', re: /backgroundSize\s*=\s*`\$\{this\.n\s*\*\s*100\}%/ },
  { name: 'no raw permutation shuffle (no Array.sort random)', re: /sort\(\(\)\s*=>\s*Math\.random/, negate: true },
];
for (const c of puzzleChecks) {
  const hit = c.re.test(puzzle);
  const ok = c.negate ? !hit : hit;
  ok ? pass(c.name) : fail(c.name);
}

console.log('\n[8] PWA — installable + offline');
const swSrc = readFileSync(resolve(ROOT, 'sw.js'), 'utf8');
const manifestSrc = JSON.parse(readFileSync(resolve(ROOT, 'manifest.webmanifest'), 'utf8'));
const pwaHtmlChecks = [
  { name: 'index links the web manifest', re: /rel="manifest" href="manifest\.webmanifest"/ },
  { name: 'index has apple-touch-icon', re: /rel="apple-touch-icon" href="apple-touch-icon\.png"/ },
  { name: 'index declares apple-mobile-web-app-capable', re: /apple-mobile-web-app-capable/ },
];
for (const c of pwaHtmlChecks) (c.re.test(html) ? pass(c.name) : fail(c.name));

// app.js must register the SW (external file — no inline script, keeps CSP strict)
(/navigator\.serviceWorker\.register\(["']sw\.js["']\)/.test(app)
  ? pass('app.js registers the service worker') : fail('app.js registers the service worker'));

const swChecks = [
  { name: 'sw caches the app shell', re: /addAll\(SHELL\)/ },
  { name: 'sw precaches index + app + styles', re: /["']\/app\.js["'][\s\S]*["']\/styles\.css["']/ },
  { name: 'sw handles navigations (offline fallback)', re: /req\.mode === "navigate"/ },
  { name: 'sw cache-first runtime strategy', re: /function cacheFirst/ },
  { name: 'sw purges old caches on activate', re: /caches\.delete/ },
];
for (const c of swChecks) (c.re.test(swSrc) ? pass(c.name) : fail(c.name));

// Manifest content
(manifestSrc.display === 'standalone' ? pass('manifest display: standalone') : fail('manifest display: standalone'));
(manifestSrc.start_url === '/' ? pass('manifest start_url: /') : fail('manifest start_url: /'));
(Array.isArray(manifestSrc.icons) && manifestSrc.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')
  ? pass('manifest has 512 maskable icon') : fail('manifest has 512 maskable icon'));
(manifestSrc.icons.some((i) => i.sizes === '192x192')
  ? pass('manifest has 192 icon') : fail('manifest has 192 icon'));

// CSP must allow the SW (worker-src self) + the manifest (manifest-src self)
const cspVal = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8'))
  .headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
(/worker-src 'self'/.test(cspVal) ? pass('CSP worker-src allows self (SW)') : fail('CSP worker-src allows self (SW)'));
(/manifest-src 'self'/.test(cspVal) ? pass('CSP manifest-src allows self') : fail('CSP manifest-src allows self'));

console.log('\n[9] Mobile tab bar — app-style bottom nav');
const navSrc = readFileSync(resolve(ROOT, 'nav.js'), 'utf8');
const tabbarChecks = [
  { name: 'index has the tab bar', re: /<nav class="tabbar"/ },
  { name: 'tab bar has 4 tabs', re: /data-section="frame"[\s\S]*data-section="collection"[\s\S]*data-section="puzzle"[\s\S]*data-section="story"/ },
  { name: 'sections carry anchor ids', re: /id="frame"[\s\S]*id="collection"[\s\S]*id="puzzle"[\s\S]*id="story"/ },
  { name: 'index loads nav.js', re: /<script type="module" src="nav\.js"/ },
];
for (const c of tabbarChecks) (c.re.test(html) ? pass(c.name) : fail(c.name));
(/getBoundingClientRect\(\)\.top/.test(navSrc) && /addEventListener\("scroll"/.test(navSrc)
  ? pass('nav.js deterministic scroll-spy (reference line)') : fail('nav.js deterministic scroll-spy (reference line)'));
(/is-active/.test(navSrc) ? pass('nav.js toggles active tab') : fail('nav.js toggles active tab'));
(/visualViewport/.test(navSrc) ? pass('nav.js pins tab bar above mobile browser chrome') : fail('nav.js pins tab bar above mobile browser chrome'));

const cssSrc = readFileSync(resolve(ROOT, 'styles.css'), 'utf8');
const tabCssChecks = [
  { name: 'tab bar hidden on desktop', re: /\.tabbar\s*\{\s*display:\s*none/ },
  { name: 'tab bar fixed to bottom', re: /\.tabbar\s*\{[\s\S]*position:\s*fixed[\s\S]*bottom:\s*0/ },
  { name: 'iOS safe-area inset honored', re: /env\(safe-area-inset-bottom/ },
  { name: 'smooth anchor scrolling', re: /scroll-behavior:\s*smooth/ },
  { name: 'body uses overflow-x clip (keeps fixed bar pinned on mobile)', re: /overflow-x:\s*clip/ },
];
for (const c of tabCssChecks) (c.re.test(cssSrc) ? pass(c.name) : fail(c.name));

console.log('\n[10] "View in your room" — AR (model-viewer + GLB/USDZ)');
const arHtmlChecks = [
  { name: 'index has "View in your room" button', re: /id="viewInRoom"/ },
  { name: 'index has AR modal', re: /id="arModal"/ },
  { name: 'index has AR modal stage for model-viewer', re: /id="arModalStage"/ },
];
for (const c of arHtmlChecks) (c.re.test(html) ? pass(c.name) : fail(c.name));

const arAppChecks = [
  { name: 'app.js imports USDZExporter', re: /import \{ USDZExporter \}/ },
  { name: 'app.js lazy-loads model-viewer', re: /@google\/model-viewer/ },
  { name: 'app.js launches Scene Viewer (ar_preferred, no bounce)', re: /scene-viewer\/1\.0[\s\S]*mode=ar_preferred/ },
  { name: 'app.js iOS Quick Look via rel=ar anchor', re: /setAttribute\("rel",\s*"ar"\)/ },
  { name: 'app.js Android GLB from /ar/<id>.glb endpoint', re: /\/ar\/\$\{e\.id\}\.glb`|\/ar\/\$\{id\}\.glb`/ },
  { name: 'app.js USDZ as data URL (iOS Quick Look)', re: /data:model\/vnd\.usdz\+zip;base64,/ },
  { name: 'app.js scales frame to real metres', re: /AR_FRAME_WIDTH_M/ },
];
for (const c of arAppChecks) (c.re.test(app) ? pass(c.name) : fail(c.name));

// Serverless model endpoint (Scene Viewer downloads the GLB from a URL)
(existsSync(resolve(ROOT, 'api/model/[id].js'))
  ? pass('serverless route api/model/[id].js exists') : fail('serverless route api/model/[id].js exists'));
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
(pkg.dependencies && pkg.dependencies['@gltf-transform/core']
  ? pass('package.json has @gltf-transform/core') : fail('package.json has @gltf-transform/core'));
(pkg.dependencies && pkg.dependencies.sharp
  ? pass('package.json has sharp') : fail('package.json has sharp'));
const vj = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8'));
(Array.isArray(vj.rewrites) && vj.rewrites.some((r) => /\/ar\/:id\.glb/.test(r.source))
  ? pass('vercel.json rewrites /ar/:id.glb -> model route') : fail('vercel.json rewrites /ar/:id.glb -> model route'));

(/connect-src[^;]*blob:/.test(cspVal) ? pass('CSP connect-src allows blob: (AR GLB)') : fail('CSP connect-src allows blob: (AR GLB)'));
(/req\.url\.startsWith\("http"\)/.test(swSrc) ? pass('sw skips blob:/data: schemes') : fail('sw skips blob:/data: schemes'));
(/webglcontextrestored/.test(app) && /visibilitychange/.test(app)
  ? pass('app.js recovers from WebGL context loss + app backgrounding')
  : fail('app.js recovers from WebGL context loss + app backgrounding'));

// WebXR AR needs these Permissions-Policy features enabled for self — keep a
// future "security hardening" from silently disabling them and killing AR.
const permPol = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8'))
  .headers[0].headers.find((h) => h.key === 'Permissions-Policy').value;
for (const feat of ['xr-spatial-tracking', 'camera', 'gyroscope', 'accelerometer']) {
  (new RegExp(`${feat}=\\(self\\)`).test(permPol)
    ? pass(`Permissions-Policy allows ${feat} (WebXR AR)`)
    : fail(`Permissions-Policy allows ${feat} (WebXR AR)`));
}

// ===== Summary =====
const ok = results.filter((r) => r.ok).length;
const ko = results.filter((r) => !r.ok).length;
console.log(`\n=========== ${ok} pass · ${ko} fail ===========`);
if (ko > 0) {
  console.log('\nFailed:');
  for (const r of results.filter((r) => !r.ok)) console.log(`  - ${r.name}${r.detail ? ': ' + r.detail : ''}`);
  process.exit(1);
}
process.exit(0);
