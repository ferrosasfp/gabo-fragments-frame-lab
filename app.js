/* Gabo Fragments Frame Lab — community gallery-card renderer
 *
 * Three.js renders a modern gallery card with the Gabo Fragments artwork
 * inset and a plaque below printed with token info + fragment tier.
 * The same scene drives:
 *   - the live on-screen preview (looping rotation)
 *   - Frame PNG  (one frame, hi-res, at a flattering angle)
 *   - Frame GIF  (frames around a full rotation)
 *   - Frame WebM (MediaRecorder on canvas.captureStream)
 *   - Frame GLB  (GLTFExporter of the whole scene incl. artwork texture)
 *
 * Data: pre-baked static assets (fragments/<id>.webp + manifest.json),
 * generated once by scripts/build-manifest.py. No runtime RPC or IPFS.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { USDZExporter } from "three/addons/exporters/USDZExporter.js";

// ============================================================================
// Config — Gabo Fragments Society
// ============================================================================
const GABO_FRAGMENTS = {
  symbol: "GABO",
  contract: "0x3d36acd9123550b9de753c7535578205b15480a2",
  chain: "ape_chain",
  chainId: 33139,
  minId: 0,
  maxId: 990,
  // Artwork is served from pre-baked static assets (fragments/<id>.webp).
  // The provenance (ApeChain RPC + IPFS) lives in scripts/build-manifest.py.
};

window.GABO_FRAGMENTS = GABO_FRAGMENTS; // expose for tests / debugging

const GIFJS_URL    = "https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.js";
const GIFJS_WORKER = "https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js";
const GIFJS_SRI        = "sha384-4RMW82CWFobXY+HRHXe5go/V5acBhiIVGCT+2k7TEoxi7AiWKw8WoWb9qMU+FAFu";
const GIFJS_WORKER_SRI = "sha384-uL0SwIQSos1DfQU2KzlDbPuSz7Jwo+hmNPIhe86VJ+MWwyj0DvjngnAgWrkNi9eQ";

// GFS palette in canvas-friendly hex strings
const COLOR = {
  cobalt:       "#1E3A6E",
  cobaltDeep:   "#0F1F40",
  cobaltBright: "#2E5BB0",
  cream:        "#F5F1E8",
  cream2:       "#EDE6D5",
  bone:         "#FFFCF5",
  matCream:     "#FAF6EC",   // slightly warmer mat between liner and artwork
  ink:          "#1A1A1A",
  inkSoft:      "#555555",
  tileBlue:     "#2A5BA0",
  silver:       "#C0C4CC",   // polished silver liner (between cobalt frame and mat)
  silverBone:   "#E8EAEF",   // plaque background (museum-card feel)
};

// Frame geometry — portrait orientation, like a hung painting (5:7 like a card)
const SLAB_W = 1.0;
const SLAB_H = 1.4;
const SLAB_D = 0.06; // a bit thicker than a card — frames have depth

const TEX_W = 1200;
const TEX_H = Math.round(TEX_W * SLAB_H / SLAB_W); // 1680

// ============================================================================
// Fragment hierarchy helpers
// ============================================================================
function fragmentTier(id) {
  const n = Number(id);
  if (n === 0) return { tier: 0, label: "Genesis", total: 1, of: 1 };
  if (n >= 1 && n <= 9)   return { tier: 1, label: "Tier 1", total: 9,   of: n };
  if (n >= 10 && n <= 90) return { tier: 2, label: "Tier 2", total: 81,  of: n - 9 };
  if (n >= 91)            return { tier: 3, label: "Tier 3", total: 900, of: n - 90 };
  return { tier: -1, label: "Unknown", total: 0, of: 0 };
}

// ============================================================================
// DOM refs
// ============================================================================
const $ = (id) => document.getElementById(id);
const canvas       = $("slabCanvas");
const tokenInput   = $("tokenInput");
const frameItBtn   = $("frameItBtn");
const randomBtn    = $("frameIt");
const exportBtns   = document.querySelectorAll(".btn[data-export]");
const stageLoading = $("stageLoading");
const loadingLabel = $("loadingLabel");
const stageToast   = $("stageToast");
const dockError    = $("dockError");
const viewInRoomBtn = $("viewInRoom");
const arModal       = $("arModal");
const arModalStage  = $("arModalStage");
const arClose       = $("arClose");
const arLaunch      = $("arLaunch");
const footerYear   = $("footerYear");
footerYear.textContent = new Date().getFullYear();

// Populate hierarchy grids (81 + 900 cells too noisy to inline in HTML) +
// mark a few random cells as .active. Each active cell shows its
// corresponding slice of the Genesis artwork — bg-size + bg-position set
// inline based on the cell's row/col. Result: active cells form windows
// to specific fragments of the original piece, default cells are invisible
// (bone, matching grid bg). Counts: 1 / 3 / 10 (per design spec).
(function populateHierarchyGrids() {
  function pickRandomIndices(count, total) {
    const indices = new Set();
    while (indices.size < count) indices.add(Math.floor(Math.random() * total));
    return [...indices];
  }
  function markActiveSliced(cells, count, gridSize) {
    if (!cells.length) return;
    const denom = gridSize - 1;
    pickRandomIndices(count, cells.length).forEach((idx) => {
      const cell = cells[idx];
      if (!cell) return;
      cell.classList.add("active");
      // Compute which 1/(gridSize²) slice of the artwork this cell shows
      const col = idx % gridSize;
      const row = Math.floor(idx / gridSize);
      const xPct = denom > 0 ? (col / denom) * 100 : 50;
      const yPct = denom > 0 ? (row / denom) * 100 : 50;
      cell.style.backgroundPosition = `${xPct}% ${yPct}%`;
      cell.style.backgroundSize = `${gridSize * 100}% ${gridSize * 100}%`;
    });
  }

  // Tier 1 — 9 cells (already inline in HTML), 1 active
  const t1Grid = document.querySelector(".tier-card.t1 .grid-vis");
  if (t1Grid) markActiveSliced(t1Grid.querySelectorAll("span"), 1, 3);

  // Tier 2 — 81 cells, 3 active
  const t2 = document.getElementById("t2grid");
  if (t2) {
    for (let i = 0; i < 81; i++) t2.appendChild(document.createElement("span"));
    markActiveSliced(t2.querySelectorAll("span"), 3, 9);
  }

  // Tier 3 — 900 cells, 10 active
  const t3 = document.getElementById("t3grid");
  if (t3) {
    for (let i = 0; i < 900; i++) t3.appendChild(document.createElement("span"));
    markActiveSliced(t3.querySelectorAll("span"), 10, 30);
  }
})();

// ============================================================================
// State
// ============================================================================
const cache = new Map();
let current = null;
let errorTimer = null, toastTimer = null;

// ============================================================================
// UI helpers
// ============================================================================
function showError(msg, sticky = false) {
  clearTimeout(errorTimer);
  if (!msg) { dockError.hidden = true; dockError.textContent = ""; return; }
  dockError.hidden = false;
  dockError.textContent = msg;
  if (!sticky) errorTimer = setTimeout(() => showError(""), 4500);
}
function showToast(msg, ms = 1800) {
  clearTimeout(toastTimer);
  stageToast.textContent = msg;
  stageToast.hidden = false;
  toastTimer = setTimeout(() => (stageToast.hidden = true), ms);
}
function setLoading(on, label) {
  if (label) loadingLabel.textContent = label;
  stageLoading.hidden = !on;
}
function setBusy(on) {
  [frameItBtn, randomBtn, ...exportBtns].forEach((b) => (b.disabled = !!on));
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function canvasToBlob(c, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob null"))), type, quality);
  });
}

// ============================================================================
// Data layer — pre-baked static assets
// ----------------------------------------------------------------------------
// The collection is immutable and finite (991 fragments). Every artwork was
// pre-baked to fragments/<id>.webp by scripts/build-manifest.py, so the runtime
// path is a single same-origin, edge-cached image load: no per-user ApeChain
// RPC call, no IPFS gateway race. manifest.json is the catalog/source-of-truth
// (name + traits per token); the render path needs only id + tier, both derived
// locally, so the front does not download it.
// ============================================================================
function fetchImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // same-origin now, but keep canvas-safe explicitly
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", () => reject(new Error("image load failed: " + url)));
    img.src = url;
  });
}

// Static path to a pre-baked fragment artwork.
function fragmentImageUrl(tokenId) {
  return `fragments/${tokenId}.webp`;
}

async function fetchFragment(id) {
  const tokenId = String(id);
  if (cache.has(tokenId)) return cache.get(tokenId);
  const t0 = performance.now();

  const imageURL = fragmentImageUrl(tokenId);
  let image;
  try {
    image = await fetchImage(imageURL);
  } catch (imgErr) {
    throw new Error(`Fragment #${tokenId} artwork not found: ${imgErr.message}`);
  }

  const t1 = performance.now();
  const entry = {
    id: tokenId,
    metadata: {
      identifier: tokenId,
      name: `Gabo Fragment #${tokenId}`,
      image_url: imageURL,
      _via: "static",
    },
    imageURL,
    image,
    tier: fragmentTier(tokenId),
    fromCache: false,
    loadMs: Math.round(t1 - t0),
  };
  cache.set(tokenId, entry);
  return entry;
}

// ============================================================================
// Canvas drawing — modern gallery card front as a single texture
// ============================================================================
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Render the gallery card FRONT — modern, clean, editorial.
 *
 *   ┌─────────────────────────────────────┐   <- SOLID COBALT frame body
 *   │   (thin lighter cobalt strip top)   │      with subtle metallic highlight
 *   │  ┌───────────────────────────────┐  │   <- 2px silver liner #C0C4CC
 *   │  │ ╔═══════════════════════════╗ │  │   <- cream mat (breathing room)
 *   │  │ ║                           ║ │  │
 *   │  │ ║       NFT ARTWORK         ║ │  │
 *   │  │ ║                           ║ │  │
 *   │  │ ╚═══════════════════════════╝ │  │
 *   │  │   ┌──── SILVER PLAQUE ────┐   │  │
 *   │  │   │ GABO FRAGMENTS SOCIETY│   │  │   silver-bone background
 *   │  │   │ FRAGMENT #247 · 1/900 │   │  │   deep cobalt text
 *   │  │   │ APECHAIN · 0x3d36..a2 │   │  │
 *   │  │   └───────────────────────┘   │  │
 *   │  └───────────────────────────────┘  │
 *   └─────────────────────────────────────┘
 */
