"""E14.F6 — backfill 2015 → ตอนนี้: `backfill --deadline`, `backfill-plan`, `backfill-advance`

ใช้ province/item fixture เดียวกับ test_cli.py (import ตรง ๆ — ไม่มี __init__.py ใต้ tests/ pytest
จึงเห็น test_cli เป็นโมดูลบน sys.path เหมือนกัน)
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from gfm import cli
from gfm.grid import load_province_grid

from test_cli import _assets, _item, _province


class _Clock:
    """คืนค่าถัดไปจากลิสต์ที่กำหนดไว้ล่วงหน้าทุกครั้งที่ถูกเรียก — ควบคุมเวลาสมมติแบบ deterministic"""

    def __init__(self, times: list[datetime]) -> None:
        self._times = list(times)

    def __call__(self) -> datetime:
        return self._times.pop(0)


def _cursor_path(tmp_path: Path) -> Path:
    return tmp_path / "cursor.json"


# ---------------------------------------------------------------------------
# run_backfill_visit — newest-first, skip ที่รู้จักแล้ว, หยุดที่ deadline
# ---------------------------------------------------------------------------


def test_run_backfill_visit_processes_newest_first(tmp_path):
    work, aoi = _province(tmp_path)
    grid = load_province_grid("57", work, aoi)
    out = tmp_path / "out"
    old = _item("ENSEMBLE_FLOOD_20240901T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "old", True), "2024-09-01T15:00:00Z")
    new = _item("ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "new", True), "2024-09-12T15:00:00Z")
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    deadline = now + timedelta(hours=10)
    # ส่ง item ตามลำดับเก่า→ใหม่โดยตั้งใจ — ต้องประมวลผลใหม่สุดก่อนไม่ว่าลำดับอินพุตจะเป็นอะไร
    # clock คงที่ (ไม่ใช่ datetime.now จริง) กันไม่ให้เวลาระบบจริง ณ วันที่รันเทสไปชน deadline สมมติ
    result = cli.run_backfill_visit(grid, [old, new], out, now=now, deadline=deadline, clock=lambda: now)
    assert result.scenes_processed == 2 and result.scenes_skipped == 0
    assert not result.stopped_at_deadline and result.errors == []
    assert [e["sceneId"] for e in result.entries] == ["20240912T112331-AS020M", "20240901T112331-AS020M"]
    assert result.last_visited == ("20240901T112331-AS020M", "2024-09-01T11:23:31Z")


def test_run_backfill_visit_skips_scene_already_in_index(tmp_path):
    work, aoi = _province(tmp_path)
    grid = load_province_grid("57", work, aoi)
    out = tmp_path / "out"
    known = _item("ENSEMBLE_FLOOD_20240901T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "known", True), "2024-09-01T15:00:00Z")
    fresh = _item("ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "fresh", True), "2024-09-12T15:00:00Z")
    ipath = cli.index_path(out, "57")
    ipath.parent.mkdir(parents=True)
    ipath.write_text(json.dumps({"provinceCode": "57", "scenes": [
        {"sceneId": "20240901T112331-AS020M", "observedAt": "2024-09-01T11:23:31Z"},
    ]}))
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    result = cli.run_backfill_visit(grid, [known, fresh], out, now=now, deadline=now + timedelta(hours=10),
                                     clock=lambda: now)
    assert result.scenes_processed == 1 and result.scenes_skipped == 1
    assert [e["sceneId"] for e in result.entries] == ["20240912T112331-AS020M"]
    assert not (out / "aoi/57/flood/20240901T112331-AS020M").exists()


def test_run_backfill_visit_stops_before_next_scene_when_deadline_close(tmp_path):
    """ประมวลผลฉากใหม่สุดแล้วหยุดก่อนฉากถัดไป — last_visited ชี้ที่ฉากที่ทำไปแล้วเท่านั้น"""
    work, aoi = _province(tmp_path)
    grid = load_province_grid("57", work, aoi)
    out = tmp_path / "out"
    newest = _item("ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "newest", True), "2024-09-12T15:00:00Z")
    older = _item("ENSEMBLE_FLOOD_20240906T112331_VV_AS020M_E048N020T3", _assets(tmp_path, "older", True), "2024-09-06T15:00:00Z")
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    deadline = base + timedelta(seconds=250)
    # scene1 (ใหม่สุด): check เริ่มด้วย p95 ปริยาย 60 วิ → base+180 <= deadline → ประมวลผล ใช้เวลา 200 วิ
    # scene2: check ถัดมาใช้ p95([200])=200 → base+210+600=base+810 > deadline → หยุด ไม่แตะ scene2
    clock = _Clock([base, base + timedelta(seconds=10), base + timedelta(seconds=210), base + timedelta(seconds=210)])
    result = cli.run_backfill_visit(grid, [newest, older], out, now=base, deadline=deadline, clock=clock)
    assert result.scenes_processed == 1 and result.scenes_skipped == 0
    assert result.stopped_at_deadline is True
    assert result.last_visited == ("20240912T112331-AS020M", "2024-09-12T11:23:31Z")
    assert [e["sceneId"] for e in result.entries] == ["20240912T112331-AS020M"]
    assert not (out / "aoi/57/flood/20240906T112331-AS020M").exists()


# ---------------------------------------------------------------------------
# backfill --deadline --cursor-out — exit codes ผ่าน `python -m gfm`
# ---------------------------------------------------------------------------


def test_backfill_deadline_window_finished_exit0_nexto_null(tmp_path, monkeypatch):
    work, aoi = _province(tmp_path)
    out = tmp_path / "out"
    wet = _item("ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "wet", True), "2024-09-12T15:00:00Z")
    monkeypatch.setattr(cli, "search_items", lambda *a, **kw: [wet])
    cursor = _cursor_path(tmp_path)
    rc = cli.main([
        "--work-dir", str(work), "--aoi-root", str(aoi), "backfill",
        "--province", "57", "--from", "2015-01-01T00:00:00Z", "--to", "2024-12-31T00:00:00Z",
        "--deadline", "2030-01-01T00:00:00Z", "--cursor-out", str(cursor), "--out", str(out),
    ])
    assert rc == 0
    c = json.loads(cursor.read_text())
    assert c == {"code": "57", "nextTo": None, "done": True, "scenesProcessed": 1, "scenesSkipped": 0,
                 "searchCount": 1, "lastError": None}
    idx = json.loads((out / "aoi/57/flood/index.json").read_text())
    assert [s["sceneId"] for s in idx["scenes"]] == ["20240912T112331-AS020M"]


def test_backfill_deadline_empty_window_exit0_done_no_error(tmp_path, monkeypatch):
    """ค้นแล้วไม่มี item เลยในหน้าต่าง (ไม่ใช่ "ถามไม่ได้") — ต้องยังคืน 0/done: true, lastError: None
    เหมือนเดิม ไม่ใช่ regression ของการแก้ blocker A (ซึ่งกันเฉพาะ "มี error แต่ไม่มี entry สำเร็จ")
    """
    work, aoi = _province(tmp_path)
    out = tmp_path / "out"
    monkeypatch.setattr(cli, "search_items", lambda *a, **kw: [])
    cursor = _cursor_path(tmp_path)
    rc = cli.main([
        "--work-dir", str(work), "--aoi-root", str(aoi), "backfill",
        "--province", "57", "--from", "2015-01-01T00:00:00Z", "--to", "2024-12-31T00:00:00Z",
        "--deadline", "2030-01-01T00:00:00Z", "--cursor-out", str(cursor), "--out", str(out),
    ])
    assert rc == 0
    c = json.loads(cursor.read_text())
    assert c == {"code": "57", "nextTo": None, "done": True, "scenesProcessed": 0, "scenesSkipped": 0,
                 "searchCount": 1, "lastError": None}
    assert not (out / "aoi/57/flood/index.json").exists()


def test_backfill_deadline_stop_writes_cursor_before_last_processed_scene_exit3(tmp_path, monkeypatch):
    work, aoi = _province(tmp_path)
    out = tmp_path / "out"
    monkeypatch.setattr(cli, "search_items", lambda *a, **kw: [])  # unimportant — run_backfill_visit ถูก stub
    entry = {
        "sceneId": "20240912T112331-AS020M", "observedAt": "2024-09-12T11:23:31Z", "publishedAt": None,
        "orbit": None, "floodedCells": 1, "excludedCells": 0, "observedCells": 10, "floodedAreaKm2": 0.01,
        "maxDepthCm": 5, "medianDepthCm": 5, "depthEstimatedFraction": 1.0, "gfmItemIds": ["x"],
    }
    stub = cli.BackfillVisitResult(
        entries=[entry], scenes_processed=1, scenes_skipped=0, stopped_at_deadline=True,
        last_visited=("20240912T112331-AS020M", "2024-09-12T11:23:31Z"), errors=[],
    )
    monkeypatch.setattr(cli, "run_backfill_visit", lambda *a, **kw: stub)
    cursor = _cursor_path(tmp_path)
    rc = cli.main([
        "--work-dir", str(work), "--aoi-root", str(aoi), "backfill",
        "--province", "57", "--from", "2015-01-01T00:00:00Z", "--to", "2024-12-31T00:00:00Z",
        "--deadline", "2026-01-01T00:04:10Z", "--cursor-out", str(cursor), "--out", str(out),
    ])
    assert rc == 3
    c = json.loads(cursor.read_text())
    # nextTo = observedAt ของฉากสุดท้ายที่ทำไปแล้ว ลบ 1 วิ — ทำให้รอบหน้าไม่ประมวลผลฉากนี้ซ้ำ
    assert c == {"code": "57", "nextTo": "2024-09-12T11:23:30Z", "done": False, "scenesProcessed": 1,
                 "scenesSkipped": 0, "searchCount": 1, "lastError": None}
    idx = json.loads((out / "aoi/57/flood/index.json").read_text())
    assert [s["sceneId"] for s in idx["scenes"]] == ["20240912T112331-AS020M"]


def test_backfill_deadline_stop_before_any_scene_keeps_window_to(tmp_path, monkeypatch):
    """หยุดก่อนแตะฉากไหนเลย (เช่น หมดเวลาระหว่างโหลดอินพุต) → nextTo = --to เดิม ไม่ใช่ null"""
    work, aoi = _province(tmp_path)
    out = tmp_path / "out"
    monkeypatch.setattr(cli, "search_items", lambda *a, **kw: [])
    stub = cli.BackfillVisitResult(entries=[], scenes_processed=0, scenes_skipped=0,
                                    stopped_at_deadline=True, last_visited=None, errors=[])
    monkeypatch.setattr(cli, "run_backfill_visit", lambda *a, **kw: stub)
    cursor = _cursor_path(tmp_path)
    rc = cli.main([
        "--work-dir", str(work), "--aoi-root", str(aoi), "backfill",
        "--province", "57", "--from", "2015-01-01T00:00:00Z", "--to", "2024-12-31T00:00:00Z",
        "--deadline", "2026-01-01T00:00:01Z", "--cursor-out", str(cursor), "--out", str(out),
    ])
    assert rc == 3
    c = json.loads(cursor.read_text())
    assert c["nextTo"] == "2024-12-31T00:00:00Z"  # = --to เดิม ไม่ใช่ null


def test_backfill_deadline_index_overflow_exit1_and_index_unchanged(tmp_path, monkeypatch):
    from gfm import contract as C

    work, aoi = _province(tmp_path)
    out = tmp_path / "out"
    wet = _item("ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "wet", True), "2024-09-12T15:00:00Z")
    monkeypatch.setattr(cli, "search_items", lambda *a, **kw: [wet])
    # เติม index เดิมให้เต็มเพดานพอดี ก่อนที่ฉากใหม่หนึ่งฉากจะดันให้เกิน
    existing_scenes = [
        {"sceneId": f"2020{i:04d}T000000-AS020M", "observedAt": f"2020-01-01T00:{i % 60:02d}:{i // 60:02d}Z"}
        for i in range(C.INDEX_MAX_SCENES)
    ]
    ipath = cli.index_path(out, "57")
    ipath.parent.mkdir(parents=True)
    ipath.write_text(json.dumps({"provinceCode": "57", "scenes": existing_scenes}))
    before = ipath.read_bytes()
    cursor = _cursor_path(tmp_path)
    rc = cli.main([
        "--work-dir", str(work), "--aoi-root", str(aoi), "backfill",
        "--province", "57", "--from", "2015-01-01T00:00:00Z", "--to", "2024-12-31T00:00:00Z",
        "--deadline", "2030-01-01T00:00:00Z", "--cursor-out", str(cursor), "--out", str(out),
    ])
    assert rc == 1
    c = json.loads(cursor.read_text())
    assert c["code"] == "57" and c["done"] is False and c["scenesProcessed"] == 1
    assert c["lastError"] is not None and "1501" in c["lastError"]
    assert ipath.read_bytes() == before  # ไม่เขียนทับ — ฉากที่คำนวณแล้วยังอยู่บนดิสก์แต่ไม่มี index ชี้


def test_backfill_deadline_requires_single_province_from_to(tmp_path):
    work, aoi = _province(tmp_path)
    cursor = _cursor_path(tmp_path)
    rc = cli.main([
        "--work-dir", str(work), "--aoi-root", str(aoi), "backfill",
        "--province", "57", "--province", "58", "--from", "2015-01-01T00:00:00Z", "--to", "2024-12-31T00:00:00Z",
        "--deadline", "2030-01-01T00:00:00Z", "--cursor-out", str(cursor), "--out", str(tmp_path / "out"),
    ])
    assert rc == 1
    assert json.loads(cursor.read_text())["lastError"] is not None


def test_backfill_deadline_without_cursor_out_is_a_usage_error(tmp_path, capsys):
    work, aoi = _province(tmp_path)
    rc = cli.main([
        "--work-dir", str(work), "--aoi-root", str(aoi), "backfill",
        "--province", "57", "--from", "2015-01-01T00:00:00Z", "--to", "2024-12-31T00:00:00Z",
        "--deadline", "2030-01-01T00:00:00Z", "--out", str(tmp_path / "out"),
    ])
    assert rc == 2
    assert "--cursor-out" in capsys.readouterr().err


def test_backfill_deadline_all_scenes_fail_exits_1_not_done(tmp_path, monkeypatch):
    """ทุกฉากในหน้าต่างประมวลผลไม่ผ่าน (เช่น asset เปิดไม่ได้) — ไม่มี entry ไหนสำเร็จ ต้องคืน 1 ไม่ใช่
    0/done: true (ซึ่งจะปิดจังหวัดว่า "เสร็จ" ทั้งที่ยังไม่มีอะไรถูกประมวลผลจริง)
    """
    work, aoi = _province(tmp_path)
    out = tmp_path / "out"
    bad1 = _item("ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "bad1", True, broken=True), "2024-09-12T15:00:00Z")
    bad2 = _item("ENSEMBLE_FLOOD_20240906T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "bad2", True, broken=True), "2024-09-06T15:00:00Z")
    monkeypatch.setattr(cli, "search_items", lambda *a, **kw: [bad1, bad2])
    cursor = _cursor_path(tmp_path)
    rc = cli.main([
        "--work-dir", str(work), "--aoi-root", str(aoi), "backfill",
        "--province", "57", "--from", "2015-01-01T00:00:00Z", "--to", "2024-12-31T00:00:00Z",
        "--deadline", "2030-01-01T00:00:00Z", "--cursor-out", str(cursor), "--out", str(out),
    ])
    assert rc == 1
    c = json.loads(cursor.read_text())
    assert c["code"] == "57" and c["done"] is False
    assert c["scenesProcessed"] == 2 and c["scenesSkipped"] == 0
    assert c["lastError"] is not None
    assert not (out / "aoi/57/flood/index.json").exists()
    # backfill-advance กับ rc=1 นี้ต้องไม่ปิดจังหวัดว่าเสร็จ — สร้าง state แยก aoi (คนละ tmp_path) เพื่อ
    # เลี่ยงชนโฟลเดอร์ aoi/57 ที่ _province() ข้างบนสร้างไว้แล้ว
    state_root = tmp_path / "state-check"
    aoi2 = _aoi_with_provinces(state_root, ["57"])
    state = state_root / "state.json"
    cli.main(["--aoi-root", str(aoi2), "backfill-plan", "--state", str(state), "--deadline", FAR_DEADLINE,
              "--live-start", LIVE_START])
    adv_rc = cli.main(["backfill-advance", "--state", str(state), "--cursor", str(cursor), "--rc", "1"])
    assert adv_rc == 0
    st = json.loads(state.read_text())
    assert st["provinces"]["57"]["done"] is False
    assert st["provinces"]["57"]["failures"] == 1
    assert st["provinces"]["57"]["failed"] is None  # ครั้งแรก — ยังไม่ถึงเกณฑ์ล้มติดกัน


def test_backfill_require_index_without_local_index_exits_1(tmp_path):
    """--require-index แต่ไม่มี index.json ในเครื่อง — ปฏิเสธเขียนทับของเดิมบน R2 (belt-and-braces)"""
    work, aoi = _province(tmp_path)
    cursor = _cursor_path(tmp_path)
    rc = cli.main([
        "--work-dir", str(work), "--aoi-root", str(aoi), "backfill",
        "--province", "57", "--from", "2015-01-01T00:00:00Z", "--to", "2024-12-31T00:00:00Z",
        "--deadline", "2030-01-01T00:00:00Z", "--cursor-out", str(cursor), "--out", str(tmp_path / "out"),
        "--require-index",
    ])
    assert rc == 1
    c = json.loads(cursor.read_text())
    assert c["code"] == "57" and c["done"] is False
    assert c["lastError"] is not None and "require-index" in c["lastError"]


def test_backfill_require_index_with_local_index_proceeds(tmp_path, monkeypatch):
    """--require-index กับ index.json ที่มีอยู่ในเครื่องแล้ว — visit ดำเนินต่อตามปกติ"""
    work, aoi = _province(tmp_path)
    out = tmp_path / "out"
    ipath = cli.index_path(out, "57")
    ipath.parent.mkdir(parents=True)
    ipath.write_text(json.dumps({"provinceCode": "57", "scenes": []}))
    wet = _item("ENSEMBLE_FLOOD_20240912T112331_VV_AS020M_E048N018T3", _assets(tmp_path, "wet", True), "2024-09-12T15:00:00Z")
    monkeypatch.setattr(cli, "search_items", lambda *a, **kw: [wet])
    cursor = _cursor_path(tmp_path)
    rc = cli.main([
        "--work-dir", str(work), "--aoi-root", str(aoi), "backfill",
        "--province", "57", "--from", "2015-01-01T00:00:00Z", "--to", "2024-12-31T00:00:00Z",
        "--deadline", "2030-01-01T00:00:00Z", "--cursor-out", str(cursor), "--out", str(out),
        "--require-index",
    ])
    assert rc == 0
    assert json.loads(cursor.read_text())["done"] is True


# ---------------------------------------------------------------------------
# backfill-plan / backfill-advance — state machine
# ---------------------------------------------------------------------------

LIVE_START = "2026-08-30T00:00:00Z"
FAR_DEADLINE = "2030-01-01T00:00:00Z"


def _aoi_with_provinces(tmp_path: Path, codes: list[str]) -> Path:
    aoi = tmp_path / "aoi"
    for i, code in enumerate(codes):
        _province(tmp_path, code, bbox=(99.0 + i, 19.0, 100.0 + i, 20.0), inputs=False)
    return aoi


def test_backfill_plan_builds_fresh_state_and_picks_first_province(tmp_path, capsys):
    aoi = _aoi_with_provinces(tmp_path, ["10", "57", "58"])
    state = tmp_path / "state.json"
    rc = cli.main(["--aoi-root", str(aoi), "backfill-plan", "--state", str(state), "--deadline", FAR_DEADLINE,
                   "--live-start", LIVE_START])
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert out == {"code": "10", "from": "2015-01-01T00:00:00Z", "to": LIVE_START}
    st = json.loads(state.read_text())
    assert st["version"] == 1 and st["floor"] == "2015-01-01T00:00:00Z" and st["order"] == ["10", "57", "58"]
    assert st["current"] is None
    assert st["provinces"]["10"] == {
        "to": LIVE_START, "done": False, "failed": None, "failures": 0, "lastError": None, "scenes": 0,
    }


def test_backfill_advance_rc3_moves_to_back_and_plan_resumes_current(tmp_path, capsys):
    aoi = _aoi_with_provinces(tmp_path, ["10", "57"])
    state = tmp_path / "state.json"
    cli.main(["--aoi-root", str(aoi), "backfill-plan", "--state", str(state), "--deadline", FAR_DEADLINE,
              "--live-start", LIVE_START])
    capsys.readouterr()
    cursor = tmp_path / "cursor.json"
    cursor.write_text(json.dumps({"code": "10", "nextTo": "2024-05-01T00:00:00Z", "done": False,
                                   "scenesProcessed": 3, "scenesSkipped": 1, "searchCount": 1, "lastError": None}))
    rc = cli.main(["backfill-advance", "--state", str(state), "--cursor", str(cursor), "--rc", "3"])
    assert rc == 0
    st = json.loads(state.read_text())
    assert st["provinces"]["10"] == {
        "to": "2024-05-01T00:00:00Z", "done": False, "failed": None, "failures": 0, "lastError": None, "scenes": 3,
    }
    assert st["current"] == "10"
    # plan รอบถัดไปต้อง resume "10" (current) ต่อ แม้มันยังเป็นตัวแรกใน order อยู่ก็ตาม
    rc = cli.main(["--aoi-root", str(aoi), "backfill-plan", "--state", str(state), "--deadline", FAR_DEADLINE,
                   "--live-start", LIVE_START])
    assert rc == 0
    plan = json.loads(capsys.readouterr().out)
    assert plan == {"code": "10", "from": "2015-01-01T00:00:00Z", "to": "2024-05-01T00:00:00Z"}


def test_backfill_advance_rc3_with_lasterror_does_not_wipe_failure_counter(tmp_path):
    """rc 3 ที่ cursor เองมี lastError (หยุดที่ deadline แต่มีฉากล้มปนอยู่ในหน้าต่างนั้น) ต้องไม่ล้าง
    failures/lastError ทิ้งเหมือนเป็น visit สะอาด — ไม่งั้นจังหวัดที่ล้มช้า ๆ ทุก visit (ชน deadline ก่อน
    เสมอ) จะไม่มีวันสะสมครบเกณฑ์ failed เลย — `to` ยังต้องขยับตาม nextTo ปกติ
    """
    aoi = _aoi_with_provinces(tmp_path, ["10"])
    state = tmp_path / "state.json"
    cli.main(["--aoi-root", str(aoi), "backfill-plan", "--state", str(state), "--deadline", FAR_DEADLINE,
              "--live-start", LIVE_START])
    cursor = tmp_path / "cursor.json"
    # ทำให้จังหวัดมี failures=1 อยู่ก่อนแล้ว (เหมือนล้มติดกันมาหนึ่งครั้ง)
    cursor.write_text(json.dumps({"code": "10", "nextTo": None, "scenesProcessed": 0, "scenesSkipped": 0,
                                   "searchCount": 1, "lastError": "10: boom 1"}))
    cli.main(["backfill-advance", "--state", str(state), "--cursor", str(cursor), "--rc", "1"])
    assert json.loads(state.read_text())["provinces"]["10"]["failures"] == 1
    # visit ถัดมาหยุดที่ deadline (rc 3) แต่ฉากบางฉากในหน้าต่างล้ม — cursor มี lastError
    cursor.write_text(json.dumps({"code": "10", "nextTo": "2024-05-01T00:00:00Z", "done": False,
                                   "scenesProcessed": 2, "scenesSkipped": 0, "searchCount": 1,
                                   "lastError": "10: boom 2"}))
    cli.main(["backfill-advance", "--state", str(state), "--cursor", str(cursor), "--rc", "3"])
    st = json.loads(state.read_text())
    assert st["provinces"]["10"]["to"] == "2024-05-01T00:00:00Z"  # หน้าต่างยังขยับตามปกติ
    assert st["provinces"]["10"]["failures"] == 1  # ไม่ถูกล้าง และไม่ถูกเพิ่ม (rc3 เดินหน้าต่อได้จริง)
    assert st["provinces"]["10"]["lastError"] == "10: boom 1"  # ค่าก่อนหน้าคงอยู่ ไม่ใช่ None และไม่ใช่ boom 2


def test_backfill_advance_rc3_with_null_nexto_keeps_previous_to(tmp_path):
    aoi = _aoi_with_provinces(tmp_path, ["10"])
    state = tmp_path / "state.json"
    cli.main(["--aoi-root", str(aoi), "backfill-plan", "--state", str(state), "--deadline", FAR_DEADLINE,
              "--live-start", LIVE_START])
    cursor = tmp_path / "cursor.json"
    cursor.write_text(json.dumps({"code": "10", "nextTo": None, "done": False, "scenesProcessed": 0,
                                   "scenesSkipped": 0, "searchCount": 1, "lastError": None}))
    rc = cli.main(["backfill-advance", "--state", str(state), "--cursor", str(cursor), "--rc", "3"])
    assert rc == 0
    st = json.loads(state.read_text())
    # to ต้องคงค่า live_start เดิม — ไม่ถูกเขียนทับเป็น null (จะทำให้รอบหน้า backfill --to None พัง)
    assert st["provinces"]["10"]["to"] == LIVE_START
    assert st["current"] == "10"


def test_backfill_advance_rc0_marks_done_and_plan_moves_to_next(tmp_path, capsys):
    aoi = _aoi_with_provinces(tmp_path, ["10", "57"])
    state = tmp_path / "state.json"
    cli.main(["--aoi-root", str(aoi), "backfill-plan", "--state", str(state), "--deadline", FAR_DEADLINE,
              "--live-start", LIVE_START])
    capsys.readouterr()
    cursor = tmp_path / "cursor.json"
    cursor.write_text(json.dumps({"code": "10", "nextTo": None, "done": True, "scenesProcessed": 5,
                                   "scenesSkipped": 0, "searchCount": 1, "lastError": None}))
    cli.main(["backfill-advance", "--state", str(state), "--cursor", str(cursor), "--rc", "0"])
    st = json.loads(state.read_text())
    assert st["provinces"]["10"]["done"] is True and st["provinces"]["10"]["scenes"] == 5
    assert st["current"] is None
    rc = cli.main(["--aoi-root", str(aoi), "backfill-plan", "--state", str(state), "--deadline", FAR_DEADLINE,
                   "--live-start", LIVE_START])
    assert rc == 0
    assert json.loads(capsys.readouterr().out)["code"] == "57"


def test_backfill_advance_rc1_marks_failed_after_3_consecutive_and_plan_skips_it(tmp_path, capsys):
    aoi = _aoi_with_provinces(tmp_path, ["10", "57", "90"])
    state = tmp_path / "state.json"
    cli.main(["--aoi-root", str(aoi), "backfill-plan", "--state", str(state), "--deadline", FAR_DEADLINE,
              "--live-start", LIVE_START])
    capsys.readouterr()
    # ทำ "10" ให้เสร็จก่อน แล้วให้ "57" ล้มติดกัน 3 ครั้ง (เกณฑ์ BACKFILL_MAX_CONSECUTIVE_FAILURES) เพื่อให้
    # plan ถัดไปต้องข้ามทั้งคู่ไปที่ "90" — ล้มไม่ถึงเกณฑ์ต้องไม่ถูกข้าม (ดูเทสต์ consecutive-failures ด้านล่าง)
    cursor = tmp_path / "cursor.json"
    cursor.write_text(json.dumps({"code": "10", "nextTo": None, "done": True, "scenesProcessed": 0,
                                   "scenesSkipped": 0, "searchCount": 1, "lastError": None}))
    cli.main(["backfill-advance", "--state", str(state), "--cursor", str(cursor), "--rc", "0"])
    for i in range(cli.BACKFILL_MAX_CONSECUTIVE_FAILURES):
        cursor.write_text(json.dumps({"code": "57", "nextTo": None, "scenesProcessed": 0, "scenesSkipped": 0,
                                       "searchCount": 1, "lastError": f"57: boom {i}"}))
        cli.main(["backfill-advance", "--state", str(state), "--cursor", str(cursor), "--rc", "1"])
    st = json.loads(state.read_text())
    assert st["provinces"]["57"]["failures"] == cli.BACKFILL_MAX_CONSECUTIVE_FAILURES
    assert st["provinces"]["57"]["failed"] == f"57: boom {cli.BACKFILL_MAX_CONSECUTIVE_FAILURES - 1}"
    assert st["current"] is None
    rc = cli.main(["--aoi-root", str(aoi), "backfill-plan", "--state", str(state), "--deadline", FAR_DEADLINE,
                   "--live-start", LIVE_START])
    assert rc == 0
    assert json.loads(capsys.readouterr().out)["code"] == "90"


def test_backfill_advance_rc1_below_threshold_is_not_failed_and_plan_still_offers_it(tmp_path, capsys):
    """ล้มติดกันไม่ถึงเกณฑ์ (1 หรือ 2 ครั้ง) — จังหวัดต้องยังไม่ถูกข้ามในแผนถัดไป"""
    aoi = _aoi_with_provinces(tmp_path, ["10"])
    state = tmp_path / "state.json"
    cli.main(["--aoi-root", str(aoi), "backfill-plan", "--state", str(state), "--deadline", FAR_DEADLINE,
              "--live-start", LIVE_START])
    capsys.readouterr()
    cursor = tmp_path / "cursor.json"
    for i in range(1, cli.BACKFILL_MAX_CONSECUTIVE_FAILURES):
        cursor.write_text(json.dumps({"code": "10", "nextTo": None, "scenesProcessed": 0, "scenesSkipped": 0,
                                       "searchCount": 1, "lastError": f"10: boom {i}"}))
        cli.main(["backfill-advance", "--state", str(state), "--cursor", str(cursor), "--rc", "1"])
        st = json.loads(state.read_text())
        assert st["provinces"]["10"]["failures"] == i
        assert st["provinces"]["10"]["failed"] is None
        assert st["provinces"]["10"]["lastError"] == f"10: boom {i}"
        rc = cli.main(["--aoi-root", str(aoi), "backfill-plan", "--state", str(state), "--deadline", FAR_DEADLINE,
                       "--live-start", LIVE_START])
        assert rc == 0
        assert json.loads(capsys.readouterr().out)["code"] == "10"


def test_backfill_advance_rc3_resets_failure_counter(tmp_path):
    """ล้มครั้งหนึ่งแล้วสำเร็จ (rc 3) ต้องล้าง failures/lastError กลับเป็น 0/None"""
    aoi = _aoi_with_provinces(tmp_path, ["10"])
    state = tmp_path / "state.json"
    cli.main(["--aoi-root", str(aoi), "backfill-plan", "--state", str(state), "--deadline", FAR_DEADLINE,
              "--live-start", LIVE_START])
    cursor = tmp_path / "cursor.json"
    cursor.write_text(json.dumps({"code": "10", "nextTo": None, "scenesProcessed": 0, "scenesSkipped": 0,
                                   "searchCount": 1, "lastError": "10: boom"}))
    cli.main(["backfill-advance", "--state", str(state), "--cursor", str(cursor), "--rc", "1"])
    st = json.loads(state.read_text())
    assert st["provinces"]["10"]["failures"] == 1
    cursor.write_text(json.dumps({"code": "10", "nextTo": "2024-05-01T00:00:00Z", "done": False,
                                   "scenesProcessed": 2, "scenesSkipped": 0, "searchCount": 1, "lastError": None}))
    cli.main(["backfill-advance", "--state", str(state), "--cursor", str(cursor), "--rc", "3"])
    st = json.loads(state.read_text())
    assert st["provinces"]["10"]["failures"] == 0
    assert st["provinces"]["10"]["lastError"] is None
    assert st["provinces"]["10"]["failed"] is None


def test_backfill_advance_rc0_with_cursor_lasterror_is_treated_as_failure_not_done(tmp_path):
    """rc=0 แต่ cursor.json มี lastError (ไม่ควรเกิดขึ้นจริงหลัง cli.py กันไว้แล้ว) — ต้องไม่ปิดจังหวัดว่า
    "เสร็จ" กันไว้สองชั้นที่ backfill-advance
    """
    aoi = _aoi_with_provinces(tmp_path, ["10"])
    state = tmp_path / "state.json"
    cli.main(["--aoi-root", str(aoi), "backfill-plan", "--state", str(state), "--deadline", FAR_DEADLINE,
              "--live-start", LIVE_START])
    cursor = tmp_path / "cursor.json"
    cursor.write_text(json.dumps({"code": "10", "nextTo": None, "done": True, "scenesProcessed": 1,
                                   "scenesSkipped": 0, "searchCount": 1, "lastError": "10: boom"}))
    rc = cli.main(["backfill-advance", "--state", str(state), "--cursor", str(cursor), "--rc", "0"])
    assert rc == 0
    st = json.loads(state.read_text())
    assert st["provinces"]["10"]["done"] is False
    assert st["provinces"]["10"]["failures"] == 1
    assert st["provinces"]["10"]["lastError"] == "10: boom"
    assert st["provinces"]["10"]["failed"] is None  # ครั้งแรก — ยังไม่ถึงเกณฑ์ล้มติดกัน


def test_backfill_plan_all_done_returns_done_true(tmp_path, capsys):
    aoi = _aoi_with_provinces(tmp_path, ["10"])
    state = tmp_path / "state.json"
    cli.main(["--aoi-root", str(aoi), "backfill-plan", "--state", str(state), "--deadline", FAR_DEADLINE,
              "--live-start", LIVE_START])
    capsys.readouterr()
    cursor = tmp_path / "cursor.json"
    cursor.write_text(json.dumps({"code": "10", "nextTo": None, "done": True, "scenesProcessed": 1,
                                   "scenesSkipped": 0, "searchCount": 1, "lastError": None}))
    cli.main(["backfill-advance", "--state", str(state), "--cursor", str(cursor), "--rc", "0"])
    rc = cli.main(["--aoi-root", str(aoi), "backfill-plan", "--state", str(state), "--deadline", FAR_DEADLINE,
                   "--live-start", LIVE_START])
    assert rc == 0
    assert json.loads(capsys.readouterr().out) == {"done": True}


def test_backfill_plan_deadline_margin_returns_done_with_reason(tmp_path, capsys):
    aoi = _aoi_with_provinces(tmp_path, ["10"])
    state = tmp_path / "state.json"
    now = datetime.now(timezone.utc)
    close_deadline = (now + timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%SZ")  # < 20 นาที
    rc = cli.main(["--aoi-root", str(aoi), "backfill-plan", "--state", str(state), "--deadline", close_deadline,
                   "--live-start", LIVE_START])
    assert rc == 0
    assert json.loads(capsys.readouterr().out) == {"done": True, "reason": "deadline"}
    # state ยังถูกสร้าง/เขียนแม้ visit นี้จะไม่เกิดขึ้นจริง
    assert state.exists()


def test_backfill_advance_missing_state_or_cursor_is_a_usage_error(tmp_path, capsys):
    state = tmp_path / "state.json"
    cursor = tmp_path / "cursor.json"
    rc = cli.main(["backfill-advance", "--state", str(state), "--cursor", str(cursor), "--rc", "0"])
    assert rc == 2
    assert "state" in capsys.readouterr().err
