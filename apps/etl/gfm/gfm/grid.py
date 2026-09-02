"""ตารางของจังหวัด — 30 ม. (DEM/WorldCover ใน apps/etl/data/work) และ overview (manifest.terrain)

แหล่งความจริงเรื่องตารางคือไฟล์จริงสองใบ:
- `p{code}-clipped30.tif` (Int16, UTM, 30 ม.) — ไบต์ชุดเดียวกับที่สร้าง terrain tiles
- `apps/web/public/aoi/{code}/manifest.json` → `terrain.{width,height,cellSizeM}` +
  `originEasting/originNorthing` (มุม **ล่างซ้าย** ตาม buildProvinceTerrain.ts) — ตาราง
  ที่ `floodMask.ts` / `uFloodMask` sample อยู่แล้ว จึงเป็นตารางของ `field.bin`

สองตารางนี้ *ควร* มีมุมบนซ้ายเดียวกัน (gdalwarp -te เดียวกัน) แต่ 203 ม. ไม่ใช่พหุคูณของ
30 ม. ขอบล่าง/ขวาจึงต่างกันไม่เกินหนึ่งเซลล์ overview — `check_alignment()` รายงานตัวเลขจริง
แทนการเชื่อ และ `overview_index()` แมปจากพิกัดจริง ไม่ใช่จากสมมติฐานว่ามุมตรงกัน
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import Affine

WORLDCOVER_MASKED = (50, 10)  # สิ่งปลูกสร้าง, ต้นไม้ — ไม่ประมาณความลึก (DSM)


@dataclass(frozen=True)
class OverviewGrid:
    width: int
    height: int
    cell_size_m: float
    origin_easting: float  # มุมล่างซ้าย (ตาม manifest)
    origin_northing: float
    utm_zone: str  # "32647" | "32648"

    @property
    def top_northing(self) -> float:
        return self.origin_northing + self.height * self.cell_size_m

    @property
    def right_easting(self) -> float:
        return self.origin_easting + self.width * self.cell_size_m

    def as_json(self) -> dict:
        return {
            "width": self.width,
            "height": self.height,
            # manifest.terrain.cellSizeM เป็นจำนวนเต็ม (203) — เขียนกลับให้เหมือนเดิม ไม่ใช่ 203.0
            "cellSizeM": int(self.cell_size_m) if float(self.cell_size_m).is_integer() else self.cell_size_m,
            "originEasting": self.origin_easting,
            "originNorthing": self.origin_northing,
            "utmZone": self.utm_zone,
        }


@dataclass(frozen=True)
class ProvinceGrid:
    code: str
    name_th: str
    bbox: tuple[float, float, float, float]  # lon/lat minx,miny,maxx,maxy
    crs: str  # "EPSG:32647"
    transform: Affine  # ตาราง 30 ม. (มุมบนซ้าย, แถว 0 = เหนือ)
    width: int
    height: int
    dem_path: Path
    landcover_path: Path
    dem_nodata: float
    overview: OverviewGrid

    @property
    def cell_size_m(self) -> float:
        return float(self.transform.a)


def load_manifest(aoi_root: Path, code: str) -> dict:
    with open(aoi_root / code / "manifest.json", encoding="utf-8") as f:
        return json.load(f)


@dataclass(frozen=True)
class ProvinceBox:
    """จังหวัดที่รู้แค่ bbox (จาก manifest ที่ track ใน repo) — พอสำหรับ `plan` ซึ่งยังไม่มี DEM ในเครื่อง

    `stac.group_by_province` ใช้แค่ `.code`/`.bbox` จึงรับทั้งชนิดนี้และ ProvinceGrid
    """

    code: str
    bbox: tuple[float, float, float, float]  # lon/lat minx,miny,maxx,maxy


def province_box(code: str, aoi_root: Path) -> ProvinceBox:
    b = load_manifest(aoi_root, code)["bbox"]
    return ProvinceBox(code=code, bbox=(b["minLon"], b["minLat"], b["maxLon"], b["maxLat"]))


def list_province_codes(aoi_root: Path) -> list[str]:
    """รหัสจังหวัดทุกตัวที่มี manifest.json ใต้ aoi_root (77 ตัวใน apps/web/public/aoi)"""
    return sorted(d.name for d in aoi_root.iterdir() if d.is_dir() and (d / "manifest.json").exists())


def load_province_grid(code: str, work_dir: Path, aoi_root: Path) -> ProvinceGrid:
    m = load_manifest(aoi_root, code)
    dem_path = work_dir / f"p{code}-clipped30.tif"
    lc_path = work_dir / f"p{code}-worldcover30.tif"
    if not dem_path.exists():
        raise FileNotFoundError(f"ไม่พบ DEM 30 ม. ของจังหวัด {code}: {dem_path}")
    if not lc_path.exists():
        raise FileNotFoundError(f"ไม่พบ WorldCover 30 ม. ของจังหวัด {code}: {lc_path}")
    with rasterio.open(dem_path) as dem:
        crs = dem.crs.to_string()
        transform = dem.transform
        width, height = dem.width, dem.height
        nodata = dem.nodata if dem.nodata is not None else -32768
    with rasterio.open(lc_path) as lc:
        if (lc.width, lc.height) != (width, height) or not lc.transform.almost_equals(transform, precision=1e-3):
            raise ValueError(
                f"WorldCover ของ {code} ไม่อยู่บนตารางเดียวกับ DEM: "
                f"{lc.width}x{lc.height} {lc.transform} vs {width}x{height} {transform}"
            )
    t = m["terrain"]
    overview = OverviewGrid(
        width=int(t["width"]),
        height=int(t["height"]),
        cell_size_m=float(t["cellSizeM"]),
        origin_easting=float(m["originEasting"]),
        origin_northing=float(m["originNorthing"]),
        utm_zone=str(m["utmZone"]),
    )
    if f"EPSG:{overview.utm_zone}" != crs:
        raise ValueError(f"CRS ของ DEM ({crs}) ไม่ตรงกับ manifest.utmZone ({overview.utm_zone}) — จังหวัด {code}")
    b = m["bbox"]
    return ProvinceGrid(
        code=code,
        name_th=m.get("provinceNameTh", ""),
        bbox=(b["minLon"], b["minLat"], b["maxLon"], b["maxLat"]),
        crs=crs,
        transform=transform,
        width=width,
        height=height,
        dem_path=dem_path,
        landcover_path=lc_path,
        dem_nodata=float(nodata),
        overview=overview,
    )


@dataclass(frozen=True)
class AlignmentReport:
    ul_easting_diff_m: float  # มุมบนซ้าย 30 ม. − มุมบนซ้าย overview
    ul_northing_diff_m: float
    right_edge_diff_m: float  # ขอบขวา 30 ม. − ขอบขวา overview
    bottom_edge_diff_m: float  # ขอบล่าง 30 ม. − ขอบล่าง overview (ลบ = DEM ยื่นลงใต้กว่า)
    cells_per_overview_cell: float

    @property
    def ok(self) -> bool:
        # มุมบนซ้ายต้องตรงในระดับเมตร (ทั้งคู่มาจาก gdalwarp -te เดียวกัน); ขอบอีกสองด้าน
        # ต่างกันได้ไม่เกินหนึ่งเซลล์ overview เพราะ 203 ไม่ใช่พหุคูณของ 30
        return abs(self.ul_easting_diff_m) < 1.0 and abs(self.ul_northing_diff_m) < 1.0

    def describe(self) -> str:
        return (
            f"UL Δe={self.ul_easting_diff_m:+.3f} m Δn={self.ul_northing_diff_m:+.3f} m · "
            f"right edge Δ={self.right_edge_diff_m:+.1f} m · bottom edge Δ={self.bottom_edge_diff_m:+.1f} m · "
            f"{self.cells_per_overview_cell:.3f} DEM cells per overview cell"
        )


def check_alignment(g: ProvinceGrid) -> AlignmentReport:
    ov = g.overview
    t = g.transform
    ul_e, ul_n = t.c, t.f
    right = ul_e + g.width * t.a
    bottom = ul_n + g.height * t.e  # t.e เป็นลบ
    return AlignmentReport(
        ul_easting_diff_m=ul_e - ov.origin_easting,
        ul_northing_diff_m=ul_n - ov.top_northing,
        right_edge_diff_m=right - ov.right_easting,
        bottom_edge_diff_m=bottom - ov.origin_northing,
        cells_per_overview_cell=ov.cell_size_m / abs(t.a),
    )


def overview_index(g: ProvinceGrid) -> tuple[np.ndarray, np.ndarray]:
    """แมปแถว/คอลัมน์ของตาราง 30 ม. → ดัชนี overview (แถว **บนลงล่าง** ตามภูมิศาสตร์)

    คืน (row_map[height], col_map[width]) เป็น int32; ค่า -1 = จุดศูนย์กลางของเซลล์ 30 ม.
    อยู่นอกตาราง overview (ทิ้ง) การกลับลำดับแถวเป็นล่างขึ้นบนของ `field.bin` เกิดตอน encode
    ทีเดียว ไม่ใช่ที่นี่
    """
    ov = g.overview
    t = g.transform
    rows = np.arange(g.height, dtype=np.float64)
    cols = np.arange(g.width, dtype=np.float64)
    centre_n = t.f + (rows + 0.5) * t.e
    centre_e = t.c + (cols + 0.5) * t.a
    row_map = np.floor((ov.top_northing - centre_n) / ov.cell_size_m).astype(np.int32)
    col_map = np.floor((centre_e - ov.origin_easting) / ov.cell_size_m).astype(np.int32)
    row_map[(row_map < 0) | (row_map >= ov.height)] = -1
    col_map[(col_map < 0) | (col_map >= ov.width)] = -1
    return row_map, col_map


def read_inputs(g: ProvinceGrid) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """อ่าน DEM (float32 เมตร, NaN = nodata), WorldCover (uint8), และ mask ว่า DEM มีค่า"""
    with rasterio.open(g.dem_path) as src:
        dem_raw = src.read(1)
    with rasterio.open(g.landcover_path) as src:
        lc = src.read(1).astype(np.uint8)
    valid = dem_raw != g.dem_nodata
    dem = dem_raw.astype(np.float32)
    dem[~valid] = np.nan
    return dem, lc, valid