function drawSlabFront(canvas, entry) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  // ===== Frame body — SOLID COBALT (high contrast vs typical artwork) =====
  ctx.fillStyle = COLOR.cobalt;
  ctx.fillRect(0, 0, W, H);

  // Subtle metallic highlight: lighter cobalt strip at the top edge (~5% of height)
  // Gradient from a brighter cobalt to the base cobalt — hint of dimensionality.
  const highlightH = Math.round(H * 0.05);
  const hg = ctx.createLinearGradient(0, 0, 0, highlightH);
  hg.addColorStop(0, COLOR.cobaltBright);
  hg.addColorStop(1, COLOR.cobalt);
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, W, highlightH);

  // Faint bottom shadow — opposite cue, very subtle
  const shadowH = Math.round(H * 0.04);
  const sg = ctx.createLinearGradient(0, H - shadowH, 0, H);
  sg.addColorStop(0, "rgba(15, 31, 64, 0)");
  sg.addColorStop(1, "rgba(15, 31, 64, 0.40)");
  ctx.fillStyle = sg;
  ctx.fillRect(0, H - shadowH, W, shadowH);

  // ===== Crisp outer hairline (deep cobalt) =====
  ctx.strokeStyle = COLOR.cobaltDeep;
  ctx.lineWidth = Math.max(1, W * 0.0014);
  ctx.strokeRect(
    ctx.lineWidth / 2,
    ctx.lineWidth / 2,
    W - ctx.lineWidth,
    H - ctx.lineWidth,
  );

  // ===== Frame layout: artwork window + plaque =====
  // Slightly thicker frame body now that it's dark, so it reads as a real frame.
  const FRAME_INSET = Math.round(W * 0.075);           // cobalt frame thickness
  const PLAQUE_H    = Math.round(H * 0.13);            // plaque area below artwork

  const artX = FRAME_INSET;
  const artY = FRAME_INSET;
  const artW = W - FRAME_INSET * 2;
  const artH = H - FRAME_INSET - PLAQUE_H - Math.round(H * 0.030);

  // ===== Cream mat (breathing room around the artwork) =====
  const matPad = Math.round(W * 0.020);
  // Cover the whole inner area (artwork + plaque + space between) with cream mat.
  const matX = artX - matPad;
  const matY = artY - matPad;
  const matW = artW + matPad * 2;
  const matH = (PLAQUE_H + Math.round(H * 0.030) + artH) + matPad * 2;
  ctx.fillStyle = COLOR.matCream;
  ctx.fillRect(matX, matY, matW, matH);

  // Very subtle tile motif on the cream mat (kept gentle so it doesn't compete)
  ctx.save();
  ctx.beginPath();
  ctx.rect(matX, matY, matW, matH);
  ctx.clip();
  drawTileMotif(ctx, matX, matY, matW, matH, 0.035);
  ctx.restore();

  // ===== 2px silver liner — between the cobalt frame and the cream mat =====
  // This is the "foleado sutil" — adds polished sophistication.
  const liner = Math.max(2, Math.round(W * 0.0035));
  ctx.strokeStyle = COLOR.silver;
  ctx.lineWidth = liner;
  ctx.strokeRect(
    matX - liner / 2,
    matY - liner / 2,
    matW + liner,
    matH + liner,
  );

  // Inner hairline at the silver liner's inside edge for crisp definition
  ctx.strokeStyle = "rgba(15, 31, 64, 0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(matX + 0.5, matY + 0.5, matW - 1, matH - 1);

  // ===== Soft drop shadow INSIDE the mat, around the artwork (depth cue) =====
  ctx.save();
  // top
  let g = ctx.createLinearGradient(0, artY - 6, 0, artY + 4);
  g.addColorStop(0, "rgba(15, 31, 64, 0)");
  g.addColorStop(1, "rgba(15, 31, 64, 0.18)");
  ctx.fillStyle = g;
  ctx.fillRect(artX - 4, artY - 6, artW + 8, 10);
  // left
  g = ctx.createLinearGradient(artX - 6, 0, artX + 4, 0);
  g.addColorStop(0, "rgba(15, 31, 64, 0)");
  g.addColorStop(1, "rgba(15, 31, 64, 0.14)");
  ctx.fillStyle = g;
  ctx.fillRect(artX - 6, artY - 4, 10, artH + 8);
  // right
  g = ctx.createLinearGradient(artX + artW - 4, 0, artX + artW + 6, 0);
  g.addColorStop(0, "rgba(15, 31, 64, 0.14)");
  g.addColorStop(1, "rgba(15, 31, 64, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(artX + artW - 4, artY - 4, 10, artH + 8);
  // bottom
  g = ctx.createLinearGradient(0, artY + artH - 4, 0, artY + artH + 6);
  g.addColorStop(0, "rgba(15, 31, 64, 0.12)");
  g.addColorStop(1, "rgba(15, 31, 64, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(artX - 4, artY + artH - 4, artW + 8, 10);
  ctx.restore();

  // ===== Artwork itself =====
  drawArtwork(ctx, artX, artY, artW, artH, entry);

  // ===== Plaque below the artwork =====
  const plaqueX = Math.round(W * 0.10);
  const plaqueY = artY + artH + Math.round(H * 0.038);
  const plaqueW = W - plaqueX * 2;
  const plaqueH = Math.round(H * 0.085);
  drawPlaque(ctx, plaqueX, plaqueY, plaqueW, plaqueH, entry);
}

/**
 * Render a subtle azulejo tile motif over (x, y, w, h) at a given alpha.
 * Uses small cobalt diamond + ring shapes; keeps the page editorial, not noisy.
 */
function drawTileMotif(ctx, x, y, w, h, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLOR.cobalt;
  ctx.strokeStyle = COLOR.cobalt;
  ctx.lineWidth = 1;
  const tile = Math.round(w / 12);
  for (let row = 0; row < Math.ceil(h / tile) + 1; row++) {
    for (let col = 0; col < Math.ceil(w / tile) + 1; col++) {
      const cx = x + col * tile + tile / 2;
      const cy = y + row * tile + tile / 2;
      // diamond
      ctx.beginPath();
      ctx.moveTo(cx, cy - tile * 0.20);
      ctx.lineTo(cx + tile * 0.20, cy);
      ctx.lineTo(cx, cy + tile * 0.20);
      ctx.lineTo(cx - tile * 0.20, cy);
      ctx.closePath();
      ctx.stroke();
      // ring
      ctx.beginPath();
      ctx.arc(cx, cy, tile * 0.06, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawArtwork(ctx, x, y, w, h, entry) {
  // Cream placeholder background (so we never show a bright cobalt void
  // — keep the editorial palette consistent)
  ctx.fillStyle = COLOR.cream;
  ctx.fillRect(x, y, w, h);

  if (entry && entry.image && entry.image.complete && entry.image.naturalWidth) {
    const img = entry.image;
    const srcW = img.naturalWidth, srcH = img.naturalHeight;
    const srcAR = srcW / srcH;
    const dstAR = w / h;
    let dW, dH, dX, dY;
    // Fit by "contain" so artwork is shown fully (no crop, no stretch).
    if (srcAR > dstAR) {
      dW = w;
      dH = w / srcAR;
      dX = x;
      dY = y + (h - dH) / 2;
    } else {
      dH = h;
      dW = h * srcAR;
      dX = x + (w - dW) / 2;
      dY = y;
    }
    ctx.drawImage(img, dX, dY, dW, dH);

    // 1px cobalt hairline around the actual artwork rectangle
    ctx.strokeStyle = "rgba(30, 58, 110, 0.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(dX + 0.5, dY + 0.5, dW - 1, dH - 1);
  } else {
    // Placeholder text
    ctx.fillStyle = COLOR.inkSoft;
    ctx.font = `500 ${Math.round(h * 0.030)}px 'Inter', system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Type a token ID and click Frame It", x + w / 2, y + h / 2 - 14);
    ctx.font = `400 ${Math.round(h * 0.022)}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = "rgba(85, 85, 85, 0.7)";
    ctx.fillText("Gabo Fragments Society · ApeChain · 0–990", x + w / 2, y + h / 2 + 16);
  }
}

function drawPlaque(ctx, x, y, w, h, entry) {
  ctx.save();
  // Silver-bone plaque background — museum-card feel
  ctx.fillStyle = COLOR.silverBone;
  roundRectPath(ctx, x, y, w, h, 2);
  ctx.fill();

  // Thin deep-cobalt outline
  ctx.strokeStyle = COLOR.cobaltDeep;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Top + bottom rule inside, very thin
  ctx.strokeStyle = "rgba(15, 31, 64, 0.25)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x + 12, y + 6);
  ctx.lineTo(x + w - 12, y + 6);
  ctx.moveTo(x + 12, y + h - 6);
  ctx.lineTo(x + w - 12, y + h - 6);
  ctx.stroke();

  // ===== Text — deep cobalt on silver-bone for high contrast =====
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";

  // Title — Inter Bold, cobalt deep
  const titleSize = Math.round(h * 0.22);
  ctx.font = `800 ${titleSize}px 'Inter', system-ui, sans-serif`;
  ctx.fillStyle = COLOR.cobaltDeep;
  const title = "GABO FRAGMENTS SOCIETY";
  ctx.fillText(truncateToWidth(ctx, title, w * 0.92), x + w / 2, y + titleSize + Math.round(h * 0.08));

  // Subtitle — fragment metadata (Inter Regular) — deep cobalt
  const subSize = Math.round(h * 0.16);
  ctx.font = `600 ${subSize}px 'Inter', system-ui, sans-serif`;
  ctx.fillStyle = COLOR.cobaltDeep;
  const tier = entry ? entry.tier : null;
  let sub;
  if (!entry) {
    sub = "FRAGMENT #--- · ---";
  } else if (tier && tier.tier === 0) {
    sub = `FRAGMENT #${entry.id} · GENESIS · 1/1`;
  } else if (tier) {
    sub = `FRAGMENT #${entry.id} · ${tier.label.toUpperCase()} · ${tier.of}/${tier.total}`;
  } else {
    sub = `FRAGMENT #${entry.id}`;
  }
  ctx.fillText(sub, x + w / 2, y + titleSize + Math.round(h * 0.08) + subSize + 6);

  // Provenance line — JetBrains Mono for the contract address
  const provSize = Math.round(h * 0.13);
  ctx.font = `500 ${provSize}px 'JetBrains Mono', ui-monospace, monospace`;
  ctx.fillStyle = COLOR.cobalt;
  const cShort = GABO_FRAGMENTS.contract.slice(0, 6) + "…" + GABO_FRAGMENTS.contract.slice(-4);
  const prov = `APECHAIN · ${cShort}`;
  ctx.fillText(prov, x + w / 2, y + titleSize + Math.round(h * 0.08) + subSize + 6 + provSize + 6);

  ctx.restore();
}

function truncateToWidth(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 4 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

// ============================================================================
// Three.js scene (with 2D fallback when WebGL is unavailable)
// ============================================================================
let renderer, scene, camera;
let slabMesh, frontMaterial, slabTextureCanvas, slabTexture;
let rafId = null;
let contextLost = false;
let manualRotation = false;
let manualRot = { x: 0, y: 0 };
let use3D = false;
let fallback2DCanvas = null;

function init3D() {
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true, preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  scene = new THREE.Scene();
  scene.background = null;

  camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
  camera.position.set(0, 0, 3.7);
  camera.lookAt(0, 0, 0);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // Lighting: warm gallery key + soft fill + ambient
  const key = new THREE.DirectionalLight(0xfdf6e8, 1.10);
  key.position.set(0.5, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xe6ddc8, 0.45);
  fill.position.set(-4, 1, 3);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0xeae3d2, 0.35));

  const slabGeom = new RoundedBoxGeometry(SLAB_W, SLAB_H, SLAB_D, 6, 0.012);

  slabTextureCanvas = document.createElement("canvas");
  slabTextureCanvas.width  = TEX_W;
  slabTextureCanvas.height = TEX_H;
  drawSlabFront(slabTextureCanvas, null);

  slabTexture = new THREE.CanvasTexture(slabTextureCanvas);
  slabTexture.colorSpace = THREE.SRGBColorSpace;
  slabTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  slabTexture.needsUpdate = true;

  // Modern gallery card material — texture map provides full colors.
  // color MUST be white (multiplier identity) so the map renders as authored.
  // The cobalt frame body + silver liner + cream mat are painted into the canvas texture itself.
  // Slight metalness/roughness tweak — refined surface without being shiny.
  frontMaterial = new THREE.MeshPhysicalMaterial({
    map: slabTexture,
    color: 0xffffff,
    metalness: 0.15,
    roughness: 0.65,
    clearcoat: 0.0,
    envMapIntensity: 0.50,
    side: THREE.FrontSide,
  });

  slabMesh = new THREE.Mesh(slabGeom, frontMaterial);
  scene.add(slabMesh);

  use3D = true;

  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement);

  let dragging = false, dragStart = { x: 0, y: 0 }, rotStart = { x: 0, y: 0 };
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true; manualRotation = true;
    dragStart = { x: e.clientX, y: e.clientY };
    rotStart = { x: slabMesh.rotation.x, y: slabMesh.rotation.y };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = (e.clientX - dragStart.x) / 200;
    const dy = (e.clientY - dragStart.y) / 200;
    manualRot.y = rotStart.y + dx;
    manualRot.x = rotStart.x + dy;
  });
  canvas.addEventListener("pointerup", () => { dragging = false; });
  canvas.addEventListener("dblclick", () => { manualRotation = false; });

  startAutoRotate();
}

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  if (use3D) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  } else if (fallback2DCanvas) {
    const pr = Math.min(window.devicePixelRatio, 2);
    canvas.width = Math.floor(w * pr);
    canvas.height = Math.floor(h * pr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    render2DPreview();
  }
}

