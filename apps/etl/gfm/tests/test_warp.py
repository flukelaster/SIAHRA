"""warp ออฟไลน์ — ต้นทางเป็น GeoTIFF ใน tmp_path (CRS ต่างจากตารางจังหวัด) ผ่าน opener ที่ inject"""

from datetime import datetime, timezone

import numpy as np
import pystac
import pytest
import rasterio
from rasterio.transform import Affine
from rasterio.warp import transform as warp_transform

from gfm.stac import ASSET_EXCLUSION, ASSET_EXTENT, ASSET_KEYS, ASSET_LIKELIHOOD, ASSET_REFWATER
from gfm.warp import GFM_NODATA, warp_scene

from conftest import make_grid, write_tif

# Equi7 Asia ตามที่ item ของ GFM ประกาศใน proj:wkt2 (Azimuthal Equidistant, ไม่มี EPSG)
EQUI7_AS_WKT = (
    'PROJCS["Azimuthal_Equidistant",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],'
    'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Azimuthal_Equidistant"],'
    'PARAMETER["latitude_of_center",47],PARAMETER["longitude_of_center",94],PARAMETER["false_easting",4340913.84808],'
    'PARAMETER["false_northing",4812712.92347],UNIT["metre",1]]'
)


def _source_tifs(tmp_path, grid, flood_block, nodata_rows: int = 0):
    """สร้างชั้นทั้งสี่ 20 ม. ใน Equi7 ครอบตารางจังหวัด + ขอบ; `flood_block` = (r0,r1,c0,c1) ในพิกัดต้นทาง"""
    left, top = grid.transform.c, grid.transform.f
    right, bottom = left + grid.width * 30, top - grid.height * 30
    xs, ys = warp_transform(grid.crs, EQUI7_AS_WKT, [left, right, left, right], [top, top, bottom, bottom])
    x0, y1 = min(xs) - 200, max(ys) + 200
    w = int((max(xs) - min(xs) + 400) / 20)
    h = int((max(ys) - min(ys) + 400) / 20)
    t = Affine(20, 0, x0, 0, -20, y1)
    extent = np.zeros((h, w), np.uint8)
    r0, r1, c0, c1 = flood_block
    extent[r0:r1, c0:c1] = 1
    extent[:nodata_rows, :] = GFM_NODATA
    lik = np.full((h, w), 80, np.uint8)
    lik[:nodata_rows, :] = GFM_NODATA
    # mask สองชั้นวางไว้ "ในกรอบจังหวัด" (พ้นขอบ 200 ม. = 10 px) ให้เห็นหลัง warp
    excl = np.zeros((h, w), np.uint8)
    excl[12:18, 12:18] = 1
    ref = np.zeros((h, w), np.uint8)
    ref[h - 18 : h - 12, 12:18] = 1
    hrefs = {}
    for key, arr in zip(ASSET_KEYS, (extent, lik, excl, ref)):
        hrefs[key] = str(write_tif(tmp_path / f"{key}.tif", arr, t, EQUI7_AS_WKT, nodata=GFM_NODATA))
    return hrefs, t


def _item(hrefs, item_id="ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3", wkt=EQUI7_AS_WKT):
    it = pystac.Item(id=item_id, geometry=None, bbox=[99, 19, 100, 20],
                     datetime=datetime(2024, 9, 12, 11, 23, 31, tzinfo=timezone.utc),
                     properties={"proj:wkt2": wkt} if wkt else {})
    for k, href in hrefs.items():
        it.add_asset(k, pystac.Asset(href=href))
    return it


def test_warp_places_flood_block_and_masks(tmp_path):
    g = make_grid(width=40, height=40)
    hrefs, t = _source_tifs(tmp_path, g, (30, 40, 30, 45))
    opened = []

    def opener(url):
        opened.append(url)
        return rasterio.open(url)

    sr = warp_scene([_item(hrefs)], g, opener=opener)
    assert len(opened) == 4
    assert sr.observed.all()  # ต้นทางครอบทั้งจังหวัด
    assert sr.item_ids == ["ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3"]
    assert sr.missing_assets == {}  # ครบทุก asset → ไม่มีอะไรให้บันทึก
    # จุดศูนย์กลางของบล็อกท่วม (พิกัดต้นทาง) → เซลล์ตารางจังหวัด ต้องเป็น 1
    cx, cy = t * (37.5, 35.0)
    ex, ny = warp_transform(EQUI7_AS_WKT, g.crs, [cx], [cy])
    col, row = ~g.transform * (ex[0], ny[0])
    assert sr.extent[int(row), int(col)] == 1
    assert sr.extent.sum() > 0 and (sr.extent == 1).sum() < sr.extent.size // 4
    assert sr.likelihood[int(row), int(col)] == 80
    assert sr.refwater.any() and sr.excluded.any()
    assert not (sr.refwater & sr.excluded).any()


