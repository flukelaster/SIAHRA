"""กฎการตั้งชื่อของ E10/E14: ไม่มีคำต้องห้ามในสตริงที่ pipeline ปล่อยออกมา และในซอร์สทั้งหมด"""

import json
import re
from pathlib import Path

import numpy as np

from gfm import contract as C
from gfm.encode import merge_index, scene_entry, scene_meta

from conftest import make_grid

FORBIDDEN = ["เสี่ยง", "พยากรณ์", "คาดการณ์", "โอกาส", "ความน่าจะเป็น",
             "risk", "forecast", "prediction", "probability", "chance"]
_RE = re.compile("|".join(re.escape(w) for w in FORBIDDEN), re.IGNORECASE)


def test_source_files_have_no_forbidden_words():
    src = Path(__file__).resolve().parents[1] / "gfm"
    for f in sorted(src.glob("*.py")):
        m = _RE.search(f.read_text(encoding="utf-8"))
        assert m is None, f"{f.name}: พบ {m.group(0)!r}"


def test_emitted_json_has_no_forbidden_words():
    g = make_grid(width=9, height=9)
    cls = np.full((3, 3), C.CLASS_FLOODED, np.uint8)
    depth = np.full((3, 3), 55, np.uint16)
    e = scene_entry("20240912T112331-AS020M", "2024-09-12T11:23:31Z", "2024-09-12T15:00:00Z", "descending", cls, depth, g, ["x"])
    idx = merge_index(None, g, [e], "2026-01-01T00:00:00Z")
    text = json.dumps(idx, ensure_ascii=False) + json.dumps(scene_meta(e, 100), ensure_ascii=False)
    assert _RE.search(text) is None