function startAutoRotate() {
  if (rafId) return;
  const start = performance.now();
  function tick(now) {
    const t = (now - start) * 0.001;
    // Wrapped so a lost WebGL context (mobile drops the GPU when the app is
    // backgrounded, especially after AR) can't throw and kill the loop — the
    // loop survives and resumes rendering once the context is restored.
    try {
      if (use3D && !contextLost) {
        if (manualRotation) {
          slabMesh.rotation.x = manualRot.x;
          slabMesh.rotation.y = manualRot.y;
        } else {
          // Slow, dignified rotation — like a hanging card catching light
          slabMesh.rotation.y = Math.sin(t * 0.45) * 0.22;
          slabMesh.rotation.x = Math.cos(t * 0.33) * 0.04;
        }
        renderer.render(scene, camera);
      } else if (!use3D) {
        render2DPreview(t);
      }
    } catch (_err) {
      /* keep the loop alive; context-restore handler recovers rendering */
    }
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

function stopAutoRotate() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

// --- Resilience: recover from WebGL context loss + app backgrounding ---------
// Mobile browsers drop the WebGL context when the PWA is sent to the background
// (more so after a GPU-heavy AR session). Without this, the canvas freezes and
// the render loop dies — the app looks hung until you force-close it.
canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();      // REQUIRED so 'restored' can fire later
  contextLost = true;
}, false);
canvas.addEventListener("webglcontextrestored", () => {
  contextLost = false;
  if (slabTexture) slabTexture.needsUpdate = true; // force GPU re-upload
  resize();
  stopAutoRotate();
  startAutoRotate();
}, false);

