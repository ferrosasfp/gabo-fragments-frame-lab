// Serverless: build the AR model (GLB) for a Gabo fragment on demand.
//
// Native AR launchers (Android Scene Viewer) download the model from a URL —
// they can't read an in-page blob — so this route serves a real, fetchable
// GLB per fragment. The GLB geometry/material is built by api/_lib/build-glb.js
// (pure, unit-tested); here we just fetch + downscale the artwork (webp -> jpeg,
// since glTF core textures are PNG/JPEG) and stream the result.
import sharp from "sharp";
import { buildFragmentGlb } from "../_lib/build-glb.js";

const MIN_ID = 0;
const MAX_ID = 990;
const TEX_MAX = 1024; // texture cap — keeps the GLB small for mobile download

export default async function handler(req, res) {
  const id = Number(req.query.id);
  if (!Number.isInteger(id) || id < MIN_ID || id > MAX_ID) {
    res.status(400).json({ error: "invalid fragment id" });
    return;
  }

  try {
    // SSRF guard: fetch the artwork from THIS deployment only. VERCEL_URL is
    // set by the platform to the deployment's own host and is not client-
    // controllable — unlike the Host / X-Forwarded-Host headers, which an
    // attacker could spoof to make us fetch from an arbitrary origin.
    const selfHost = process.env.VERCEL_URL || req.headers.host;
    const imgRes = await fetch(`https://${selfHost}/fragments/${id}.webp`);
    if (!imgRes.ok) throw new Error(`artwork fetch ${imgRes.status}`);

    const jpeg = await sharp(Buffer.from(await imgRes.arrayBuffer()))
      .resize(TEX_MAX, TEX_MAX, { fit: "inside" })
      .jpeg({ quality: 82 })
      .toBuffer();

    const glb = await buildFragmentGlb(jpeg);

    res.setHeader("Content-Type", "model/gltf-binary");
    res.setHeader("Content-Disposition", `inline; filename="gabo-${id}.glb"`);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.status(200).send(Buffer.from(glb));
  } catch (err) {
    console.error("model build failed:", err);
    res.status(502).json({ error: "model build failed" });
  }
}
