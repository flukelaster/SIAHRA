/**
 * สร้าง `apps/api/src/data/localAuthorityBoundaries.json` — ขั้น repackage
 * ล้วน ๆ (E11.4) ที่รวมขอบเขต อปท. จริงจาก E11.2
 * (`apps/web/public/aoi/{code}/local-authorities.geojson`, 431 รูปใน 46
 * จังหวัด) เป็นไฟล์เดียว คีย์ด้วย id ของ อปท. เอง (`TH-LAO-{dlaCode}`) แทนที่
 * จะแยกตามจังหวัด
 *
 *   npm run build:local-authority-boundaries-bundle -w apps/etl
 *
 * ## ทำไมต้องมีไฟล์นี้แยกจาก E11.2
 * Worker ของ apps/api อ่าน `apps/web/public/aoi/**` ตอนรันไม่ได้ (คนละ deploy
 * unit) เหมือนที่ `apps/api/src/geo/provinceRings.ts` กับ
 * `apps/api/src/data/localAuthorities.ts` ต้องมีไฟล์ bake เข้า bundle ของ
 * ตัวเองเหมือนกัน — ไฟล์นี้ทำหน้าที่เดียวกันสำหรับเรขาคณิตขอบเขต อปท. ที่
 * `apps/api/src/geo/floodIntersection.ts` (E11.4) ต้องใช้คำนวณ real polygon
 * intersection กับขอบเขตน้ำท่วมของ GISTDA
 *
 * ไม่คำนวณ/สกัดรูปหลายเหลี่ยมใหม่จาก OSM ที่นี่ — คัดลอกเรขาคณิตจริงจาก E11.2
 * มาทั้งดุ้น (verbatim) เท่านั้น ถ้าจะแก้ความละเอียด/ที่มาของรูป ต้องแก้ที่
 * `buildLocalAuthorityBoundaries.ts` (E11.2) แล้วรันสคริปต์นี้ใหม่ ไม่ใช่แก้ที่นี่
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LocalAuthorityBoundariesArtefact, LocalAuthorityBoundaryGeometry } from "@siahra/shared-types";
import { isoUtc } from "./provenance.js";

const AOI_DIR = path.resolve(import.meta.dirname, "../../web/public/aoi");
const OUT_PATH = path.resolve(import.meta.dirname, "../../api/src/data/localAuthorityBoundaries.json");

interface RawFeatureCollection {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: { id: string; nameTh: string; type: string };
    geometry: LocalAuthorityBoundaryGeometry;
  }[];
}

export async function run(): Promise<void> {
  const provinceCodes = readdirSync(AOI_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((code) => existsSync(path.join(AOI_DIR, code, "local-authorities.geojson")))
    .sort();

  const boundaries: LocalAuthorityBoundariesArtefact["boundaries"] = [];
  const seenIds = new Set<string>();
  for (const provinceCode of provinceCodes) {
    const file = path.join(AOI_DIR, provinceCode, "local-authorities.geojson");
    const fc = JSON.parse(readFileSync(file, "utf-8")) as RawFeatureCollection;
    for (const f of fc.features) {
      if (seenIds.has(f.properties.id)) {
        // ไม่ควรเกิด (แต่ละ อปท. อยู่จังหวัดเดียว) — เตือนแทนเขียนทับเงียบ ๆ
        console.warn(`[lao-boundaries-bundle] duplicate id across provinces: ${f.properties.id}`);
        continue;
      }
      seenIds.add(f.properties.id);
      boundaries.push({ id: f.properties.id, geometry: f.geometry });
    }
  }

  const artefact: LocalAuthorityBoundariesArtefact = {
    generatedAt: isoUtc(Date.now()),
    recordCount: boundaries.length,
    boundaries,
  };
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const json = JSON.stringify(artefact);
  writeFileSync(OUT_PATH, json);
  console.log(
    `[lao-boundaries-bundle] wrote ${OUT_PATH} — ${boundaries.length} boundaries from ${provinceCodes.length} provinces (${(Buffer.byteLength(json) / 1024).toFixed(1)} KB)`,
  );
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
