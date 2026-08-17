#!/usr/bin/env bash
# ตรวจว่า tile ของทุกจังหวัดขึ้น R2 แล้วจริงไหม โดยยิง HEAD ผ่าน Worker (path เดียวกับที่ client ใช้)
#
#   scripts/verify-tiles.sh                     # ทุกจังหวัด, 4 ชนิด × (z ตื้นสุด + z ลึกสุด)
#   scripts/verify-tiles.sh 11 12               # เฉพาะบางจังหวัด
#   HOST=http://localhost:5173 scripts/verify-tiles.sh
#   SAMPLE=20 scripts/verify-tiles.sh 10        # สุ่มเพิ่มอีก N ไฟล์ต่อจังหวัด
#
# ใช้ HEAD + `curl -k` เพราะเครื่องที่ deploy อยู่หลัง TLS-inspecting filter — GET body จะถูก
# แทนด้วยหน้า 403 ของ filter (ดู docs/deploy.md §6) ส่วน status ของ HEAD ยังเชื่อถือได้
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TILES="$ROOT/apps/etl/data/tiles"
HOST="${HOST:-https://siahra-radar.co}"
SAMPLE="${SAMPLE:-0}"

[ -d "$TILES" ] || { echo "ไม่พบ $TILES" >&2; exit 1; }

if [ $# -gt 0 ]; then provinces=("$@"); else provinces=($(ls "$TILES" | sort)); fi

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

echo "ตรวจ $(echo "$keys" | grep -vc MISSING_LOCAL) key จาก ${#provinces[@]} จังหวัด ที่ $HOST"

results=$(
  echo "$keys" | grep -v MISSING_LOCAL |
  xargs -P 12 -I{} sh -c 'printf "%s %s\n" "$(curl -sk -o /dev/null -w "%{http_code}" -I "'"$HOST"'/aoi/{}")" "{}"'
)

echo "$keys" | grep MISSING_LOCAL || true
bad=$(echo "$results" | grep -v '^200 ' || true)
okn=$(echo "$results" | grep -c '^200 ' || true)

echo
echo "200: $okn"
if [ -n "$bad" ]; then
  echo "ไม่ผ่าน:"
  echo "$bad"
  echo
  echo "จังหวัดที่ยังขาด: $(echo "$bad" | awk '{split($2,a,"/"); print a[1]}' | sort -u | tr '\n' ' ')"
  exit 1
fi
echo "ครบทุก key ที่ตรวจ ✅"
