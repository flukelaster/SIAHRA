"""CLI: `python -m gfm plan|run|backfill|check-grid` — เขียนต้นไม้ไฟล์ที่สะท้อนคีย์บน R2 ตัวต่อตัว

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
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .encode import aggregate, encode_field, gzip_bytes, iso_now, merge_index, scene_entry, scene_meta
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
            _write_json(ipath, merge_index(existing, g, entries, generated_at))
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


def cmd_backfill(args: argparse.Namespace) -> int:
    out: Path = args.out
    now = datetime.now(timezone.utc)
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
    b.set_defaults(fn=cmd_backfill)

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
