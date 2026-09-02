"""CLI: `python -m gfm run|backfill|check-grid` — เขียนต้นไม้ไฟล์ที่สะท้อนคีย์บน R2 ตัวต่อตัว

    DIR/aoi/{code}/flood/index.json
    DIR/aoi/{code}/flood/{sceneId}/field.bin      (gzip แล้ว — R2 ส่งด้วย Content-Encoding: gzip)
    DIR/aoi/{code}/flood/{sceneId}/meta.json
    DIR/flood/gfm/state.json                      ({lastCreated} — เฉพาะ `run`)
    DIR/flood/gfm/health.json                     ({lastRunAt, lastSceneObservedAt, lastError, itemsProcessed, scenesWritten})

ไม่มีโค้ดอัปโหลดในเฟสนี้ — workflow ของ F3 sync ต้นไม้นี้ด้วย rclone
- ฉากที่มี field.bin อยู่แล้วถูกข้าม (immutable, idempotent)
- ฉากที่ล้มเหลวถูกจับ บันทึกใน health.lastError แล้วรันต่อ; state.lastCreated ไม่ข้ามฉากที่ล้ม
- index.json ถูกเขียน **ครั้งเดียวต่อจังหวัดต่อ run** (สะสม entry ก่อน) — devops constraint (b)
- log บรรทัดเดียวต่อฉาก ไม่มีต่อเซลล์
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import contract as C
from .encode import aggregate, encode_field, gzip_bytes, iso_now, merge_index, scene_entry, scene_meta
from .fwdet import estimate_depth
from .grid import ProvinceGrid, check_alignment, load_province_grid, read_inputs
from .stac import group_by_province, iso_z, orbit, published_at, scene_key, search_items, union_bbox
from .warp import warp_scene

log = logging.getLogger("gfm")

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_OUT = REPO_ROOT / "apps" / "etl" / "data" / "flood"
DEFAULT_WORK = REPO_ROOT / "apps" / "etl" / "data" / "work"
DEFAULT_AOI = REPO_ROOT / "apps" / "web" / "public" / "aoi"


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
    key = scene_key(items[0])
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
    _write_json(d / "meta.json", scene_meta(entry, len(gz)))
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
) -> dict:
    """ประมวลผลทุกฉากของทุกจังหวัด — คืนสรุปสำหรับ state/health"""
    groups = group_by_province(items, grids)
    scenes_written = 0
    items_ok: set[str] = set()
    failed_created: list[datetime] = []
    last_error: str | None = None
    newest_observed: str | None = None
    generated_at = iso_now(now)

    for g in grids:
        keys = sorted(k for k in groups if k[0] == g.code)
        if not keys:
            log.info("จังหวัด %s: ไม่มี item ของ GFM ทับ bbox ในช่วงที่ค้น", g.code)
        dem = landcover = None
        entries: list[dict] = []
        for code, scene_id in keys:
            scene_items = groups[(code, scene_id)]
            fdir = scene_dir(out, code, scene_id)
            if (fdir / "field.bin").exists():
                log.info("%s/%s: มี field.bin แล้ว — ข้าม", code, scene_id)
                items_ok.update(it.id for it in scene_items)
                continue
            try:
                if dem is None:
                    dem, landcover, _ = read_inputs(g)
                entry, nbytes = process_scene(g, scene_items, dem, landcover, out, scene_id, opener)
            except Exception as e:  # ฉากเดียวล้ม ไม่ล้มทั้ง run — แต่ต้องมองเห็นใน health
                last_error = f"{code}/{scene_id}: {type(e).__name__}: {e}"
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
        # เขียน index ครั้งเดียวต่อจังหวัด (devops constraint b) — รวมกรณีไม่มีฉากใหม่ (generatedAt ขยับ)
        ipath = index_path(out, g.code)
        _write_json(ipath, merge_index(_read_json(ipath), g, entries, generated_at))

    created_all = [p for p in (published_at(it) for it in items) if p]
    last_created: datetime | None = max(created_all) if created_all else None
    if failed_created and last_created is not None:
        # อย่าข้ามฉากที่ล้ม: รอบหน้าค้นตั้งแต่ `created` ของ item ที่ล้มที่เก่าสุด
        last_created = min(last_created, min(failed_created))
    return {
        "generatedAt": generated_at,
        "itemsProcessed": len(items_ok),
        "scenesWritten": scenes_written,
        "lastError": last_error,
        "lastSceneObservedAt": newest_observed,
        "lastCreated": iso_z(last_created) if last_created else None,
    }


def write_health(out: Path, summary: dict) -> None:
    hpath = out / "flood" / "gfm" / "health.json"
    prev = _read_json(hpath) or {}
    _write_json(
        hpath,
        {
            "lastRunAt": summary["generatedAt"],
            # ฉากล่าสุดที่เคยเขียนสำเร็จ — run ที่ไม่มีฉากใหม่คงค่าเดิม ไม่ใช่ล้างเป็น null
            "lastSceneObservedAt": summary["lastSceneObservedAt"] or prev.get("lastSceneObservedAt"),
            "lastError": summary["lastError"],
            "itemsProcessed": summary["itemsProcessed"],
            "scenesWritten": summary["scenesWritten"],
        },
    )


def _load_grids(codes: list[str], work: Path, aoi: Path) -> list[ProvinceGrid]:
    return [load_province_grid(c, work, aoi) for c in codes]


def cmd_check_grid(args: argparse.Namespace) -> int:
    rc = 0
    for code in args.province:
        g = load_province_grid(code, args.work_dir, args.aoi_root)
        rep = check_alignment(g)
        print(f"{code}: 30m {g.width}x{g.height} @ {g.cell_size_m:g} m · overview {g.overview.width}x{g.overview.height} @ {g.overview.cell_size_m:g} m")
        print(f"    {rep.describe()} · {'OK' if rep.ok else 'MISALIGNED'}")
        rc |= 0 if rep.ok else 1
    return rc


def cmd_run(args: argparse.Namespace) -> int:
    out: Path = args.out
    state_path: Path = args.state or (out / "flood" / "gfm" / "state.json")
    now = datetime.now(timezone.utc)
    if args.since:
        since = _parse_when(args.since)
    else:
        st = _read_json(state_path)
        if not st or not st.get("lastCreated"):
            # ไม่มี state และไม่มี --since: ห้ามเดา "ตอนนี้" — ผู้ใช้ต้องบอกจุดเริ่ม
            print(f"ไม่พบ {state_path} (หรือไม่มี lastCreated) — ระบุ --since ISO สำหรับ run แรก", file=sys.stderr)
            return 2
        since = _parse_when(st["lastCreated"])
    grids = _load_grids(args.province, args.work_dir, args.aoi_root)
    summary = {"generatedAt": iso_now(now), "itemsProcessed": 0, "scenesWritten": 0, "lastError": None,
               "lastSceneObservedAt": None, "lastCreated": None}
    try:
        items = search_items(since, now, union_bbox(grids))
        log.info("STAC: %d item ตั้งแต่ created ≥ %s", len(items), iso_z(since))
        summary = run_pipeline(items, grids, out, now=now, opener=None)
    except Exception as e:  # STAC ล่ม/เน็ตล่ม: บอกว่า "ถามไม่ได้" ไม่ใช่ "ไม่มีอะไรใหม่"
        summary["lastError"] = f"search: {type(e).__name__}: {e}"
        log.error("ค้น STAC ไม่สำเร็จ — %s", e)
    write_health(out, summary)
    # ไม่มี item ใหม่ หรือถาม STAC ไม่สำเร็จ → ไม่ขยับ (คงค่า since เดิม) ไม่ใช่ "ตอนนี้"
    last_created = summary["lastCreated"] or iso_z(since)
    _write_json(state_path, {"lastCreated": last_created})
    log.info("run เสร็จ: items=%d scenes=%d lastCreated=%s error=%s",
             summary["itemsProcessed"], summary["scenesWritten"], last_created, summary["lastError"])
    return 1 if summary["lastError"] else 0


def cmd_backfill(args: argparse.Namespace) -> int:
    out: Path = args.out
    now = datetime.now(timezone.utc)
    t0 = _parse_when(getattr(args, "from"))
    t1 = _parse_when(args.to)
    grids = _load_grids(args.province, args.work_dir, args.aoi_root)
    summary = {"generatedAt": iso_now(now), "itemsProcessed": 0, "scenesWritten": 0, "lastError": None,
               "lastSceneObservedAt": None, "lastCreated": None}
    try:
        items = search_items(None, None, union_bbox(grids), acquired_from=t0, acquired_to=t1)
        log.info("STAC: %d item บันทึกภาพระหว่าง %s..%s", len(items), iso_z(t0), iso_z(t1))
        summary = run_pipeline(items, grids, out, now=now, opener=None)
    except Exception as e:
        summary["lastError"] = f"search: {type(e).__name__}: {e}"
        log.error("ค้น STAC ไม่สำเร็จ — %s", e)
    # backfill ไม่แตะ state.json: lastCreated เป็นของ run ปกติ (ถอยไปอดีตแล้วขยับ = ข้ามของใหม่)
    write_health(out, summary)
    log.info("backfill เสร็จ: items=%d scenes=%d error=%s",
             summary["itemsProcessed"], summary["scenesWritten"], summary["lastError"])
    return 1 if summary["lastError"] else 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m gfm", description="SIAHRA E14 — Copernicus GFM → FwDET → field.bin")
    p.add_argument("--work-dir", type=Path, default=DEFAULT_WORK, help="โฟลเดอร์ p{code}-clipped30.tif")
    p.add_argument("--aoi-root", type=Path, default=DEFAULT_AOI, help="โฟลเดอร์ apps/web/public/aoi")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--province", action="append", required=True, help="รหัสจังหวัด (ซ้ำได้)")
        sp.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"ปริยาย {DEFAULT_OUT}")

    r = sub.add_parser("run", help="ฉากใหม่ตั้งแต่ state.lastCreated (หรือ --since)")
    common(r)
    r.add_argument("--since", help="ISO — created ≥ นี้ (แทน state)")
    r.add_argument("--state", type=Path, help="ปริยาย DIR/flood/gfm/state.json")
    r.set_defaults(fn=cmd_run)

    b = sub.add_parser("backfill", help="ฉากที่บันทึกภาพระหว่าง --from..--to")
    common(b)
    b.add_argument("--from", required=True, help="ISO")
    b.add_argument("--to", required=True, help="ISO")
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
