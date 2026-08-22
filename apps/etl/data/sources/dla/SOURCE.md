# DLA local-authority coverage table

**File:** `re01_9112566tambon.csv` (13,346,057 bytes, sha256
`65a85868cdcc934d8345e567377bd69374a7822c30721d463faaa8091b088cae`)

**Dataset:** ชื่อและที่ตั้งองค์กรปกครองส่วนท้องถิ่น (Names and locations of Local
Administrative Organizations), dataset id `dlads_05_01`
**Publisher:** กรมส่งเสริมการปกครองท้องถิ่น (Department of Local Administration — DLA)
**Dataset page:** https://opendata.dla.go.th/en/dataset/dlads_05_01
**Resource downloaded:** https://opendata.dla.go.th/dataset/1a668c66-c6d6-4c94-bc0f-e57c81813eb8/resource/e9d61e15-d28f-467e-a018-98e0647ef2f4/download/re01_9112566tambon.csv
**License:** "Open Data Common" (as stated on the dataset page)
**Dataset page "last updated":** 2026-06-10 (2569-06-10 BE) — used as `publishedAt`
**Downloaded:** 2026-08-23 (this session, direct `curl`, HTTP 200, `text/csv`) — used as `fetchedAt`

## Shape

One row per (province, district, tambon) the อปท. covers — a coverage/jurisdiction
table, not a one-row-per-authority table. 82,641 rows, 7,849 distinct `รหัส อปท.`
(DLA org codes). Verified: for every code, `อปท.` (name), `ประเภท อปท.` (type) and
`จังหวัด` (province) are identical across all of that code's rows (0 conflicts across
7,849 codes) — the ETL dedupes to one record per code, keeping the first row.

Columns: `จังหวัด, อำเภอ, ตำบล, รหัส อปท., ประเภท อปท., อปท., ที่ตั้งสำนักงานเลขที่,
หมู่ที่, รหัสไปรษณีย์, ขนาดพื้นที่, LAT, LONG, เว็ปไซต์ของอปท`

Properly RFC 4180 quoted — some rows contain a literal `,` inside the website column
(e.g. `"www,tlpm.go.th"`) and escaped quotes (e.g. `"""-"""`), so this cannot be parsed
by naive `split(",")`.

`ประเภท อปท.` values found: `เทศบาลนคร` (30), `เทศบาลเมือง` (195), `เทศบาลตำบล` (2,247),
`อบต.` (5,300), `อบจ.` (76), `ท้องถิ่นรูปแบบพิเศษ` (1 — Pattaya City; area 208.1 km²
matches the publicly known figure).

`LAT`/`LONG`/`ขนาดพื้นที่` (area, km²) are present for roughly 65% of authorities
(4,875 / 7,849) and legitimately empty for the rest — the ETL must carry that through
as `null`, never a fallback value.

## What this dataset does **not** cover

**Bangkok (กรุงเทพมหานคร) is absent** — it is not a row-omission bug. The Bangkok
Metropolitan Administration is governed under its own act (not the Local
Administration Act that creates the หน่วยงาน this dataset lists), so DLA does not
administer it and it does not appear in DLA's own registry. 76 provinces are
covered, not 77; Bangkok has no `อปท.` row and must not be synthesized one.

No English names, no district codes (only district *names*, `อำเภอ`), no addresses
usable as a canonical ID.

## Reproduction

If this file needs to be refreshed, re-download the resource URL above, verify the
dataset page's "last updated" date has actually changed (rows may be republished
under the same date with no content change), and update the two timestamps in this
file and in `apps/etl/src/buildLocalAuthorities.ts`'s `SOURCE_*` constants together.
