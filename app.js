/* Gabo Fragments Frame Lab — community gallery-frame renderer
 *
 * Three.js renders a polished silver gallery frame with the Gabo Fragments
 * artwork inset, and a silver plaque below engraved with token info + fragment
 * tier. The same scene drives:
 *   - the live on-screen preview (looping rotation)
 *   - Frame PNG  (one frame, hi-res, at a flattering angle)
 *   - Frame GIF  (frames around a full rotation)
 *   - Frame WebM (MediaRecorder on canvas.captureStream)
 *   - Frame GLB  (GLTFExporter of the whole scene incl. artwork texture)
 *
 * Data: OpenSea API v2 for ApeChain. Falls back to ApeChain RPC + IPFS
 * gateway race if OpenSea is unavailable / rate-limited.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

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
  openseaApi: "https://api.opensea.io/api/v2",
  rpc: "https://rpc.apechain.com/http",
  gateways: [
    "https://gateway.pinata.cloud/ipfs",
    "https://dweb.link/ipfs",
    "https://nftstorage.link/ipfs",
    "https://w3s.link/ipfs",
    "https://ipfs.io/ipfs",
  ],
};

window.GABO_FRAGMENTS = GABO_FRAGMENTS; // expose for tests / debugging

const GIFJS_URL    = "https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.js";
const GIFJS_WORKER = "https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js";
const GIFJS_SRI        = "sha384-4RMW82CWFobXY+HRHXe5go/V5acBhiIVGCT+2k7TEoxi7AiWKw8WoWb9qMU+FAFu";
const GIFJS_WORKER_SRI = "sha384-uL0SwIQSos1DfQU2KzlDbPuSz7Jwo+hmNPIhe86VJ+MWwyj0DvjngnAgWrkNi9eQ";

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
const footerYear   = $("footerYear");
footerYear.textContent = new Date().getFullYear();

// ============================================================================
// State
// ============================================================================
const cache = new Map();
const LS_PREFIX = "gabo-frag-cache-v1::";
let current = null;
let errorTimer = null, toastTimer = null;

// Restore cached metadata from localStorage (image still has to be re-fetched
// each session, but metadata is cheap to keep around).
function loadMetaFromLS(id) {
  try {
    const v = localStorage.getItem(LS_PREFIX + id);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}
function saveMetaToLS(id, meta) {
  try {
    localStorage.setItem(LS_PREFIX + id, JSON.stringify(meta));
  } catch { /* quota — non-fatal */ }
}

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
// Data layer — OpenSea API v2 with IPFS gateway race fallback
// ============================================================================
function fetchImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", () => reject(new Error("image load failed: " + url)));
    img.src = url;
  });
}

// Rewrite ipfs://CID[/path] to a list of HTTPS gateway URLs.
function ipfsToGatewayUrls(ipfsUri) {
  const cidPath = String(ipfsUri).replace(/^ipfs:\/\//, "").replace(/^\/ipfs\//, "");
  return GABO_FRAGMENTS.gateways.map((gw) => `${gw}/${cidPath}`);
}

// Race an image across multiple URLs; resolve with the first one that loads.
function raceImageUrls(urls) {
  return new Promise((resolve, reject) => {
    if (!urls.length) return reject(new Error("No image URLs to race"));
    const imgs = urls.map(() => { const img = new Image(); img.crossOrigin = "anonymous"; return img; });
    let resolved = false, errored = 0;
    urls.forEach((u, i) => {
      imgs[i].addEventListener("load", () => {
        if (resolved) return;
        resolved = true;
        imgs.forEach((other, j) => { if (j !== i) other.src = ""; });
        resolve({ image: imgs[i], url: u });
      });
      imgs[i].addEventListener("error", () => {
        errored++;
        if (errored === urls.length && !resolved) reject(new Error("All image URLs failed"));
      });
      imgs[i].src = u;
    });
  });
}

// Primary path: OpenSea v2 NFT endpoint. Returns { identifier, name, image_url, metadata_url, traits, ... }.
async function fetchOpenSea(tokenId) {
  const url = `${GABO_FRAGMENTS.openseaApi}/chain/${GABO_FRAGMENTS.chain}/contract/${GABO_FRAGMENTS.contract}/nfts/${tokenId}`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) {
    if (r.status === 404) throw new Error(`Gabo Fragment #${tokenId} not indexed on OpenSea yet`);
    if (r.status === 429) throw new Error("OpenSea rate-limited — try again in a minute");
    throw new Error(`OpenSea HTTP ${r.status}`);
  }
  const json = await r.json();
  if (!json.nft) throw new Error("OpenSea response missing nft");
  return json.nft;
}

