"""FwDET-2 บนตาราง 30 ม. — ความลึกภาพประกอบจากขอบของพื้นที่น้ำท่วมที่ GFM สังเกตได้

ทำตาม docs/methodology/flood-depth.md ขั้น 2–7 ทีละข้อ (Cohen et al. 2018; FwDET v2.0, 2019):
  2. flooded = extent==1 ∧ ¬excluded ∧ ¬refwater ∧ observed
  3. boundary = flooded ที่มีเพื่อนบ้าน 4 ทิศเป็น "สังเกตแล้วว่าแห้ง" (ขอบที่ชน NO_OBSERVATION /
     EXCLUDED / REFERENCE_WATER ไม่นับ — อีกฝั่งไม่ได้แห้ง)
  4. WSE ที่ขอบ = DEM ที่เซลล์ขอบ แล้ว median ในหน้าต่าง 3×3 **เฉพาะเซลล์ขอบ** ในหน้าต่างนั้น
  5. ทุกเซลล์ที่ท่วมรับ WSE จากเซลล์ขอบที่ใกล้ที่สุด (distance_transform_edt, return_indices)
  6. depth = clip(WSE − DEM, 0, 10 ม.) → ซม.
  7. WorldCover ∈ {50, 10} หรือ DEM nodata → FLOODED_DEPTH_NOT_ESTIMATED (ไม่มีค่า ไม่ใช่ 0)

ไม่มีค่าตรวจวัดจากสถานี ไม่มีสมการการไหล — ผลลัพธ์เป็นชั้น illustrative เสมอ (methodology)
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage

from .contract import (
    CLASS_DRY,
    CLASS_EXCLUDED,
    CLASS_FLOODED,
    CLASS_FLOODED_DEPTH_NOT_ESTIMATED,
    CLASS_NO_OBSERVATION,
    CLASS_REFERENCE_WATER,
    DEPTH_CAP_CM,
    MASKED_WORLDCOVER_CLASSES,
    NO_DEPTH,
)


@dataclass
class DepthResult:
    cls: np.ndarray  # uint8 [H,W] — contract.CLASS_*
    depth_cm: np.ndarray  # uint16 [H,W] — NO_DEPTH ทุกที่ที่ class ≠ FLOODED
    boundary_cells: int  # จำนวนเซลล์ขอบที่ใช้จริง (0 = ประมาณความลึกไม่ได้เลย)


def classify(extent: np.ndarray, excluded: np.ndarray, refwater: np.ndarray, observed: np.ndarray) -> np.ndarray:
    """คลาสต่อเซลล์ก่อนคิดความลึก — ลำดับ: ไม่มีภาพ < แห้ง < ตัดออก < น้ำถาวร < ท่วม

    เซลล์ที่ทั้ง `excluded` และ `refwater` เป็น REFERENCE_WATER (แม่น้ำยังเป็นแม่น้ำแม้ SAR
    จะจำแนกรอบ ๆ ไม่ได้) — ท่วมต้องไม่ใช่ทั้งสองอย่างจึงจะนับเป็นท่วม (methodology ขั้น 2)
    """
    cls = np.full(extent.shape, CLASS_NO_OBSERVATION, dtype=np.uint8)
    cls[observed] = CLASS_DRY
    cls[observed & excluded] = CLASS_EXCLUDED
    cls[observed & refwater] = CLASS_REFERENCE_WATER
    cls[flooded_mask(extent, excluded, refwater, observed)] = CLASS_FLOODED
    return cls


def flooded_mask(extent: np.ndarray, excluded: np.ndarray, refwater: np.ndarray, observed: np.ndarray) -> np.ndarray:
    return observed & (extent == 1) & ~excluded & ~refwater


def dry_mask(extent: np.ndarray, excluded: np.ndarray, refwater: np.ndarray, observed: np.ndarray) -> np.ndarray:
    """"สังเกตแล้วว่าแห้ง" — เฉพาะเซลล์ที่ GFM จำแนกจริงว่าไม่มีน้ำ"""
    return observed & (extent == 0) & ~excluded & ~refwater


def _neighbours4_any(mask: np.ndarray) -> np.ndarray:
    """True เมื่อเพื่อนบ้าน 4 ทิศอย่างน้อยหนึ่งเซลล์เป็น True (นอกขอบภาพ = False)"""
    out = np.zeros_like(mask, dtype=bool)
    out[1:, :] |= mask[:-1, :]
    out[:-1, :] |= mask[1:, :]
    out[:, 1:] |= mask[:, :-1]
    out[:, :-1] |= mask[:, 1:]
    return out


def boundary_wse(dem: np.ndarray, boundary: np.ndarray) -> np.ndarray:
    """ความสูงผิวน้ำที่เซลล์ขอบ = median ของ DEM ในหน้าต่าง 3×3 **เฉพาะเซลล์ที่เป็นขอบ**

    เทียบเท่า `ndimage.generic_filter(where(boundary, dem, nan), nanmedian, size=3)` ประเมิน
    เฉพาะที่ boundary — แต่ทำแบบ vectorised (รวบ 9 ตำแหน่งเลื่อนเป็นเมทริกซ์ [9, n_boundary]
    แล้ว nanmedian ตามแกน 0) เพราะ generic_filter เรียก callback ของ Python ต่อเซลล์ ซึ่งบน
    ตาราง 25M เซลล์ใช้เวลาเป็นนาที ค่าที่ได้เท่ากันทุกเซลล์
    คืน float32 [H,W] — NaN ที่ไม่ใช่ขอบ
    """
    vals = np.where(boundary, dem, np.nan).astype(np.float32)
    padded = np.pad(vals, 1, mode="constant", constant_values=np.nan)
    rows, cols = np.nonzero(boundary)
    stack = np.empty((9, rows.size), dtype=np.float32)
    k = 0
    for dr in (0, 1, 2):
        for dc in (0, 1, 2):
            stack[k] = padded[rows + dr, cols + dc]
            k += 1
    out = np.full(dem.shape, np.nan, dtype=np.float32)
    if rows.size:
        out[rows, cols] = np.nanmedian(stack, axis=0)  # ตัวเองอยู่ในหน้าต่างเสมอ → ไม่มี all-NaN
    return out


def _smooth_depth(depth: np.ndarray, has_depth: np.ndarray) -> np.ndarray:
    """ค่าเฉลี่ย 3×3 เฉพาะเซลล์ที่มีค่าความลึก — ไม่เกลี่ยข้าม mask (เซลล์ที่ไม่มีค่าไม่ถูกนับ)"""
    d = np.where(has_depth, depth, 0.0).astype(np.float32)
    m = has_depth.astype(np.float32)
    ssum = ndimage.uniform_filter(d, size=3, mode="constant", cval=0.0) * 9.0
    scnt = ndimage.uniform_filter(m, size=3, mode="constant", cval=0.0) * 9.0
    out = depth.copy()
    ok = has_depth & (scnt > 0)
    out[ok] = ssum[ok] / scnt[ok]
    return out


def _bbox_of(mask: np.ndarray, pad: int = 1) -> tuple[slice, slice]:
    rows = np.flatnonzero(mask.any(axis=1))
    cols = np.flatnonzero(mask.any(axis=0))
    r0, r1 = max(int(rows[0]) - pad, 0), min(int(rows[-1]) + pad + 1, mask.shape[0])
    c0, c1 = max(int(cols[0]) - pad, 0), min(int(cols[-1]) + pad + 1, mask.shape[1])
    return slice(r0, r1), slice(c0, c1)


def estimate_depth(
    dem: np.ndarray,
    extent: np.ndarray,
    excluded: np.ndarray,
    refwater: np.ndarray,
    observed: np.ndarray,
    landcover: np.ndarray,
    *,
    smooth_depth: bool = True,
) -> DepthResult:
    """FwDET-2 บนตาราง 30 ม. — `dem` float32 เมตร (NaN = nodata), ที่เหลือ [H,W] ตารางเดียวกัน"""
    if not (dem.shape == extent.shape == excluded.shape == refwater.shape == observed.shape == landcover.shape):
        raise ValueError("อาร์เรย์นำเข้าไม่ได้อยู่บนตารางเดียวกัน")
    cls = classify(extent, excluded, refwater, observed)
    depth_cm = np.full(dem.shape, NO_DEPTH, dtype=np.uint16)
    flooded = cls == CLASS_FLOODED
    if not flooded.any():
        return DepthResult(cls=cls, depth_cm=depth_cm, boundary_cells=0)

    # ทำงานในกรอบของพื้นที่ท่วมเท่านั้น — เซลล์ขอบทุกเซลล์เป็นเซลล์ท่วมอยู่แล้ว การหาขอบที่
    # ใกล้ที่สุดในกรอบนี้จึงให้คำตอบเดียวกับทั้งภาพ แต่ EDT บน 25M เซลล์กินหน่วยความจำหลาย GB
    rs, cs = _bbox_of(flooded)
    dem_w = dem[rs, cs]
    flooded_w = flooded[rs, cs]
    dem_valid_w = ~np.isnan(dem_w)
    dry_w = dry_mask(extent, excluded, refwater, observed)[rs, cs]
    boundary_w = flooded_w & dem_valid_w & _neighbours4_any(dry_w)
    n_boundary = int(boundary_w.sum())

    masked_lc_w = np.isin(landcover[rs, cs], MASKED_WORLDCOVER_CLASSES)
    has_depth_w = np.zeros_like(flooded_w)
    if n_boundary:
        wse_b = boundary_wse(dem_w, boundary_w)
        _, idx = ndimage.distance_transform_edt(~boundary_w, return_indices=True)
        wse_w = wse_b[idx[0], idx[1]]
        depth_m = np.clip(wse_w - dem_w, 0.0, DEPTH_CAP_CM / 100.0)
        has_depth_w = flooded_w & dem_valid_w & ~masked_lc_w
        if smooth_depth:
            depth_m = _smooth_depth(depth_m, has_depth_w)
        depth_m = np.where(has_depth_w, depth_m, 0.0)  # NaN (DEM nodata) ห้ามหลุดเข้า cast
        depth_cm_w = np.rint(depth_m * 100.0).astype(np.uint16)
        sub = depth_cm[rs, cs]
        sub[has_depth_w] = depth_cm_w[has_depth_w]
        depth_cm[rs, cs] = sub

    not_est_w = flooded_w & ~has_depth_w
    sub_cls = cls[rs, cs]
    sub_cls[not_est_w] = CLASS_FLOODED_DEPTH_NOT_ESTIMATED
    cls[rs, cs] = sub_cls
    return DepthResult(cls=cls, depth_cm=depth_cm, boundary_cells=n_boundary)
