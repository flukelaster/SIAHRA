#!/usr/bin/env bash
# ตรวจว่า tile ของทุกจังหวัดขึ้น R2 แล้วจริงไหม โดยยิง HEAD ผ่าน Worker (path เดียวกับที่ client ใช้)
#
#   scripts/verify-tiles.sh                     # ทุกจังหวัด, 4 ชนิด × (z ตื้นสุด + z ลึกสุด)
#   scripts/verify-tiles.sh 11 12               # เฉพาะบางจังหวัด
#   HOST=http://localhost:5173 scripts/verify-tiles.sh
#   SAMPLE=20 scripts/verify-tiles.sh 10        # สุ่มเพิ่มอีก N ไฟล์ต่อจังหวัด
#   VERSIONED=0 scripts/verify-tiles.sh         # ตรวจเฉพาะ prefix เดิม
#   VERSION=2026-08-21 scripts/verify-tiles.sh  # บังคับรุ่นเดียวกันทุกจังหวัด (แทนค่าจาก manifest)
#
# ตั้งแต่ E9.2 มี prefix สองแบบและต้อง **ตอบ 200 ทั้งคู่**:
#   /aoi/{code}/{layer}/{z}/{x}_{y}.bin              ของเดิม — ห้ามหาย ห้ามลบ (docs/dataset.md §7)
#   /aoi/{code}/v/{ver}/{layer}/{z}/{x}_{y}.bin      รุ่นที่ manifest ของจังหวัดนั้นชี้อยู่
# รุ่นอ่านจาก apps/web/public/aoi/{code}/manifest.json (.provenance.datasetVersion) ด้วย jq
# — ไม่มี jq หรือ manifest ไม่ประกาศรุ่น จะพิมพ์บรรทัด NO_VERSION ออกมา ไม่ข้ามแบบเงียบ ๆ
#
# ใช้ HEAD + `curl -k` เพราะเครื่องที่ deploy อยู่หลัง TLS-inspecting filter — GET body จะถูก
# แทนด้วยหน้า 403 ของ filter (ดู docs/deploy.md §6) ส่วน status ของ HEAD ยังเชื่อถือได้
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TILES="$ROOT/apps/etl/data/tiles"
AOI_ROOT="$ROOT/apps/web/public/aoi"
HOST="${HOST:-https://siahra-radar.co}"
SAMPLE="${SAMPLE:-0}"
VERSIONED="${VERSIONED:-1}"
VERSION="${VERSION:-}"

[ -d "$TILES" ] || { echo "ไม่พบ $TILES" >&2; exit 1; }

if [ "$VERSIONED" = "1" ] && [ -z "$VERSION" ] && ! command -v jq >/dev/null; then
  echo "NO_VERSION ทุกจังหวัด: ไม่มี jq จึงอ่าน provenance.datasetVersion ไม่ได้ — ตรวจเฉพาะ prefix เดิม (brew install jq)" >&2
  VERSIONED=0
fi

if [ $# -gt 0 ]; then provinces=("$@"); else provinces=($(ls "$TILES" | sort)); fi

# รุ่นของจังหวัดหนึ่ง ๆ ตามที่ manifest ของมันประกาศ (ว่าง = ไม่รู้)
version_of() {
  [ -n "$VERSION" ] && { echo "$VERSION"; return; }
  jq -r '.provenance.datasetVersion // empty' "$AOI_ROOT/$1/manifest.json" 2>/dev/null
}

# สร้างรายการ key ที่จะตรวจ: ต่อจังหวัด ต่อชนิด เอา z ตื้นสุดกับ z ลึกสุดอย่างละไฟล์
# (ถ้าตรวจแค่ z0 การ sync ที่หลุดชั้นลึกจะผ่านหมด)
keys=$(
  for p in "${provinces[@]}"; do
    for k in terrain buildings features landcover; do
      d="$TILES/$p/$k"
      [ -d "$d" ] || { echo "MISSING_LOCAL $p/$k"; continue; }
      zs=$(ls "$d" | sort -n)
      for z in $(echo "$zs" | head -1) $(echo "$zs" | tail -1); do
        f=$(ls "$d/$z" | head -1)
        [ -n "$f" ] && echo "$p/$k/$z/$f"
      done
    done
    if [ "$SAMPLE" -gt 0 ]; then
      find "$TILES/$p" -name '*.bin' | sort | awk -v n="$SAMPLE" 'NR%int(1+NR/n)==0' | head -"$SAMPLE" |
        sed "s|^$TILES/||"
    fi
  done | sort -u
)

# แตก key เป็น path จริงที่จะยิง: ของเดิมเสมอ + แบบมีรุ่นเมื่อรู้รุ่นของจังหวัดนั้น
paths=$(
  for p in "${provinces[@]}"; do
    ver=""
    [ "$VERSIONED" = "1" ] && ver=$(version_of "$p")
    if [ "$VERSIONED" = "1" ] && [ -z "$ver" ]; then
      echo "NO_VERSION $p (manifest ไม่ประกาศ provenance.datasetVersion — ตรวจเฉพาะ prefix เดิม)" >&2
    fi
    echo "$keys" | grep -v MISSING_LOCAL | grep "^$p/" | while read -r key; do
      echo "/aoi/$key"
      [ -n "$ver" ] && echo "/aoi/${key%%/*}/v/$ver/${key#*/}"
    done
  done
)

echo "ตรวจ $(echo "$paths" | grep -c .) path จาก ${#provinces[@]} จังหวัด ที่ $HOST"

results=$(
  echo "$paths" | grep . |
  xargs -P 12 -I{} sh -c 'printf "%s %s\n" "$(curl -sk -o /dev/null -w "%{http_code}" -I "'"$HOST"'{}")" "{}"'
)

echo "$keys" | grep MISSING_LOCAL || true
bad=$(echo "$results" | grep -v '^200 ' || true)
okn=$(echo "$results" | grep -c '^200 ' || true)

echo
echo "200: $okn (prefix เดิม $(echo "$results" | grep '^200 ' | grep -vc '/v/'), แบบมีรุ่น $(echo "$results" | grep '^200 ' | grep -c '/v/'))"
if [ -n "$bad" ]; then
  echo "ไม่ผ่าน:"
  echo "$bad"
  echo
  echo "จังหวัดที่ยังขาด: $(echo "$bad" | awk '{split($2,a,"/"); print a[3]}' | sort -u | tr '\n' ' ')"
  # แยกให้เห็นว่าพังฝั่งไหน: prefix เดิมพัง = ของเก่าหายไป (ร้ายแรงกว่า), แบบมีรุ่นพัง
  # = ยังไม่ได้ก๊อปขึ้น R2 หรือ Worker ที่ deploy อยู่ยังไม่รู้จัก /v/ (ต้องมี E9.2)
  echo "  prefix เดิมไม่ผ่าน $(echo "$bad" | grep -vc '/v/') · แบบมีรุ่นไม่ผ่าน $(echo "$bad" | grep -c '/v/')"
  exit 1
fi
echo "ครบทุก path ที่ตรวจ ✅"
