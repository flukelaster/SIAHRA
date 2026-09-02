"""ตัวช่วยร่วมของเทส — ProvinceGrid ปลอมที่ไม่ต้องมีไฟล์จริง (ทุกเทสออฟไลน์)"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import Affine

from gfm.grid import OverviewGrid, ProvinceGrid

UTM_CRS = "EPSG:32647"
UL_E, UL_N = 500_000.0, 2_200_000.0


def make_grid(
    width: int = 60,
    height: int = 60,
    cell: float = 30.0,
    ov_cell: float = 90.0,
    ul: tuple[float, float] = (UL_E, UL_N),
    ov_ul: tuple[float, float] | None = None,
    code: str = "99",
    dem_path: Path = Path("/nonexistent/dem.tif"),
    lc_path: Path = Path("/nonexistent/lc.tif"),
) -> ProvinceGrid:
    """ตาราง 30 ม. width×height และ overview ที่ครอบพื้นที่เดียวกัน (ปริยาย: 3×3 เซลล์ต่อเซลล์ overview)"""
    ul_e, ul_n = ul
    ov_ul_e, ov_ul_n = ov_ul or ul
    ov_w = int(np.ceil(width * cell / ov_cell))
    ov_h = int(np.ceil(height * cell / ov_cell))
    ov = OverviewGrid(
        width=ov_w,
        height=ov_h,
        cell_size_m=ov_cell,
        origin_easting=ov_ul_e,
        origin_northing=ov_ul_n - ov_h * ov_cell,
        utm_zone="32647",
    )
    return ProvinceGrid(
        code=code,
        name_th="ทดสอบ",
        bbox=(99.0, 19.0, 100.0, 20.0),
        crs=UTM_CRS,
        transform=Affine(cell, 0.0, ul_e, 0.0, -cell, ul_n),
        width=width,
        height=height,
        dem_path=dem_path,
        landcover_path=lc_path,
        dem_nodata=-32768.0,
        overview=ov,
    )


def write_tif(path: Path, arr: np.ndarray, transform: Affine, crs: str, nodata=None) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path, "w", driver="GTiff", width=arr.shape[1], height=arr.shape[0], count=1,
        dtype=arr.dtype, crs=crs, transform=transform, nodata=nodata,
    ) as dst:
        dst.write(arr, 1)
    return path


@pytest.fixture
def grid() -> ProvinceGrid:
    return make_grid()
