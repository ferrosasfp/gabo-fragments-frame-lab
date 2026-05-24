# Gabo Fragments Frame Lab

A non-commercial, community-built fan tool for **Gabo Fragments Society** NFT holders. Drop in a token id and get a modern gallery card with PNG / GIF / WebM / GLB exports — all rendered in your browser. Editorial cobalt + cream aesthetic that pairs with the GFS brand.

## What it does

Pulls publicly available fragment artwork + metadata from OpenSea (ApeChain) — with IPFS gateway fallbacks — and renders a **modern gallery card** (clean cobalt rule, bone-white liner, cream mat with a subtle azulejo tile motif, and a printed plaque). The same scene drives a flat PNG, a rotating GIF, a 3D GLB, or an HD WebM clip.

| Export | Format | Notes |
|---|---|---|
| Frame | PNG | 2x hi-res render at a flattering angle |
| Frame | GIF | 36-frame loop, ~2.5s |
| Frame | WebM | HD video, 4s, MediaRecorder |
| Frame | GLB | 3D model, WebXR-ready |

Everything happens client-side — no server, no upload, no tracking, no AI calls at runtime.

## Page layout (editorial)

1. **Nav bar** — GFS block logo + OpenSea / @thegaboeth / back-to-collection CTA.
2. **Mini hero** — `FRAME ANY FRAGMENT.` headline (Anton heavy condensed) + sub.
3. **Frame Lab** — the tool itself: token id input + Frame It CTA + 3D-rendered gallery card + 4 export buttons.
4. **Fragment Hierarchy** — 9 / 81 / 900 visual breakdown of the collection.
5. **From Lisbon to the Chain** — 6-step origin timeline (Ape Fest Lisbon → Tile Artwork → Photographed → Vectorized → Fragmented → Minted on ApeChain).
6. **Footer** — links, resources, disclaimer.

## The collection

**Gabo Fragments Society** (`$GABO`) is a 991-piece fine-art collection on **ApeChain** by [@thegaboeth](https://x.com/thegaboeth), born at **ApeFest Lisbon 2024** from azulejo-inspired ceramic artwork.

- Contract: `0x3d36acd9123550b9de753c7535578205b15480a2`
- Chain: ApeChain (id `33139`)
- Token range: `0` to `990`
- Fragment hierarchy:
  - `#0` — Genesis (the original photograph)
  - `#1` – `#9` — Tier 1 (9 large fragments)
  - `#10` – `#90` — Tier 2 (81 medium fragments)
  - `#91` – `#990` — Tier 3 (900 micro fragments)
- Marketplace: [OpenSea](https://opensea.io/collection/gabo-fragments-society)

## Stack

- Vanilla HTML / CSS / JS — no build step, no framework
- Three.js via `<script type="importmap">` (ES module CDN imports)
- `gif.js` for GIF encoding (worker loaded as a Blob URL — SRI-verified)
- `MediaRecorder` + `canvas.captureStream()` for WebM
- `GLTFExporter` from `three/addons` for GLB
- OpenSea API v2 (`/api/v2/chain/ape_chain/contract/{c}/nfts/{id}`) with parallel IPFS gateway race fallback
- Typography: **Anton** (heavy condensed display) + **Inter** (body) + **JetBrains Mono** (token IDs, contract addr)

## Run locally

```bash
python3 serve.py
# open http://127.0.0.1:8767
```

Any static file server works — the app is fully client-side.

## Deploy

Hosted on Vercel. Manual deploy:

```bash
vercel deploy --prod --yes
```

The CSP allowlist in `vercel.json` covers OpenSea (`api.opensea.io`, `*.seadn.io`), five IPFS gateways (Pinata / dweb / nftstorage / w3s / ipfs.io), and Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`).

## Tests

```bash
node tests/e2e.mjs
```

Verifies file presence, HTML structure (sections, exports, palette tokens), CSS palette, app.js constants, vercel.json CSP, and `logo.svg`.

## Legal / non-affiliation

This project is an **independent, non-commercial fan tool** built by a community member for other holders. It only renders publicly available on-chain token metadata into a decorative gallery card for personal use.

**It is NOT affiliated with, endorsed by, or sponsored by:**

- @thegaboeth or the Gabo Fragments Society team
- OpenSea, ApeChain, or ApeFest
- Any museum, gallery, or grading authority

All trademarks, names, logos and artwork are the property of their respective owners. No claim of ownership over any collection's intellectual property is made or implied. If you are a rights-holder and have concerns about this project, please open an issue and the project will respond promptly.
