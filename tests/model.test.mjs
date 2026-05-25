#!/usr/bin/env node
/* Deep test for the AR model pipeline (api/_lib/build-glb.js).
 *
 * Builds a real GLB from a pre-baked fragment (webp -> jpeg via sharp) and
 * checks it is a spec-valid glTF (Khronos validator, 0 errors) with the
 * expected structure. This exercises the actual code Scene Viewer downloads.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}`)));

console.log("[model] AR GLB generation + validation");

const sharp = (await import("sharp")).default;
const { buildFragmentGlb, FRAME_M, ART_M } = await import("../api/_lib/build-glb.js");

// Real artwork -> jpeg, exactly like the serverless route does.
const webpPath = resolve(ROOT, "fragments/0.webp");
ok("sample fragment exists", existsSync(webpPath));
const jpeg = await sharp(readFileSync(webpPath)).resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 82 }).toBuffer();
ok("sharp produced a jpeg", jpeg.length > 1000);

const glb = await buildFragmentGlb(jpeg);
ok("GLB is a non-trivial binary", glb.length > jpeg.length);
ok("GLB has the glTF magic", Buffer.from(glb.slice(0, 4)).toString("ascii") === "glTF");

// Parse the JSON chunk and assert structure.
const buf = Buffer.from(glb);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
ok("glTF 2.0", json.asset && json.asset.version === "2.0");
ok("two meshes (frame + art)", json.meshes && json.meshes.length === 2);
ok("one embedded texture", json.textures && json.textures.length === 1);
ok("jpeg image embedded", json.images && json.images.some((i) => i.mimeType === "image/jpeg"));
ok("POSITION accessors carry min/max (Scene Viewer requires it)",
  json.accessors.filter((a) => a.min && a.max).length >= 2);
ok("real-world scale (frame > art, ~0.5 m)", FRAME_M > ART_M && FRAME_M < 1);

// Khronos validator — the strict loader Scene Viewer/Quick Look effectively use.
const gv = await import("gltf-validator");
const validate = gv.validateBytes || gv.default?.validateBytes || gv.default;
const report = await validate(new Uint8Array(glb));
ok(`glTF validator: 0 errors (got ${report.issues.numErrors})`, report.issues.numErrors === 0);
if (report.issues.numErrors > 0) {
  for (const m of report.issues.messages.filter((m) => m.severity === 0)) {
    console.log(`     ERROR ${m.code}: ${m.message} @ ${m.pointer}`);
  }
}

// Robustness: empty input must throw, not produce garbage.
let threw = false;
try { await buildFragmentGlb(new Uint8Array(0)); } catch { threw = true; }
ok("rejects empty jpeg buffer", threw);

console.log(`\n=========== ${pass} pass · ${fail} fail (model) ===========`);
process.exit(fail > 0 ? 1 : 0);