// Fallback path: read tokenURI(uint256) directly from ApeChain RPC.
async function fetchFromRpc(tokenId) {
  // tokenURI(uint256) selector = 0xc87b56dd
  const idHex = BigInt(tokenId).toString(16).padStart(64, "0");
  const data = "0xc87b56dd" + idHex;
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{ to: GABO_FRAGMENTS.contract, data }, "latest"],
  };
  const r = await fetch(GABO_FRAGMENTS.rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`ApeChain RPC HTTP ${r.status}`);
  const json = await r.json();
  if (json.error) throw new Error(`RPC: ${json.error.message || "unknown"}`);
  const result = json.result || "";
  if (!result || result === "0x") throw new Error("tokenURI returned empty");

  // ABI-decode dynamic string
  const decoded = decodeAbiString(result);
  if (!decoded) throw new Error("Could not decode tokenURI");

  // tokenURI may be data: URI, ipfs:// URI, or https://
  let metaText;
  if (decoded.startsWith("data:application/json;base64,")) {
    metaText = atob(decoded.slice("data:application/json;base64,".length));
  } else if (decoded.startsWith("data:application/json,")) {
    metaText = decodeURIComponent(decoded.slice("data:application/json,".length));
  } else if (decoded.startsWith("ipfs://")) {
    const urls = ipfsToGatewayUrls(decoded);
    const winner = await Promise.any(urls.map((u) =>
      fetch(u).then((r2) => { if (!r2.ok) throw new Error(String(r2.status)); return r2.text(); })
    ));
    metaText = winner;
  } else if (decoded.startsWith("http")) {
    const r2 = await fetch(decoded);
    if (!r2.ok) throw new Error(`tokenURI HTTP ${r2.status}`);
    metaText = await r2.text();
  } else {
    throw new Error("Unknown tokenURI scheme: " + decoded.slice(0, 40));
  }
  return JSON.parse(metaText);
}

function decodeAbiString(hex) {
  if (!hex.startsWith("0x")) return null;
  const buf = hex.slice(2);
  // offset (32 bytes), length (32 bytes), then data padded to 32 bytes
  if (buf.length < 128) return null;
  const len = parseInt(buf.slice(64, 128), 16);
  if (!Number.isFinite(len) || len <= 0) return null;
  const dataHex = buf.slice(128, 128 + len * 2);
  try {
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = parseInt(dataHex.slice(i * 2, i * 2 + 2), 16);
    return new TextDecoder().decode(bytes);
  } catch { return null; }
}

async function fetchFragment(id) {
  const tokenId = String(id);
  if (cache.has(tokenId)) return cache.get(tokenId);
  const t0 = performance.now();

  // Try in-memory + localStorage cache first
  let meta = loadMetaFromLS(tokenId);
  let fromCache = !!meta;

  if (!meta) {
    try {
      meta = await fetchOpenSea(tokenId);
    } catch (openSeaErr) {
      // Fallback to RPC + IPFS race
      try {
        meta = await fetchFromRpc(tokenId);
        // Normalize to the OpenSea-like shape so downstream code is uniform
        meta = {
          identifier: tokenId,
          name: meta.name || `Gabo Fragment #${tokenId}`,
          description: meta.description || "",
          image_url: meta.image || meta.image_url || "",
          metadata_url: "",
          traits: (meta.attributes || []).map((a) => ({
            trait_type: a.trait_type, value: a.value,
          })),
          _via: "rpc",
        };
      } catch (rpcErr) {
        throw new Error(
          `Both OpenSea and ApeChain RPC failed for #${tokenId}: ${openSeaErr.message}; ${rpcErr.message}`
        );
      }
    }
    saveMetaToLS(tokenId, meta);
  }

  // Resolve image — handle https, ipfs://, opensea CDN
  let image;
  let imageURL = String(meta.image_url || "");

  if (!imageURL) throw new Error(`No image_url for fragment #${tokenId}`);

  try {
    if (imageURL.startsWith("ipfs://")) {
      const urls = ipfsToGatewayUrls(imageURL);
      const winner = await raceImageUrls(urls);
      image = winner.image;
      imageURL = winner.url;
    } else {
      image = await fetchImage(imageURL);
    }
  } catch (imgErr) {
    throw new Error(`Image load failed for #${tokenId}: ${imgErr.message}`);
  }

  const t1 = performance.now();
  const entry = {
    id: tokenId,
    metadata: meta,
    imageURL,
    image,
    tier: fragmentTier(tokenId),
    fromCache,
    loadMs: Math.round(t1 - t0),
  };
  cache.set(tokenId, entry);
  return entry;
}

