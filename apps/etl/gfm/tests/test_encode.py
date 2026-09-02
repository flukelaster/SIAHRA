import gzip
import struct

import numpy as np

from gfm import contract as C
from gfm.encode import aggregate, decode_field, encode_field, gzip_bytes, merge_index, scene_entry, scene_meta

from conftest import make_grid


def test_header_and_bottom_up_row_order():
    w, h = 3, 2
    cls = np.full((h, w), C.CLASS_DRY, np.uint8)
    depth = np.full((h, w), C.NO_DEPTH, np.uint16)
    lik = np.full((h, w), 7, np.uint8)
    cls[0, 0] = C.CLASS_FLOODED  # มุมบนซ้ายทางภูมิศาสตร์
    depth[0, 0] = 123
    raw = encode_field(cls, depth, lik)
    assert raw[:4] == b"SFLD"
    assert struct.unpack_from("<IHHH", raw, 0) == (C.FLOOD_FIELD_MAGIC, C.FLOOD_FIELD_VERSION, w, h)
    assert len(raw) == C.FLOOD_FIELD_HEADER_BYTES + w * h * C.FLOOD_FIELD_CELL_BYTES
    # แถวแรกในไฟล์ = แถวล่างสุดทางภูมิศาสตร์ (แห้งทั้งแถว) แถวที่สอง = แถวบน → เซลล์แรกคือเซลล์ท่วม
    row0 = raw[10 : 10 + w * 4]
    row1 = raw[10 + w * 4 : 10 + 2 * w * 4]
    assert row0[0] == C.CLASS_DRY and row0[1:3] == b"\xff\xff"
    assert row1[0:4] == bytes([C.CLASS_FLOODED, 123, 0, 7])


def test_round_trip_raw_and_gzip():
    rng = np.random.default_rng(1)
    h, w = 11, 7
    cls = rng.integers(0, 6, size=(h, w)).astype(np.uint8)
    depth = np.where(cls == C.CLASS_FLOODED, rng.integers(0, 1001, size=(h, w)), C.NO_DEPTH).astype(np.uint16)
    lik = np.where(cls != C.CLASS_NO_OBSERVATION, rng.integers(0, 101, size=(h, w)), C.NO_LIKELIHOOD).astype(np.uint8)
    raw = encode_field(cls, depth, lik)
    gz = gzip_bytes(raw)
    for data in (raw, gz):
        c2, d2, l2 = decode_field(data)
        assert np.array_equal(c2, cls) and np.array_equal(d2, depth) and np.array_equal(l2, lik)
    assert gzip.decompress(gz) == raw
    assert gzip_bytes(raw) == gz  # deterministic (mtime=0)


def test_aggregate_precedence_and_means():
    g = make_grid(width=9, height=9, ov_cell=90.0)  # 3×3 overview, 3×3 เซลล์ 30 ม. ต่อเซลล์
    cls = np.full((9, 9), C.CLASS_DRY, np.uint8)
    depth = np.full((9, 9), C.NO_DEPTH, np.uint16)
    lik = np.full((9, 9), 50, np.uint8)
    # เซลล์ overview (0,0): 8 แห้ง + 1 ท่วมมีค่า → FLOODED, depth = ค่านั้น
    cls[0, 0] = C.CLASS_FLOODED
    depth[0, 0] = 40
    # (0,1): ท่วมไม่ประมาณ 1 + น้ำถาวร 8 → FLOODED_DEPTH_NOT_ESTIMATED
    cls[0:3, 3:6] = C.CLASS_REFERENCE_WATER
    cls[1, 4] = C.CLASS_FLOODED_DEPTH_NOT_ESTIMATED
    # (0,2): ตัดออก 8 + น้ำถาวร 1 → REFERENCE_WATER
    cls[0:3, 6:9] = C.CLASS_EXCLUDED
    cls[2, 8] = C.CLASS_REFERENCE_WATER
    # (1,0): ไม่มีภาพ 8 + แห้ง 1 → DRY; likelihood เฉลี่ยเฉพาะที่สังเกตได้
    cls[3:6, 0:3] = C.CLASS_NO_OBSERVATION
    lik[3:6, 0:3] = C.NO_LIKELIHOOD
    cls[4, 1] = C.CLASS_DRY
    lik[4, 1] = 90
    # (1,1): ไม่มีภาพทั้งหมด
    cls[3:6, 3:6] = C.CLASS_NO_OBSERVATION
    lik[3:6, 3:6] = C.NO_LIKELIHOOD
    # (2,2): ท่วมสองเซลล์ค่า 100 กับ 200 + ท่วมไม่ประมาณ 1 → FLOODED, mean 150
    cls[6, 6] = C.CLASS_FLOODED
    depth[6, 6] = 100
    cls[7, 7] = C.CLASS_FLOODED
    depth[7, 7] = 200
    cls[8, 8] = C.CLASS_FLOODED_DEPTH_NOT_ESTIMATED

    oc, od, ol = aggregate(cls, depth, lik, g)
    assert oc.shape == (3, 3)
    assert oc[0, 0] == C.CLASS_FLOODED and od[0, 0] == 40
    assert oc[0, 1] == C.CLASS_FLOODED_DEPTH_NOT_ESTIMATED and od[0, 1] == C.NO_DEPTH
    assert oc[0, 2] == C.CLASS_REFERENCE_WATER
    assert oc[1, 0] == C.CLASS_DRY and ol[1, 0] == 90
    assert oc[1, 1] == C.CLASS_NO_OBSERVATION and ol[1, 1] == C.NO_LIKELIHOOD and od[1, 1] == C.NO_DEPTH
    assert oc[2, 2] == C.CLASS_FLOODED and od[2, 2] == 150
    assert oc[2, 0] == C.CLASS_DRY and od[2, 0] == C.NO_DEPTH and ol[2, 0] == 50


