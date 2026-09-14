"""CLI: `python -m gfm plan|run|backfill|backfill-plan|backfill-advance|check-grid` — เขียนต้นไม้ไฟล์
ที่สะท้อนคีย์บน R2 ตัวต่อตัว

    DIR/aoi/{code}/flood/index.json
    DIR/aoi/{code}/flood/{sceneId}/field.bin      (gzip แล้ว — Worker ส่งด้วย Content-Encoding: gzip)
    DIR/aoi/{code}/flood/{sceneId}/meta.json
    DIR/flood/gfm/state.json                      ({lastCreated} — เฉพาะ `run`)
    DIR/flood/gfm/health.json                     ({lastRunAt, lastSuccessAt, lastSceneObservedAt, lastError,
                                                    itemsProcessed, scenesWritten})

ไม่มีโค้ดเครือข่ายฝั่ง R2 ในนี้เลย — workflow `.github/workflows/gfm-ingest.yml` (E14.F3) เป็นคนดึง
state/index/อินพุตลงมาและ `rclone copy` ต้นไม้นี้ขึ้นไป (จำกัดใต้ `aoi/{code}/flood/` และ `flood/gfm/`)
ลำดับบน runner ชั่วคราว:

    plan      ค้น STAC **ครั้งเดียว** ทั้งประเทศ → เขียนรหัสจังหวัดที่มี item (ไฟล์บรรทัดละรหัส) + plan.json
              → shell ดาวน์โหลด index.json + DEM/WorldCover เฉพาะจังหวัดเหล่านั้น
    run --plan  ค้น STAC อีกครั้งเดียวด้วยหน้าต่างเดิม (since..createdMax ของ plan) แล้วประมวลผลเฉพาะ
              จังหวัดใน plan — ไม่มีวันวนค้นรายจังหวัด (77 ครั้ง) และ plan ที่มี 0 item ไม่ค้นซ้ำเลย

ทำไม run ค้นใหม่แทนที่จะแคช item ลงดิสก์: การค้นถูกมาก (หน้าละ 100 item ~1.3 วิ, ดู stac.py) ส่วนการ
serialize/reload pystac item เป็นโค้ดและจุดพังเพิ่มโดยไม่ได้อะไร — หน้าต่าง `until = createdMax` ทำให้
run เห็นชุด item เดียวกับ plan ทุกตัว item ที่ต้นทางเผยแพร่ระหว่างสองคำสั่งจึงตกไปรอบหน้า ไม่ใช่หายไป

- ฉากถูกข้ามเมื่อ sceneId อยู่ใน index.json เดิม **หรือ** field.bin มีอยู่แล้วในเครื่อง (immutable, idempotent)
- index.json ถูกเขียน **เฉพาะเมื่อรายการฉากเปลี่ยน** — ไม่เขียน = ไม่อัป = แคชที่ขอบไม่ถูกทำให้เก่า (devops)
- ฉากที่ล้มเหลวถูกจับ บันทึกใน health.lastError แล้วรันต่อ; state.lastCreated ไม่ข้ามฉากที่ล้ม
  (รวมจังหวัดที่โหลดอินพุตไม่ได้: item ของมันถูก "ยึด" ไว้ให้รอบหน้า) — lastError รวม **ทุก** ฉาก/จังหวัด
  ที่ล้มในสตริงเดียว (คั่นด้วย " | ", ตัดที่ ERROR_MAX_CHARS) ไม่ใช่แค่ตัวสุดท้ายที่ทับตัวก่อน
- health.lastSuccessAt ขยับเฉพาะ run ที่ไม่มี lastError — API ใช้เป็น fetchedAt จึงไม่มีวันรายงาน run ที่ล้ม
  ว่า "ดึงสำเร็จ"
- log บรรทัดเดียวต่อฉาก ไม่มีต่อเซลล์

E14.F6 — backfill 2015 → ตอนนี้ (`.github/workflows/gfm-ingest.yml` ลูป "backfill until deadline"):

    backfill-plan     อ่าน/สร้าง state (`flood/gfm/backfill-state.json`) → พิมพ์ JSON {code, from, to}
                       ของจังหวัดที่จะทำรอบนี้ (ลำดับจาก scan_aoi_root, resume `current` ก่อน) หรือ
                       {done: true} เมื่อครบทุกจังหวัด หรือ {done: true, reason: "deadline"} เมื่อเหลือ
                       เวลาน้อยกว่า 20 นาที — สร้าง state ใหม่ (ยังไม่มีไฟล์) แล้วเขียนลง --state ทันที
    backfill --deadline --cursor-out   หนึ่ง "visit" ของจังหวัดเดียว: ค้น STAC ครั้งเดียวในหน้าต่าง
                       --from..--to ทั้งก้อน ประมวลผลฉาก**ใหม่สุดก่อน** หยุดก่อนเริ่มฉากถัดไปเมื่อ
                       now + 3×p95(เวลาต่อฉากที่วัดมาแล้ว, ปริยาย 60 วิ) > deadline — เขียน cursor.json
                       แล้วคืนรหัส 0 (จบหน้าต่าง) / 3 (หยุดที่ deadline, อัปโหลดได้) / 1 (ล้ม, ไม่มีอะไรให้อัป)
                       ไม่แตะ state.json (เหมือน backfill ปกติ) และไม่เขียน health.json (ไม่มีใครอัปมันใน
                       backfill loop — เขียนไปก็จะรายงานสถานะแหล่ง live ผิด) — ไม่มี entry ไหนสำเร็จเลยแต่มี
                       error เกิดขึ้น (เช่น read_inputs/process_scene ล้มทุกฉาก) คืนรหัส 1 เสมอ ไม่ใช่ 0/done:
                       true ทั้งที่ไม่มีอะไรให้อัป; --require-index ปฏิเสธเขียน index.json ถ้าไม่พบไฟล์เดิม
                       ในเครื่อง (ใช้เมื่อ workflow ดาวน์โหลด index.json เดิมสำเร็จ — กันชั้นสองไม่ให้ทับ
                       index จริงบน R2 ด้วย index ที่มีแค่ฉากของ visit นี้)
    backfill-advance   อ่าน cursor.json + rc แล้วปรับ state: rc 0 → done, failures/lastError ล้างเป็น
                       0/None; rc 3 → to = cursor.nextTo (nextTo เป็น null แปลว่ายังไม่ได้แตะฉากไหนเลยใน
                       รอบนี้ — to เดิมคงไว้ ไม่เขียน null ทับ ไม่งั้นรอบหน้า backfill จะได้ --to None แล้ว
                       พัง), failures/lastError ล้างเช่นกัน; rc 1 → failures += 1, lastError = cursor.lastError
                       — ล้มติดกันครบ BACKFILL_MAX_CONSECUTIVE_FAILURES ครั้งเท่านั้นจึง failed = lastError
                       (ข้ามในแผนถัดไปจนกว่าคนจะล้าง — ล้มชั่วคราวครั้งเดียวไม่ทิ้งทั้งหน้าต่างที่เหลือ);
                       rc 0 ที่ cursor มี lastError (ไม่ควรเกิดขึ้นจริงหลัง cli.py กันไว้แล้ว) ถูกปฏิบัติ
                       เหมือน rc 1 กันไว้สองชั้น — ไม่ปิดจังหวัดว่า "เสร็จ" ทั้งที่ visit ล้ม

`from` ของทุกจังหวัดคือ floor คงที่ (ปริยาย 2015-01-01) — `to` เท่านั้นที่ถอยลงทีละ visit (nextTo =
observedAt ของฉากสุดท้ายที่ทำในรอบนี้ ลบ 1 วิ) การค้นครั้งถัดไปจึงเห็นเฉพาะฉากที่ยังไม่เคยประมวลผล
โดยธรรมชาติ (อยู่นอกหน้าต่างใหม่ที่แคบลง) ไม่ต้องเทียบกับ index เพื่อกรองซ้ำอีกชั้น
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .encode import IndexOverflowError, aggregate, encode_field, gzip_bytes, iso_now, merge_index, scene_entry, scene_meta
from .fwdet import estimate_depth
from .grid import (
    ProvinceBox,
    ProvinceGrid,
    check_alignment,
    load_province_grid,
    province_box,
    read_inputs,
    scan_aoi_root,
)
from .stac import (
    THAILAND_BBOX,
    _bbox_intersects,
    group_by_province,
    iso_z,
    orbit,
    published_at,
    scene_key,
    search_items,
    union_bbox,
)
from .warp import warp_scene

log = logging.getLogger("gfm")

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_OUT = REPO_ROOT / "apps" / "etl" / "data" / "flood"
DEFAULT_WORK = REPO_ROOT / "apps" / "etl" / "data" / "work"
DEFAULT_AOI = REPO_ROOT / "apps" / "web" / "public" / "aoi"

# คีย์ใน meta.json ที่ไม่อยู่ใน index entry (encode.scene_meta) — ใช้ตอนสร้าง entry คืนจาก meta.json
_META_ONLY_KEYS = ("methodology", "fieldBytesGz", "missingAssets")

# ความยาวสูงสุดของ health.lastError — รวมทุกจังหวัด/ฉากที่ล้มในสตริงเดียว แต่ไม่ให้ health.json
# (ซึ่ง /api/v1/health อ่านทุกครั้ง) บวมตาม traceback ของ 77 จังหวัด
ERROR_MAX_CHARS = 500


def _join_errors(errors: list[str]) -> str | None:
    """รวมข้อความล้มเหลวทุกตัวเป็นสตริงเดียว (ลำดับตามที่เกิด) ตัดที่ ERROR_MAX_CHARS — ว่าง = None"""
    if not errors:
        return None
    text = " | ".join(errors)
    if len(text) > ERROR_MAX_CHARS:
        text = text[: ERROR_MAX_CHARS - 1].rstrip() + "…"
    return text


def _parse_when(value: str) -> datetime:
    d = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def _read_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    tmp.replace(path)


def scene_dir(out: Path, code: str, scene_id: str) -> Path:
    return out / "aoi" / code / "flood" / scene_id


def index_path(out: Path, code: str) -> Path:
    return out / "aoi" / code / "flood" / "index.json"


def _empty_summary(now: datetime) -> dict:
    return {"generatedAt": iso_now(now), "itemsProcessed": 0, "scenesWritten": 0, "lastError": None,
            "lastSceneObservedAt": None, "lastCreated": None}


@dataclass(frozen=True)
class UnloadedProvince:
    """จังหวัดที่โหลดตาราง/อินพุตไม่ได้ (DEM หรือ WorldCover หายจาก --work-dir ฯลฯ)

    bbox จาก manifest ใช้หา item ของมันเพื่อ "ยึด" lastCreated ไว้; None = ไม่รู้ bbox → ยึดทั้งหมด
    """

    code: str
    bbox: tuple[float, float, float, float] | None
    error: str


def process_scene(
    grid: ProvinceGrid, items: list, dem, landcover, out: Path, scene_id: str, opener=None
) -> tuple[dict | None, int]:
    """warp → FwDET → ย่อ → เขียน field.bin + meta.json — คืน (entry, ไบต์ gzip)

    คืน (None, 0) เมื่อไม่มีเซลล์ใดในจังหวัดอยู่ในรอยเท้าภาพเลย: bbox ของ item คือกรอบไทล์ Equi7
    ทั้งใบ (300 กม.) ส่วนเฟรมของ S1 จริงอาจอยู่คนละมุมของไทล์ (วัดจริงเชียงราย 2024-09-11..13:
    6 ใน 8 กลุ่มเป็นแบบนี้) เฟรมที่ไม่เคยถ่ายจังหวัดไม่ใช่ "ฉากของจังหวัด" — ไม่เขียนอะไรเลย
    ต่างจากฉากที่ถ่ายแล้วแห้ง (floodedCells 0) ซึ่งเป็นข้อมูลและถูกเขียนเสมอ
    """
    kwargs = {"opener": opener} if opener is not None else {}
    rasters = warp_scene(items, grid, **kwargs)
    if not rasters.observed.any():
        return None, 0
    res = estimate_depth(dem, rasters.extent, rasters.excluded, rasters.refwater, rasters.observed, landcover)
    cls_ov, depth_ov, lik_ov = aggregate(res.cls, res.depth_cm, rasters.likelihood, grid)
    # sceneId คือเฟรมแรกสุดของรอบ (stac.merge_frames) — observedAt ต้องเป็นเวลาเดียวกับใน sceneId
    key = min((scene_key(it) for it in items), key=lambda k: k.acquisition_utc)
    pub = [p for p in (published_at(it) for it in items) if p is not None]
    entry = scene_entry(
        scene_id=scene_id,
        observed_at=iso_z(key.acquisition_utc),
        # ฉากหนึ่งมีหลาย item — เวลาเผยแพร่ของฉาก = item ที่เผยแพร่ล่าสุด; ไม่มีเลย = null
        published_at=iso_z(max(pub)) if pub else None,
        orbit=next((o for o in (orbit(it) for it in items) if o), None),
        cls=cls_ov,
        depth_cm=depth_ov,
        grid=grid,
        item_ids=rasters.item_ids,
    )
    gz = gzip_bytes(encode_field(cls_ov, depth_ov, lik_ov))
    d = scene_dir(out, grid.code, scene_id)
    d.mkdir(parents=True, exist_ok=True)
    _write_json(d / "meta.json", scene_meta(entry, len(gz), rasters.missing_assets))
    tmp = d / "field.bin.tmp"
    tmp.write_bytes(gz)
    tmp.replace(d / "field.bin")  # field.bin ปรากฏครบไบต์เท่านั้น — "มีอยู่" คือสัญญาณข้าม
    return entry, len(gz)


def run_pipeline(
    items: list,
    grids: list[ProvinceGrid],
    out: Path,
    *,
    now: datetime,
    opener=None,
    unloaded: list[UnloadedProvince] | None = None,
) -> dict:
    """ประมวลผลทุกฉากของทุกจังหวัด — คืนสรุปสำหรับ state/health"""
    groups = group_by_province(items, grids)
    scenes_written = 0
    items_ok: set[str] = set()
    failed_created: list[datetime] = []
    hold_all = False
    errors: list[str] = []  # ทุกฉาก/จังหวัดที่ล้ม — รวมเป็น lastError เดียวตอนจบ
    newest_observed: str | None = None
    generated_at = iso_now(now)

    for g in grids:
        keys = sorted(k for k in groups if k[0] == g.code)
        if not keys:
            log.info("จังหวัด %s: ไม่มี item ของ GFM ทับ bbox ในช่วงที่ค้น", g.code)
        dem = landcover = None
        ipath = index_path(out, g.code)
        existing = _read_json(ipath)
        known = {s["sceneId"] for s in (existing or {}).get("scenes", [])}
        entries: list[dict] = []
        entry_items: list[list] = []  # ขนานกับ entries — item ต้นทางของแต่ละ entry เผื่อ index เขียนไม่สำเร็จ
        for code, scene_id in keys:
            scene_items = groups[(code, scene_id)]
            if scene_id in known:
                # runner ชั่วคราวไม่มี field.bin ในเครื่อง — index ที่ดึงลงมาคือความจริงว่าฉากนี้อยู่บน R2 แล้ว
                log.info("%s/%s: อยู่ใน index แล้ว — ข้าม", code, scene_id)
                items_ok.update(it.id for it in scene_items)
                continue
            fdir = scene_dir(out, code, scene_id)
            if (fdir / "field.bin").exists():
                log.info("%s/%s: มี field.bin แล้ว — ข้าม", code, scene_id)
                items_ok.update(it.id for it in scene_items)
                # มีไฟล์แต่ index ไม่รู้จัก (รอบก่อนตายระหว่างเขียนฉากกับเขียน index): คืน entry จาก
                # meta.json ให้ index — ฉากที่อยู่บนดิสก์แต่ไม่มีใครชี้คือฉากที่หายไปเงียบ ๆ
                meta = _read_json(fdir / "meta.json")
                if meta and meta.get("sceneId") == scene_id:
                    entries.append({k: v for k, v in meta.items() if k not in _META_ONLY_KEYS})
                    entry_items.append(scene_items)
                continue
            try:
                if dem is None:
                    dem, landcover, _ = read_inputs(g)
                entry, nbytes = process_scene(g, scene_items, dem, landcover, out, scene_id, opener)
            except Exception as e:  # ฉากเดียวล้ม ไม่ล้มทั้ง run — แต่ต้องมองเห็นใน health
                errors.append(f"{code}/{scene_id}: {type(e).__name__}: {e}")
                log.error("%s/%s: ล้มเหลว — %s", code, scene_id, e)
                failed_created.extend(p for p in (published_at(it) for it in scene_items) if p)
                continue
            if entry is None:
                log.info("%s/%s: items=%d รอยเท้าภาพไม่ครอบจังหวัด — ไม่มีฉาก (ไม่เขียน)", code, scene_id, len(scene_items))
                items_ok.update(it.id for it in scene_items)
                continue
            entries.append(entry)
            entry_items.append(scene_items)
            scenes_written += 1
            items_ok.update(it.id for it in scene_items)
            if newest_observed is None or entry["observedAt"] > newest_observed:
                newest_observed = entry["observedAt"]
            log.info(
                "%s/%s: items=%d flooded=%d observed=%d maxDepthCm=%s medianDepthCm=%s gz=%dB",
                code, scene_id, len(scene_items), entry["floodedCells"], entry["observedCells"],
                entry["maxDepthCm"], entry["medianDepthCm"], nbytes,
            )
        # เขียน index ครั้งเดียวต่อจังหวัด และ **เฉพาะเมื่อรายการฉากเปลี่ยน** (devops constraint b):
        # ไม่มี entry ใหม่ = ไบต์เดิมบน R2 ยังถูก ไม่อัปทับ ไม่ทำให้แคช 5 นาทีที่ขอบเก่าโดยเปล่าประโยชน์
        if entries:
            try:
                _write_json(ipath, merge_index(existing, g, entries, generated_at))
            except IndexOverflowError as e:
                # เกิน INDEX_MAX_SCENES: ฉากที่ประมวลผลแล้วยังอยู่บนดิสก์ (field.bin/meta.json) แต่ไม่มี
                # index ชี้ — เขียนไม่ได้จริง ๆ; จังหวัดนี้ล้มแต่จังหวัดอื่นเดินต่อ เหมือน error อื่น ๆ
                # ยึด lastCreated ของจังหวัดนี้ไว้ไม่ให้ข้ามฉากที่เขียน index ไม่สำเร็จ — เหมือนทุก error
                # path อื่น (ฉากเดียวล้ม/โหลดอินพุตไม่ได้) items_ok ถูกอัปเดตไปแล้วสำหรับฉากพวกนี้ แต่
                # entries ที่ยังไม่ถูกเขียนลง index.json ต้องถูกค้นหาใหม่รอบหน้า
                errors.append(str(e))
                log.error("จังหวัด %s: %s", g.code, e)
                for scene_items in entry_items:
                    failed_created.extend(p for p in (published_at(it) for it in scene_items) if p)
        else:
            log.info("จังหวัด %s: ไม่มีฉากใหม่ — ไม่เขียน index.json", g.code)

    # จังหวัดที่โหลดอินพุตไม่ได้: item ของมันยังไม่ถูกประมวลผล → ยึด lastCreated ไว้ไม่ให้ข้าม
    for u in unloaded or []:
        errors.append(u.error)
        log.error("จังหวัด %s: โหลดอินพุตไม่ได้ — %s", u.code, u.error)
        if u.bbox is None:
            hold_all = True
            continue
        failed_created.extend(
            p for p in (published_at(it) for it in items if it.bbox and _bbox_intersects(it.bbox, u.bbox)) if p
        )

    created_all = [p for p in (published_at(it) for it in items) if p]
    last_created: datetime | None = max(created_all) if created_all else None
    if hold_all:
        last_created = None
    elif failed_created and last_created is not None:
        # อย่าข้ามฉากที่ล้ม: รอบหน้าค้นตั้งแต่ `created` ของ item ที่ล้มที่เก่าสุด
        last_created = min(last_created, min(failed_created))
    return {
        "generatedAt": generated_at,
        "itemsProcessed": len(items_ok),
        "scenesWritten": scenes_written,
        "lastError": _join_errors(errors),
        "lastSceneObservedAt": newest_observed,
        "lastCreated": iso_z(last_created) if last_created else None,
    }


def write_health(out: Path, summary: dict) -> None:
    hpath = out / "flood" / "gfm" / "health.json"
    prev = _read_json(hpath) or {}
    ok = summary["lastError"] is None
    _write_json(
        hpath,
        {
            "lastRunAt": summary["generatedAt"],
            # run ที่ไม่มี error เท่านั้นที่นับว่า "ดึงสำเร็จ" — API ใช้ค่านี้เป็น fetchedAt (lastRunAt เป็น
            # lastAttemptAt) run ที่ล้มจึงคงค่าเดิม ไม่ใช่ประทับเวลาใหม่ทับ; 0 item โดยไม่มี error = สำเร็จ
            # (ถามแล้ว ต้นทางตอบว่าไม่มีของใหม่ — ต่างจาก "ถามไม่ได้" ซึ่งมี lastError)
            "lastSuccessAt": summary["generatedAt"] if ok else prev.get("lastSuccessAt"),
            # ฉากล่าสุดที่เคยเขียนสำเร็จ — run ที่ไม่มีฉากใหม่คงค่าเดิม ไม่ใช่ล้างเป็น null
            "lastSceneObservedAt": summary["lastSceneObservedAt"] or prev.get("lastSceneObservedAt"),
            "lastError": summary["lastError"],
            "itemsProcessed": summary["itemsProcessed"],
            "scenesWritten": summary["scenesWritten"],
        },
    )


def _load_grids(codes: list[str], work: Path, aoi: Path) -> tuple[list[ProvinceGrid], list[UnloadedProvince]]:
    """โหลดทีละจังหวัด — จังหวัดที่พังไม่ล้มทั้ง run แต่ถูกรายงาน (health.lastError) และ item ของมันถูกยึดไว้"""
    grids: list[ProvinceGrid] = []
    unloaded: list[UnloadedProvince] = []
    for c in codes:
        try:
            grids.append(load_province_grid(c, work, aoi))
        except Exception as e:
            bbox = None
            try:
                bbox = province_box(c, aoi).bbox
            except Exception:
                pass
            unloaded.append(UnloadedProvince(c, bbox, f"{c}: {type(e).__name__}: {e}"))
    return grids, unloaded


def _search_bbox(grids: list[ProvinceGrid], unloaded: list[UnloadedProvince]) -> tuple[float, float, float, float]:
    """bbox ของการค้น = รวมทุกจังหวัดที่ขอ **รวมจังหวัดที่โหลดไม่ได้** (item ของมันต้องถูกเห็นเพื่อยึดไว้)"""
    if any(u.bbox is None for u in unloaded):
        return THAILAND_BBOX
    boxes: list[ProvinceGrid | ProvinceBox] = [*grids, *(ProvinceBox(u.code, u.bbox) for u in unloaded if u.bbox)]
    return union_bbox(boxes) if boxes else THAILAND_BBOX


def _read_plan(path: Path, mode: str) -> dict:
    plan = _read_json(path)
    if not plan:
        raise SystemExit(f"ไม่พบ plan {path}")
    if plan.get("mode") != mode:
        raise SystemExit(f"plan {path} เป็นโหมด {plan.get('mode')!r} ไม่ใช่ {mode!r}")
    return plan


def _finish(out: Path, summary: dict, verb: str) -> int:
    write_health(out, summary)
    log.info("%s เสร็จ: itemsProcessed=%d scenesWritten=%d lastError=%s", verb, summary["itemsProcessed"],
             summary["scenesWritten"], summary["lastError"])
    return 1 if summary["lastError"] else 0


def cmd_check_grid(args: argparse.Namespace) -> int:
    rc = 0
    for code in args.province:
        g = load_province_grid(code, args.work_dir, args.aoi_root)
        rep = check_alignment(g)
        print(f"{code}: 30m {g.width}x{g.height} @ {g.cell_size_m:g} m · overview {g.overview.width}x{g.overview.height} @ {g.overview.cell_size_m:g} m")
        print(f"    {rep.describe()} · {'OK' if rep.ok else 'MISALIGNED'}")
        rc |= 0 if rep.ok else 1
    return rc


def _since_from(args: argparse.Namespace, state_path: Path) -> datetime | None:
    """จุดเริ่มของหน้าต่าง `created` — จาก --since หรือ state.lastCreated; None = ไม่มีทั้งคู่ (ห้ามเดา)"""
    if args.since:
        return _parse_when(args.since)
    st = _read_json(state_path)
    if not st or not st.get("lastCreated"):
        # ไม่มี state และไม่มี --since: ห้ามเดา "ตอนนี้" — ผู้ใช้ต้องบอกจุดเริ่ม
        print(f"ไม่พบ {state_path} (หรือไม่มี lastCreated) — ระบุ --since ISO สำหรับ run แรก", file=sys.stderr)
        return None
    return _parse_when(st["lastCreated"])


def cmd_plan(args: argparse.Namespace) -> int:
    """ค้น STAC ครั้งเดียว → จังหวัดที่มี item (บรรทัดละรหัส) + plan.json — ไม่แตะ DEM/ฉาก/state/health

    เขียน plan.json **เสมอ** แม้ค้นไม่สำเร็จ (มี `error`, provinces ว่าง) เพื่อให้ `run --plan` รายงานว่า
    "ถามไม่ได้" ลง health.json โดยไม่ขยับ state — plan ที่หายไปเฉย ๆ จะทำให้ run เดาไม่ได้ว่าเกิดอะไร
    """
    out: Path = args.out
    now = datetime.now(timezone.utc)
    if args.province:
        codes = list(args.province)
    else:
        codes, skipped = scan_aoi_root(args.aoi_root)
        if skipped:  # บรรทัดเดียว ไม่ว่าจะข้ามกี่รายการ — สิ่งที่ไม่ใช่จังหวัดต้องเห็นว่าถูกข้าม ไม่ใช่หายเงียบ
            log.info("plan: ข้าม %d รายการใต้ %s ที่ไม่ใช่จังหวัด (ต้องเป็นโฟลเดอร์ชื่อ 2 หลักที่มี manifest.json): %s",
                     len(skipped), args.aoi_root, ", ".join(skipped))
    boxes = [province_box(c, args.aoi_root) for c in codes]
    backfill = bool(getattr(args, "from") or args.to)
    plan: dict = {"mode": "backfill" if backfill else "run", "plannedAt": iso_now(now), "provinces": [],
                  "itemCount": 0, "sceneCount": 0, "createdMin": None, "createdMax": None, "error": None}
    if backfill:
        if not (getattr(args, "from") and args.to):
            print("โหมด backfill ต้องมีทั้ง --from และ --to", file=sys.stderr)
            return 2
        t0, t1 = _parse_when(getattr(args, "from")), _parse_when(args.to)
        plan.update({"from": iso_z(t0), "to": iso_z(t1)})
    else:
        since = _since_from(args, args.state or (out / "flood" / "gfm" / "state.json"))
        if since is None:
            return 2
        plan.update({"since": iso_z(since), "until": iso_z(now)})
    try:
        if backfill:
            items = search_items(None, None, union_bbox(boxes), acquired_from=t0, acquired_to=t1)
        else:
            items = search_items(since, now, union_bbox(boxes))
        groups = group_by_province(items, boxes)
        created = [p for p in (published_at(it) for it in items) if p]
        plan.update({
            "provinces": sorted({code for code, _ in groups}),
            "itemCount": len(items),
            "sceneCount": len(groups),
            "createdMin": iso_z(min(created)) if created else None,
            "createdMax": iso_z(max(created)) if created else None,
        })
    except Exception as e:  # ถามไม่ได้ ≠ ไม่มีของใหม่ — บอกให้ชัดใน plan แล้วให้ run ส่งต่อไป health
        plan["error"] = f"search: {type(e).__name__}: {e}"
        log.error("ค้น STAC ไม่สำเร็จ — %s", e)
    provinces_file: Path = args.provinces_file
    provinces_file.parent.mkdir(parents=True, exist_ok=True)
    provinces_file.write_text("".join(f"{c}\n" for c in plan["provinces"]), encoding="utf-8")
    _write_json(args.plan_file or provinces_file.parent / "plan.json", plan)
    log.info("plan: items=%d scenes=%d provinces=%s error=%s",
             plan["itemCount"], plan["sceneCount"], ",".join(plan["provinces"]) or "-", plan["error"])
    return 1 if plan["error"] else 0


def cmd_run(args: argparse.Namespace) -> int:
    out: Path = args.out
    state_path: Path = args.state or (out / "flood" / "gfm" / "state.json")
    now = datetime.now(timezone.utc)
    plan = _read_plan(args.plan, "run") if args.plan else None
    if plan is not None:
        codes = list(plan["provinces"])
        since = _parse_when(plan["since"])
        until = _parse_when(plan["createdMax"]) if plan.get("createdMax") else now
    else:
        if not args.province:
            print("ต้องระบุ --province อย่างน้อยหนึ่งตัว หรือ --plan", file=sys.stderr)
            return 2
        codes = list(args.province)
        s = _since_from(args, state_path)
        if s is None:
            return 2
        since = s
        until = _parse_when(args.until) if args.until else now
    grids, unloaded = _load_grids(codes, args.work_dir, args.aoi_root)
    summary = _empty_summary(now)
    if plan is not None and plan.get("error"):
        summary["lastError"] = plan["error"]  # plan ถามไม่ได้ — ไม่ค้นซ้ำ ไม่ขยับ state
    elif plan is not None and plan["itemCount"] == 0:
        log.info("plan ไม่มี item — ไม่ค้นซ้ำ")
    else:
        try:
            items = search_items(since, until, _search_bbox(grids, unloaded))
            log.info("STAC: %d item ตั้งแต่ created ≥ %s ถึง %s", len(items), iso_z(since), iso_z(until))
            summary = run_pipeline(items, grids, out, now=now, opener=None, unloaded=unloaded)
        except Exception as e:  # STAC ล่ม/เน็ตล่ม: บอกว่า "ถามไม่ได้" ไม่ใช่ "ไม่มีอะไรใหม่"
            summary["lastError"] = f"search: {type(e).__name__}: {e}"
            log.error("ค้น STAC ไม่สำเร็จ — %s", e)
    if unloaded and summary["lastError"] is None:
        summary["lastError"] = _join_errors([u.error for u in unloaded])
    # ไม่มี item ใหม่ หรือถาม STAC ไม่สำเร็จ → ไม่ขยับ (คงค่า since เดิม) ไม่ใช่ "ตอนนี้"
    last_created = summary["lastCreated"] or iso_z(since)
    _write_json(state_path, {"lastCreated": last_created})
    log.info("state: lastCreated=%s", last_created)
    return _finish(out, summary, "run")


# E14.F6: floor คงที่ของ backfill ทุกจังหวัด (Sentinel-1 ไม่มีข้อมูลใช้งานได้ก่อนหน้านี้อย่างมีนัยสำคัญ
# สำหรับ GFM) — ผู้ใช้ปรับได้ด้วย backfill-plan --floor แต่ต้องระบุ explicit ไม่มีการเดา
BACKFILL_FLOOR = "2015-01-01T00:00:00Z"
BACKFILL_STATE_VERSION = 1
# เหลือเวลาน้อยกว่านี้ก่อน deadline: ไม่เริ่ม visit ใหม่ — หนึ่ง visit ต้องมีเวลาพอดาวน์โหลดอินพุต
# (DEM/WorldCover เต็มจังหวัด) บวกอย่างน้อยสองสามฉาก
BACKFILL_DEADLINE_MARGIN_MINUTES = 20
# p95 เวลาต่อฉากเมื่อยังไม่เคยวัด (visit แรกของ job) — ปริยายอนุรักษ์นิยมกว่าตัวเลขจริงที่วัดได้ (~35 วิ/ฉาก)
BACKFILL_DEFAULT_SCENE_SECONDS = 60.0
# จำนวน visit ที่ล้มติดกัน (rc 1) ก่อนจังหวัดถูกทำเครื่องหมาย failed ถาวร (ข้ามในแผนถัดไป) — ล้มชั่วคราว
# ครั้งเดียว (STAC/เน็ตล่ม) ต้องไม่ทิ้งหน้าต่างที่เหลือทั้งหมดของจังหวัดนั้น
BACKFILL_MAX_CONSECUTIVE_FAILURES = 3


def _p95(durations: list[float], default: float = BACKFILL_DEFAULT_SCENE_SECONDS) -> float:
    """p95 แบบ nearest-rank — ไม่พึ่ง numpy ใน cli.py; ว่าง = default (ยังไม่เคยวัดฉากไหนในรอบนี้)"""
    if not durations:
        return default
    s = sorted(durations)
    idx = min(len(s) - 1, math.ceil(0.95 * len(s)) - 1)
    return s[idx]


@dataclass
class BackfillVisitResult:
    """ผลของหนึ่ง visit (จังหวัดเดียว, หน้าต่าง from..to เดียว) — cmd_backfill ใช้สร้าง cursor.json"""

    entries: list[dict] = field(default_factory=list)
    scenes_processed: int = 0  # ฉากที่เรียก process_scene จริง (นับ error ด้วย — เวลาถูกใช้ไปแล้ว)
    scenes_skipped: int = 0  # ฉากที่ข้ามเพราะอยู่ใน index/field.bin แล้ว (เหมือน run_pipeline)
    stopped_at_deadline: bool = False
    last_visited: tuple[str, str] | None = None  # (sceneId, observedAt) ของฉากสุดท้ายที่แตะในรอบนี้
    errors: list[str] = field(default_factory=list)


def run_backfill_visit(
    grid: ProvinceGrid,
    items: list,
    out: Path,
    *,
    now: datetime,
    deadline: datetime,
    opener=None,
    clock=None,
) -> BackfillVisitResult:
    """ประมวลผลฉากของจังหวัดเดียว **ใหม่สุดก่อน** หยุดก่อนเริ่มฉากถัดไปเมื่อเวลาไม่พอ (E14.F6)

    `clock` (ปริยาย datetime.now) เรียกก่อนเช็ค deadline ของแต่ละฉาก และอีกครั้งหลังประมวลผลเสร็จ
    เพื่อวัดเวลาจริงต่อฉาก — แยกจาก `now` (เวลาเริ่ม visit, ใช้เป็น generatedAt ของ index)
    """
    clock = clock or (lambda: datetime.now(timezone.utc))
    groups = group_by_province(items, [grid])
    keys = sorted((k for k in groups if k[0] == grid.code), key=lambda k: k[1], reverse=True)  # ใหม่สุดก่อน
    ipath = index_path(out, grid.code)
    existing = _read_json(ipath)
    known = {s["sceneId"] for s in (existing or {}).get("scenes", [])}
    result = BackfillVisitResult()
    durations: list[float] = []
    dem = landcover = None

    for code, scene_id in keys:
        t_check = clock()
        if t_check + timedelta(seconds=3 * _p95(durations)) > deadline:
            result.stopped_at_deadline = True
            break
        scene_items = groups[(code, scene_id)]
        observed_fallback = iso_z(min(scene_key(it).acquisition_utc for it in scene_items))
        if scene_id in known:
            log.info("%s/%s: อยู่ใน index แล้ว — ข้าม", code, scene_id)
            result.scenes_skipped += 1
            result.last_visited = (scene_id, observed_fallback)
            continue
        fdir = scene_dir(out, code, scene_id)
        if (fdir / "field.bin").exists():
            log.info("%s/%s: มี field.bin แล้ว — ข้าม", code, scene_id)
            result.scenes_skipped += 1
            meta = _read_json(fdir / "meta.json")
            observed = meta["observedAt"] if meta else observed_fallback
            if meta and meta.get("sceneId") == scene_id:
                result.entries.append({k: v for k, v in meta.items() if k not in _META_ONLY_KEYS})
            result.last_visited = (scene_id, observed)
            continue
        t0 = clock()
        try:
            if dem is None:
                dem, landcover, _ = read_inputs(grid)
            entry, nbytes = process_scene(grid, scene_items, dem, landcover, out, scene_id, opener)
        except Exception as e:  # ฉากเดียวล้ม ไม่ล้มทั้ง visit — เหมือน run_pipeline
            result.errors.append(f"{code}/{scene_id}: {type(e).__name__}: {e}")
            log.error("%s/%s: ล้มเหลว — %s", code, scene_id, e)
            durations.append((clock() - t0).total_seconds())
            result.scenes_processed += 1
            result.last_visited = (scene_id, observed_fallback)
            continue
        durations.append((clock() - t0).total_seconds())
        result.scenes_processed += 1
        if entry is None:
            log.info("%s/%s: items=%d รอยเท้าภาพไม่ครอบจังหวัด — ไม่มีฉาก (ไม่เขียน)", code, scene_id, len(scene_items))
            result.last_visited = (scene_id, observed_fallback)
            continue
        result.entries.append(entry)
        result.last_visited = (scene_id, entry["observedAt"])
        log.info(
            "%s/%s: items=%d flooded=%d observed=%d gz=%dB",
            code, scene_id, len(scene_items), entry["floodedCells"], entry["observedCells"], nbytes,
        )
    return result


def cmd_backfill(args: argparse.Namespace) -> int:
    out: Path = args.out
    now = datetime.now(timezone.utc)
    if args.deadline:
        if not args.cursor_out:
            print("โหมด --deadline (E14.F6) ต้องระบุ --cursor-out ด้วย", file=sys.stderr)
            return 2
        return _cmd_backfill_visit(args, out, now)
    plan = _read_plan(args.plan, "backfill") if args.plan else None
    if plan is not None:
        codes = list(plan["provinces"])
        t0, t1 = _parse_when(plan["from"]), _parse_when(plan["to"])
    else:
        if not args.province or not getattr(args, "from") or not args.to:
            print("ต้องระบุ --province, --from และ --to หรือ --plan", file=sys.stderr)
            return 2
        codes = list(args.province)
        t0, t1 = _parse_when(getattr(args, "from")), _parse_when(args.to)
    grids, unloaded = _load_grids(codes, args.work_dir, args.aoi_root)
    summary = _empty_summary(now)
    if plan is not None and plan.get("error"):
        summary["lastError"] = plan["error"]
    elif plan is not None and plan["itemCount"] == 0:
        log.info("plan ไม่มี item — ไม่ค้นซ้ำ")
    else:
        try:
            items = search_items(None, None, _search_bbox(grids, unloaded), acquired_from=t0, acquired_to=t1)
            log.info("STAC: %d item บันทึกภาพระหว่าง %s..%s", len(items), iso_z(t0), iso_z(t1))
            summary = run_pipeline(items, grids, out, now=now, opener=None, unloaded=unloaded)
        except Exception as e:
            summary["lastError"] = f"search: {type(e).__name__}: {e}"
            log.error("ค้น STAC ไม่สำเร็จ — %s", e)
    if unloaded and summary["lastError"] is None:
        summary["lastError"] = _join_errors([u.error for u in unloaded])
    # backfill ไม่แตะ state.json: lastCreated เป็นของ run ปกติ (ถอยไปอดีตแล้วขยับ = ข้ามของใหม่)
    return _finish(out, summary, "backfill")


def _cursor_error(
    cursor_path: Path, code: str | None, error: str, *, search_count: int = 0,
    scenes_processed: int = 0, scenes_skipped: int = 0,
) -> int:
    """เขียน cursor.json สำหรับ visit ที่ล้ม — คืน 1 เสมอ (E14.F6: "ล้ม" = ไม่มีอะไรให้อัป)

    scenes_processed/scenes_skipped ปริยาย 0 (ล้มก่อนแตะฉากไหนเลย — grid โหลดไม่ได้/ค้นไม่สำเร็จ) แต่รับ
    ค่าจริงได้เมื่อ visit ประมวลผลไปแล้วบางส่วนก่อนจะพัง (เช่น index overflow) ไม่ให้ตัวเลขหายไปเงียบ ๆ
    """
    _write_json(cursor_path, {
        "code": code, "nextTo": None, "done": False, "scenesProcessed": scenes_processed,
        "scenesSkipped": scenes_skipped, "searchCount": search_count, "lastError": error,
    })
    log.error(error)
    return 1


def _cmd_backfill_visit(args: argparse.Namespace, out: Path, now: datetime) -> int:
    """หนึ่ง visit ของจังหวัดเดียว (E14.F6, `backfill --deadline`) — เขียน cursor.json เสมอไม่ว่าจะจบยังไง

    ครอบด้วย try/except กว้างสุดท้าย: ความล้มเหลวที่ไม่ได้คาดไว้ก็ต้องมี cursor.json ที่มี lastError
    ไม่งั้น backfill-advance (ซึ่งอ่านแค่ cursor.json) จะไม่เห็นเลยว่า visit นี้พัง
    """
    cursor_path: Path = args.cursor_out
    codes = list(args.province or [])
    code = codes[0] if codes else None
    try:
        if len(codes) != 1 or not getattr(args, "from") or not args.to:
            return _cursor_error(cursor_path, code, "backfill --deadline ต้องการ --province ตัวเดียว, --from และ --to")
        if getattr(args, "require_index", False) and not index_path(out, code).exists():
            # workflow บอกว่ามี index.json เดิมบน R2 (fetch_optional ดึงสำเร็จ) แต่ในเครื่องไม่มี — เชื่อ
            # ไม่ได้ว่ารายการฉากเดิมครบ ปฏิเสธเขียนทับ index จริงด้วย index ที่มีแค่ฉากของ visit นี้
            return _cursor_error(cursor_path, code,
                                  f"{code}: --require-index แต่ไม่พบ index.json ในเครื่อง — ปฏิเสธเขียนทับ")
        deadline = _parse_when(args.deadline)
        t0, t1 = _parse_when(getattr(args, "from")), _parse_when(args.to)
        try:
            grid = load_province_grid(code, args.work_dir, args.aoi_root)
        except Exception as e:
            return _cursor_error(cursor_path, code, f"{code}: {type(e).__name__}: {e}")
        try:
            # bbox ของการค้น = bbox ของจังหวัดนี้เท่านั้น (ต่างจาก `backfill --plan` ที่ค้นรวมหลายจังหวัด)
            items = search_items(None, None, grid.bbox, acquired_from=t0, acquired_to=t1)
        except Exception as e:
            return _cursor_error(cursor_path, code, f"search: {type(e).__name__}: {e}", search_count=1)
        log.info("STAC: %d item บันทึกภาพระหว่าง %s..%s (จังหวัด %s)", len(items), iso_z(t0), iso_z(t1), code)
        result = run_backfill_visit(grid, items, out, now=now, deadline=deadline)
        last_error = _join_errors(result.errors)
        if result.entries:
            try:
                existing = _read_json(index_path(out, code))
                _write_json(index_path(out, code), merge_index(existing, grid, result.entries, iso_now(now)))
            except IndexOverflowError as e:
                # ฉากที่ประมวลผลแล้วยังอยู่บนดิสก์แต่ไม่มี index ชี้ — runner ทิ้ง (ephemeral) ไม่อัป แต่
                # scenesProcessed/scenesSkipped ยังต้องเป็นตัวเลขจริง ไม่ใช่ 0 ทั้งที่ประมวลผลไปแล้ว
                return _cursor_error(cursor_path, code, str(e), search_count=1,
                                      scenes_processed=result.scenes_processed, scenes_skipped=result.scenes_skipped)
        if result.stopped_at_deadline:
            # nextTo=None (ยังไม่แตะฉากไหนเลยก่อนหมดเวลา — เช่น deadline หมดระหว่างโหลดอินพุต) ต้องไม่
            # ทำให้รอบหน้าได้ --to null แล้วพัง: คงหน้าต่างเดิม (t1) ไว้แทน (กันไว้สองชั้นกับ backfill-advance)
            next_to = iso_z(t1)
            if result.last_visited:
                last_observed = _parse_when(result.last_visited[1])
                next_to = iso_z(last_observed - timedelta(seconds=1))
            _write_json(cursor_path, {
                "code": code, "nextTo": next_to, "done": False,
                "scenesProcessed": result.scenes_processed, "scenesSkipped": result.scenes_skipped,
                "searchCount": 1, "lastError": last_error,
            })
            log.info("%s: หยุดที่ deadline — nextTo=%s scenesProcessed=%d scenesSkipped=%d",
                     code, next_to, result.scenes_processed, result.scenes_skipped)
            return 3
        if not result.entries and result.errors:
            # จบหน้าต่างทั้งก้อนโดยไม่มีฉากไหนสำเร็จเลย (เช่น read_inputs/process_scene ล้มทุกฉาก) — ไม่มี
            # อะไรให้อัปขึ้น R2 จริง ๆ visit นี้ต้องนับเป็น "ล้ม" (rc 1, ไม่ใช่ done: true ที่ควรแปลว่า
            # "ถามแล้วไม่มีของใหม่") ไม่งั้นจังหวัดที่อ่านไม่ได้เลยจะถูกปิดว่าเสร็จด้วยศูนย์ฉาก
            return _cursor_error(cursor_path, code, last_error, search_count=1,
                                  scenes_processed=result.scenes_processed, scenes_skipped=result.scenes_skipped)
        _write_json(cursor_path, {
            "code": code, "nextTo": None, "done": True,
            "scenesProcessed": result.scenes_processed, "scenesSkipped": result.scenes_skipped,
            "searchCount": 1, "lastError": last_error,
        })
        log.info("%s: จบหน้าต่าง — scenesProcessed=%d scenesSkipped=%d lastError=%s",
                 code, result.scenes_processed, result.scenes_skipped, last_error)
        return 0
    except Exception as e:  # ไม่คาดไว้ — ยังต้องเขียน cursor.json ไม่งั้น advance มองไม่เห็นว่า visit นี้พัง
        return _cursor_error(cursor_path, code, f"{type(e).__name__}: {e}")


def _fresh_backfill_state(aoi_root: Path, floor: str, live_start: str, now: datetime) -> dict:
    """state ใหม่: ลำดับจาก scan_aoi_root (ตัวเลข), from=floor คงที่ทุกจังหวัด, to=live_start ขอบบน"""
    codes, skipped = scan_aoi_root(aoi_root)
    if skipped:
        log.info("backfill-plan: ข้าม %d รายการใต้ %s ที่ไม่ใช่จังหวัด: %s", len(skipped), aoi_root, ", ".join(skipped))
    started = iso_now(now)
    return {
        "version": BACKFILL_STATE_VERSION,
        "floor": floor,
        "provinces": {
            c: {"to": live_start, "done": False, "failed": None, "failures": 0, "lastError": None, "scenes": 0}
            for c in codes
        },
        "order": codes,
        "current": None,
        "startedAt": started,
        "updatedAt": started,
    }


def cmd_backfill_plan(args: argparse.Namespace) -> int:
    """E14.F6: อ่าน/สร้าง state แล้วพิมพ์ JSON ของ visit ถัดไปลง stdout — คืน 0 เสมอ (ทั้งสามรูปแบบผลลัพธ์
    เป็นผลลัพธ์ปกติของ plan ไม่ใช่ความล้มเหลว — ห้ามให้ `plan_json=$(...)` ใน shell เห็นเป็นพัง)
    """
    now = datetime.now(timezone.utc)
    state_path: Path = args.state
    deadline = _parse_when(args.deadline)
    state = _read_json(state_path)
    if state is None:
        state = _fresh_backfill_state(args.aoi_root, args.floor, args.live_start, now)
        _write_json(state_path, state)
        log.info("backfill-plan: สร้าง state ใหม่ %d จังหวัด floor=%s liveStart=%s",
                  len(state["order"]), args.floor, args.live_start)
    if deadline - now < timedelta(minutes=BACKFILL_DEADLINE_MARGIN_MINUTES):
        print(json.dumps({"done": True, "reason": "deadline"}))
        return 0
    provinces: dict = state["provinces"]
    current = state.get("current")
    code = current if current and current in provinces and not provinces[current]["done"] and not provinces[current]["failed"] else None
    if code is None:
        for c in state["order"]:
            p = provinces.get(c)
            if p and not p["done"] and not p["failed"]:
                code = c
                break
    if code is None:
        print(json.dumps({"done": True}))
        return 0
    print(json.dumps({"code": code, "from": state["floor"], "to": provinces[code]["to"]}))
    return 0


def cmd_backfill_advance(args: argparse.Namespace) -> int:
    """E14.F6: ปรับ state ตาม cursor.json + --rc ของ visit ที่เพิ่งรัน — เขียนทับ --state"""
    now = datetime.now(timezone.utc)
    state_path: Path = args.state
    state = _read_json(state_path)
    if state is None:
        print(f"ไม่พบ state {state_path} — ต้องรัน backfill-plan ก่อนเสมอ", file=sys.stderr)
        return 2
    cursor = _read_json(args.cursor)
    if cursor is None:
        print(f"ไม่พบ cursor {args.cursor}", file=sys.stderr)
        return 2
    code = cursor.get("code")
    if not code or code not in state["provinces"]:
        print(f"cursor ไม่มีรหัสจังหวัดที่รู้จักใน state: {cursor.get('code')!r}", file=sys.stderr)
        return 2
    p = state["provinces"][code]
    p["scenes"] = p.get("scenes", 0) + int(cursor.get("scenesProcessed", 0))
    p.setdefault("failures", 0)
    p.setdefault("lastError", None)
    rc = args.rc
    if rc == 0 and cursor.get("lastError"):
        # ไม่ควรเกิดขึ้นจริง — cli.py คืน rc 1 เสมอเมื่อ visit ไม่มีฉากสำเร็จเลยแต่มี error (กันไว้ที่
        # cli.py แล้ว) แต่ถ้า cursor.json ผิดปกติหลุดมาถึงนี่ (บั๊กที่ไม่คาดคิด) ต้องไม่ปิดจังหวัดว่า
        # "เสร็จ": ปฏิบัติเหมือน rc==1 กันไว้สองชั้น
        log.error("backfill-advance: %s cursor มี lastError ทั้งที่ rc=0 — ปฏิบัติเหมือนล้ม: %s",
                   code, cursor["lastError"])
        rc = 1
    if rc == 0:
        p["done"] = True
        p["failures"] = 0
        p["lastError"] = None
        state["current"] = None
    elif rc == 3:
        next_to = cursor.get("nextTo")
        if next_to:  # null = ยังไม่แตะฉากไหนในรอบนี้ — คง to เดิมไว้ ไม่งั้นรอบหน้าได้ --to None แล้วพัง
            p["to"] = next_to
        if cursor.get("lastError"):
            # หยุดที่ deadline แต่มีฉากที่ล้มปนอยู่ในหน้าต่างนี้ (ไม่ใช่ visit สะอาด) — ห้ามล้าง
            # failures/lastError ทิ้งเหมือนไม่มีอะไรเกิดขึ้น ไม่งั้นจังหวัดที่ล้มช้า ๆ ทุก visit (พอดีชน
            # deadline ก่อนเสมอ) จะไม่มีวันสะสมครบเกณฑ์ failed เลย — คงค่าเดิมไว้ (ไม่เพิ่มด้วย เพราะ
            # visit นี้เดินหน้าต่อได้จริง มี nextTo ขยับ ต่างจาก rc 1 ที่ไม่มีอะไรขยับเลย)
            pass
        else:
            p["failures"] = 0
            p["lastError"] = None
        state["current"] = code
    else:  # rc == 1 (หรือ rc==0 ที่ cursor มี lastError ผิดปกติ — ถูกแปลงเป็น 1 ข้างบน)
        p["failures"] = p.get("failures", 0) + 1
        p["lastError"] = cursor.get("lastError") or f"{code}: backfill exit 1 ไม่มี lastError"
        # ล้มติดกันครบเกณฑ์เท่านั้นถึงข้ามถาวร — ล้มชั่วคราวครั้งเดียว (เช่น STAC/เน็ตล่ม) ไม่ควรทิ้ง
        # หน้าต่างที่เหลือทั้งหมดของจังหวัดนั้น
        if p["failures"] >= BACKFILL_MAX_CONSECUTIVE_FAILURES:
            p["failed"] = p["lastError"]
        state["current"] = None
    state["updatedAt"] = iso_now(now)
    _write_json(state_path, state)
    log.info("backfill-advance: %s rc=%d done=%s failed=%s failures=%d to=%s scenes=%d",
              code, rc, p["done"], p["failed"], p["failures"], p.get("to"), p["scenes"])
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m gfm", description="SIAHRA E14 — Copernicus GFM → FwDET → field.bin")
    p.add_argument("--work-dir", type=Path, default=DEFAULT_WORK, help="โฟลเดอร์ p{code}-clipped30.tif")
    p.add_argument("--aoi-root", type=Path, default=DEFAULT_AOI, help="โฟลเดอร์ apps/web/public/aoi")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp: argparse.ArgumentParser, *, plan_help: str) -> None:
        sp.add_argument("--province", action="append", help="รหัสจังหวัด (ซ้ำได้) — ไม่ต้องใส่เมื่อใช้ --plan")
        sp.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"ปริยาย {DEFAULT_OUT}")
        sp.add_argument("--plan", type=Path, help=plan_help)

    pl = sub.add_parser("plan", help="ค้น STAC ครั้งเดียว → จังหวัดที่มี item + plan.json (ไม่ประมวลผล)")
    pl.add_argument("--province", action="append", help="จำกัดจังหวัด (ปริยาย: ทุกจังหวัดใน --aoi-root)")
    pl.add_argument("--out", type=Path, default=DEFAULT_OUT, help="ใช้หา state.json ปริยาย")
    pl.add_argument("--since", help="ISO — created ≥ นี้ (แทน state)")
    pl.add_argument("--state", type=Path, help="ปริยาย DIR/flood/gfm/state.json")
    pl.add_argument("--from", help="ISO — โหมด backfill (เวลาบันทึกภาพ)")
    pl.add_argument("--to", help="ISO — โหมด backfill")
    pl.add_argument("--provinces-file", type=Path, required=True, help="เขียนรหัสจังหวัดที่มี item บรรทัดละตัว")
    pl.add_argument("--plan-file", type=Path, help="ปริยาย: plan.json ข้าง --provinces-file")
    pl.set_defaults(fn=cmd_plan)

    r = sub.add_parser("run", help="ฉากใหม่ตั้งแต่ state.lastCreated (หรือ --since)")
    common(r, plan_help="plan.json จาก `plan` (โหมด run) — ให้ provinces/since/until")
    r.add_argument("--since", help="ISO — created ≥ นี้ (แทน state)")
    r.add_argument("--until", help="ISO — created ≤ นี้ (ปริยาย: ตอนนี้)")
    r.add_argument("--state", type=Path, help="ปริยาย DIR/flood/gfm/state.json")
    r.set_defaults(fn=cmd_run)

    b = sub.add_parser("backfill", help="ฉากที่บันทึกภาพระหว่าง --from..--to")
    common(b, plan_help="plan.json จาก `plan --from --to` — ให้ provinces/from/to")
    b.add_argument("--from", help="ISO")
    b.add_argument("--to", help="ISO")
    b.add_argument("--deadline", help="ISO — E14.F6: หนึ่ง visit ของจังหวัดเดียว หยุดก่อนหมดเวลา (ต้องคู่กับ --cursor-out)")
    b.add_argument("--cursor-out", type=Path, help="E14.F6: เขียน cursor.json ที่นี่ (ต้องคู่กับ --deadline)")
    b.add_argument("--require-index", action="store_true",
                    help="E14.F6 --deadline: ปฏิเสธเขียน index.json ถ้าไม่พบไฟล์เดิมในเครื่อง (ใช้เมื่อรู้ว่ามีอยู่บน R2)")
    b.set_defaults(fn=cmd_backfill)

    bp = sub.add_parser("backfill-plan", help="E14.F6: อ่าน/สร้าง state ของ backfill → visit ถัดไป (JSON ลง stdout)")
    bp.add_argument("--state", type=Path, required=True, help="flood/gfm/backfill-state.json ที่ดาวน์โหลดมา (สร้างใหม่ถ้าไม่มี)")
    bp.add_argument("--deadline", required=True, help="ISO — เวลาสิ้นสุด job (job start + 285 นาที)")
    bp.add_argument("--floor", default=BACKFILL_FLOOR, help=f"ISO — ขอบล่างของ backfill ทุกจังหวัด ปริยาย {BACKFILL_FLOOR}")
    bp.add_argument("--live-start", required=True, help="ISO — since แรกสุดของ live ingest (ขอบบนของ backfill เมื่อสร้าง state ใหม่)")
    bp.set_defaults(fn=cmd_backfill_plan)

    ba = sub.add_parser("backfill-advance", help="E14.F6: ปรับ state ตามผลของ visit ที่เพิ่งรัน (rc ของ `backfill --deadline`)")
    ba.add_argument("--state", type=Path, required=True)
    ba.add_argument("--cursor", type=Path, required=True, help="cursor.json จาก `backfill --cursor-out`")
    ba.add_argument("--rc", type=int, required=True, choices=(0, 1, 3), help="exit code ของ `backfill --deadline`")
    ba.set_defaults(fn=cmd_backfill_advance)

    c = sub.add_parser("check-grid", help="รายงานการจัดแนว 30 ม. กับ overview")
    c.add_argument("--province", action="append", required=True)
    c.set_defaults(fn=cmd_check_grid)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )
    logging.getLogger("rasterio").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    return args.fn(args)
