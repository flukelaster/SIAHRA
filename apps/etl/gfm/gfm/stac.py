"""ค้นหา item ของ Copernicus GFM ใน STAC ของ EODC และจัดกลุ่มเป็น "ฉาก" ต่อจังหวัด

ข้อเท็จจริงของต้นทาง (วัดจริง 2026-08-25, อย่าอนุมานใหม่): `https://stac.eodc.eu/api/v1`
collection `GFM` ไม่ต้อง auth; item id รูป `ENSEMBLE_FLOOD_20260824T232439_VV_AS020M_E045N012T3`
(เวลาบันทึกภาพ UTC, โพลาไรเซชัน, กลุ่มไทล์ Equi7, ไทล์ T3); `created` = เวลาที่ GFM เผยแพร่
(ปกติ ~4 ชม. หลังบันทึกภาพ แต่การประมวลผลซ้ำอาจตามมาหลังเป็นเดือน — ตัวกรอง "ใหม่กว่ารอบก่อน"
จึงต้องดูที่ `created` ไม่ใช่ `datetime`); `sat:orbit_state` อาจไม่มี

ฉาก (scene) = item ทุกใบที่มีวินาทีบันทึกภาพเดียวกัน + กลุ่มไทล์เดียวกัน และทับซ้อน bbox ของ
จังหวัด — sceneId คือ `{acq:%Y%m%dT%H%M%S}-{tile_group}` ตามที่ docs/dataset.md §8 กำหนดไว้
(`\\d{8}T\\d{6}-[A-Z]{2}\\d{3}M`) ไทล์ Equi7 หลายใบของวินาทีเดียวกันถูก mosaic ใน warp.py
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pystac
import pystac_client
from pystac_client.stac_api_io import StacApiIO

from .grid import ProvinceGrid

STAC_URL = "https://stac.eodc.eu/api/v1"
COLLECTION = "GFM"
THAILAND_BBOX = (97.0, 5.0, 106.0, 21.0)

# ชั้นทั้งสี่ที่ warp.py อ่านต่อ item — ชื่อ asset ตามที่ต้นทางใช้จริง
ASSET_EXTENT = "ensemble_flood_extent"
ASSET_LIKELIHOOD = "ensemble_likelihood"
ASSET_EXCLUSION = "exclusion_mask"
ASSET_REFWATER = "reference_water_mask"
ASSET_KEYS = (ASSET_EXTENT, ASSET_LIKELIHOOD, ASSET_EXCLUSION, ASSET_REFWATER)

# `ENSEMBLE_FLOOD_20260824T232439_VV_AS020M_E045N012T3`
_ITEM_ID_RE = re.compile(r"^ENSEMBLE_FLOOD_(\d{8}T\d{6})_[A-Z]+_([A-Z]{2}\d{3}M)_([A-Z]\d{3}[A-Z]\d{3}T\d)$")

# ระยะย้อนหลังของหน้าต่าง `datetime` เมื่อค้นด้วย `created` — การประมวลผลซ้ำของ GFM มาช้ากว่า
# บันทึกภาพได้หลายสัปดาห์ item ที่ `created` ใหม่แต่ `datetime` เก่ากว่านี้จะถูกเก็บตกในการ
# backfill ไม่ใช่ใน run ปกติ
CREATED_LOOKBACK = timedelta(days=30)

# วัดจริง 2026-09-02 (เชียงราย 94 item): หน้าปริยาย 10 item ของ stac.eodc.eu บางหน้าใช้เวลา
# 50–70 วินาที และบางครั้งค้างไม่ตอบเลย (process นั่ง 0% CPU เกิน 6 นาที) ขณะที่ `limit=100`
# ได้ครบใน 1.3 วินาทีหน้าเดียว — ขอหน้าใหญ่ + timeout ต่อคำขอ + retry ไม่งั้น job ค้างตลอดกาล
PAGE_SIZE = 100
REQUEST_TIMEOUT_S = 120
MAX_RETRIES = 3


def open_client() -> pystac_client.Client:
    return pystac_client.Client.open(STAC_URL, stac_io=StacApiIO(timeout=REQUEST_TIMEOUT_S, max_retries=MAX_RETRIES))


@dataclass(frozen=True)
class SceneKey:
    acquisition_utc: datetime
    tile_group: str

    @property
    def scene_id(self) -> str:
        return f"{self.acquisition_utc:%Y%m%dT%H%M%S}-{self.tile_group}"


def _parse_iso(value: str) -> datetime:
    d = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def scene_key(item: pystac.Item) -> SceneKey:
    """(เวลาบันทึกภาพ UTC, กลุ่มไทล์ Equi7) จาก item id — ตกไปที่ `datetime` + `Equi7Tile` เมื่อ id ผิดรูป"""
    m = _ITEM_ID_RE.match(item.id)
    if m:
        acq = datetime.strptime(m.group(1), "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
        return SceneKey(acq, m.group(2))
    dt = item.properties.get("datetime")
    tile = item.properties.get("Equi7Tile", "")
    if not dt or "_" not in tile:
        raise ValueError(f"อ่านเวลาบันทึกภาพ/กลุ่มไทล์จาก item ไม่ได้: {item.id}")
    return SceneKey(_parse_iso(dt).replace(microsecond=0), tile.split("_", 1)[0])


def orbit(item: pystac.Item) -> str | None:
    """`sat:orbit_state` — None เมื่อต้นทางไม่ให้ (ห้ามเดาจากเวลาบันทึกภาพ)"""
    v = item.properties.get("sat:orbit_state")
    return v if v in ("ascending", "descending") else None


def published_at(item: pystac.Item) -> datetime | None:
    """`created` ของ STAC = เวลาที่ GFM เผยแพร่ — None เมื่อไม่มี **ห้ามเติมจากเวลาปัจจุบัน**"""
    v = item.properties.get("created")
    return _parse_iso(v) if v else None


def iso_z(d: datetime) -> str:
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sort_by_created(items: Iterable[pystac.Item]) -> list[pystac.Item]:
    # item ที่ไม่มี `created` ไปท้ายสุด (stable) — ไม่แต่งค่าให้มันเพื่อให้เรียงได้
    far = datetime.max.replace(tzinfo=timezone.utc)
    return sorted(items, key=lambda it: (published_at(it) or far, it.id))


def search_items(
    since: datetime | None,
    until: datetime | None,
    bbox: Sequence[float] = THAILAND_BBOX,
    *,
    acquired_from: datetime | None = None,
    acquired_to: datetime | None = None,
    client: pystac_client.Client | None = None,
) -> list[pystac.Item]:
    """item ของ GFM ใน bbox เรียงตาม `created` จากเก่าไปใหม่ (ไล่ทุกหน้า)

    - `since`/`until` กรองที่ `created` (ฝั่ง client — ไม่พึ่ง query extension ของเซิร์ฟเวอร์)
      โดยตั้งหน้าต่าง `datetime` ของ STAC เป็น [since − CREATED_LOOKBACK, until]
    - `acquired_from`/`acquired_to` (backfill) กรองที่เวลาบันทึกภาพโดยตรง
    """
    if client is None:
        client = open_client()
    if acquired_from is None and since is not None:
        acquired_from = since - CREATED_LOOKBACK
    if acquired_to is None:
        acquired_to = until
    if acquired_from is None and acquired_to is None:
        dt_range = None
    else:
        dt_range = [acquired_from, acquired_to]
    search = client.search(collections=[COLLECTION], bbox=list(bbox), datetime=dt_range, limit=PAGE_SIZE)
    items: list[pystac.Item] = []
    for it in search.items():  # pystac_client ไล่หน้าถัดไปให้เอง (`next` links)
        created = published_at(it)
        if since is not None and (created is None or created < since):
            continue
        if until is not None and created is not None and created > until:
            continue
        items.append(it)
    return sort_by_created(items)


def _bbox_intersects(a: Sequence[float], b: Sequence[float]) -> bool:
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


def group_by_province(
    items: Iterable[pystac.Item], provinces: Iterable[ProvinceGrid]
) -> dict[tuple[str, str], list[pystac.Item]]:
    """{(รหัสจังหวัด, sceneId): [item...]} — item ที่ bbox ทับจังหวัดและมีวินาที+กลุ่มไทล์เดียวกัน

    bbox ของ item คือกรอบไทล์ Equi7 ทั้งใบ (ใหญ่กว่ารอยเท้าภาพจริง) เซลล์ที่ไม่มีภาพจริง ๆ
    จะกลายเป็น NO_OBSERVATION ตอน warp ไม่ใช่ถูกตัดทิ้งตรงนี้
    """
    grids = list(provinces)
    out: dict[tuple[str, str], list[pystac.Item]] = {}
    for it in items:
        if it.bbox is None:
            continue
        key = scene_key(it)
        for g in grids:
            if _bbox_intersects(it.bbox, g.bbox):
                out.setdefault((g.code, key.scene_id), []).append(it)
    for lst in out.values():
        lst.sort(key=lambda it: it.id)
    return out


def union_bbox(provinces: Iterable[ProvinceGrid]) -> tuple[float, float, float, float]:
    bs = [g.bbox for g in provinces]
    if not bs:
        return THAILAND_BBOX
    return (min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs))
