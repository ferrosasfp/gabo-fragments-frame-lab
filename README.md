# Gabo Fragments Frame Lab

A non-commercial, community-built fan tool for **Gabo Fragments Society** NFT holders. Drop in a fragment id and get an azulejos-inspired museum frame with PNG / GIF / GLB / WebM exports — all rendered in your browser.

## What it does

Pulls publicly available fragment artwork + metadata from OpenSea (ApeChain) — with IPFS gateway fallbacks — and renders an **ornate gold frame around a museum plaque** so any fragment can become a 3D-rendered exhibit piece. Export the artwork, the framed piece, a rotating GIF, a 3D GLB, or a high-resolution wallpaper.

| Export | Format | Typical size |
|---|---|---|
| Artwork | PNG | flat NFT image |
| Frame | PNG | 2x museum-framed render |
| Frame | GIF | 36-frame loop, ~2.5s |
| Frame | GLB | 3D model, WebXR-ready |
| Frame | WebM | HD video, transparent-friendly |
| Wallpaper | PNG | iPhone / Android / iPad / FHD / QHD / 4K / 21:9 |

Everything happens client-side — no server, no upload, no tracking, no AI calls at runtime.

## The collection

**Gabo Fragments Society** (`$GABO`) is a 991-piece fine-art collection on **ApeChain** by [@thegaboeth](https://x.com/thegaboeth), born at **ApeFest Lisbon 2024** from azulejo-inspired ceramic artwork.

- Contract: `0x3d36acd9123550b9de753c7535578205b15480a2`
- Chain: ApeChain (id `33139`)
- Token range: `0` to `990`
- Fragment hierarchy:
  - `#0` — Genesis (the original photograph)
  - `#1` – `#9` — Tier 1 (9 quadrants)
  - `#10` – `#90` — Tier 2 (81 second-level fragments)
  - `#91` – `#990` — Tier 3 (900 final pieces)
- Marketplace: [OpenSea](https://opensea.io/collection/gabofragments)

## Stack

- Vanilla HTML / CSS / JS — no build step, no framework
- Three.js via `<script type="importmap">` (ES module CDN imports)
- `gif.js` for GIF encoding (worker loaded as a Blob URL — SRI-verified)
- `MediaRecorder` + `canvas.captureStream()` for WebM
- `GLTFExporter` from `three/addons` for GLB
- OpenSea API v2 (`/api/v2/chain/ape_chain/contract/{c}/nfts/{id}`) with parallel IPFS gateway race fallback

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

The CSP allowlist in `vercel.json` covers OpenSea (`api.opensea.io`, `*.seadn.io`) and five IPFS gateways (Pinata / dweb / nftstorage / w3s / ipfs.io).

## Legal / non-affiliation

This project is an **independent, non-commercial fan tool** built by a community member for other holders. It only renders publicly available on-chain token metadata into a decorative museum frame for personal use.

**It is NOT affiliated with, endorsed by, or sponsored by:**

- @thegaboeth or the Gabo Fragments Society team
- OpenSea, ApeChain, or ApeFest
- Any museum, gallery, or grading authority

All trademarks, names, logos and artwork are the property of their respective owners. No claim of ownership over any collection's intellectual property is made or implied. If you are a rights-holder and have concerns about this project, please open an issue and the project will respond promptly.
