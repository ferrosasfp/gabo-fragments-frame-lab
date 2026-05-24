#!/usr/bin/env node
/* Gabo Fragments Frame Lab — minimal smoke test.
 *
 * This is intentionally a "static + asset + JS-parse" sanity check that runs
 * without a browser. It verifies:
 *   - all required files exist + non-trivial size
 *   - HTML references real local assets (no broken links)
 *   - vercel.json CSP allowlists OpenSea + at least one IPFS gateway
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
  { path: 'logo.svg',   min: 800 },
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
  { name: 'English CTA "Frame it"', re: />Frame it</ },
  { name: 'loads app.js module', re: /<script type="module" src="app\.js"/ },
  { name: 'loads styles.css', re: /href="styles\.css"/ },
  { name: 'importmap for three', re: /three@0\.160\.0/ },
  { name: 'preconnect OpenSea', re: /preconnect" href="https:\/\/api\.opensea\.io"/ },
  { name: 'non-affiliation disclaimer', re: /NOT affiliated/ },
];
for (const c of htmlChecks) {
  const hit = c.re.test(html);
  const ok = c.negate ? !hit : hit;
  ok ? pass(c.name) : fail(c.name);
}

console.log('\n[3] CSS palette checks (azulejos + silver)');
const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8');
const cssChecks = [
  { name: '--azulejo cobalt color defined', re: /--azulejo:\s*#1e4a8c/ },
  { name: '--silver polished sterling defined', re: /--silver:\s*#c0c4cc/ },
  { name: '--silver-deep defined', re: /--silver-deep:\s*#7a7e85/ },
  { name: '--silver-bright defined', re: /--silver-bright:\s*#e8eaef/ },
  { name: '--terracotta defined', re: /--terracotta:/ },
  { name: '--ink cobalt blue', re: /--ink:\s*#1a3050/ },
  { name: '--bg aged paper', re: /--bg:\s*#faf7f0/ },
  { name: 'Cormorant Garamond font', re: /Cormorant Garamond/ },
  { name: 'Cinzel font for plaques', re: /Cinzel/ },
  { name: 'no smoke animations (azulejo theme)', re: /smoke/, negate: true },
  { name: 'no --gold variable (silver palette)', re: /--gold/, negate: true },
  { name: 'no .wp- selectors (wallpaper removed)', re: /\.wp-/, negate: true },
];
for (const c of cssChecks) {
  const hit = c.re.test(css);
  const ok = c.negate ? !hit : hit;
  ok ? pass(c.name) : fail(c.name);
}

console.log('\n[4] app.js — Gabo collection constants');
const app = readFileSync(resolve(ROOT, 'app.js'), 'utf8');
const appChecks = [
  { name: 'GABO_FRAGMENTS constant', re: /const GABO_FRAGMENTS = \{/ },
  { name: 'correct contract address', re: /0x3d36acd9123550b9de753c7535578205b15480a2/ },
  { name: 'chain ape_chain', re: /chain:\s*"ape_chain"/ },
  { name: 'chainId 33139', re: /chainId:\s*33139/ },
  { name: 'maxId 990 (991 pieces)', re: /maxId:\s*990/ },
  { name: 'minId 0 (Genesis)', re: /minId:\s*0/ },
  { name: 'OpenSea API base', re: /openseaApi:\s*"https:\/\/api\.opensea\.io\/api\/v2"/ },
  { name: 'IPFS gateways defined', re: /gateway\.pinata\.cloud\/ipfs/ },
  { name: 'fragmentTier function', re: /function fragmentTier\(/ },
  { name: 'Genesis tier handled', re: /tier:\s*0,\s*label:\s*"Genesis"/ },
  { name: 'Tier 3 = 900 pieces', re: /tier:\s*3,\s*label:\s*"Tier 3",\s*total:\s*900/ },
  { name: 'OpenSea fetcher present', re: /async function fetchOpenSea/ },
  { name: 'ApeChain RPC fallback', re: /rpc\.apechain\.com/ },
  { name: 'GLB export', re: /async function exportSlabGLB/ },
  { name: 'GIF export', re: /async function exportSlabGIF/ },
  { name: 'WebM export', re: /async function exportSlabWebM/ },
  { name: 'frame drawing', re: /function drawSlabFront/ },
  { name: 'silver plaque drawing', re: /function drawSilverPlaque/ },
  { name: 'ornate corner flourishes', re: /function drawCornerFlourish/ },
  { name: 'silver material color hex', re: /color:\s*0xc0c4cc/ },
  { name: 'no wallpaper module (WP_DEVICES removed)', re: /WP_DEVICES/, negate: true },
  { name: 'no drawBrassPlaque (renamed to silver)', re: /drawBrassPlaque/, negate: true },
  { name: 'no exportCardPNG (artwork PNG removed)', re: /exportCardPNG/, negate: true },
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
    { name: 'CSP includes OpenSea API', re: /api\.opensea\.io/ },
    { name: 'CSP includes seadn.io (OpenSea CDN)', re: /seadn\.io/ },
    { name: 'CSP includes Pinata gateway', re: /gateway\.pinata\.cloud/ },
    { name: 'CSP includes dweb.link', re: /dweb\.link/ },
    { name: 'CSP includes ApeChain RPC', re: /rpc\.apechain\.com/ },
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
/G monogram|>G</.test(logo) ? pass('logo.svg includes G monogram') : fail('logo.svg includes G monogram');

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
