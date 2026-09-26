# Storm-track fixtures (`StormTrackDO`)

**All non-empty files here are real upstream responses, saved unmodified with `curl` on
2026-09-26 (~10:30 UTC).** Nothing in them was hand-edited. The two `*-empty.json` files
are the only synthetic ones: they are the documented "nothing active" shapes (`[]` for JMA,
an empty `FeatureCollection` for GDACS).

| File | URL |
|---|---|
| `jma-targetTc.json` | `https://www.jma.go.jp/bosai/typhoon/data/targetTc.json` |
| `jma-TC2632-specifications.json` | `https://www.jma.go.jp/bosai/typhoon/data/TC2632/specifications.json` |
| `jma-TC2632-forecast.json` | `https://www.jma.go.jp/bosai/typhoon/data/TC2632/forecast.json` |
| `gdacs-eventlist.json` | `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&alertlevel=green;orange;red&fromdate=2026-09-19&todate=2026-09-26` |
| `gdacs-geometry-1001326.json` | `https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=1001326&episodeid=6` |
| `jma-targetTc-empty.json` | synthetic: `[]` |
| `gdacs-eventlist-empty.json` | synthetic: `{"type":"FeatureCollection","features":[]}` |

On that day JMA had one active storm: TC2632, typhoon 2626 **Surigae**, south of Okinawa.
The GDACS list had eight TC events. One of them is in the North Indian Ocean: **ONE-26**,
event 1001326, episode 6, with its centroid at 83.7 °E, 18.1 °N. GDACS also lists
SURIGAE-26 at 126.8 °E. That event is JMA's storm and the ingest must drop it, because v1
never substitutes GDACS for JMA in the western North Pacific.

The following was observed while probing. The code depends on it.
- JMA numbers are **strings** (`"55"`, `"990"`, `"-"`). The past track in
  `forecast.json` is a list of `[lat, lon]` pairs with **no timestamps**.
- `specifications.json` reaches +117 h, not just +45 h. It carries the 70 % probability
  circle radius in km (`probabilityCircleRadius.km`).
- The GDACS list ignores `iscurrent=true` as a query parameter: it returns the same 100
  features with or without it. `iscurrent` and `istemporary` are the **strings**
  `"true"` and `"false"`. The ingest therefore bounds the list with `fromdate`/`todate`
  and filters on `iscurrent === "true"` itself.
- The event-list point is `Class: "Point_Centroid"`, which is a centroid and not the
  latest fix.
- GDACS geometry positions are `Point_Polygon_Point_N`, small circles whose
  `key` is `MMDDHHMM` and whose `polygonlabel` is `DD/MM HH:MM UTC`. **Neither carries a
  year.** `polygondate` is the synoptic time of the latest fix. Nothing in the list or in
  the geometry is an advisory *issue* time.
- ONE-26 is `iscurrent: "true"`, but its last fix is 2026-09-24 00 UTC, two days before
  the fixture was taken.