// ============================================================================
// Canvas drawing — the full FRAME FRONT as a single texture
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
 * Render the gallery frame FRONT.
 *
 *   ┌─────────────────────────────────────┐   <- polished silver molding
 *   │  ╔═══════════════════════════════╗  │
 *   │  ║                               ║  │
 *   │  ║       NFT ARTWORK             ║  │   (inset, with shadow)
 *   │  ║                               ║  │
 *   │  ║                               ║  │
 *   │  ╚═══════════════════════════════╝  │
 *   │  ─────── SILVER PLAQUE ─────────    │
 *   │   GABO · FRAGMENTS SOCIETY          │
 *   │   Fragment #247 — Tier 3 (900)      │
 *   │   ApeChain · 0x3d36…80a2            │
 *   └─────────────────────────────────────┘
 */
function drawSlabFront(canvas, entry) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  // ===== Frame outer molding (polished silver gradient with depth) =====
  // Base
  const baseGrad = ctx.createLinearGradient(0, 0, W, H);
  baseGrad.addColorStop(0,    "#7a7e85");
  baseGrad.addColorStop(0.25, "#c0c4cc");
  baseGrad.addColorStop(0.50, "#e8eaef");
  baseGrad.addColorStop(0.75, "#c0c4cc");
  baseGrad.addColorStop(1,    "#7a7e85");
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, W, H);

  // Inner darker shadow band (the lip of the moulding)
  const FRAME_W = Math.round(W * 0.06);   // outer molding thickness
  const FRAME_H_TOP = Math.round(H * 0.045);
  const FRAME_H_SIDE = Math.round(W * 0.06);
  const PLAQUE_H = Math.round(H * 0.13);   // plaque area below artwork

  // Artwork window coordinates (the inset hole)
  const artX = FRAME_W;
  const artY = FRAME_H_TOP;
  const artW = W - FRAME_W * 2;
  const artH = H - FRAME_H_TOP - PLAQUE_H - Math.round(H * 0.022);

  // Carved ornament — outer ring of detail (top/bottom bevels)
  drawFrameOrnaments(ctx, W, H, FRAME_W, FRAME_H_TOP, PLAQUE_H);

  // Inner shadow / rabbet around the artwork window
  ctx.save();
  const shadowGrad = ctx.createLinearGradient(artX - 8, artY - 8, artX, artY);
  shadowGrad.addColorStop(0, "rgba(0,0,0,0.55)");
  shadowGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadowGrad;
  ctx.fillRect(artX - 12, artY - 12, artW + 24, 14);

  const shadowSide = ctx.createLinearGradient(artX - 8, 0, artX, 0);
  shadowSide.addColorStop(0, "rgba(0,0,0,0.45)");
  shadowSide.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadowSide;
  ctx.fillRect(artX - 12, artY - 6, 14, artH + 12);

  const shadowRight = ctx.createLinearGradient(artX + artW, 0, artX + artW + 8, 0);
  shadowRight.addColorStop(0, "rgba(0,0,0,0)");
  shadowRight.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = shadowRight;
  ctx.fillRect(artX + artW - 2, artY - 6, 14, artH + 12);

  const shadowBot = ctx.createLinearGradient(0, artY + artH, 0, artY + artH + 8);
  shadowBot.addColorStop(0, "rgba(0,0,0,0)");
  shadowBot.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = shadowBot;
  ctx.fillRect(artX - 6, artY + artH - 2, artW + 12, 14);
  ctx.restore();

  // ===== Artwork mat (the bevel between frame and artwork) =====
  const matPad = Math.round(W * 0.012);
  ctx.fillStyle = "#1a3050"; // deep cobalt — like a gallery mat
  ctx.fillRect(artX - matPad, artY - matPad, artW + matPad * 2, artH + matPad * 2);

  // Thin silver liner inside the mat
  ctx.strokeStyle = "rgba(192,196,204,0.65)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(artX - matPad + 4, artY - matPad + 4, artW + matPad * 2 - 8, artH + matPad * 2 - 8);

  // ===== Artwork itself =====
  drawArtwork(ctx, artX, artY, artW, artH, entry);

  // ===== Silver plaque below the artwork =====
  const plaqueX = Math.round(W * 0.16);
  const plaqueY = artY + artH + Math.round(H * 0.030);
  const plaqueW = W - plaqueX * 2;
  const plaqueH = Math.round(H * 0.09);
  drawSilverPlaque(ctx, plaqueX, plaqueY, plaqueW, plaqueH, entry);

  // ===== Spotlight from above — soft cool wash for silver =====
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const spot = ctx.createRadialGradient(W / 2, -H * 0.12, W * 0.10, W / 2, H * 0.35, W * 0.85);
  spot.addColorStop(0, "rgba(240, 244, 252, 0.45)");
  spot.addColorStop(0.4, "rgba(240, 244, 252, 0.18)");
  spot.addColorStop(1, "rgba(240, 244, 252, 0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // ===== Final outer frame highlight (top edge catches light) =====
  ctx.save();
  const topHL = ctx.createLinearGradient(0, 0, 0, H * 0.04);
  topHL.addColorStop(0, "rgba(248, 250, 255, 0.70)");
  topHL.addColorStop(1, "rgba(248, 250, 255, 0)");
  ctx.fillStyle = topHL;
  ctx.fillRect(0, 0, W, H * 0.04);
  ctx.restore();

  // ===== Bottom edge shadow (the frame's lower lip) =====
  ctx.save();
  const botSh = ctx.createLinearGradient(0, H - H * 0.04, 0, H);
  botSh.addColorStop(0, "rgba(0,0,0,0)");
  botSh.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = botSh;
  ctx.fillRect(0, H - H * 0.04, W, H * 0.04);
  ctx.restore();
}

