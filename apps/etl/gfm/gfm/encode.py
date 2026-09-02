"""ย่อผล 30 ม. ลงตาราง overview ของจังหวัด แล้วเขียน `field.bin` / `meta.json` / `index.json`

รูปแบบไฟล์และชื่อฟิลด์ทั้งหมดมาจาก `packages/shared-types/src/flood.ts` (FloodSceneIndexEntry,
FloodSceneIndex, FloodSceneMeta, layout ของ field.bin) และ `hazard-layer.ts` (HazardLayerDescriptor)
— ค่าคงที่อยู่ใน contract.py ที่เดียว
"""

from __future__ import annotations

import gzip
import io
import struct
from collections.abc import Iterable
from datetime import datetime

import numpy as np

from . import contract as C
from .grid import ProvinceGrid, overview_index

# แถวละ 4 ไบต์ต่อเซลล์ตาม flood.ts: u8 class, u16 depthCm (LE), u8 likelihood — ไม่มี padding
CELL_DTYPE = np.dtype([("cls", "u1"), ("depth", "<u2"), ("lik", "u1")])
assert CELL_DTYPE.itemsize == C.FLOOD_FIELD_CELL_BYTES

# ลำดับความสำคัญตอนย่อ: FLOODED > FLOODED_DEPTH_NOT_ESTIMATED > REFERENCE_WATER > EXCLUDED > DRY > NO_OBSERVATION
# ใช้ "ลำดับความสำคัญ" ไม่ใช่ฐานนิยม (mode): เซลล์ overview 203 ม. ที่มีเซลล์ 30 ม. ท่วมแม้แค่หนึ่ง
# เซลล์ต้องไม่อ่านว่า "แห้ง" — ฐานนิยมจะกลบน้ำท่วมแคบ ๆ (คูคลอง ถนน) ให้หายไปเงียบ ๆ ซึ่งคือ
# การทำให้ข้อมูลที่สังเกตได้หายจากแผนที่ ในทางกลับกัน "ไม่มีภาพ" แพ้ทุกอย่างเพราะเซลล์ที่มีภาพ
# บางส่วนก็คือมีภาพ
_PRECEDENCE = (
    C.CLASS_NO_OBSERVATION,
    C.CLASS_DRY,
    C.CLASS_EXCLUDED,
    C.CLASS_REFERENCE_WATER,
    C.CLASS_FLOODED_DEPTH_NOT_ESTIMATED,
    C.CLASS_FLOODED,
)


