// Serverless: build the AR model (GLB) for a Gabo fragment on demand.
//
// Native AR launchers (Android Scene Viewer) download the model from a URL —
// they can't read an in-page blob — so this route serves a real, fetchable
// GLB per fragment: the pre-baked artwork on a quad inside a cobalt frame,
// sized to ~0.56 m for the wall. Built with gltf-transform (no GL context
// needed) + sharp (webp -> jpeg, since glTF core textures are PNG/JPEG).
import { Document, NodeIO } from "@gltf-transform/core";
import sharp from "sharp";

const MIN_ID = 0;
const MAX_ID = 990;
const FRAME_M = 0.56; // outer frame size (metres)
const ART_M = 0.50; // artwork size (metres)
const COBALT_LINEAR = [0.014, 0.043, 0.158, 1]; // #1E3A6E in linear space

function addQuad(doc, buffer, size, z, material) {
  const h = size / 2;
  const pos = doc.createAccessor().setType("VEC3").setBuffer(buffer)
    .setArray(new Float32Array([-h, -h, z, h, -h, z, h, h, z, -h, h, z]));
  const nor = doc.createAccessor().setType("VEC3").setBuffer(buffer)
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]));
  const uv = doc.createAccessor().setType("VEC2").setBuffer(buffer)
    .setArray(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]));
  const idx = doc.createAccessor().setType("SCALAR").setBuffer(buffer)
    .setArray(new Uint16Array([0, 1, 2, 0, 2, 3]));
  const prim = doc.createPrimitive()
    .setAttribute("POSITION", pos)
    .setAttribute("NORMAL", nor)
    .setAttribute("TEXCOORD_0", uv)
    .setIndices(idx)
    .setMaterial(material);
  return doc.createMesh().addPrimitive(prim);
}

export default async function handler(req, res) {
  const id = Number(req.query.id);
  if (!Number.isInteger(id) || id < MIN_ID || id > MAX_ID) {
    res.status(400).json({ error: "invalid fragment id" });
    return;
  }

  try {
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const imgRes = await fetch(`${proto}://${host}/fragments/${id}.webp`);
    if (!imgRes.ok) throw new Error(`artwork fetch ${imgRes.status}`);

    const jpeg = await sharp(Buffer.from(await imgRes.arrayBuffer()))
      .resize(1024, 1024, { fit: "inside" })
      .jpeg({ quality: 82 })
      .toBuffer();

    const doc = new Document();
    const buffer = doc.createBuffer();

    const frameMat = doc.createMaterial("frame")
      .setBaseColorFactor(COBALT_LINEAR)
      .setMetallicFactor(0.0)
      .setRoughnessFactor(0.7)
      .setDoubleSided(true);
    const artMat = doc.createMaterial("art")
      .setBaseColorTexture(doc.createTexture("art").setImage(new Uint8Array(jpeg)).setMimeType("image/jpeg"))
      .setMetallicFactor(0.0)
      .setRoughnessFactor(0.85)
      .setDoubleSided(true);

    const frameMesh = addQuad(doc, buffer, FRAME_M, 0.0, frameMat);
    const artMesh = addQuad(doc, buffer, ART_M, 0.012, artMat);

    const scene = doc.createScene()
      .addChild(doc.createNode("frame").setMesh(frameMesh))
      .addChild(doc.createNode("art").setMesh(artMesh));
    doc.getRoot().setDefaultScene(scene);

    const glb = await new NodeIO().writeBinary(doc);

    res.setHeader("Content-Type", "model/gltf-binary");
    res.setHeader("Content-Disposition", `inline; filename="gabo-${id}.glb"`);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.status(200).send(Buffer.from(glb));
  } catch (err) {
    console.error("model build failed:", err);
    res.status(502).json({ error: "model build failed" });
  }
}
