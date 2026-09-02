import re
from datetime import datetime, timedelta, timezone

import pystac

from gfm import contract as C
from gfm.grid import ProvinceBox
from gfm.stac import (
    CREATED_LOOKBACK,
    FRAME_MERGE_WINDOW,
    group_by_province,
    orbit,
    published_at,
    scene_key,
    search_items,
    sort_by_created,
)

from conftest import make_grid


def _item(item_id: str, bbox, created: str | None = None, **props) -> pystac.Item:
    p = dict(props)
    if created:
        p["created"] = created
    return pystac.Item(id=item_id, geometry=None, bbox=list(bbox), datetime=datetime(2026, 8, 24, 23, 24, 39, tzinfo=timezone.utc), properties=p)


def test_scene_id_from_real_item_id():
    it = _item("ENSEMBLE_FLOOD_20260824T232439_VV_AS020M_E045N012T3", [97, 5, 106, 21])
    k = scene_key(it)
    assert k.acquisition_utc == datetime(2026, 8, 24, 23, 24, 39, tzinfo=timezone.utc)
    assert k.tile_group == "AS020M"
    assert k.scene_id == "20260824T232439-AS020M"
    assert re.match(C.SCENE_ID_RE, k.scene_id)
    assert re.match(r"^\d{8}T\d{6}-[A-Z]{2}\d{3}M$", k.scene_id)


def test_published_and_orbit_absent_stay_none():
    it = _item("ENSEMBLE_FLOOD_20260824T232439_VV_AS020M_E045N012T3", [97, 5, 106, 21])
    assert published_at(it) is None
    assert orbit(it) is None
    it2 = _item("ENSEMBLE_FLOOD_20260824T232439_VV_AS020M_E045N012T3", [97, 5, 106, 21],
                created="2026-08-25T03:20:00.123456+00:00", **{"sat:orbit_state": "descending"})
    assert published_at(it2) == datetime(2026, 8, 25, 3, 20, 0, 123456, tzinfo=timezone.utc)
    assert orbit(it2) == "descending"


def test_group_by_province_merges_frames_of_one_pass_keyed_on_earliest():
    """เฟรมห่างกัน 25 วิ (รอบบินเดียวกัน กลุ่มไทล์เดียวกัน) = ฉากเดียว sceneId ของเฟรมแรกสุด"""
    a = _item("ENSEMBLE_FLOOD_20240913T112241_VV_AS020M_E048N018T3", [98.2, 19.58, 101.1, 22.4])
    b = _item("ENSEMBLE_FLOOD_20240913T112241_VV_AS020M_E048N015T3", [98.1, 16.9, 101.0, 19.74])
    c = _item("ENSEMBLE_FLOOD_20240913T112216_VV_AS020M_E048N015T3", [98.1, 16.9, 101.0, 19.74])
    far = _item("ENSEMBLE_FLOOD_20240913T112241_VV_AS020M_E051N015T3", [101.5, 16.9, 104.0, 19.74])
    g = make_grid(code="57")  # bbox 99..100, 19..20 (conftest)
    groups = group_by_province([far, a, b, c], [g])
    assert set(groups) == {("57", "20240913T112216-AS020M")}
    assert re.match(C.SCENE_ID_RE, "20240913T112216-AS020M")
    # เรียงตาม id (เฟรมหลังทับเฟรมก่อนตอน mosaic)
    assert [it.id for it in groups[("57", "20240913T112216-AS020M")]] == [c.id, b.id, a.id]