// When returning to the app after switching away, rAF may have been parked and
// not auto-resume — force a fresh loop so the canvas is never left frozen.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && use3D) {
    stopAutoRotate();
    startAutoRotate();
  }
});

function rerenderSlabTexture() {
  drawSlabFront(slabTextureCanvas, current);
  if (use3D && slabTexture) slabTexture.needsUpdate = true;
  if (!use3D) render2DPreview();
}

function init2DFallback() {
  use3D = false;
  if (!slabTextureCanvas) {
    slabTextureCanvas = document.createElement("canvas");
    slabTextureCanvas.width = TEX_W;
    slabTextureCanvas.height = TEX_H;
    drawSlabFront(slabTextureCanvas, null);
  }
  fallback2DCanvas = canvas.getContext("2d");
  resize();
}

function render2DPreview(t = 0) {
  if (!fallback2DCanvas) return;
  const W = canvas.width, H = canvas.height;
  const ctx = fallback2DCanvas;
  ctx.clearRect(0, 0, W, H);

  const margin = 0.95;
  const slabAspect = SLAB_W / SLAB_H;
  let drawH = H * margin;
  let drawW = drawH * slabAspect;
  if (drawW > W * margin) { drawW = W * margin; drawH = drawW / slabAspect; }

  const rotY = Math.sin(t * 0.45) * 0.18;
  const skewX = -rotY * 0.16;
  const visScale = Math.cos(rotY) * 0.97 + 0.03;

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.transform(visScale, 0, skewX, 1, 0, 0);
  ctx.shadowColor = "rgba(15, 31, 64, 0.35)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 14;
  ctx.drawImage(slabTextureCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

// ============================================================================
// Exports
// ============================================================================
function requireCurrent() {
  if (!current) throw new Error("Load a fragment first — type a token id and click Frame It.");
  return current;
}

async function exportSlabPNG() {
  const e = requireCurrent();
  if (use3D) {
    const prev = new THREE.Vector2(); renderer.getSize(prev);
    const prevPR = renderer.getPixelRatio();
    const prevRotY = slabMesh.rotation.y, prevRotX = slabMesh.rotation.x;
    try {
      stopAutoRotate();
      const W = 2000, H = Math.round(W * SLAB_H / SLAB_W);
      renderer.setPixelRatio(1);
      renderer.setSize(W, H, false);
      camera.aspect = W / H; camera.updateProjectionMatrix();
      slabMesh.rotation.y = -0.14;
      slabMesh.rotation.x = 0.03;
      renderer.render(scene, camera);
      const blob = await canvasToBlob(canvas, "image/png");
      downloadBlob(blob, `gabo-frame-${e.id}.png`);
      showToast("frame PNG saved");
    } finally {
      renderer.setPixelRatio(prevPR);
      renderer.setSize(prev.x, prev.y, false);
      camera.aspect = prev.x / prev.y; camera.updateProjectionMatrix();
      slabMesh.rotation.y = prevRotY;
      slabMesh.rotation.x = prevRotX;
      startAutoRotate();
    }
  } else {
    const W = 1600;
    const H = Math.round(W * SLAB_H / SLAB_W) + 160;
    const out = document.createElement("canvas");
    out.width = W; out.height = H;
    const ctx = out.getContext("2d");
    ctx.imageSmoothingQuality = "high";

    // Cream paper background
    ctx.fillStyle = COLOR.cream;
    ctx.fillRect(0, 0, W, H);

    const drawW = Math.round(W * 0.92);
    const drawH = Math.round(drawW * SLAB_H / SLAB_W);
    const slabHighRes = document.createElement("canvas");
    slabHighRes.width = drawW;
    slabHighRes.height = drawH;
    drawSlabFront(slabHighRes, e);

    const angle = 0.10;
    const skewX = -angle * 0.16;
    const visScale = Math.cos(angle) * 0.97 + 0.03;

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.transform(visScale, 0, skewX, 1, 0, 0);
    ctx.shadowColor = "rgba(15, 31, 64, 0.35)";
    ctx.shadowBlur = 50;
    ctx.shadowOffsetY = 22;
    ctx.drawImage(slabHighRes, -drawW / 2, -drawH / 2);
    ctx.restore();

    const blob = await canvasToBlob(out, "image/png");
    downloadBlob(blob, `gabo-frame-${e.id}.png`);
    showToast("frame PNG saved");
  }
}

let gifLoading = null, gifWorkerUrl = null;
function ensureGifJs() {
  if (gifLoading) return gifLoading;
  gifLoading = (async () => {
    if (!window.GIF) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = GIFJS_URL; s.async = true;
        s.crossOrigin = "anonymous";
        s.integrity = GIFJS_SRI;
        s.onload = resolve;
        s.onerror = () => reject(new Error("Failed to load or verify gif.js (SRI mismatch?)"));
        document.head.appendChild(s);
      });
    }
    if (!gifWorkerUrl) {
      const r = await fetch(GIFJS_WORKER, { integrity: GIFJS_WORKER_SRI });
      if (!r.ok) throw new Error("Failed to fetch gif.worker.js");
      gifWorkerUrl = URL.createObjectURL(await r.blob());
    }
  })();
  return gifLoading;
}

