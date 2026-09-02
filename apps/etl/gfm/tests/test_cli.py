"""run_pipeline แบบออฟไลน์ — จังหวัดปลอมบนดิสก์ + item ที่ชี้ GeoTIFF ในเครื่อง"""

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


def _province(tmp_path: Path, code: str = "57"):
    work, aoi = tmp_path / "work", tmp_path / "aoi"
    t = Affine(30, 0, UL_E, 0, -30, UL_N)
    yy, xx = np.mgrid[0:H, 0:W]
    dem = (100 + 0.02 * ((xx - 15) ** 2 + (yy - 15) ** 2)).astype(np.int16)  # แอ่งตื้น
    dem[0, :] = -32768
    lc = np.full((H, W), 40, np.uint8)
    lc[12:14, 12:14] = 50
    write_tif(work / f"p{code}-clipped30.tif", dem, t, UTM_CRS, nodata=-32768)
    write_tif(work / f"p{code}-worldcover30.tif", lc, t, UTM_CRS)
    (aoi / code).mkdir(parents=True)
    ov_w, ov_h = 5, 5
    (aoi / code / "manifest.json").write_text(json.dumps({
        "provinceNameTh": "ทดสอบ", "utmZone": "32647",
        "originEasting": UL_E, "originNorthing": UL_N - ov_h * 203,
        "bbox": {"minLon": 99.0, "minLat": 19.0, "maxLon": 100.0, "maxLat": 20.0},
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


def _item(item_id: str, hrefs: dict[str, str], created: str | None) -> pystac.Item:
    props = {"created": created} if created else {}
    it = pystac.Item(id=item_id, geometry=None, bbox=[99, 19, 100, 20],
                     datetime=datetime(2024, 9, 12, 11, 23, 31, tzinfo=timezone.utc), properties=props)
    for k, h in hrefs.items():
        it.add_asset(k, pystac.Asset(href=h))
    return it


def test_run_pipeline_tree_idempotence_failure_and_single_index_write(tmp_path, monkeypatch):
    work, aoi = _province(tmp_path)
    grid = load_province_grid("57", work, aoi)
    out = tmp_path / "out"
    wet = _item("ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "wet", True), "2024-09-12T15:00:00Z")
    dry = _item("ENSEMBLE_FLOOD_20240906T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "dry", False), None)
    bad = _item("ENSEMBLE_FLOOD_20240918T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "bad", True, broken=True), "2024-09-18T15:00:00Z")
    none = _item("ENSEMBLE_FLOOD_20240924T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "none", False, no_footprint=True), "2024-09-24T15:00:00Z")

    writes: list[Path] = []
    real_write = cli._write_json

    def spy(path, data):
        writes.append(path)
        real_write(path, data)

    monkeypatch.setattr(cli, "_write_json", spy)
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

    # รอบสอง: ทุกอย่างมีแล้ว → ข้ามหมด index เท่าเดิมยกเว้น generatedAt
    cli.write_health(out, s)
    writes.clear()
    s2 = cli.run_pipeline([wet, dry], [grid], out, now=datetime(2026, 1, 2, tzinfo=timezone.utc))
    assert s2["scenesWritten"] == 0 and s2["itemsProcessed"] == 2 and s2["lastError"] is None
    idx2 = json.loads((out / "aoi/57/flood/index.json").read_text())
    assert idx2["scenes"] == idx["scenes"] and idx2["generatedAt"] == "2026-01-02T00:00:00Z"
    assert idx2["layers"]["extent"]["fetchedAt"] == "2026-01-02T00:00:00Z"
    assert (sdir / "field.bin").read_bytes() == gz
    assert [p for p in writes if p.name == "index.json"] == [out / "aoi/57/flood/index.json"]

    cli.write_health(out, s2)
    health = json.loads((out / "flood/gfm/health.json").read_text())
    assert health == {
        "lastRunAt": "2026-01-02T00:00:00Z",
        "lastSceneObservedAt": "2024-09-12T11:23:31Z",  # คงค่าจากรอบก่อน ไม่ล้างเป็น null
        "lastError": None,
        "itemsProcessed": 2,
        "scenesWritten": 0,
    }


def test_run_pipeline_zero_items_still_writes_index(tmp_path):
    work, aoi = _province(tmp_path)
    grid = load_province_grid("57", work, aoi)
    out = tmp_path / "out"
    s = cli.run_pipeline([], [grid], out, now=datetime(2026, 1, 1, tzinfo=timezone.utc))
    assert s["scenesWritten"] == 0 and s["lastCreated"] is None and s["lastError"] is None
    idx = json.loads((out / "aoi/57/flood/index.json").read_text())
    assert idx["scenes"] == [] and idx["generatedAt"] == "2026-01-01T00:00:00Z"


def test_run_requires_since_or_state(tmp_path, capsys):
    work, aoi = _province(tmp_path)
    rc = cli.main(["--work-dir", str(work), "--aoi-root", str(aoi), "run", "--province", "57", "--out", str(tmp_path / "o")])
    assert rc == 2
    assert "--since" in capsys.readouterr().err


def test_check_grid_cli(tmp_path, capsys):
    work, aoi = _province(tmp_path)
    rc = cli.main(["--work-dir", str(work), "--aoi-root", str(aoi), "check-grid", "--province", "57"])
    assert rc == 0
    assert "UL Δe=+0.000 m" in capsys.readouterr().out
