"""warp ชั้นทั้งสี่ของ GFM (Equi7 Asia, 20 ม.) ลงตาราง UTM 30 ม. ของจังหวัด (nearest)

อ่านจาก COG บน data.eodc.eu ด้วย HTTP range เฉพาะหน้าต่างที่ทับกรอบจังหวัด (คำนวณกรอบใน
CRS ต้นทางด้วย `transform_bounds`) — ไม่ดาวน์โหลดไทล์ 15000² ทั้งใบ ไทล์หลายใบของฉากเดียว
ถูก mosaic ลงตารางเดียวกัน: เซลล์ที่ไม่มี item ใดให้ค่า (นอกรอยเท้าภาพ / nodata 255) คือ
`observed=False` → NO_OBSERVATION ใน fwdet.py "ไม่มีภาพ" ไม่ใช่ "แห้ง"

ส่วนที่แตะเครือข่ายมีจุดเดียวคือ `open_asset(url)` ซึ่ง inject ได้ — เทสส่ง dataset ในหน่วยความจำ
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

import numpy as np
import pystac
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window, from_bounds

from .grid import ProvinceGrid
from .stac import ASSET_EXCLUSION, ASSET_EXTENT, ASSET_KEYS, ASSET_LIKELIHOOD, ASSET_REFWATER

# nodata ของทุก asset ตาม `raster:bands` ของ item (uint8, 255)
GFM_NODATA = 255

# ตัวเลือก GDAL สำหรับอ่าน COG ระยะไกลแบบประหยัด (ไม่ list directory, รวม range ติดกัน)
GDAL_REMOTE_ENV = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.TIF",
    "GDAL_HTTP_MULTIRANGE": "YES",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "GDAL_HTTP_MAX_RETRY": "5",
    "GDAL_HTTP_RETRY_DELAY": "2",
    "VSI_CACHE": "TRUE",
    "VSI_CACHE_SIZE": str(64 * 1024 * 1024),
}

Opener = Callable[[str], Any]  # url → rasterio DatasetReader (ผู้เรียกปิดเอง)


def open_asset(url: str) -> Any:
    """เปิด COG ระยะไกลผ่าน /vsicurl/ — จุดเดียวที่แตะเครือข่ายในโมดูลนี้

    ตัวเลือก GDAL อยู่ที่ `rasterio.Env` รอบทั้ง `warp_scene` (การอ่านหน้าต่างเกิดหลัง open)
    """
    return rasterio.open(url)


@dataclass
class SceneRasters:
    """ชั้นของฉากบนตาราง 30 ม. ของจังหวัด (แถว 0 = เหนือ เหมือน DEM)"""

    extent: np.ndarray  # uint8 — 0/1, GFM_NODATA นอกภาพ
    likelihood: np.ndarray  # uint8 — 0..100, GFM_NODATA เมื่อไม่มีค่า
    excluded: np.ndarray  # bool
    refwater: np.ndarray  # bool
    observed: np.ndarray  # bool — extent มีค่า (ในรอยเท้าภาพ)
    item_ids: list[str]


def _grid_bounds(grid: ProvinceGrid) -> tuple[float, float, float, float]:
    t = grid.transform
    left, top = t.c, t.f
    right = left + grid.width * t.a
    bottom = top + grid.height * t.e
    return left, bottom, right, top


def source_window(src: Any, src_crs: CRS, grid: ProvinceGrid) -> Window | None:
    """หน้าต่างพิกเซลใน COG ต้นทางที่ครอบกรอบจังหวัด (ขยายออก 1 พิกเซลกันขอบ) — None เมื่อไม่ทับกันเลย"""
    left, bottom, right, top = _grid_bounds(grid)
    sb = transform_bounds(CRS.from_string(grid.crs), src_crs, left, bottom, right, top, densify_pts=21)
    win = from_bounds(*sb, transform=src.transform)
    col0 = int(np.floor(win.col_off)) - 1
    row0 = int(np.floor(win.row_off)) - 1
    col1 = int(np.ceil(win.col_off + win.width)) + 1
    row1 = int(np.ceil(win.row_off + win.height)) + 1
    col0, row0 = max(col0, 0), max(row0, 0)
    col1, row1 = min(col1, src.width), min(row1, src.height)
    if col1 <= col0 or row1 <= row0:
        return None
    return Window(col0, row0, col1 - col0, row1 - row0)


def warp_asset(src: Any, grid: ProvinceGrid, src_crs: CRS | None = None) -> np.ndarray:
    """อ่านเฉพาะหน้าต่างที่ทับจังหวัดแล้ว reproject (nearest) ลงตาราง 30 ม. — uint8, GFM_NODATA นอกภาพ"""
    crs = src_crs or src.crs
    if crs is None:
        raise ValueError("COG ต้นทางไม่มี CRS และ item ไม่มี proj:wkt2")
    dst = np.full((grid.height, grid.width), GFM_NODATA, dtype=np.uint8)
    win = source_window(src, crs, grid)
    if win is None:
        return dst
    arr = src.read(1, window=win).astype(np.uint8, copy=False)
    nodata = src.nodata if src.nodata is not None else GFM_NODATA
    reproject(
        source=arr,
        destination=dst,
        src_transform=src.window_transform(win),
        src_crs=crs,
        src_nodata=nodata,
        dst_transform=grid.transform,
        dst_crs=CRS.from_string(grid.crs),
        dst_nodata=GFM_NODATA,
        resampling=Resampling.nearest,
    )
    return dst


def item_crs(item: pystac.Item) -> CRS | None:
    """CRS จาก `proj:wkt2` ของ item (Equi7 Asia — Azimuthal Equidistant ไม่มี EPSG) — None เมื่อไม่มี"""
    wkt = item.properties.get("proj:wkt2")
    return CRS.from_wkt(wkt) if wkt else None


def warp_scene(items: Iterable[pystac.Item], grid: ProvinceGrid, opener: Opener = open_asset) -> SceneRasters:
    """mosaic ชั้นทั้งสี่ของทุก item ในฉากลงตารางจังหวัด — item หลังทับ item ก่อนเฉพาะที่มีค่า"""
    items = list(items)
    if not items:
        raise ValueError("ฉากไม่มี item")
    shape = (grid.height, grid.width)
    layers = {k: np.full(shape, GFM_NODATA, dtype=np.uint8) for k in ASSET_KEYS}
    # Env ครอบทั้ง open และ read: ตัวเลือก range/retry ของ GDAL ถูกอ่านตอนยิงคำขอ ไม่ใช่ตอน open
    with rasterio.Env(**GDAL_REMOTE_ENV):
        for it in items:
            crs = item_crs(it)
            for key in ASSET_KEYS:
                asset = it.assets.get(key)
                if asset is None:
                    raise KeyError(f"item {it.id} ไม่มี asset {key}")
                src = opener(asset.href)
                try:
                    warped = warp_asset(src, grid, crs)
                finally:
                    src.close()
                has = warped != GFM_NODATA
                layers[key][has] = warped[has]
    extent = layers[ASSET_EXTENT]
    observed = extent != GFM_NODATA
    excl = layers[ASSET_EXCLUSION]
    ref = layers[ASSET_REFWATER]
    return SceneRasters(
        extent=extent,
        likelihood=layers[ASSET_LIKELIHOOD],
        excluded=(excl != GFM_NODATA) & (excl != 0),
        refwater=(ref != GFM_NODATA) & (ref != 0),
        observed=observed,
        item_ids=sorted(it.id for it in items),
    )