async function exportSlabGIF() {
  const e = requireCurrent();
  setLoading(true, "rendering gif…");
  await ensureGifJs();

  const W = 900, H = Math.round(W * SLAB_H / SLAB_W);
  const gif = new window.GIF({
    workers: 2, quality: 10, width: W, height: H, workerScript: gifWorkerUrl,
  });

  if (use3D) {
    const prev = new THREE.Vector2(); renderer.getSize(prev);
    const prevPR = renderer.getPixelRatio();
    const prevRotY = slabMesh.rotation.y, prevRotX = slabMesh.rotation.x;
    try {
      stopAutoRotate();
      renderer.setPixelRatio(1);
      renderer.setSize(W, H, false);
      camera.aspect = W / H; camera.updateProjectionMatrix();
      scene.background = new THREE.Color(0xEDE6D5); // cream-2

      const FRAMES = 36, DELAY = 70;
      for (let i = 0; i < FRAMES; i++) {
        const t = i / FRAMES;
        slabMesh.rotation.y = Math.sin(t * Math.PI * 2) * 0.28;
        slabMesh.rotation.x = Math.cos(t * Math.PI * 2) * 0.05;
        renderer.render(scene, camera);
        const frame = document.createElement("canvas");
        frame.width = W; frame.height = H;
        frame.getContext("2d").drawImage(canvas, 0, 0, W, H);
        gif.addFrame(frame, { delay: DELAY });
      }
    } finally {
      scene.background = null;
      renderer.setPixelRatio(prevPR);
      renderer.setSize(prev.x, prev.y, false);
      camera.aspect = prev.x / prev.y; camera.updateProjectionMatrix();
      slabMesh.rotation.y = prevRotY;
      slabMesh.rotation.x = prevRotX;
      startAutoRotate();
    }
  } else {
    const FRAMES = 36, DELAY = 70;
    for (let i = 0; i < FRAMES; i++) {
      const t = i / FRAMES;
      const frame = document.createElement("canvas");
      frame.width = W; frame.height = H;
      render2DSlabFrame(frame, t);
      gif.addFrame(frame, { delay: DELAY });
    }
  }

  const blob = await new Promise((resolve, reject) => {
    gif.on("finished", resolve);
    gif.on("abort", () => reject(new Error("GIF aborted")));
    gif.render();
  });
  downloadBlob(blob, `gabo-frame-${e.id}.gif`);
  showToast("frame GIF saved");
}

