"""run_pipeline / plan / run แบบออฟไลน์ — จังหวัดปลอมบนดิสก์ + item ที่ชี้ GeoTIFF ในเครื่อง"""

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pystac
from rasterio.transform import Affine

from gfm import cli
from gfm import contract as C
from gfm.encode import decode_field
from gfm.grid import load_province_grid
from gfm.stac import ASSET_KEYS

from conftest import UL_E, UL_N, UTM_CRS, write_tif

W = H = 30  # ตาราง 30 ม. 30×30 = 900 ม. → overview 203 ม. = 5×5 (ไม่ลงตัวเหมือนของจริง)


def _province(tmp_path: Path, code: str = "57", bbox=(99.0, 19.0, 100.0, 20.0), inputs: bool = True):
    work, aoi = tmp_path / "work", tmp_path / "aoi"
    t = Affine(30, 0, UL_E, 0, -30, UL_N)
    yy, xx = np.mgrid[0:H, 0:W]
    dem = (100 + 0.02 * ((xx - 15) ** 2 + (yy - 15) ** 2)).astype(np.int16)  # แอ่งตื้น
    dem[0, :] = -32768
    lc = np.full((H, W), 40, np.uint8)
    lc[12:14, 12:14] = 50
    if inputs:
        write_tif(work / f"p{code}-clipped30.tif", dem, t, UTM_CRS, nodata=-32768)
        write_tif(work / f"p{code}-worldcover30.tif", lc, t, UTM_CRS)
    (aoi / code).mkdir(parents=True)
    ov_w, ov_h = 5, 5
    (aoi / code / "manifest.json").write_text(json.dumps({
        "provinceNameTh": "ทดสอบ", "utmZone": "32647",
        "originEasting": UL_E, "originNorthing": UL_N - ov_h * 203,
        "bbox": {"minLon": bbox[0], "minLat": bbox[1], "maxLon": bbox[2], "maxLat": bbox[3]},
        "terrain": {"width": ov_w, "height": ov_h, "cellSizeM": 203},
    }))
    return work, aoi


def _assets(tmp_path: Path, name: str, flooded: bool, broken: bool = False, no_footprint: bool = False) -> dict[str, str]:
    t = Affine(20, 0, UL_E - 100, 0, -20, UL_N + 100)  # 20 ม. ทับตาราง + ขอบ, CRS เดียวกัน (พอสำหรับ cli)
    n = 60
    extent = np.zeros((n, n), np.uint8)
    if flooded:
        extent[15:40, 15:40] = 1
    lik = np.full((n, n), 70, np.uint8)
    if no_footprint:  # ไทล์ทับ bbox แต่เฟรม S1 ไม่ได้ถ่ายตรงนี้: nodata ทั้งหน้าต่าง
        extent[:] = 255
        lik[:] = 255
    zeros = np.zeros((n, n), np.uint8)
    hrefs = {}
    for key, arr in zip(ASSET_KEYS, (extent, lik, zeros, zeros)):
        hrefs[key] = str(write_tif(tmp_path / name / f"{key}.tif", arr, t, UTM_CRS, nodata=255))
    if broken:
        hrefs[ASSET_KEYS[0]] = str(tmp_path / name / "missing.tif")
    return hrefs


def _item(item_id: str, hrefs: dict[str, str], created: str | None, bbox=(99, 19, 100, 20)) -> pystac.Item:
    props = {"created": created} if created else {}
    it = pystac.Item(id=item_id, geometry=None, bbox=list(bbox),
                     datetime=datetime(2024, 9, 12, 11, 23, 31, tzinfo=timezone.utc), properties=props)
    for k, h in hrefs.items():
        it.add_asset(k, pystac.Asset(href=h))
    return it


def _spy_writes(monkeypatch) -> list[Path]:
    writes: list[Path] = []
    real_write = cli._write_json

    def spy(path, data):
        writes.append(path)
        real_write(path, data)

    monkeypatch.setattr(cli, "_write_json", spy)
    return writes