def _entry(scene_id: str, observed_at: str, flooded: int = 0) -> dict:
    g = make_grid(width=9, height=9)
    cls = np.full((3, 3), C.CLASS_DRY, np.uint8)
    depth = np.full((3, 3), C.NO_DEPTH, np.uint16)
    for i in range(flooded):
        cls[0, i] = C.CLASS_FLOODED
        depth[0, i] = 10 * (i + 1)
    return scene_entry(scene_id, observed_at, None, None, cls, depth, g, ["b", "a"])


def test_scene_entry_and_meta_fields():
    e = _entry("20240912T112331-AS020M", "2024-09-12T11:23:31Z", flooded=3)
    assert set(e) == {
        "sceneId", "observedAt", "publishedAt", "orbit", "floodedCells", "excludedCells", "observedCells",
        "floodedAreaKm2", "maxDepthCm", "medianDepthCm", "depthEstimatedFraction", "gfmItemIds",
    }
    assert e["floodedCells"] == 3 and e["observedCells"] == 9 and e["excludedCells"] == 0
    assert e["maxDepthCm"] == 30 and e["medianDepthCm"] == 20 and e["depthEstimatedFraction"] == 1.0
    assert e["floodedAreaKm2"] == round(3 * 90 * 90 / 1e6, 4)
    assert e["gfmItemIds"] == ["a", "b"]
    dry = _entry("20240912T112331-AS020M", "2024-09-12T11:23:31Z")
    assert dry["maxDepthCm"] is None and dry["medianDepthCm"] is None and dry["depthEstimatedFraction"] == 0.0
    m = scene_meta(e, 1234)
    assert m["methodology"] == {"name": "FwDET-2", "boundarySmoothingCells": 3, "depthCapCm": 1000, "maskedClasses": [50, 10]}
    assert m["fieldBytesGz"] == 1234


def test_merge_index_idempotent_newest_first():
    g = make_grid()
    a = _entry("20240901T000000-AS020M", "2024-09-01T00:00:00Z")
    b = _entry("20240912T112331-AS020M", "2024-09-12T11:23:31Z", flooded=2)
    idx = merge_index(None, g, [a, b], "2026-01-01T00:00:00Z")
    assert [s["sceneId"] for s in idx["scenes"]] == [b["sceneId"], a["sceneId"]]
    assert idx["provinceCode"] == "99" and idx["grid"] == g.overview.as_json()
    ext, dep = idx["layers"]["extent"], idx["layers"]["depth"]
    assert ext["epistemicClass"] == "observed" and ext["id"] == "copernicus-gfm-flood-extent"
    assert ext["observedAt"] == b["observedAt"] and ext["publishedAt"] is None
    assert ext["fetchedAt"] == "2026-01-01T00:00:00Z" and ext["sourceIds"] == ["copernicus-gfm"]
    assert dep["epistemicClass"] == "illustrative" and dep["methodologyUrl"] == "/methodology/flood-depth"
    assert dep["publishedAt"] is None
    # ซ้ำ: ไม่แทนที่ ไม่เพิ่ม — generatedAt เท่านั้นที่ขยับ
    b2 = dict(b, floodedCells=999)
    idx2 = merge_index(idx, g, [b2], "2026-01-02T00:00:00Z")
    assert idx2["scenes"] == idx["scenes"] and idx2["generatedAt"] == "2026-01-02T00:00:00Z"
    idx3 = merge_index(idx2, g, b, "2026-01-03T00:00:00Z")  # entry เดี่ยวก็รับ
    assert idx3["scenes"] == idx["scenes"]
    # ฉากแห้งอยู่ใน index เหมือนฉากอื่น
    assert idx3["scenes"][1]["floodedCells"] == 0
    # ไม่มีฉากเลย: ไม่มี observedAt, publishedAt null
    empty = merge_index(None, g, [], "2026-01-01T00:00:00Z")
    assert empty["scenes"] == [] and "observedAt" not in empty["layers"]["extent"]
    assert empty["layers"]["extent"]["publishedAt"] is None


def test_merge_index_cap():
    g = make_grid()
    entries = [_entry(f"2024{i:04d}T000000-AS020M", f"2024-01-01T00:{i % 60:02d}:{i // 60:02d}Z") for i in range(1600)]
    idx = merge_index(None, g, entries, "2026-01-01T00:00:00Z")
    assert len(idx["scenes"]) == C.INDEX_MAX_SCENES