function render2DSlabFrame(target, t) {
  const W = target.width, H = target.height;
  const ctx = target.getContext("2d");
  ctx.fillStyle = COLOR.cream2;
  ctx.fillRect(0, 0, W, H);

  const margin = 0.95;
  const slabAspect = SLAB_W / SLAB_H;
  let drawH = H * margin;
  let drawW = drawH * slabAspect;
  if (drawW > W * margin) { drawW = W * margin; drawH = drawW / slabAspect; }

  const angle = Math.sin(t * Math.PI * 2) * 0.28;
  const skewX = -angle * 0.16;
  const visScale = Math.cos(angle) * 0.97 + 0.03;

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.transform(visScale, 0, skewX, 1, 0, 0);
  ctx.shadowColor = "rgba(15, 31, 64, 0.35)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.drawImage(slabTextureCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

async function exportSlabWebM() {
  const e = requireCurrent();
  if (typeof MediaRecorder === "undefined")
    throw new Error("WebM recording not supported in this browser");
  setLoading(true, "recording webm…");

  const W = 1000, H = Math.round(W * SLAB_H / SLAB_W);
  const FPS = 30, DURATION = 4000;
  const mimePref = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const mime = mimePref.find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";

  if (use3D) {
    const prev = new THREE.Vector2(); renderer.getSize(prev);
    const prevPR = renderer.getPixelRatio();
    const prevRotY = slabMesh.rotation.y, prevRotX = slabMesh.rotation.x;
    try {
      stopAutoRotate();
      renderer.setPixelRatio(1);
      renderer.setSize(W, H, false);
      camera.aspect = W / H; camera.updateProjectionMatrix();
      scene.background = new THREE.Color(0xEDE6D5); // cream-2
      slabMesh.rotation.y = 0;
      renderer.render(scene, camera);

      const stream = canvas.captureStream(FPS);
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      const chunks = [];
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
      const start = performance.now();
      let raf;
      function loop(now) {
        const elapsed = now - start;
        const t = (elapsed / DURATION) % 1;
        slabMesh.rotation.y = Math.sin(t * Math.PI * 2) * 0.28;
        slabMesh.rotation.x = Math.cos(t * Math.PI * 2) * 0.05;
        renderer.render(scene, camera);
        if (elapsed < DURATION) raf = requestAnimationFrame(loop);
        else { rec.stop(); cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); }
      }
      const done = new Promise((resolve) => (rec.onstop = resolve));
      rec.start();
      raf = requestAnimationFrame(loop);
      await done;
      const blob = new Blob(chunks, { type: mime });
      if (!blob.size) throw new Error("WebM produced no data");
      downloadBlob(blob, `gabo-frame-${e.id}.webm`);
      showToast("frame WebM saved");
    } finally {
      scene.background = null;
      renderer.setPixelRatio(prevPR);
      renderer.setSize(prev.x, prev.y, false);
      camera.aspect = prev.x / prev.y; camera.updateProjectionMatrix();
      slabMesh.rotation.y = prevRotY;
      slabMesh.rotation.x = prevRotX;
      startAutoRotate();
    }
  } else {
    const rec2D = document.createElement("canvas");
    rec2D.width = W; rec2D.height = H;
    render2DSlabFrame(rec2D, 0);
    const stream = rec2D.captureStream(FPS);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    const start = performance.now();
    let raf;
    function loop(now) {
      const elapsed = now - start;
      const t = (elapsed / DURATION) % 1;
      render2DSlabFrame(rec2D, t);
      if (elapsed < DURATION) raf = requestAnimationFrame(loop);
      else { rec.stop(); cancelAnimationFrame(raf); stream.getTracks().forEach((tr) => tr.stop()); }
    }
    const done = new Promise((resolve) => (rec.onstop = resolve));
    rec.start();
    raf = requestAnimationFrame(loop);
    await done;
    const blob = new Blob(chunks, { type: mime });
    if (!blob.size) throw new Error("WebM produced no data");
    downloadBlob(blob, `gabo-frame-${e.id}.webm`);
    showToast("frame WebM saved");
  }
}