def test_run_pipeline_tree_idempotence_failure_and_single_index_write(tmp_path, monkeypatch):
    work, aoi = _province(tmp_path)
    grid = load_province_grid("57", work, aoi)
    out = tmp_path / "out"
    wet = _item("ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "wet", True), "2024-09-12T15:00:00Z")
    dry = _item("ENSEMBLE_FLOOD_20240906T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "dry", False), None)
    bad = _item("ENSEMBLE_FLOOD_20240918T112331_VV_AS020M_E048N020T3", _assets(tmp_path, "bad", True, broken=True), "2024-09-18T15:00:00Z")
    none = _item("ENSEMBLE_FLOOD_20240924T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "none", False, no_footprint=True), "2024-09-24T15:00:00Z")

    writes = _spy_writes(monkeypatch)
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    s = cli.run_pipeline([wet, dry, bad, none], [grid], out, now=now)

    # เฟรมที่ไม่ครอบจังหวัด: นับว่าประมวลผลแล้ว แต่ไม่มีฉาก ไม่มีไฟล์ ไม่อยู่ใน index
    assert s["scenesWritten"] == 2 and s["itemsProcessed"] == 3
    assert not (out / "aoi/57/flood/20240924T112331-AS020M").exists()
    assert s["lastError"].startswith("57/20240918T112331-AS020M:")
    # ฉากที่ล้มไม่ถูกข้าม: lastCreated ถอยมาที่ created ของ item ที่ล้ม (แม้มี item ใหม่กว่าที่ผ่าน)
    assert s["lastCreated"] == "2024-09-18T15:00:00Z"
    assert s["lastSceneObservedAt"] == "2024-09-12T11:23:31Z"
    # index เขียนครั้งเดียวต่อจังหวัด (devops constraint b)
    assert [p for p in writes if p.name == "index.json"] == [out / "aoi/57/flood/index.json"]

    idx = json.loads((out / "aoi/57/flood/index.json").read_text())
    assert [e["sceneId"] for e in idx["scenes"]] == ["20240912T112331-AS020M", "20240906T112331-AS020M"]
    wet_e, dry_e = idx["scenes"]
    assert wet_e["publishedAt"] == "2024-09-12T15:00:00Z" and dry_e["publishedAt"] is None
    assert wet_e["floodedCells"] > 0 and dry_e["floodedCells"] == 0
    assert wet_e["maxDepthCm"] is not None and dry_e["maxDepthCm"] is None
    assert idx["layers"]["extent"]["fetchedAt"] == "2026-01-01T00:00:00Z"
    assert idx["layers"]["extent"]["publishedAt"] == "2024-09-12T15:00:00Z"
    assert idx["layers"]["depth"]["epistemicClass"] == "illustrative"

    sdir = out / "aoi/57/flood/20240912T112331-AS020M"
    meta = json.loads((sdir / "meta.json").read_text())
    gz = (sdir / "field.bin").read_bytes()
    assert gz[:2] == b"\x1f\x8b" and meta["fieldBytesGz"] == len(gz)
    assert {k: v for k, v in meta.items() if k not in ("methodology", "fieldBytesGz")} == wet_e
    cls, depth, lik = decode_field(gz)
    assert cls.shape == (5, 5)
    assert (cls == C.CLASS_FLOODED).any()
    assert np.all(depth[cls != C.CLASS_FLOODED] == C.NO_DEPTH)
    assert np.all(lik[cls != C.CLASS_NO_OBSERVATION] == 70)
    assert not (out / "aoi/57/flood/20240918T112331-AS020M/field.bin").exists()

    # รอบสอง: ทุกอย่างมีแล้ว → ข้ามหมด และ **ไม่เขียน index** (รายการฉากไม่เปลี่ยน — ไบต์เดิมทุกตัว)
    cli.write_health(out, s)
    index_bytes = (out / "aoi/57/flood/index.json").read_bytes()
    writes.clear()
    s2 = cli.run_pipeline([wet, dry], [grid], out, now=datetime(2026, 1, 2, tzinfo=timezone.utc))
    assert s2["scenesWritten"] == 0 and s2["itemsProcessed"] == 2 and s2["lastError"] is None
    assert (out / "aoi/57/flood/index.json").read_bytes() == index_bytes
    assert (sdir / "field.bin").read_bytes() == gz
    assert [p for p in writes if p.name == "index.json"] == []

    cli.write_health(out, s2)
    health = json.loads((out / "flood/gfm/health.json").read_text())
    assert health == {
        "lastRunAt": "2026-01-02T00:00:00Z",
        "lastSuccessAt": "2026-01-02T00:00:00Z",  # รอบสองไม่มี error → สำเร็จ (0 ฉากใหม่ก็สำเร็จ)
        "lastSceneObservedAt": "2024-09-12T11:23:31Z",  # คงค่าจากรอบก่อน ไม่ล้างเป็น null
        "lastError": None,
        "itemsProcessed": 2,
        "scenesWritten": 0,
    }


def test_write_health_keeps_last_success_across_failed_run(tmp_path):
    out = tmp_path / "out"
    ok = {"generatedAt": "2026-01-01T00:00:00Z", "itemsProcessed": 3, "scenesWritten": 1, "lastError": None,
          "lastSceneObservedAt": "2024-09-12T11:23:31Z", "lastCreated": None}
    cli.write_health(out, ok)
    failed = {**ok, "generatedAt": "2026-01-01T06:00:00Z", "scenesWritten": 0, "lastError": "search: Timeout: x",
              "lastSceneObservedAt": None}
    cli.write_health(out, failed)
    h = json.loads((out / "flood/gfm/health.json").read_text())
    # run ที่ล้ม: lastRunAt ขยับ (พยายามแล้ว) แต่ lastSuccessAt ไม่ขยับ — API จึงไม่รายงานว่าดึงสำเร็จ
    assert h["lastRunAt"] == "2026-01-01T06:00:00Z"
    assert h["lastSuccessAt"] == "2026-01-01T00:00:00Z"
    assert h["lastError"] == "search: Timeout: x"
    assert h["lastSceneObservedAt"] == "2024-09-12T11:23:31Z"
    # ไม่เคยสำเร็จเลย → null ไม่ใช่เวลาใด ๆ
    cli.write_health(tmp_path / "fresh", failed)
    assert json.loads((tmp_path / "fresh/flood/gfm/health.json").read_text())["lastSuccessAt"] is None


def test_run_pipeline_zero_items_writes_no_index(tmp_path, monkeypatch):
    work, aoi = _province(tmp_path)
    grid = load_province_grid("57", work, aoi)
    out = tmp_path / "out"
    writes = _spy_writes(monkeypatch)
    s = cli.run_pipeline([], [grid], out, now=datetime(2026, 1, 1, tzinfo=timezone.utc))
    assert s["scenesWritten"] == 0 and s["lastCreated"] is None and s["lastError"] is None
    # รายการฉากไม่เปลี่ยน (ว่าง → ว่าง) = ไม่มีอะไรให้อัป
    assert not (out / "aoi/57/flood/index.json").exists() and writes == []


def test_scene_listed_in_index_is_skipped_without_local_field(tmp_path, monkeypatch):
    """runner ชั่วคราว: index.json ที่ดึงลงมาบอกว่าฉากอยู่บน R2 แล้ว แม้ field.bin จะไม่อยู่ในเครื่อง"""
    work, aoi = _province(tmp_path)
    grid = load_province_grid("57", work, aoi)
    out = tmp_path / "out"
    wet = _item("ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "wet", True), "2024-09-12T15:00:00Z")
    ipath = out / "aoi/57/flood/index.json"
    ipath.parent.mkdir(parents=True)
    ipath.write_text(json.dumps({"provinceCode": "57", "scenes": [{"sceneId": "20240912T112331-AS020M", "observedAt": "2024-09-12T11:23:31Z"}]}))
    before = ipath.read_bytes()
    writes = _spy_writes(monkeypatch)
    s = cli.run_pipeline([wet], [grid], out, now=datetime(2026, 1, 1, tzinfo=timezone.utc))
    assert s["scenesWritten"] == 0 and s["itemsProcessed"] == 1 and s["lastError"] is None
    assert s["lastCreated"] == "2024-09-12T15:00:00Z"
    assert not (out / "aoi/57/flood/20240912T112331-AS020M").exists()
    assert ipath.read_bytes() == before and writes == []


def test_local_field_missing_from_index_is_restored_into_index(tmp_path):
    """field.bin+meta.json อยู่บนดิสก์แต่ index ไม่รู้จัก (ตายระหว่างสองการเขียน) → ข้ามการคำนวณ แต่เติม entry"""
    work, aoi = _province(tmp_path)
    grid = load_province_grid("57", work, aoi)
    out = tmp_path / "out"
    wet = _item("ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "wet", True), "2024-09-12T15:00:00Z")
    cli.run_pipeline([wet], [grid], out, now=datetime(2026, 1, 1, tzinfo=timezone.utc))
    ipath = out / "aoi/57/flood/index.json"
    full = json.loads(ipath.read_text())
    ipath.unlink()
    s = cli.run_pipeline([wet], [grid], out, now=datetime(2026, 1, 2, tzinfo=timezone.utc))
    assert s["scenesWritten"] == 0
    restored = json.loads(ipath.read_text())
    assert restored["scenes"] == full["scenes"] and restored["generatedAt"] == "2026-01-02T00:00:00Z"


class _FakeSearch:
    """แทน stac.search_items ใน cli — นับจำนวนครั้งที่ถูกเรียก (ห้ามวนค้นรายจังหวัด)"""

    def __init__(self, items, fail: bool = False):
        self.items = items
        self.fail = fail
        self.calls: list[dict] = []

    def __call__(self, since, until, bbox, **kw):
        self.calls.append({"since": since, "until": until, "bbox": tuple(bbox), **kw})
        if self.fail:
            raise TimeoutError("stac.eodc.eu ไม่ตอบ")
        return list(self.items)


def _base(work: Path, aoi: Path) -> list[str]:
    return ["--work-dir", str(work), "--aoi-root", str(aoi)]


def test_plan_then_run_with_plan_processes_only_planned_provinces(tmp_path, monkeypatch):
    work, aoi = _province(tmp_path, "57")
    _province(tmp_path, "58", bbox=(100.5, 19.0, 101.5, 20.0))
    _province(tmp_path, "90", bbox=(100.0, 6.0, 101.0, 7.5))
    out, wd = tmp_path / "out", tmp_path / "wd"
    wet = _item("ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "wet", True), "2024-09-12T15:00:00Z")
    # item ที่สองทับทั้ง 57 และ 58 (ไม่ทับ 90 ที่อยู่ภาคใต้)
    wet2 = _item("ENSEMBLE_FLOOD_20240912T112356_VV_AS020M_E048N018T3", _assets(tmp_path, "wet2", True), "2024-09-12T16:00:00Z", bbox=(99.5, 19, 101, 20))
    fake = _FakeSearch([wet, wet2])
    monkeypatch.setattr(cli, "search_items", fake)

    rc = cli.main([*_base(work, aoi), "plan", "--since", "2024-09-12T00:00:00Z", "--out", str(out),
                   "--provinces-file", str(wd / "provinces.txt")])
    assert rc == 0
    assert (wd / "provinces.txt").read_text() == "57\n58\n"
    plan = json.loads((wd / "plan.json").read_text())
    assert plan["mode"] == "run" and plan["provinces"] == ["57", "58"] and plan["error"] is None
    assert plan["itemCount"] == 2 and plan["sceneCount"] == 2  # เฟรมห่าง 25 วิ → ฉากเดียวต่อจังหวัด
    assert plan["since"] == "2024-09-12T00:00:00Z"
    assert plan["createdMin"] == "2024-09-12T15:00:00Z" and plan["createdMax"] == "2024-09-12T16:00:00Z"
    # ค้นครั้งเดียวทั้งสามจังหวัด (bbox รวม) — ไม่ใช่ครั้งละจังหวัด; ไม่แตะ DEM/ฉาก/state/health
    assert len(fake.calls) == 1 and fake.calls[0]["bbox"] == (99.0, 6.0, 101.5, 20.0)
    assert not (out / "aoi").exists() and not (out / "flood").exists()

    rc = cli.main([*_base(work, aoi), "run", "--plan", str(wd / "plan.json"), "--out", str(out)])
    assert rc == 0
    # run ค้นอีกครั้งเดียว ด้วยหน้าต่างของ plan (since..createdMax) เหนือ bbox ของจังหวัดที่วางแผนเท่านั้น
    assert len(fake.calls) == 2
    assert fake.calls[1]["since"] == datetime(2024, 9, 12, tzinfo=timezone.utc)
    assert fake.calls[1]["until"] == datetime(2024, 9, 12, 16, tzinfo=timezone.utc)
    assert fake.calls[1]["bbox"] == (99.0, 19.0, 101.5, 20.0)
    idx57 = json.loads((out / "aoi/57/flood/index.json").read_text())
    idx58 = json.loads((out / "aoi/58/flood/index.json").read_text())
    assert [e["sceneId"] for e in idx57["scenes"]] == ["20240912T112331-AS020M"]
    assert idx57["scenes"][0]["gfmItemIds"] == [wet.id, wet2.id]
    assert [e["sceneId"] for e in idx58["scenes"]] == ["20240912T112356-AS020M"]
    assert not (out / "aoi/90").exists()
    assert json.loads((out / "flood/gfm/state.json").read_text()) == {"lastCreated": "2024-09-12T16:00:00Z"}
    h = json.loads((out / "flood/gfm/health.json").read_text())
    assert h["lastError"] is None and h["scenesWritten"] == 2 and h["itemsProcessed"] == 2
    assert h["lastSuccessAt"] == h["lastRunAt"]


def test_run_with_plan_of_zero_items_does_not_search_and_keeps_state(tmp_path, monkeypatch):
    work, aoi = _province(tmp_path, "57")
    out, wd = tmp_path / "out", tmp_path / "wd"
    fake = _FakeSearch([])
    monkeypatch.setattr(cli, "search_items", fake)
    state = out / "flood/gfm/state.json"
    cli._write_json(state, {"lastCreated": "2024-09-12T15:00:00Z"})
    rc = cli.main([*_base(work, aoi), "plan", "--out", str(out), "--provinces-file", str(wd / "provinces.txt")])
    assert rc == 0 and (wd / "provinces.txt").read_text() == ""
    plan = json.loads((wd / "plan.json").read_text())
    assert plan["itemCount"] == 0 and plan["provinces"] == [] and plan["createdMax"] is None
    rc = cli.main([*_base(work, aoi), "run", "--plan", str(wd / "plan.json"), "--out", str(out)])
    assert rc == 0
    assert len(fake.calls) == 1  # run ไม่ค้นซ้ำเมื่อ plan ว่าง
    assert json.loads(state.read_text()) == {"lastCreated": "2024-09-12T15:00:00Z"}  # ไม่ขยับ ไม่ใช่ "ตอนนี้"
    h = json.loads((out / "flood/gfm/health.json").read_text())
    assert h["itemsProcessed"] == 0 and h["scenesWritten"] == 0 and h["lastError"] is None
    assert h["lastSuccessAt"] == h["lastRunAt"] and h["lastSceneObservedAt"] is None


def test_plan_search_failure_is_carried_into_health_without_touching_state(tmp_path, monkeypatch):
    work, aoi = _province(tmp_path, "57")
    out, wd = tmp_path / "out", tmp_path / "wd"
    fake = _FakeSearch([], fail=True)
    monkeypatch.setattr(cli, "search_items", fake)
    rc = cli.main([*_base(work, aoi), "plan", "--since", "2024-09-12T00:00:00Z", "--out", str(out),
                   "--provinces-file", str(wd / "provinces.txt")])
    assert rc == 1
    plan = json.loads((wd / "plan.json").read_text())
    assert plan["error"].startswith("search: TimeoutError") and plan["provinces"] == []
    rc = cli.main([*_base(work, aoi), "run", "--plan", str(wd / "plan.json"), "--out", str(out)])
    assert rc == 1 and len(fake.calls) == 1
    h = json.loads((out / "flood/gfm/health.json").read_text())
    # "ถามไม่ได้" ≠ "ไม่มีอะไรใหม่": มี lastError, ไม่เคยสำเร็จ → lastSuccessAt null
    assert h["lastError"] == plan["error"] and h["lastSuccessAt"] is None and h["itemsProcessed"] == 0
    assert json.loads((out / "flood/gfm/state.json").read_text()) == {"lastCreated": "2024-09-12T00:00:00Z"}


def test_run_province_without_inputs_fails_visibly_and_holds_last_created(tmp_path, monkeypatch):
    """DEM/WorldCover ของจังหวัดหนึ่งไม่ได้ดาวน์โหลด → จังหวัดนั้นล้ม (health.lastError) จังหวัดอื่นเดินต่อ
    และ lastCreated ไม่ข้าม item ของจังหวัดที่ล้ม"""
    work, aoi = _province(tmp_path, "57")
    _province(tmp_path, "58", bbox=(100.5, 19.0, 101.5, 20.0), inputs=False)
    out = tmp_path / "out"
    wet = _item("ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "wet", True), "2024-09-12T15:00:00Z")
    only58 = _item("ENSEMBLE_FLOOD_20240912T112356_VV_AS020M_E048N018T3", _assets(tmp_path, "w58", True), "2024-09-12T16:00:00Z", bbox=(100.6, 19, 101, 20))
    fake = _FakeSearch([wet, only58])
    monkeypatch.setattr(cli, "search_items", fake)
    rc = cli.main([*_base(work, aoi), "run", "--province", "57", "--province", "58", "--since", "2024-09-12T00:00:00Z", "--out", str(out)])
    assert rc == 1 and len(fake.calls) == 1
    assert fake.calls[0]["bbox"] == (99.0, 19.0, 101.5, 20.0)  # bbox ค้นรวมจังหวัดที่โหลดไม่ได้ด้วย
    assert (out / "aoi/57/flood/20240912T112331-AS020M/field.bin").exists()
    assert not (out / "aoi/58").exists()
    h = json.loads((out / "flood/gfm/health.json").read_text())
    assert h["lastError"].startswith("58: FileNotFoundError") and h["scenesWritten"] == 1
    assert h["lastSuccessAt"] is None
    # item ของ 58 (created 16:00) ยังไม่ถูกประมวลผล → รอบหน้าค้นตั้งแต่ตรงนั้น ไม่ใช่ข้ามไป
    assert json.loads((out / "flood/gfm/state.json").read_text()) == {"lastCreated": "2024-09-12T16:00:00Z"}


def test_backfill_with_plan_and_backfill_never_touches_state(tmp_path, monkeypatch):
    work, aoi = _province(tmp_path, "57")
    out, wd = tmp_path / "out", tmp_path / "wd"
    wet = _item("ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "wet", True), "2024-09-12T15:00:00Z")
    fake = _FakeSearch([wet])
    monkeypatch.setattr(cli, "search_items", fake)
    rc = cli.main([*_base(work, aoi), "plan", "--from", "2024-09-01T00:00:00Z", "--to", "2024-10-01T00:00:00Z",
                   "--province", "57", "--out", str(out), "--provinces-file", str(wd / "provinces.txt")])
    assert rc == 0
    plan = json.loads((wd / "plan.json").read_text())
    assert plan["mode"] == "backfill" and plan["from"] == "2024-09-01T00:00:00Z" and plan["provinces"] == ["57"]
    assert fake.calls[0]["acquired_from"] == datetime(2024, 9, 1, tzinfo=timezone.utc)
    rc = cli.main([*_base(work, aoi), "backfill", "--plan", str(wd / "plan.json"), "--out", str(out)])
    assert rc == 0 and len(fake.calls) == 2
    assert fake.calls[1]["acquired_to"] == datetime(2024, 10, 1, tzinfo=timezone.utc)
    assert (out / "aoi/57/flood/20240912T112331-AS020M/field.bin").exists()
    assert not (out / "flood/gfm/state.json").exists()
    # plan โหมดหนึ่งใช้กับคำสั่งอีกโหมดไม่ได้
    try:
        cli.main([*_base(work, aoi), "run", "--plan", str(wd / "plan.json"), "--out", str(out)])
    except SystemExit as e:
        assert "backfill" in str(e)
    else:
        raise AssertionError("run ต้องปฏิเสธ plan โหมด backfill")


def test_run_requires_since_or_state(tmp_path, capsys):
    work, aoi = _province(tmp_path)
    rc = cli.main([*_base(work, aoi), "run", "--province", "57", "--out", str(tmp_path / "o")])
    assert rc == 2
    assert "--since" in capsys.readouterr().err


def test_run_requires_province_or_plan(tmp_path, capsys):
    work, aoi = _province(tmp_path)
    rc = cli.main([*_base(work, aoi), "run", "--since", "2024-09-12T00:00:00Z", "--out", str(tmp_path / "o")])
    assert rc == 2
    assert "--plan" in capsys.readouterr().err


def test_check_grid_cli(tmp_path, capsys):
    work, aoi = _province(tmp_path)
    rc = cli.main([*_base(work, aoi), "check-grid", "--province", "57"])
    assert rc == 0
    assert "UL Δe=+0.000 m" in capsys.readouterr().out
