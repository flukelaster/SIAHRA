# HII FEWS fixtures (`HiiForecastDO`, `ingestion/hiiFews.ts`)

**Real upstream files from `https://fews2.hii.or.th/model-output/data_portal/`, fetched with `curl`
on 2026-09-29 (~08:45 UTC, `Last-Modified: Tue, 29 Sep 2026 03:05:01 GMT`). Series files are
byte-for-byte as served (CRLF line ends, trailing space in the `value ` header).**

| File | URL |
|---|---|
| `forecast-C2.txt` | `rid_discharge/forecast/C2.txt` (337 rows, 2026-09-22 06:00 .. 2026-10-06 06:00, Thai local time) |
| `forecast-C13.txt` | `rid_discharge/forecast/C13.txt` |
| `forecast-CPY014.txt` | `hii_waterlevel/forecast/CPY014.txt` |
| `rid_discharge.csv` | `metadata/rid_discharge.csv` — **trimmed** to the header + `C2 C13 C3 C7A C35` + `N1` (an unrelated row the parser must ignore) |
| `hii_waterlevel.csv` | `metadata/hii_waterlevel.csv` — **trimmed** to the header + `CPY014` + `CPY011` |

Timezone evidence (why the parser reads `date,time` as +07:00): the observe file
`rid_discharge/observe/C2.txt` ends `2026-09-29,05:00:00` under the same `Last-Modified` 03:05:01 GMT —
read as UTC that observation would be newer than the file, so the clock is Thai local time; the
forecast file's 05:00 row (2030.99) matches the observe file's 05:00 (2031).