async function exportSlabGLB() {
  const e = requireCurrent();
  setLoading(true, "building 3D frame…");

  const exporter = new GLTFExporter();
  const exportScene = new THREE.Scene();

  let mesh;
  if (use3D && slabMesh) {
    mesh = slabMesh.clone();
  } else {
    const geom = new RoundedBoxGeometry(SLAB_W, SLAB_H, SLAB_D, 6, 0.012);
    const tex = new THREE.CanvasTexture(slabTextureCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const mat = new THREE.MeshPhysicalMaterial({
      map: tex,
      color: 0xffffff,
      metalness: 0.15,
      roughness: 0.65,
      clearcoat: 0.0,
    });
    mesh = new THREE.Mesh(geom, mat);
  }
  mesh.rotation.set(0, 0, 0);
  mesh.name = `GaboFrame_${e.id}`;
  exportScene.add(mesh);

  const buf = await new Promise((resolve, reject) => {
    try {
      exporter.parse(exportScene, resolve, reject, { binary: true, embedImages: true });
    } catch (err) { reject(err); }
  });
  if (!(buf instanceof ArrayBuffer)) throw new Error("GLB returned non-binary");
  downloadBlob(new Blob([buf], { type: "model/gltf-binary" }), `gabo-frame-${e.id}.glb`);
  showToast("frame GLB saved");
}

// ============================================================================
// "View in your room" — AR via <model-viewer> + native AR apps
// ----------------------------------------------------------------------------
// AR runs in the OS-native apps (Android Scene Viewer, iOS Quick Look), which
// anchor to walls properly and run OUTSIDE the PWA (no WebGL contention / freeze
// like the in-page WebXR path had). Scene Viewer downloads the GLB from a real
// URL (/ar/<id>.glb, built by the serverless route); Quick Look reads the USDZ
// generated client-side and passed as a data: URL.
// ============================================================================
const AR_FRAME_WIDTH_M = 0.6;     // real-world width of the framed piece (metres)
const MODEL_VIEWER_URL =
  "https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js";
let mvModulePromise = null;       // lazy-loaded @google/model-viewer
let arAssets = { id: null, usdzUrl: null };
let arCurrent = { id: null, usdzUrl: null }; // what the AR launch button uses

function ensureModelViewer() {
  if (!mvModulePromise) mvModulePromise = import(MODEL_VIEWER_URL);
  return mvModulePromise;
}

// The framed-card mesh, scaled to real-world metres for AR. The card texture is
// downscaled (the full 1200×1680 render is overkill for a phone wall, and the
// USDZ rides inside a data: URL for iOS Quick Look — keep it small).
const AR_TEX_MAX = 1024;
function buildArScene() {
  const scene = new THREE.Scene();
  const src = slabTextureCanvas;
  const f = Math.min(1, AR_TEX_MAX / Math.max(src.width, src.height));
  const tc = document.createElement("canvas");
  tc.width = Math.round(src.width * f);
  tc.height = Math.round(src.height * f);
  tc.getContext("2d").drawImage(src, 0, 0, tc.width, tc.height);

  const tex = new THREE.CanvasTexture(tc);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const geom = new RoundedBoxGeometry(SLAB_W, SLAB_H, SLAB_D, 6, 0.012);
  const mesh = new THREE.Mesh(geom, new THREE.MeshPhysicalMaterial({
    map: tex, color: 0xffffff, metalness: 0.15, roughness: 0.65,
  }));
  mesh.scale.multiplyScalar(AR_FRAME_WIDTH_M / SLAB_W); // scene units -> metres
  scene.add(mesh);
  return scene;
}

function bytesToBase64(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// iOS Quick Look needs a USDZ; we generate it client-side and pass it as a
// data: URL (Quick Look can read data:, but not an in-page blob:). Android's
// GLB instead comes from the /ar/<id>.glb serverless route, because Scene
// Viewer is a separate app that downloads the model from a real URL.
async function buildArUsdz(entry) {
  if (arAssets.id === entry.id && arAssets.usdzUrl) return arAssets.usdzUrl;
  const usdzBuf = await new USDZExporter().parse(buildArScene());
  const usdzUrl = "data:model/vnd.usdz+zip;base64," + bytesToBase64(usdzBuf);
  arAssets = { id: entry.id, usdzUrl };
  return usdzUrl;
}

async function openArViewer() {
  const e = requireCurrent();
  setLoading(true, "preparing AR…");
  try {
    await ensureModelViewer();
    const usdzUrl = await buildArUsdz(e);
    arCurrent = { id: e.id, usdzUrl };
    const glbUrl = `${location.origin}/ar/${e.id}.glb`; // server-built model

    // model-viewer is the in-page 3D preview AND the Android AR engine: with
    // ar-modes "webxr scene-viewer", Android uses WebXR (works where Scene
    // Viewer is broken). iOS is launched separately via Quick Look (launchAr).
    // model-viewer's own AR button is hidden (CSS) — our "View in AR" drives it.
    let mv = arModalStage.querySelector("model-viewer");
    if (!mv) {
      mv = document.createElement("model-viewer");
      mv.setAttribute("camera-controls", "");
      mv.setAttribute("touch-action", "pan-y");
      mv.setAttribute("shadow-intensity", "1");
      mv.setAttribute("ar", "");
      mv.setAttribute("ar-modes", "webxr scene-viewer");
      mv.setAttribute("ar-placement", "wall");
      mv.setAttribute("ar-scale", "fixed");
      arModalStage.appendChild(mv);
    }
    mv.setAttribute("src", glbUrl);
    mv.setAttribute("alt", `Gabo Fragment #${e.id} framed`);

    arModal.hidden = false;
    document.body.style.overflow = "hidden";
  } catch (err) {
    console.error(err);
    showError("Could not prepare AR: " + (err.message || err));
  } finally {
    setLoading(false);
  }
}

// Launch AR. iOS -> AR Quick Look via a rel="ar" anchor (USDZ data: URL).
// Android (and others) -> model-viewer's AR, which picks WebXR first, then
// Scene Viewer. WebXR runs in-page and works where the device's Scene Viewer
// is broken. Must stay in the click gesture (no await before activateAR).
function launchAr() {
  if (arCurrent.id == null) return;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if (isIOS) {
    const a = document.createElement("a");
    a.setAttribute("rel", "ar");
    a.appendChild(document.createElement("img")); // Quick Look expects a child
    a.href = arCurrent.usdzUrl;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }

  const mv = arModalStage.querySelector("model-viewer");
  if (mv && typeof mv.activateAR === "function") {
    mv.activateAR().catch((err) => {
      console.warn("activateAR failed:", err && err.message);
      showError("AR isn't available on this device/browser.");
    });
  }
}

function closeArViewer() {
  arModal.hidden = true;
  document.body.style.overflow = "";
}

// ============================================================================
// Load fragment flow
// ============================================================================
async function loadFragment(rawId) {
  const id = String(rawId).trim();
  if (!/^\d+$/.test(id)) return showError("Fragment id must be a positive integer");
  const n = Number(id);
  if (n < GABO_FRAGMENTS.minId || n > GABO_FRAGMENTS.maxId) {
    return showError(
      `Token #${id} not found — Gabo Fragments Society only has 991 pieces (${GABO_FRAGMENTS.minId}–${GABO_FRAGMENTS.maxId})`
    );
  }

  showError("");
  setLoading(true, "loading fragment…");
  setBusy(true);
  try {
    const entry = await fetchFragment(id);
    current = entry;
    rerenderSlabTexture();
    const tierLabel = entry.tier.tier === 0 ? "Genesis" : entry.tier.label;
    showToast(`Fragment #${id} · ${tierLabel} loaded in ${entry.loadMs}ms`);
  } catch (e) {
    console.error(e);
    showError(e.message || "Could not load fragment");
  } finally {
    setLoading(false);
    setBusy(false);
  }
}

function randomValidId() {
  return String(GABO_FRAGMENTS.minId + Math.floor(Math.random() * (GABO_FRAGMENTS.maxId - GABO_FRAGMENTS.minId + 1)));
}

// ============================================================================
// Wire up UI
// ============================================================================
frameItBtn.addEventListener("click", () => loadFragment(tokenInput.value || randomValidId()));
tokenInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && tokenInput.value.trim()) { e.preventDefault(); loadFragment(tokenInput.value); }
});
tokenInput.addEventListener("input", () => {
  const cleaned = tokenInput.value.replace(/[^0-9]/g, "").slice(0, 3);
  if (cleaned !== tokenInput.value) tokenInput.value = cleaned;
});
randomBtn.addEventListener("click", () => {
  const id = randomValidId();
  tokenInput.value = id;
  loadFragment(id);
});

