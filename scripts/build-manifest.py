#!/usr/bin/env python3
"""Pre-bake the Gabo Fragments Society collection to static assets.

For every token id 0..990:
  1. read tokenURI(uint256) from ApeChain RPC
  2. resolve the metadata JSON (ipfs:// / data: / https)
  3. fetch the artwork image and optimise it to webp 720px q62
  4. write it to  fragments/<id>.webp
  5. record name + description + traits in  manifest.json

The point: the collection is immutable and finite, so this converts every
per-user runtime RPC + IPFS fetch into a single edge-cached static lookup.

Idempotent / resumable: a token whose webp already exists AND already has a
manifest entry is skipped, so re-running after a partial failure only does
the missing work.

Usage:
  python3 scripts/build-manifest.py                # all 0..990
  python3 scripts/build-manifest.py --only 0,1,5   # specific ids (debugging)
  python3 scripts/build-manifest.py --workers 6
"""
import argparse
import base64
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from PIL import Image

# ----------------------------------------------------------------------------
# Config — mirrors GABO_FRAGMENTS in app.js (single source of truth in spirit)
# ----------------------------------------------------------------------------
RPC = "https://rpc.apechain.com/http"
CONTRACT = "0x3d36acd9123550b9de753c7535578205b15480a2"
CHAIN_ID = 33139
GATEWAYS = ["https://ipfs.io/ipfs", "https://gateway.pinata.cloud/ipfs"]
SELECTOR = "0xc87b56dd"  # tokenURI(uint256)
MIN_ID, MAX_ID = 0, 990

WEBP_MAX = 720          # longest-edge cap, matches genesis-bg.webp
WEBP_QUALITY = 62       # matches genesis-bg.webp
RETRIES = 4
BACKOFF = 1.6           # seconds, exponential
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/120.0 Safari/537.36")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRAG_DIR = os.path.join(ROOT, "fragments")
MANIFEST = os.path.join(ROOT, "manifest.json")


