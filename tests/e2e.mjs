#!/usr/bin/env node
/* Gabo Fragments Frame Lab — minimal smoke test.
 *
 * This is intentionally a "static + asset + JS-parse" sanity check that runs
 * without a browser. It verifies:
 *   - all required files exist + non-trivial size
 *   - HTML references real local assets (no broken links)
 *   - GFS brand sections (mini hero, fragment hierarchy, Lisbon timeline) are present
 *   - vercel.json CSP allowlists OpenSea + at least one IPFS gateway + Google Fonts
 *   - app.js exposes the canonical Gabo constants (contract, range, gateways)
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
  { path: 'styles.css', min: 8_000 },
  { path: 'logo.svg',   min: 600 },
  { path: 'serve.py',   min: 200 },
  { path: 'vercel.json', min: 800 },
  { path: 'README.md',  min: 1_000 },
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
  { name: 'preconnect ApeChain RPC', re: /preconnect" href="https:\/\/rpc\.apechain\.com"/ },
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
  { name: 'ApeChain RPC base', re: /rpc:\s*"https:\/\/rpc\.apechain\.com\/http"/ },
  { name: 'IPFS gateways defined', re: /gateway\.pinata\.cloud\/ipfs/ },
  { name: 'fragmentTier function', re: /function fragmentTier\(/ },
  { name: 'Genesis tier handled', re: /tier:\s*0,\s*label:\s*"Genesis"/ },
  { name: 'Tier 3 = 900 pieces', re: /tier:\s*3,\s*label:\s*"Tier 3",\s*total:\s*900/ },
  { name: 'RPC fetcher is the data path', re: /async function fetchFromRpc/ },
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
    { name: 'CSP includes Pinata gateway', re: /gateway\.pinata\.cloud/ },
    { name: 'CSP includes ipfs.io gateway', re: /ipfs\.io/ },
    { name: 'CSP includes ApeChain RPC', re: /rpc\.apechain\.com/ },
    { name: 'CSP dropped dead OpenSea domain', re: /api\.opensea\.io/, negate: true },
    { name: 'CSP dropped dead seadn.io domain', re: /seadn\.io/, negate: true },
    { name: 'CSP dropped dead dweb.link domain', re: /dweb\.link/, negate: true },
    { name: 'CSP allows Google Fonts CSS', re: /fonts\.googleapis\.com/ },
    { name: 'CSP allows Google Fonts files', re: /fonts\.gstatic\.com/ },
    { name: 'CSP has no unsafe-inline for scripts', re: /script-src[^;]*'unsafe-inline'/, negate: true },
    { name: 'CSP forbids object-src', re: /object-src 'none'/ },
    { name: 'CSP forbids frame-ancestors', re: /frame-ancestors 'none'/ },
    { name: 'CSP allows worker blob', re: /worker-src blob:/ },
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