// "View in your room" — AR. Pre-warm the model-viewer module on idle so the
// modal opens fast (the in-AR scan delay itself is ARCore detecting surfaces).
if ("requestIdleCallback" in window) {
  requestIdleCallback(() => ensureModelViewer().catch(() => {}), { timeout: 5000 });
}
if (viewInRoomBtn) viewInRoomBtn.addEventListener("click", openArViewer);
if (arLaunch) arLaunch.addEventListener("click", launchAr);
if (arClose) arClose.addEventListener("click", closeArViewer);
if (arModal) arModal.addEventListener("click", (ev) => {
  if (ev.target === arModal) closeArViewer(); // click on the backdrop closes
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && arModal && !arModal.hidden) closeArViewer();
});

const exporters = {
  "slab-png":  { fn: exportSlabPNG,  label: "exporting frame png…" },
  "slab-gif":  { fn: exportSlabGIF,  label: "rendering frame gif…" },
  "slab-glb":  { fn: exportSlabGLB,  label: "building 3D frame…" },
  "slab-webm": { fn: exportSlabWebM, label: "recording frame webm…" },
};
exportBtns.forEach((btn) => {
  btn.addEventListener("click", async () => {
    const ex = exporters[btn.dataset.export];
    if (!ex) return;
    showError("");
    try {
      setBusy(true);
      setLoading(true, ex.label);
      await ex.fn();
    } catch (err) {
      console.error(err);
      showError(err.message || "Export failed");
    } finally {
      setBusy(false);
      setLoading(false);
    }
  });
});

// ============================================================================
// Boot
// ============================================================================
(async function boot() {
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  } catch {}

  if (!slabTextureCanvas) {
    slabTextureCanvas = document.createElement("canvas");
    slabTextureCanvas.width = TEX_W;
    slabTextureCanvas.height = TEX_H;
    drawSlabFront(slabTextureCanvas, null);
  }

  try {
    init3D();
    renderer.render(scene, camera);
  } catch (err) {
    console.warn("WebGL unavailable — falling back to 2D preview:", err.message || err);
    init2DFallback();
  }

  startAutoRotate();

  // Default to Genesis (#0) on first load — most iconic piece
  tokenInput.value = "0";
  loadFragment("0");
})();

// ============================================================================
// PWA — register the service worker (installable + offline app shell)
// ============================================================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("SW registration failed (non-fatal):", err && err.message);
    });
  });
}