# ----------------------------------------------------------------------------
# HTTP helpers (browser-like headers — the RPC 403s plain urllib)
# ----------------------------------------------------------------------------
def _post_json(url, payload, timeout=40):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "User-Agent": UA,
        "Accept": "application/json",
        "Origin": "https://gabo-fragments-frame-lab.vercel.app",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _get_bytes(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _retry(fn, what):
    last = None
    for attempt in range(RETRIES):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            last = e
            if attempt < RETRIES - 1:
                time.sleep(BACKOFF ** (attempt + 1))
    raise RuntimeError(f"{what}: {type(last).__name__}: {last}")


# ----------------------------------------------------------------------------
# Chain + IPFS
# ----------------------------------------------------------------------------
def decode_abi_string(hex_str):
    if not hex_str or not hex_str.startswith("0x"):
        return None
    buf = hex_str[2:]
    if len(buf) < 128:
        return None
    length = int(buf[64:128], 16)
    if length <= 0:
        return None
    return bytes.fromhex(buf[128:128 + length * 2]).decode("utf-8", errors="replace")


def token_uri(token_id):
    body = {
        "jsonrpc": "2.0", "id": 1, "method": "eth_call",
        "params": [{"to": CONTRACT, "data": SELECTOR + format(token_id, "064x")}, "latest"],
    }
    res = _retry(lambda: _post_json(RPC, body), f"rpc tokenURI #{token_id}")
    if res.get("error"):
        raise RuntimeError(f"rpc error #{token_id}: {res['error'].get('message')}")
    decoded = decode_abi_string(res.get("result", ""))
    if not decoded:
        raise RuntimeError(f"could not decode tokenURI #{token_id}")
    return decoded


def ipfs_paths(ipfs_uri):
    cid_path = ipfs_uri.replace("ipfs://", "").lstrip("/")
    if cid_path.startswith("ipfs/"):
        cid_path = cid_path[5:]
    return [f"{gw}/{cid_path}" for gw in GATEWAYS]


def fetch_ipfs_bytes(ipfs_uri):
    last = None
    for url in ipfs_paths(ipfs_uri):
        try:
            return _retry(lambda u=url: _get_bytes(u), f"ipfs {url}")
        except Exception as e:  # noqa: BLE001
            last = e
    raise RuntimeError(f"all gateways failed for {ipfs_uri}: {last}")


def resolve_metadata(uri):
    if uri.startswith("data:application/json;base64,"):
        return json.loads(base64.b64decode(uri.split(",", 1)[1]).decode())
    if uri.startswith("data:application/json,"):
        return json.loads(urllib.parse.unquote(uri.split(",", 1)[1]))
    if uri.startswith("ipfs://"):
        return json.loads(fetch_ipfs_bytes(uri).decode("utf-8", errors="replace"))
    if uri.startswith("http"):
        return json.loads(_retry(lambda: _get_bytes(uri), f"http meta {uri}")
                          .decode("utf-8", errors="replace"))
    raise RuntimeError(f"unknown tokenURI scheme: {uri[:40]}")


def fetch_image_bytes(image_field):
    if image_field.startswith("ipfs://"):
        return fetch_ipfs_bytes(image_field)
    if image_field.startswith("http"):
        return _retry(lambda: _get_bytes(image_field), f"http image {image_field}")
    raise RuntimeError(f"unknown image scheme: {image_field[:40]}")


def optimise_to_webp(raw_bytes, out_path):
    img = Image.open(io.BytesIO(raw_bytes))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    w, h = img.size
    longest = max(w, h)
    if longest > WEBP_MAX:
        scale = WEBP_MAX / longest
        img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    img.save(out_path, "WEBP", quality=WEBP_QUALITY, method=6)


# ----------------------------------------------------------------------------
# Per-token worker
# ----------------------------------------------------------------------------
def process(token_id, existing):
    out_rel = f"fragments/{token_id}.webp"
    out_abs = os.path.join(ROOT, out_rel)
    # Resume: skip if image already on disk AND we have a manifest entry.
    if os.path.exists(out_abs) and str(token_id) in existing:
        return token_id, existing[str(token_id)], "skip"

    uri = token_uri(token_id)
    meta = resolve_metadata(uri)
    image_field = meta.get("image") or meta.get("image_url")
    if not image_field:
        raise RuntimeError(f"#{token_id}: metadata has no image field")

    raw = fetch_image_bytes(image_field)
    optimise_to_webp(raw, out_abs)

    entry = {
        "name": meta.get("name") or f"Gabo Fragment #{token_id}",
        "description": meta.get("description") or "",
        "image": out_rel,
        "traits": [
            {"trait_type": a.get("trait_type"), "value": a.get("value")}
            for a in (meta.get("attributes") or [])
        ],
    }
    return token_id, entry, "fetched"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--only", type=str, default="")
    args = ap.parse_args()

    os.makedirs(FRAG_DIR, exist_ok=True)

    existing = {}
    if os.path.exists(MANIFEST):
        try:
            existing = json.load(open(MANIFEST)).get("fragments", {})
        except Exception:  # noqa: BLE001
            existing = {}

    if args.only:
        ids = [int(x) for x in args.only.split(",") if x.strip() != ""]
    else:
        ids = list(range(MIN_ID, MAX_ID + 1))

    fragments = dict(existing)  # start from prior progress
    done = skipped = failed = 0
    errors = []
    t0 = time.time()
    total = len(ids)

    print(f"[build] {total} tokens · {args.workers} workers · webp {WEBP_MAX}px q{WEBP_QUALITY}",
          flush=True)

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(process, tid, existing): tid for tid in ids}
        for i, fut in enumerate(as_completed(futs), 1):
            tid = futs[fut]
            try:
                token_id, entry, status = fut.result()
                fragments[str(token_id)] = entry
                if status == "skip":
                    skipped += 1
                else:
                    done += 1
            except Exception as e:  # noqa: BLE001
                failed += 1
                errors.append(f"#{tid}: {e}")
                print(f"  FAIL #{tid}: {e}", flush=True)

            if i % 25 == 0 or i == total:
                rate = i / max(time.time() - t0, 0.001)
                eta = (total - i) / max(rate, 0.001)
                print(f"  [{i}/{total}] fetched={done} skip={skipped} fail={failed} "
                      f"· {rate:.1f}/s · ETA {eta:.0f}s", flush=True)
                # Incremental save for crash-safety / resume
                _write_manifest(fragments)

    _write_manifest(fragments)
    dt = time.time() - t0
    print(f"\n[build] done in {dt:.0f}s · fetched={done} skip={skipped} "
          f"fail={failed} · manifest entries={len(fragments)}", flush=True)
    if errors:
        print(f"[build] {len(errors)} FAILURES (re-run to retry the missing ids):", flush=True)
        for e in errors[:30]:
            print("   " + e, flush=True)
        sys.exit(1)


def _write_manifest(fragments):
    payload = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "contract": CONTRACT,
        "chainId": CHAIN_ID,
        "minId": MIN_ID,
        "maxId": MAX_ID,
        "count": len(fragments),
        "fragments": dict(sorted(fragments.items(), key=lambda kv: int(kv[0]))),
    }
    tmp = MANIFEST + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, MANIFEST)


if __name__ == "__main__":
    main()
