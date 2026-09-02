import numpy as np

from gfm import contract as C
from gfm.fwdet import boundary_wse, estimate_depth


def _bowl(n: int = 200, k: float = 3e-5, radius: float = 80.0):
    """DEM พาราโบลา z = k·r² และระดับน้ำ L = k·R² — ท่วมทุกเซลล์ที่ r < R"""
    yy, xx = np.mgrid[0:n, 0:n]
    c = n / 2
    r2 = (xx - c) ** 2 + (yy - c) ** 2
    dem = (k * r2).astype(np.float32)
    level = k * radius * radius
    extent = (dem < level).astype(np.uint8)
    return dem, extent, level, np.sqrt(r2)


def test_bowl_depth_within_1cm():
    dem, extent, level, r = _bowl()
    n = dem.shape[0]
    zeros = np.zeros_like(extent, dtype=bool)
    res = estimate_depth(dem, extent, zeros, zeros, np.ones_like(zeros), np.full((n, n), 40, np.uint8))
    interior = (r < 50) & (extent == 1)
    assert res.boundary_cells > 0
    assert np.all(res.cls[interior] == C.CLASS_FLOODED)
    expected_cm = (level - dem[interior]) * 100.0
    got = res.depth_cm[interior].astype(np.float64)
    assert np.max(np.abs(got - expected_cm)) <= 1.0
    # นอกพื้นที่ท่วม = แห้ง ไม่มีค่าความลึก
    assert np.all(res.cls[extent == 0] == C.CLASS_DRY)
    assert np.all(res.depth_cm[extent == 0] == C.NO_DEPTH)


def test_masked_landcover_is_flooded_without_depth():
    dem, extent, level, r = _bowl()
    n = dem.shape[0]
    zeros = np.zeros_like(extent, dtype=bool)
    lc = np.full((n, n), 40, np.uint8)
    lc[90:110, 90:110] = 50  # สิ่งปลูกสร้างกลางแอ่ง
    lc[60:70, 100:110] = 10  # ต้นไม้
    res = estimate_depth(dem, extent, zeros, zeros, np.ones_like(zeros), lc)
    masked = np.isin(lc, C.MASKED_WORLDCOVER_CLASSES) & (extent == 1)
    assert np.all(res.cls[masked] == C.CLASS_FLOODED_DEPTH_NOT_ESTIMATED)
    assert np.all(res.depth_cm[masked] == C.NO_DEPTH)
    # เซลล์ท่วมที่ไม่ถูก mask ยังได้ค่าปกติ (ไม่เกลี่ยข้าม mask)
    assert res.cls[100, 60] == C.CLASS_FLOODED
    assert res.depth_cm[100, 60] != C.NO_DEPTH


def test_dem_nodata_inside_flood_is_not_estimated():
    dem, extent, level, r = _bowl()
    dem[100:103, 100:103] = np.nan
    n = dem.shape[0]
    zeros = np.zeros_like(extent, dtype=bool)
    res = estimate_depth(dem, extent, zeros, zeros, np.ones_like(zeros), np.full((n, n), 40, np.uint8))
    assert np.all(res.cls[100:103, 100:103] == C.CLASS_FLOODED_DEPTH_NOT_ESTIMATED)
    assert np.all(res.depth_cm[100:103, 100:103] == C.NO_DEPTH)


def test_boundary_median_removes_spike():
    n = 20
    dem = np.full((n, n), 10.0, np.float32)
    dem[6:14, 6:14] = 9.0  # แอ่งราบ 1 ม. ใต้ขอบ
    extent = np.zeros((n, n), np.uint8)
    extent[5:15, 5:15] = 1  # ขอบวงนอก (แถว/คอลัมน์ 5 และ 14) คือขอบน้ำ ที่ DEM = 10
    dem[5, 9] = 15.0  # spike หนึ่งเซลล์บนขอบ (ต้นไม้/หลังคา)
    zeros = np.zeros((n, n), bool)
    observed = np.ones((n, n), bool)
    flooded = extent == 1
    dry = ~flooded
    from gfm.fwdet import _neighbours4_any

    boundary = flooded & _neighbours4_any(dry)
    wse = boundary_wse(dem, boundary)
    assert wse[5, 9] == 10.0  # median ของ (10, 15, 10) ตามแนวขอบ
    res = estimate_depth(dem, extent, zeros, zeros, observed, np.full((n, n), 40, np.uint8), smooth_depth=False)
    # เซลล์ด้านในถัดจาก spike ได้ความลึก 100 ซม. ไม่ใช่ 600
    assert res.depth_cm[6, 9] == 100


def test_boundary_ignores_unobserved_and_excluded_neighbours():
    n = 12
    dem = np.full((n, n), 5.0, np.float32)
    extent = np.zeros((n, n), np.uint8)
    extent[2:10, 2:10] = 1
    observed = np.ones((n, n), bool)
    observed[:, :2] = False  # ซ้ายไม่มีภาพ
    excluded = np.zeros((n, n), bool)
    excluded[:2, :] = True  # บนตัดออก
    refwater = np.zeros((n, n), bool)
    res = estimate_depth(dem, extent, excluded, refwater, observed, np.full((n, n), 40, np.uint8))
    assert np.all(res.cls[:, :2] == C.CLASS_NO_OBSERVATION)
    assert np.all(res.cls[:2, 2:] == C.CLASS_EXCLUDED)
    # ขอบมีเฉพาะด้านขวา/ล่างที่ชนเซลล์แห้ง: 8 + 8 − 1 (มุมร่วม) = 15
    assert res.boundary_cells == 15


def test_no_boundary_means_no_depth():
    n = 8
    dem = np.full((n, n), 5.0, np.float32)
    extent = np.ones((n, n), np.uint8)  # ท่วมทั้งภาพ ไม่มีเซลล์แห้งเลย
    zeros = np.zeros((n, n), bool)
    res = estimate_depth(dem, extent, zeros, zeros, np.ones((n, n), bool), np.full((n, n), 40, np.uint8))
    assert res.boundary_cells == 0
    assert np.all(res.cls == C.CLASS_FLOODED_DEPTH_NOT_ESTIMATED)
    assert np.all(res.depth_cm == C.NO_DEPTH)
