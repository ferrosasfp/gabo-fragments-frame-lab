// Build the AR model (GLB) for a Gabo fragment: the artwork on a quad inside a
// cobalt frame, sized for the wall (~0.56 m). Pure + side-effect free (takes a
// JPEG buffer, returns GLB bytes) so it is unit-testable without the network.
// Files under api/_lib are helpers, not routes (Vercel ignores the _ prefix).
import { Document, NodeIO } from "@gltf-transform/core";

export const FRAME_M = 0.56;                       // outer frame size (metres)
export const ART_M = 0.50;                         // artwork size (metres)
export const COBALT_LINEAR = [0.014, 0.043, 0.158, 1]; // #1E3A6E in linear space

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

/**
 * Build the framed-artwork GLB.
 * @param {Uint8Array|Buffer} jpegBytes - the artwork as a JPEG.
 * @returns {Promise<Uint8Array>} GLB bytes.
 */
export async function buildFragmentGlb(jpegBytes) {
  if (!jpegBytes || jpegBytes.length === 0) {
    throw new Error("buildFragmentGlb: empty jpeg buffer");
  }
  const doc = new Document();
  const buffer = doc.createBuffer();

  const frameMat = doc.createMaterial("frame")
    .setBaseColorFactor(COBALT_LINEAR)
    .setMetallicFactor(0.0)
    .setRoughnessFactor(0.7)
    .setDoubleSided(true);
  const artMat = doc.createMaterial("art")
    .setBaseColorTexture(
      doc.createTexture("art").setImage(new Uint8Array(jpegBytes)).setMimeType("image/jpeg")
    )
    .setMetallicFactor(0.0)
    .setRoughnessFactor(0.85)
    .setDoubleSided(true);

  const frameMesh = addQuad(doc, buffer, FRAME_M, 0.0, frameMat);
  const artMesh = addQuad(doc, buffer, ART_M, 0.012, artMat);

  const scene = doc.createScene()
    .addChild(doc.createNode("frame").setMesh(frameMesh))
    .addChild(doc.createNode("art").setMesh(artMesh));
  doc.getRoot().setDefaultScene(scene);

  return new NodeIO().writeBinary(doc);
}
