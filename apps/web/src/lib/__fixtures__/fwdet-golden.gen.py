"""สร้าง apps/web/src/lib/__fixtures__/fwdet-golden.json จาก gfm.fwdet ตัวจริง (E16 B-2)

รันจาก apps/etl/gfm:
  uv run --frozen python ../../web/src/lib/__fixtures__/fwdet-golden.gen.py > ../../web/src/lib/__fixtures__/fwdet-golden.json
"""
import json, sys
import numpy as np
from scipy import ndimage
from gfm.fwdet import _smooth_depth, boundary_wse, estimate_depth
from gfm import contract as C

def case(name, dem, extent, observed, smooth):
    n_r, n_c = dem.shape
    zeros = np.zeros(dem.shape, bool)
    lc = np.full(dem.shape, 40, np.uint8)
    res = estimate_depth(dem, extent, zeros, zeros, observed, lc, smooth_depth=smooth)
    # ขอบเขตบน/ล่างของความลึกเมื่อเซลล์ขอบที่ใกล้ที่สุด "เสมอกัน" หลายเซลล์ — EDT ของ scipy กับของเว็บ
    # อาจเลือกคนละเซลล์ จึงเทียบกับช่วงของทุกตัวเลือก (smooth เป็นค่าเฉลี่ยถ่วงบวก ช่วงจึงยังครอบ)
    flooded = observed & (extent == 1)
    dry = observed & (extent == 0)
    nb = np.zeros_like(dry)
    nb[1:, :] |= dry[:-1, :]; nb[:-1, :] |= dry[1:, :]; nb[:, 1:] |= dry[:, :-1]; nb[:, :-1] |= dry[:, 1:]
    boundary = flooded & nb
    wse_b = boundary_wse(dem, boundary)
    br, bc = np.nonzero(boundary)
    lo = np.zeros(dem.shape, np.float64)
    hi = np.zeros(dem.shape, np.float64)
    tie = np.zeros(dem.shape, bool)
    for r, c in zip(*np.nonzero(flooded)):
        d2 = (br - r) ** 2 + (bc - c) ** 2
        if not d2.size:
            continue
        k = d2 == d2.min()
        tie[r, c] = k.sum() > 1
        cand = np.clip(wse_b[br[k], bc[k]].astype(np.float64) - float(dem[r, c]), 0.0, C.DEPTH_CAP_CM / 100.0)
        lo[r, c] = cand.min()
        hi[r, c] = cand.max()
    if smooth:
        lo = _smooth_depth(lo, flooded)
        hi = _smooth_depth(hi, flooded)
    lo_cm = np.floor(lo * 100.0 + 1e-6)
    hi_cm = np.ceil(hi * 100.0 - 1e-6)
    return {
        "name": name, "width": int(n_c), "height": int(n_r), "smooth": smooth,
        "heights": [float(v) for v in dem.ravel()],
        "flooded": [int(v) for v in extent.ravel()],
        "inside": [int(v) for v in observed.ravel()],
        "expectedCls": [int(v) for v in res.cls.ravel()],
        "expectedDepthCm": [int(v) for v in res.depth_cm.ravel()],
        "boundaryCells": int(res.boundary_cells),
        "tie": [int(v) for v in tie.ravel()],
        "depthLoCm": [int(v) for v in lo_cm.ravel()],
        "depthHiCm": [int(v) for v in hi_cm.ravel()],
    }

cases = []
# 1) แอ่งพาราโบลา (test_bowl_depth_within_1cm ย่อขนาด) — smooth เปิดเหมือนค่าเริ่มต้น
n = 48
yy, xx = np.mgrid[0:n, 0:n]
c0 = n / 2
r2 = (xx - c0) ** 2 + (yy - c0) ** 2
k = 1e-3
dem = (k * r2).astype(np.float32)
level = k * 18 * 18
extent = (dem < level).astype(np.uint8)
cases.append(case("bowl", dem, extent, np.ones((n, n), bool), True))
# 2) พื้นขรุขระ + รูปทรงไม่สม่ำเสมอ + ขอบจังหวัด (observed=False = นอกจังหวัด) — smooth ปิด/เปิด
H, W = 22, 26
rr, cc = np.mgrid[0:H, 0:W]
dem2 = (5.0 + 0.04 * rr + 0.37 * ((rr * 7 + cc * 13) % 11) / 10).astype(np.float32)
dem2 = np.round(dem2, 2).astype(np.float32)
ext2 = np.zeros((H, W), np.uint8)
ext2[4:17, 5:20] = 1
ext2[9:13, 18:24] = 1
ext2[6:8, 9:12] = 0
obs2 = np.ones((H, W), bool)
obs2[:, :3] = False  # นอกจังหวัดด้านตะวันตก
ext2[:, :3] = 0
ext2[14:19, 3:7] = 1  # ท่วมชิดขอบจังหวัด — ด้านที่ชนนอกจังหวัดไม่ใช่ขอบน้ำ
cases.append(case("rough-nosmooth", dem2, ext2, obs2, False))
cases.append(case("rough-smooth", dem2, ext2, obs2, True))
# 3) polygon ของ GISTDA คร่อมออกนอกจังหวัด (extent=1 ที่ observed=False) — นอกจังหวัด = ไม่ได้สังเกต
#    ไม่ใช่ท่วม (cls NO_OBSERVATION ไม่มีความลึก) และไม่ใช่ขอบน้ำ; ในจังหวัดยังประมาณตามปกติ
ext3 = np.zeros((H, W), np.uint8)
ext3[3:18, 0:14] = 1  # ท่วมยาวจากนอกจังหวัด (คอลัมน์ 0–3) เข้ามาในจังหวัด
ext3[8:11, 14:22] = 1
obs3 = np.ones((H, W), bool)
obs3[:, :4] = False  # นอกจังหวัดด้านตะวันตก
obs3[:2, :] = False  # และแถบเหนือ
ext3[0:3, 16:20] = 1  # ท่วมนอกจังหวัดด้านเหนือ ชิดเซลล์แห้งในจังหวัด
cases.append(case("outside-flooded-nosmooth", dem2, ext3, obs3, False))
cases.append(case("outside-flooded-smooth", dem2, ext3, obs3, True))
json.dump({"generator": "gfm.fwdet.estimate_depth (apps/etl/gfm) via __fixtures__/fwdet-golden.gen.py — excluded/refwater False, landcover 40", "cases": cases}, sys.stdout)