def test_group_by_province_splits_frames_more_than_window_apart():
    """ห่างจากเฟรมแรกเกิน FRAME_MERGE_WINDOW = คนละฉาก (วัดจากเฟรมแรก ไม่ใช่เฟรมก่อนหน้า)"""
    first = _item("ENSEMBLE_FLOOD_20240913T112216_VV_AS020M_E048N015T3", [98.1, 16.9, 101.0, 19.74])
    edge = _item("ENSEMBLE_FLOOD_20240913T113216_VV_AS020M_E048N015T3", [98.1, 16.9, 101.0, 19.74])  # +10:00 พอดี
    over = _item("ENSEMBLE_FLOOD_20240913T113217_VV_AS020M_E048N018T3", [98.2, 19.58, 101.1, 22.4])  # +10:01
    later = _item("ENSEMBLE_FLOOD_20240913T113500_VV_AS020M_E048N015T3", [98.1, 16.9, 101.0, 19.74])  # +2:43 จาก over
    other_group = _item("ENSEMBLE_FLOOD_20240913T112220_VV_AS021M_E048N015T3", [98.1, 16.9, 101.0, 19.74])
    g = make_grid(code="57")
    assert FRAME_MERGE_WINDOW == timedelta(minutes=10)
    groups = group_by_province([later, over, edge, first, other_group], [g])
    assert set(groups) == {
        ("57", "20240913T112216-AS020M"),  # first + edge (≤ 10 นาที)
        ("57", "20240913T113217-AS020M"),  # over + later (เปิดฉากใหม่ที่ over; later ห่าง over < 10 นาที)
        ("57", "20240913T112220-AS021M"),  # กลุ่มไทล์อื่นไม่รวมกันแม้เวลาจะใกล้
    }
    assert [it.id for it in groups[("57", "20240913T112216-AS020M")]] == [first.id, edge.id]
    assert [it.id for it in groups[("57", "20240913T113217-AS020M")]] == [over.id, later.id]


def test_group_by_province_accepts_bbox_only_provinces():
    """`plan` ยังไม่มี DEM ในเครื่อง — จัดกลุ่มจาก ProvinceBox (manifest) ได้ผลเดียวกับ ProvinceGrid"""
    a = _item("ENSEMBLE_FLOOD_20240913T112241_VV_AS020M_E048N018T3", [98.2, 19.58, 101.1, 22.4])
    box = ProvinceBox(code="57", bbox=(99.0, 19.0, 100.0, 20.0))
    assert group_by_province([a], [box]) == group_by_province([a], [make_grid(code="57")])
    assert set(group_by_province([a], [ProvinceBox(code="90", bbox=(100.0, 6.0, 101.0, 7.5))])) == set()


class _FakeSearch:
    def __init__(self, items):
        self._items = items

    def items(self):
        return iter(self._items)


class _FakeClient:
    def __init__(self, items):
        self._items = items
        self.calls = []

    def search(self, **kw):
        self.calls.append(kw)
        return _FakeSearch(self._items)


def test_search_items_filters_on_created_and_widens_datetime_window():
    old = _item("ENSEMBLE_FLOOD_20240913T112241_VV_AS020M_E048N018T3", [0, 0, 1, 1], created="2024-11-06T14:19:47Z")
    new = _item("ENSEMBLE_FLOOD_20240913T112216_VV_AS020M_E048N018T3", [0, 0, 1, 1], created="2024-11-07T00:00:00Z")
    none = _item("ENSEMBLE_FLOOD_20240913T112151_VV_AS020M_E048N018T3", [0, 0, 1, 1])
    client = _FakeClient([new, none, old])
    since = datetime(2024, 11, 7, tzinfo=timezone.utc)
    until = datetime(2024, 11, 8, tzinfo=timezone.utc)
    got = search_items(since, until, [97, 5, 106, 21], client=client)
    # `created` ที่ไม่มี = กรองออก (ไม่แต่งค่าให้), created < since ออก, created == since อยู่
    assert [it.id for it in got] == [new.id]
    kw = client.calls[0]
    assert kw["collections"] == ["GFM"] and kw["bbox"] == [97, 5, 106, 21] and kw["limit"] == 100
    assert kw["datetime"] == [since - CREATED_LOOKBACK, until]
    # backfill: กรองที่เวลาบันทึกภาพ ไม่กรอง created (item ที่ไม่มี created ก็อยู่)
    got2 = search_items(None, None, [97, 5, 106, 21], acquired_from=since, acquired_to=until, client=client)
    assert [it.id for it in got2] == [old.id, new.id, none.id]
    assert client.calls[1]["datetime"] == [since, until]


def test_sort_by_created_missing_last():
    x = _item("ENSEMBLE_FLOOD_20240913T112241_VV_AS020M_E048N018T3", [0, 0, 1, 1], created="2024-11-06T14:19:47Z")
    y = _item("ENSEMBLE_FLOOD_20240913T112216_VV_AS020M_E048N018T3", [0, 0, 1, 1], created="2024-11-06T14:18:38Z")
    z = _item("ENSEMBLE_FLOOD_20240913T112151_VV_AS020M_E048N018T3", [0, 0, 1, 1])
    assert [it.id for it in sort_by_created([z, x, y])] == [y.id, x.id, z.id]