def test_warp_nodata_rows_become_unobserved_and_mosaic_fills(tmp_path):
    g = make_grid(width=40, height=40)
    # item แรก: แถวบน 1/2 ของต้นทางเป็น nodata → ส่วนเหนือของจังหวัด "ไม่มีภาพ"
    hrefs_a, t = _source_tifs(tmp_path / "a", g, (0, 0, 0, 0), nodata_rows=45)
    sr_a = warp_scene([_item(hrefs_a)], g)
    assert not sr_a.observed[0, :].any() and sr_a.observed[-1, :].all()
    assert (sr_a.extent[~sr_a.observed] == GFM_NODATA).all()
    # เพิ่ม item ที่สอง (ไทล์ข้างเคียง) เต็มภาพ → mosaic เติมส่วนที่ขาด
    hrefs_b, _ = _source_tifs(tmp_path / "b", g, (5, 10, 5, 10))
    sr = warp_scene([_item(hrefs_a), _item(hrefs_b, item_id="ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N015T3")], g)
    assert sr.observed.all()
    assert sr.item_ids == sorted(sr.item_ids) and len(sr.item_ids) == 2


def test_warp_without_wkt_uses_dataset_crs(tmp_path):
    g = make_grid(width=20, height=20)
    hrefs, _ = _source_tifs(tmp_path, g, (10, 20, 10, 20))
    sr = warp_scene([_item(hrefs, wkt=None)], g)
    assert sr.observed.all() and (sr.extent == 1).any()


def _without(hrefs: dict, *keys: str) -> dict:
    return {k: v for k, v in hrefs.items() if k not in keys}


def test_warp_item_without_exclusion_mask_still_yields_scene(tmp_path):
    """วัดจริงบน STAC 2026-09-02: 2 ใน 100 item ล่าสุดเหนือไทยไม่มี exclusion_mask — ก่อนแก้ทั้งฉากล้ม
    (KeyError) ตอนนี้ item นั้นแค่ไม่ทำเครื่องหมาย EXCLUDED และ meta บันทึกว่าขาด"""
    g = make_grid(width=40, height=40)
    hrefs, _ = _source_tifs(tmp_path, g, (30, 40, 30, 45))
    opened = []

    def opener(url):
        opened.append(url)
        return rasterio.open(url)

    item_id = "ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3"
    sr = warp_scene([_item(_without(hrefs, ASSET_EXCLUSION), item_id)], g, opener=opener)
    assert len(opened) == 3  # ไม่มีอะไรให้เปิดสำหรับชั้นที่ขาด
    assert sr.observed.all() and (sr.extent == 1).any() and sr.refwater.any()
    assert not sr.excluded.any()  # ไม่มี mask = ไม่มีเซลล์ใดถูกตัดออกโดย item นี้
    assert (sr.likelihood[sr.observed] == 80).all()
    assert sr.missing_assets == {item_id: [ASSET_EXCLUSION]}


def test_warp_item_without_likelihood_yields_nodata_likelihood(tmp_path):
    g = make_grid(width=40, height=40)
    hrefs, _ = _source_tifs(tmp_path, g, (30, 40, 30, 45))
    item_id = "ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3"
    sr = warp_scene([_item(_without(hrefs, ASSET_LIKELIHOOD), item_id)], g)
    assert sr.observed.all() and (sr.extent == 1).any()
    assert (sr.likelihood == GFM_NODATA).all()  # ไม่มีค่า ไม่ใช่ตัวเลขที่แต่งขึ้น
    assert sr.excluded.any() and sr.refwater.any()
    assert sr.missing_assets == {item_id: [ASSET_LIKELIHOOD]}


def test_warp_mosaic_records_missing_assets_per_item_only(tmp_path):
    """item ที่ขาดทั้งสองชั้น + item ครบ (ไทล์ข้างเคียง) → เซลล์ที่ item ครบให้ค่าไว้ยังมี EXCLUDED/likelihood
    และ missing_assets ระบุเฉพาะ item ที่ขาด (เรียงตาม id, ลำดับ asset ตาม ASSET_KEYS)"""
    g = make_grid(width=40, height=40)
    hrefs_a, _ = _source_tifs(tmp_path / "a", g, (30, 40, 30, 45))
    hrefs_b, _ = _source_tifs(tmp_path / "b", g, (5, 10, 5, 10))
    bare = "ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3"
    full = "ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N015T3"
    sr = warp_scene([_item(hrefs_b, full), _item(_without(hrefs_a, ASSET_LIKELIHOOD, ASSET_EXCLUSION), bare)], g)
    assert sr.observed.all()
    assert sr.excluded.any() and (sr.likelihood == 80).any()  # จาก item ครบ — item ที่ขาดไม่ลบทิ้ง
    assert sr.missing_assets == {bare: [ASSET_LIKELIHOOD, ASSET_EXCLUSION]}
    assert sr.item_ids == sorted([bare, full])


@pytest.mark.parametrize("key", [ASSET_EXTENT, ASSET_REFWATER])
def test_warp_item_without_required_asset_fails_scene(tmp_path, key):
    g = make_grid(width=20, height=20)
    hrefs, _ = _source_tifs(tmp_path, g, (10, 20, 10, 20))
    with pytest.raises(KeyError, match=key):
        warp_scene([_item(_without(hrefs, key))], g)
