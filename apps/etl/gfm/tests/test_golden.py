"""ฉากจริงของเชียงราย (57) รอบบิน 2024-09-13T11:21:51Z — ผลิตจาก STAC/COG จริงเมื่อ 2026-09-02 (E14.F3)

รอบบินนี้มี 6 เฟรม (11:21:51 → 11:23:31, ห่างกันเฟรมละ 25 วิ, สองไทล์ Equi7) — ก่อน F3 ถูกแยกเป็น
8 กลุ่ม/2 ฉาก (`…T112241`, `…T112216`) ตอนนี้ `stac.merge_frames` รวมเป็นฉากเดียวที่ sceneId
ของเฟรมแรกสุด: flooded 3,197 เซลล์เท่าเดิม observed 138,057 (เดิม 134,231 + 3,877 ในสองฉาก) 85 KB gz

field.bin ใน fixtures คือไบต์ที่ pipeline เขียนจริง (gzip mtime=0) — เทสนี้ถอดแล้วเข้ารหัสใหม่
และเทียบ **ไบต์หลังคลาย gzip** ให้เท่ากันทุกไบต์ (header ของ gzip อาจต่างกันได้ตามไลบรารี
จึงไม่เทียบไบต์ gzip) และเทียบตัวเลขใน meta.json กับที่นับใหม่จากอาร์เรย์ที่ถอดได้
"""

import gzip
import json
from pathlib import Path

import numpy as np

from gfm import contract as C
from gfm.encode import decode_field, encode_field, gzip_bytes, scene_entry

from conftest import make_grid

SCENE = "20240913T112151-AS020M"
FIX = Path(__file__).resolve().parent / "fixtures" / "57" / SCENE


def test_golden_round_trip_byte_identical():
    gz = (FIX / "field.bin").read_bytes()
    raw = gzip.decompress(gz)
    cls, depth, lik = decode_field(gz)
    assert encode_field(cls, depth, lik) == raw
    assert gzip_bytes(raw) == gz  # ตัวเข้ารหัสยังผลิตไฟล์เดิมทุกไบต์ (deterministic)


def test_golden_meta_matches_decoded_field():
    meta = json.loads((FIX / "meta.json").read_text(encoding="utf-8"))
    gz = (FIX / "field.bin").read_bytes()
    cls, depth, lik = decode_field(gz)
    assert cls.shape == (802, 686)  # manifest ของ 57: terrain 686×802 @ 203 ม.
    assert meta["fieldBytesGz"] == len(gz)
    assert meta["sceneId"] == SCENE and meta["observedAt"] == "2024-09-13T11:21:51Z"
    # ทุกเฟรมของรอบอยู่ในฉากเดียว และ sceneId คือเฟรมแรกสุด
    assert len(meta["gfmItemIds"]) == 6
    assert min(meta["gfmItemIds"]) == "ENSEMBLE_FLOOD_20240913T112151_VV_AS020M_E048N015T3"
    assert meta["methodology"] == {"name": "FwDET-2", "boundarySmoothingCells": 3, "depthCapCm": 1000, "maskedClasses": [50, 10]}
    g = make_grid(width=686 * 7, height=802 * 7, cell=29.0, ov_cell=203.0, code="57")
    assert (g.overview.width, g.overview.height) == (686, 802)
    e = scene_entry(SCENE, meta["observedAt"], meta["publishedAt"], meta["orbit"], cls, depth, g, meta["gfmItemIds"])
    for k in ("floodedCells", "excludedCells", "observedCells", "floodedAreaKm2", "maxDepthCm", "medianDepthCm", "depthEstimatedFraction", "gfmItemIds"):
        assert e[k] == meta[k], k
    assert meta["floodedCells"] > 0 and meta["observedCells"] > meta["floodedCells"]
    # sentinel ตาม flood.ts: ความลึกมีเฉพาะ FLOODED, likelihood มีเฉพาะที่สังเกตได้
    assert np.all(depth[cls != C.CLASS_FLOODED] == C.NO_DEPTH)
    assert np.all(depth[cls == C.CLASS_FLOODED] <= C.DEPTH_CAP_CM)
    assert np.all(lik[cls == C.CLASS_NO_OBSERVATION] == C.NO_LIKELIHOOD)
    assert np.all(lik[cls != C.CLASS_NO_OBSERVATION] <= 100)
