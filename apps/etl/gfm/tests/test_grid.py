import numpy as np

from gfm.grid import check_alignment, overview_index

from conftest import make_grid


def test_check_alignment_fake_grid():
    g = make_grid(width=60, height=60, cell=30.0, ov_cell=90.0)
    rep = check_alignment(g)
    assert rep.ok
    assert rep.ul_easting_diff_m == 0.0 and rep.ul_northing_diff_m == 0.0
    assert rep.cells_per_overview_cell == 3.0
    assert "UL Δe=+0.000 m" in rep.describe()
    # 203 ม. ไม่ใช่พหุคูณของ 30 → ขอบล่าง/ขวาต่างได้ไม่เกินหนึ่งเซลล์ overview แต่ UL ยังต้องตรง
    g2 = make_grid(width=100, height=100, cell=30.0, ov_cell=203.0)
    rep2 = check_alignment(g2)
    assert rep2.ok and abs(rep2.right_edge_diff_m) < 203 and abs(rep2.bottom_edge_diff_m) < 203
    # UL เลื่อน 5 ม. = ไม่ผ่าน
    g3 = make_grid(ov_ul=(500_005.0, 2_200_000.0))
    assert not check_alignment(g3).ok


def test_overview_index_maps_centres_and_drops_outside():
    g = make_grid(width=9, height=9, cell=30.0, ov_cell=90.0)
    row_map, col_map = overview_index(g)
    assert row_map.tolist() == [0, 0, 0, 1, 1, 1, 2, 2, 2]
    assert col_map.tolist() == [0, 0, 0, 1, 1, 1, 2, 2, 2]
    # overview เล็กกว่า DEM: เซลล์ 30 ม. ที่ตกนอกได้ -1
    small = make_grid(width=9, height=9, cell=30.0, ov_cell=90.0)
    from dataclasses import replace

    ov = replace(small.overview, width=2, height=2, origin_northing=small.overview.top_northing - 180.0)
    small = replace(small, overview=ov)
    row_map, col_map = overview_index(small)
    assert row_map.tolist() == [0, 0, 0, 1, 1, 1, -1, -1, -1]
    assert np.all(col_map[6:] == -1)