function drawFrameOrnaments(ctx, W, H, FRAME_W, FRAME_H_TOP, PLAQUE_H) {
  // Inner darker outline of the frame (looks like a carved profile)
  ctx.save();

  // Outer beveled edge — bright silver gleam just inside the very edge
  ctx.strokeStyle = "rgba(232, 234, 239, 0.65)";
  ctx.lineWidth = 2.5;
  ctx.strokeRect(2, 2, W - 4, H - 4);

  // Mid darker line — the "valley" between two ridges of the moulding (tarnished silver)
  ctx.strokeStyle = "rgba(70, 75, 82, 0.55)";
  ctx.lineWidth = 1.5;
  const inset = Math.round(FRAME_W * 0.45);
  ctx.strokeRect(inset, inset * 0.7, W - inset * 2, H - inset * 1.4);

  // Inner bright ridge (catches light around the artwork window)
  ctx.strokeStyle = "rgba(232, 234, 239, 0.75)";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(FRAME_W - 4, FRAME_H_TOP - 4, W - FRAME_W * 2 + 8, H - FRAME_H_TOP - PLAQUE_H - Math.round(H * 0.022) + 8);

  // Corner flourishes — small decorative carved motifs
  drawCornerFlourish(ctx, FRAME_W * 0.5,     FRAME_H_TOP * 0.5, FRAME_W * 0.55);
  drawCornerFlourish(ctx, W - FRAME_W * 0.5, FRAME_H_TOP * 0.5, FRAME_W * 0.55, true, false);
  drawCornerFlourish(ctx, FRAME_W * 0.5,     H - PLAQUE_H * 0.5 - H * 0.022 - FRAME_H_TOP * 0.5, FRAME_W * 0.55, false, true);
  drawCornerFlourish(ctx, W - FRAME_W * 0.5, H - PLAQUE_H * 0.5 - H * 0.022 - FRAME_H_TOP * 0.5, FRAME_W * 0.55, true, true);

  // Top center crest (museum frame often has a small ornament)
  drawCenterCrest(ctx, W / 2, FRAME_H_TOP * 0.55, FRAME_W * 0.85);

  ctx.restore();
}