def aggregate(
    cls30: np.ndarray, depth30: np.ndarray, lik30: np.ndarray, grid: ProvinceGrid
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(cls, depthCm, likelihood) บนตาราง overview — แถว 0 = เหนือ (การกลับแถวเกิดตอน encode)

    depthCm = ค่าเฉลี่ยของเซลล์ 30 ม. ที่เป็น FLOODED (มีค่าความลึก) — NO_DEPTH เมื่อไม่มี
    likelihood = ค่าเฉลี่ยของเซลล์ที่สังเกตได้และ GFM ให้ค่า — NO_LIKELIHOOD เมื่อไม่มี
    """
    ov = grid.overview
    row_map, col_map = overview_index(grid)
    valid = (row_map >= 0)[:, None] & (col_map >= 0)[None, :]
    flat = (row_map[:, None].astype(np.int64) * ov.width + col_map[None, :]).astype(np.int64)
    n = ov.width * ov.height

    rank = np.zeros(n, dtype=np.uint8)
    for r, klass in enumerate(_PRECEDENCE):
        sel = valid & (cls30 == klass)
        if sel.any():
            rank[flat[sel]] = r  # ค่าที่เขียนเท่ากันหมด ลำดับการเขียนจากต่ำไปสูงจึงเป็น max
    cls = np.array(_PRECEDENCE, dtype=np.uint8)[rank]
    # เซลล์ overview ที่ไม่มีเซลล์ 30 ม. ตกลงมาเลย (ขอบล่าง/ขวาที่ตารางไม่ลงตัว) = ไม่มีภาพ
    touched = np.zeros(n, dtype=bool)
    touched[flat[valid]] = True
    cls[~touched] = C.CLASS_NO_OBSERVATION

    has_depth = valid & (cls30 == C.CLASS_FLOODED)
    dsum = np.bincount(flat[has_depth], weights=depth30[has_depth].astype(np.float64), minlength=n)
    dcnt = np.bincount(flat[has_depth], minlength=n)
    depth = np.full(n, C.NO_DEPTH, dtype=np.uint16)
    dmask = dcnt > 0
    depth[dmask] = np.clip(np.rint(dsum[dmask] / dcnt[dmask]), 0, C.DEPTH_CAP_CM).astype(np.uint16)
    # คลาสที่ไม่ใช่ FLOODED ห้ามมีค่าความลึก (flood.ts: depthCm มีค่าเฉพาะ class = FLOODED)
    depth[cls != C.CLASS_FLOODED] = C.NO_DEPTH

    has_lik = valid & (cls30 != C.CLASS_NO_OBSERVATION) & (lik30 != C.NO_LIKELIHOOD)
    lsum = np.bincount(flat[has_lik], weights=lik30[has_lik].astype(np.float64), minlength=n)
    lcnt = np.bincount(flat[has_lik], minlength=n)
    lik = np.full(n, C.NO_LIKELIHOOD, dtype=np.uint8)
    lmask = lcnt > 0
    lik[lmask] = np.clip(np.rint(lsum[lmask] / lcnt[lmask]), 0, 100).astype(np.uint8)

    shape = (ov.height, ov.width)
    return cls.reshape(shape), depth.reshape(shape), lik.reshape(shape)


def encode_field(cls: np.ndarray, depth_cm: np.ndarray, likelihood: np.ndarray) -> bytes:
    """ไบต์ดิบของ field.bin (ยังไม่ gzip) — อินพุตแถว 0 = เหนือ, ไฟล์เรียง **ล่างขึ้นบน**

    แถวแรกในไฟล์คือขอบใต้ของจังหวัด ตามลำดับแถวของ THREE.DataTexture ที่ floodMask.ts ใช้
    (`texRow = height - 1 - r`)
    """
    h, w = cls.shape
    if h > 0xFFFF or w > 0xFFFF:
        raise ValueError(f"ตาราง {w}x{h} เกิน u16 ของ header")
    cells = np.empty((h, w), dtype=CELL_DTYPE)
    cells["cls"] = cls.astype(np.uint8)
    cells["depth"] = depth_cm.astype(np.uint16)
    cells["lik"] = likelihood.astype(np.uint8)
    header = struct.pack("<IHHH", C.FLOOD_FIELD_MAGIC, C.FLOOD_FIELD_VERSION, w, h)
    return header + np.ascontiguousarray(cells[::-1, :]).tobytes()


def gzip_bytes(raw: bytes) -> bytes:
    """gzip แบบ deterministic (mtime=0, ไม่มีชื่อไฟล์) — ไบต์เดิม → ไฟล์เดิม"""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0, compresslevel=9) as gz:
        gz.write(raw)
    return buf.getvalue()


def decode_field(data: bytes) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """ถอด field.bin (รับทั้ง gzip และดิบ) → (cls, depthCm, likelihood) แถว 0 = เหนือ"""
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    if len(data) < C.FLOOD_FIELD_HEADER_BYTES:
        raise ValueError("field.bin สั้นกว่า header")
    magic, version, w, h = struct.unpack_from("<IHHH", data, 0)
    if magic != C.FLOOD_FIELD_MAGIC:
        raise ValueError(f"magic ผิด: {magic:#x}")
    if version != C.FLOOD_FIELD_VERSION:
        raise ValueError(f"รุ่น {version} ไม่รู้จัก (รองรับ {C.FLOOD_FIELD_VERSION})")
    expected = C.FLOOD_FIELD_HEADER_BYTES + w * h * C.FLOOD_FIELD_CELL_BYTES
    if len(data) != expected:
        raise ValueError(f"ขนาดไม่ตรง: {len(data)} ≠ {expected}")
    cells = np.frombuffer(data, dtype=CELL_DTYPE, offset=C.FLOOD_FIELD_HEADER_BYTES).reshape(h, w)[::-1, :]
    return cells["cls"].copy(), cells["depth"].copy(), cells["lik"].copy()


def scene_entry(
    scene_id: str,
    observed_at: str,
    published_at: str | None,
    orbit: str | None,
    cls: np.ndarray,
    depth_cm: np.ndarray,
    grid: ProvinceGrid,
    item_ids: Iterable[str],
) -> dict:
    """FloodSceneIndexEntry (flood.ts) — นับบนตาราง overview"""
    flooded_any = (cls == C.CLASS_FLOODED) | (cls == C.CLASS_FLOODED_DEPTH_NOT_ESTIMATED)
    with_depth = cls == C.CLASS_FLOODED
    n_flooded = int(flooded_any.sum())
    n_depth = int(with_depth.sum())
    depths = depth_cm[with_depth].astype(np.int64)
    cell = grid.overview.cell_size_m
    return {
        "sceneId": scene_id,
        "observedAt": observed_at,
        "publishedAt": published_at,
        "orbit": orbit,
        "floodedCells": n_flooded,
        "excludedCells": int((cls == C.CLASS_EXCLUDED).sum()),
        "observedCells": int((cls != C.CLASS_NO_OBSERVATION).sum()),
        "floodedAreaKm2": round(n_flooded * cell * cell / 1e6, 4),
        "maxDepthCm": int(depths.max()) if n_depth else None,
        "medianDepthCm": int(np.median(depths)) if n_depth else None,
        "depthEstimatedFraction": round(n_depth / n_flooded, 4) if n_flooded else 0.0,
        "gfmItemIds": sorted(item_ids),
    }


def scene_meta(entry: dict, field_bytes_gz: int) -> dict:
    """FloodSceneMeta (flood.ts) = entry + methodology ที่ใช้จริง

    `fieldBytesGz` (ขนาด gzip ของ field.bin — `FloodSceneMeta.fieldBytesGz` ใน flood.ts) ไว้ให้ F6
    คิดค่า storage จากตัวเลขจริง อยู่ใน meta.json เท่านั้น ไม่ใส่ใน index entry
    """
    return {
        **entry,
        "methodology": {
            "name": "FwDET-2",
            "boundarySmoothingCells": C.BOUNDARY_SMOOTHING_CELLS,
            "depthCapCm": C.DEPTH_CAP_CM,
            "maskedClasses": list(C.MASKED_WORLDCOVER_CLASSES),
        },
        "fieldBytesGz": int(field_bytes_gz),
    }


# F5 (roadmap E14): ฉากที่เก่ากว่า 14 วันถือว่าไม่มีภาพในหน้าต่างและถูกหรี่ — S1 บินซ้ำทุก 6–12 วัน
STALE_AFTER_SECONDS = 14 * 86400


def layer_descriptors(newest: dict | None, generated_at: str) -> dict:
    """`layers.extent` (observed) + `layers.depth` (illustrative) ตาม HazardLayerDescriptor

    observedAt/publishedAt มาจากฉากใหม่สุด (ไม่มีฉาก = ไม่ใส่ observedAt, publishedAt null)
    fetchedAt = เวลาที่ job นี้เขียน index สำเร็จ — ไม่มีวันเป็น "ตอนนี้" ของฝั่งผู้อ่าน
    """
    observed = {"observedAt": newest["observedAt"]} if newest else {}
    published = newest["publishedAt"] if newest else None
    extent = {
        "id": C.EXTENT_LAYER_ID,
        "epistemicClass": "observed",
        "liveOrStatic": "live",
        **observed,
        "publishedAt": published,
        "fetchedAt": generated_at,
        "staleAfterSeconds": STALE_AFTER_SECONDS,
        "sourceIds": [C.SOURCE_ID_GFM],
    }
    depth = {
        "id": C.DEPTH_LAYER_ID,
        # เราคำนวณเองจาก DSM — ไม่ใช่การตรวจวัด และไม่ใช่ตัวเลขว่าอะไรจะเกิดขึ้น (methodology)
        "epistemicClass": "illustrative",
        "liveOrStatic": "live",
        **observed,  # ความลึกไม่มีเวลาของตัวเอง — อ้างเวลาบันทึกภาพของฉากที่มันคำนวณมาจาก
        "publishedAt": None,  # ไม่มีต้นทางเผยแพร่ค่าความลึกนี้
        "fetchedAt": generated_at,
        "staleAfterSeconds": STALE_AFTER_SECONDS,
        "methodologyUrl": C.DEPTH_METHODOLOGY_URL,
        "sourceIds": [C.SOURCE_ID_GFM, C.SOURCE_ID_DEM],
    }
    return {"extent": extent, "depth": depth}


def merge_index(existing: dict | None, grid: ProvinceGrid, entries: Iterable[dict] | dict, generated_at: str) -> dict:
    """FloodSceneIndex (flood.ts) — ใหม่สุดก่อน, sceneId ซ้ำไม่ทับของเดิม (ฉาก immutable), จำกัด 1,500

    รับ entry หลายรายการต่อครั้ง: index ถูกเขียนครั้งเดียวต่อจังหวัดต่อ run ไม่ใช่ต่อฉาก
    """
    new_entries = [entries] if isinstance(entries, dict) else list(entries)
    scenes: list[dict] = list(existing.get("scenes", [])) if existing else []
    known = {s["sceneId"] for s in scenes}
    for e in new_entries:
        if e["sceneId"] in known:
            continue  # docs/dataset.md §8: ชื่อที่ปล่อยแล้วห้ามใช้กับไบต์ชุดอื่น — ไม่แทนที่
        scenes.append(e)
        known.add(e["sceneId"])
    scenes.sort(key=lambda s: (s["observedAt"], s["sceneId"]), reverse=True)
    scenes = scenes[: C.INDEX_MAX_SCENES]
    newest = scenes[0] if scenes else None
    return {
        "provinceCode": grid.code,
        "grid": grid.overview.as_json(),
        "layers": layer_descriptors(newest, generated_at),
        "generatedAt": generated_at,
        "scenes": scenes,
    }


def iso_now(now: datetime) -> str:
    return now.strftime("%Y-%m-%dT%H:%M:%SZ")