function drawCornerFlourish(ctx, cx, cy, size, flipX = false, flipY = false) {
  ctx.save();
  ctx.translate(cx, cy);
  if (flipX) ctx.scale(-1, 1);
  if (flipY) ctx.scale(1, -1);

  // Dark engraving lines (tarnished silver shading)
  ctx.strokeStyle = "rgba(50, 55, 62, 0.75)";
  ctx.lineWidth = size * 0.04;
  ctx.lineCap = "round";

  // Acanthus leaf curl — stylized
  ctx.beginPath();
  ctx.moveTo(-size * 0.45, -size * 0.45);
  ctx.quadraticCurveTo(0, -size * 0.20, size * 0.45, -size * 0.45);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-size * 0.45, -size * 0.45);
  ctx.quadraticCurveTo(-size * 0.20, 0, -size * 0.45, size * 0.45);
  ctx.stroke();

  // Small filled jewel center (cool silver)
  const jewelGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.20);
  jewelGrad.addColorStop(0, "#e8eaef");
  jewelGrad.addColorStop(0.6, "#7a7e85");
  jewelGrad.addColorStop(1, "#4a4d54");
  ctx.fillStyle = jewelGrad;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(50, 55, 62, 0.85)";
  ctx.lineWidth = size * 0.03;
  ctx.stroke();

  // Bright catchlight on the jewel (top-left)
  ctx.fillStyle = "rgba(248, 250, 255, 0.75)";
  ctx.beginPath();
  ctx.arc(-size * 0.04, -size * 0.04, size * 0.04, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawCenterCrest(ctx, cx, cy, w) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "rgba(50, 55, 62, 0.75)";
  ctx.lineWidth = w * 0.015;
  ctx.lineCap = "round";

  // Central rosette (silver)
  const r = w * 0.18;
  const rosGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  rosGrad.addColorStop(0, "#e8eaef");
  rosGrad.addColorStop(0.7, "#7a7e85");
  rosGrad.addColorStop(1, "#4a4d54");
  ctx.fillStyle = rosGrad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 8-pointed rays carved around
  ctx.strokeStyle = "rgba(50, 55, 62, 0.6)";
  ctx.lineWidth = w * 0.010;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x1 = Math.cos(a) * r * 1.05;
    const y1 = Math.sin(a) * r * 1.05;
    const x2 = Math.cos(a) * r * 1.55;
    const y2 = Math.sin(a) * r * 1.55;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // Scrollwork wings
  ctx.lineWidth = w * 0.018;
  ctx.beginPath();
  ctx.moveTo(-r * 1.7, 0);
  ctx.quadraticCurveTo(-r * 2.4, -r * 0.6, -r * 3.0, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(r * 1.7, 0);
  ctx.quadraticCurveTo(r * 2.4, -r * 0.6, r * 3.0, 0);
  ctx.stroke();

  // Catchlight
  ctx.fillStyle = "rgba(248, 250, 255, 0.6)";
  ctx.beginPath();
  ctx.arc(-r * 0.25, -r * 0.25, r * 0.18, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawArtwork(ctx, x, y, w, h, entry) {
  // Deep cobalt placeholder (gallery mat color)
  ctx.fillStyle = "#102d5a";
  ctx.fillRect(x, y, w, h);

  if (entry && entry.image && entry.image.complete && entry.image.naturalWidth) {
    const img = entry.image;
    const srcW = img.naturalWidth, srcH = img.naturalHeight;
    const srcAR = srcW / srcH;
    const dstAR = w / h;
    let dW, dH, dX, dY;
    // Fit by "contain" so artwork is shown fully (no crop, no stretch).
    // Bars on the sides/top will show the cobalt mat behind.
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
    // Soft drop shadow under the artwork
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 6;
    ctx.drawImage(img, dX, dY, dW, dH);
    ctx.restore();

    // Crisp 1px silver inner border around the artwork rectangle
    ctx.strokeStyle = "rgba(192, 196, 204, 0.65)";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(dX + 0.5, dY + 0.5, dW - 1, dH - 1);
  } else {
    // Placeholder text
    ctx.fillStyle = "rgba(255, 248, 222, 0.65)";
    ctx.font = `500 ${Math.round(h * 0.028)}px 'JetBrains Mono', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Type a token ID and click Frame it", x + w / 2, y + h / 2 - 14);
    ctx.font = `400 ${Math.round(h * 0.020)}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = "rgba(255, 248, 222, 0.42)";
    ctx.fillText("Gabo Fragments Society · ApeChain · 0–990", x + w / 2, y + h / 2 + 16);
  }
}

function drawSilverPlaque(ctx, x, y, w, h, entry) {
  ctx.save();
  // Silver plate gradient (engraved appearance, polished sterling)
  const plate = ctx.createLinearGradient(0, y, 0, y + h);
  plate.addColorStop(0, "#9aa0a8");
  plate.addColorStop(0.45, "#d4d7dd");
  plate.addColorStop(0.55, "#e8eaef");
  plate.addColorStop(1, "#7a7e85");
  ctx.fillStyle = plate;
  roundRectPath(ctx, x, y, w, h, 4);
  ctx.fill();

  // Plate border — dark engraving (tarnished silver)
  ctx.strokeStyle = "rgba(45, 50, 56, 0.85)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Inner double engraved line
  ctx.strokeStyle = "rgba(45, 50, 56, 0.5)";
  ctx.lineWidth = 0.8;
  ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);

  // Screw heads in the four corners — tiny dark dots
  const screwR = Math.min(w, h) * 0.012;
  const screwOff = Math.min(w, h) * 0.028;
  for (const [sx, sy] of [
    [x + screwOff, y + screwOff],
    [x + w - screwOff, y + screwOff],
    [x + screwOff, y + h - screwOff],
    [x + w - screwOff, y + h - screwOff],
  ]) {
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, screwR);
    sg.addColorStop(0, "#2a2d32");
    sg.addColorStop(1, "#4a4d54");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sx, sy, screwR, 0, Math.PI * 2);
    ctx.fill();
    // slot
    ctx.strokeStyle = "rgba(15,18,22,0.85)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(sx - screwR * 0.7, sy);
    ctx.lineTo(sx + screwR * 0.7, sy);
    ctx.stroke();
  }

  // ===== Engraved text — deep cobalt for contrast against silver =====
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";

  // Title — Cormorant / serif (italic for elegance)
  const titleSize = Math.round(h * 0.26);
  ctx.font = `600 ${titleSize}px 'Cormorant Garamond', 'Playfair Display', Georgia, serif`;
  ctx.fillStyle = "#0d1d35";
  // Shadow for engraved depth (cool silver highlight)
  ctx.shadowColor = "rgba(248, 250, 255, 0.65)";
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  ctx.shadowBlur = 0;
  const title = (entry?.metadata?.name && String(entry.metadata.name)) || "Gabo Fragments Society";
  ctx.fillText(truncateToWidth(ctx, title, w * 0.92), x + w / 2, y + titleSize + 4);
  ctx.shadowColor = "transparent";

  // Subtitle — fragment id + tier
  const subSize = Math.round(h * 0.18);
  ctx.font = `600 ${subSize}px 'Cinzel', 'Cormorant Garamond', serif`;
  ctx.fillStyle = "#102d5a";
  const tier = entry ? entry.tier : null;
  const sub = entry
    ? (tier && tier.tier === 0
        ? `Fragment #${entry.id} · Genesis`
        : tier
          ? `Fragment #${entry.id} · ${tier.label} (${tier.total})`
          : `Fragment #${entry.id}`)
    : "Fragment #---";
  ctx.shadowColor = "rgba(248, 250, 255, 0.55)";
  ctx.shadowOffsetY = 1;
  ctx.fillText(sub, x + w / 2, y + titleSize + 4 + subSize + 6);

  // Provenance line (small mono) — chain + short contract
  const provSize = Math.round(h * 0.13);
  ctx.font = `500 ${provSize}px 'JetBrains Mono', monospace`;
  ctx.fillStyle = "#0d1d35";
  const cShort = GABO_FRAGMENTS.contract.slice(0, 6) + "…" + GABO_FRAGMENTS.contract.slice(-4);
  const prov = `ApeChain · ${cShort}`;
  ctx.fillText(prov, x + w / 2, y + titleSize + 4 + subSize + 6 + provSize + 6);

  // Decorative diamond separator marks (tarnished silver)
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "rgba(45, 50, 56, 0.7)";
  ctx.font = `600 ${Math.round(h * 0.14)}px 'Cormorant Garamond', serif`;
  ctx.fillText("◆", x + w * 0.10, y + h * 0.62);
  ctx.fillText("◆", x + w * 0.90, y + h * 0.62);

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
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();
  scene.background = null;

  camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
  camera.position.set(0, 0, 3.7);
  camera.lookAt(0, 0, 0);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // Lighting: cool gallery spotlight from above, soft ambient + side fill
  const key = new THREE.DirectionalLight(0xf6f8ff, 1.25);
  key.position.set(0.5, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdce0e8, 0.55);
  fill.position.set(-4, 1, 3);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0xeaeef5, 0.35));

  const slabGeom = new RoundedBoxGeometry(SLAB_W, SLAB_H, SLAB_D, 6, 0.015);

  slabTextureCanvas = document.createElement("canvas");
  slabTextureCanvas.width  = TEX_W;
  slabTextureCanvas.height = TEX_H;
  drawSlabFront(slabTextureCanvas, null);

  slabTexture = new THREE.CanvasTexture(slabTextureCanvas);
  slabTexture.colorSpace = THREE.SRGBColorSpace;
  slabTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  slabTexture.needsUpdate = true;

  // Silver frame material — polished sterling sheen: modestly higher metalness
  // and lower roughness than a wood frame, without going full chrome.
  frontMaterial = new THREE.MeshPhysicalMaterial({
    map: slabTexture,
    color: 0xc0c4cc,
    roughness: 0.30,
    metalness: 0.65,
    clearcoat: 0.7,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.15,
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
    if (use3D) {
      if (manualRotation) {
        slabMesh.rotation.x = manualRot.x;
        slabMesh.rotation.y = manualRot.y;
      } else {
        // Slower, more dignified rotation — like a hanging frame catching light
        slabMesh.rotation.y = Math.sin(t * 0.45) * 0.22;
        slabMesh.rotation.x = Math.cos(t * 0.33) * 0.04;
      }
      renderer.render(scene, camera);
    } else {
      render2DPreview(t);
    }
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

function stopAutoRotate() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

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
  ctx.shadowColor = "rgba(13, 29, 53, 0.45)";
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
  if (!current) throw new Error("Load a fragment first — type a token id and click Frame it.");
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
      showToast("◆ frame PNG saved");
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

    // Aged-paper background
    ctx.fillStyle = "#ebe4d2";
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
    ctx.shadowColor = "rgba(13, 29, 53, 0.45)";
    ctx.shadowBlur = 50;
    ctx.shadowOffsetY = 22;
    ctx.drawImage(slabHighRes, -drawW / 2, -drawH / 2);
    ctx.restore();

    const blob = await canvasToBlob(out, "image/png");
    downloadBlob(blob, `gabo-frame-${e.id}.png`);
    showToast("◆ frame PNG saved");
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
      scene.background = new THREE.Color(0xebe4d2);

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
  showToast("◆ frame GIF saved");
}

function render2DSlabFrame(target, t) {
  const W = target.width, H = target.height;
  const ctx = target.getContext("2d");
  ctx.fillStyle = "#ebe4d2";
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
  ctx.shadowColor = "rgba(13, 29, 53, 0.45)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.drawImage(slabTextureCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  // Warm spotlight catchlight that moves with rotation
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.transform(visScale, 0, skewX, 1, 0, 0);
  ctx.beginPath();
  ctx.rect(-drawW / 2, -drawH / 2, drawW, drawH);
  ctx.clip();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  ctx.globalCompositeOperation = "screen";
  const cx = W / 2 + angle * W * 0.4;
  const cool = ctx.createLinearGradient(cx - W * 0.2, 0, cx + W * 0.2, H);
  cool.addColorStop(0.0, "rgba(240, 244, 252, 0)");
  cool.addColorStop(0.5, "rgba(240, 244, 252, 0.25)");
  cool.addColorStop(1.0, "rgba(240, 244, 252, 0)");
  ctx.fillStyle = cool;
  ctx.fillRect(0, 0, W, H);
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
      scene.background = new THREE.Color(0xebe4d2);
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
      showToast("◆ frame WebM saved");
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
    showToast("◆ frame WebM saved");
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
    const geom = new RoundedBoxGeometry(SLAB_W, SLAB_H, SLAB_D, 6, 0.015);
    const tex = new THREE.CanvasTexture(slabTextureCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const mat = new THREE.MeshPhysicalMaterial({
      map: tex,
      color: 0xc0c4cc,
      roughness: 0.30,
      metalness: 0.65,
      clearcoat: 0.7,
      clearcoatRoughness: 0.12,
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
  showToast("◆ frame GLB saved");
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
    showToast(`◆ Fragment #${id} · ${tierLabel} loaded in ${entry.loadMs}ms`);
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
