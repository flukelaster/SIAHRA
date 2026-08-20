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
#
# **"200" อย่างเดียวไม่ใช่ผ่าน** — ต้องเป็น `200 application/octet-stream` เท่านั้น
# asset layer ของ siahra-web ตั้ง `not_found_handling: "single-page-application"` ไว้ path
# ที่ Worker ไม่รับจึงได้ `200 text/html` (= index.html) แทนที่จะเป็น 404 วัดจริงบน prod
# 2026-08-20: `/aoi/11/v/2026-08-17/terrain/0/0_0.bin` → `200 text/html` ขณะที่ไทล์จริงที่
# path เดิม → `200 application/octet-stream` การนับแค่ "^200 " จึงเคยทำให้ทั้งชุดที่ยังไม่ได้
# อัปเลย "ผ่าน" ครบทุก path — ซึ่งเป็นข้อผิดพลาดที่ปลดล็อกให้ manifest ไปชี้รุ่นที่ยังไม่มีไบต์
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

# ผลออกมาสามคอลัมน์เสมอ: `code ctype path` — ctype ตัด `;charset=…` ทิ้ง และเป็น "-" เมื่อ
# ยิงไม่ออก (curl พัง/TLS filter) ซึ่งต้องนับเป็น "ไม่ผ่าน" ไม่ใช่ข้ามเงียบ ๆ
#
# ส่ง path เป็น "อาร์กิวเมนต์" (-n 1) ไม่ใช่ -I{}: xargs ของ BSD เก็บสตริงแทนที่ของ -I ได้
# แค่ 255 ไบต์ (-S) พอตัวคำสั่งยาวขึ้นบวกกับ path แบบมีรุ่นที่ยาวกว่าเดิม 13 ตัวอักษร มันจะ
# ตาย "command line cannot be assembled, too long" — วัดมาแล้ว: path เดิม 8 อันรอด แบบมีรุ่นไม่รอด
# และผลคือ **ผ่านทั้งที่แทบไม่ได้ยิงอะไรเลย** (เหลือผลกลับมาอันเดียวจาก 16) ซึ่งเป็นความล้มเหลว
# ชนิดเดียวกับที่ทั้งไฟล์นี้มีไว้กัน — จำนวนผลจึงถูกนับเทียบกับจำนวน path ข้างล่างด้วย
export HOST
results=$(
  echo "$paths" | grep . |
  xargs -P 12 -n 1 sh -c '
    u=$1
    r=$(curl -sk -m 20 -o /dev/null -w "%{http_code} %{content_type}" -I "$HOST$u" 2>/dev/null)
    set -- $r
    c="${2:-}"; c="${c%%;*}"
    printf "%s %s %s\n" "${1:-000}" "${c:--}" "$u"
  ' _
)

echo "$keys" | grep MISSING_LOCAL || true

# ผลต้องกลับมาครบเท่าจำนวนที่ตั้งใจยิง — ขาดไปแม้อันเดียวแปลว่ามีอะไรตายกลางทาง
# (xargs/curl/เชลล์) และ "ตรวจไม่ครบ" ต้องไม่มีวันอ่านว่า ✅
want=$(echo "$paths" | grep -c . || true)
got=$(echo "$results" | grep -c . || true)
# ยิงศูนย์ path แล้วพิมพ์ ✅ คือคำโกหกที่แนบเนียนที่สุดของสคริปต์ตรวจสอบ:
# want==got==0 ผ่าน guard ข้างล่างได้สบาย ๆ เพราะ "ครบ" ตามตัวเลข ที่นี่จึงตัดจบก่อน
# (เกิดได้จริงเมื่อจังหวัดนั้นไม่มีโฟลเดอร์ layer เลย — จะเห็น MISSING_LOCAL ข้างบน)
if [ "$want" = "0" ]; then
  echo >&2
  echo "ไม่ได้ตรวจอะไรเลย: ไม่มี path ให้ยิงสักอัน — ไม่ผ่าน" >&2
  echo "(ดูบรรทัด MISSING_LOCAL ข้างบน: dataset ในเครื่องไม่มีชั้นที่จะตรวจ)" >&2
  exit 1
fi
if [ "$want" != "$got" ]; then
  echo
  echo "ยิงได้ไม่ครบ: ตั้งใจตรวจ $want path แต่มีผลกลับมา $got — ถือว่าไม่ผ่าน" >&2
  echo "(มีอะไรล้มกลางทาง เช่น xargs หรือ curl — ผลที่ไม่ครบสรุปไม่ได้ว่าไบต์ขึ้นครบ)" >&2
  exit 1
fi
# ผ่าน = 200 **และ** เป็นไบต์ไทล์จริง `200 text/html` คือ SPA shell ของ asset layer (ดูหัวไฟล์)
# ตรงตัวพิมพ์ ไม่ใช้ -i: `upload-tiles.sh` probe() และ worker_precondition ใน
# `release-dataset.sh` เทียบแบบตรงตัวพิมพ์ทั้งคู่ เอกสารก็เขียนว่าเป็นกฎเดียวกัน
# ทั้งสามจุด ถ้าที่นี่หลวมกว่า จะมี response ที่ตรงนี้บอกผ่านแต่อีกสองที่บอกไม่ผ่าน
OK_RE='^200 application/octet-stream '
bad=$(echo "$results" | grep -v "$OK_RE" || true)
okn=$(echo "$results" | grep -c "$OK_RE" || true)
ok_lines=$(echo "$results" | grep "$OK_RE" || true)

echo
echo "200: $okn (prefix เดิม $(echo "$ok_lines" | grep . | grep -vc '/v/'), แบบมีรุ่น $(echo "$ok_lines" | grep . | grep -c '/v/'))"
if [ -n "$bad" ]; then
  echo "ไม่ผ่าน:"
  echo "$bad"
  echo
  echo "จังหวัดที่ยังขาด: $(echo "$bad" | awk '{split($3,a,"/"); print a[3]}' | sort -u | tr '\n' ' ')"
  # แยกให้เห็นว่าพังฝั่งไหน: prefix เดิมพัง = ของเก่าหายไป (ร้ายแรงกว่า), แบบมีรุ่นพัง
  # = ยังไม่ได้ก๊อปขึ้น R2 หรือ Worker ที่ deploy อยู่ยังไม่รู้จัก /v/ (ต้องมี E9.2)
  echo "  prefix เดิมไม่ผ่าน $(echo "$bad" | grep -vc '/v/') · แบบมีรุ่นไม่ผ่าน $(echo "$bad" | grep -c '/v/')"
  shell_n=$(echo "$bad" | grep -c '^200 text/html ' || true)
  unread_n=$(echo "$bad" | grep -c '^000 ' || true)
  # สองกรณีนี้ต้องอธิบายเป็นคำ ไม่ใช่ปล่อยให้อ่านเป็น "404 ธรรมดา"
  [ "$shell_n" -gt 0 ] && echo "  ในนั้นมี $shell_n path ที่ตอบ 200 แต่เป็น text/html = index.html ของ asset layer
  ไม่ใช่ไทล์ — Worker ที่ deploy อยู่ไม่รับ path รูปนี้ (ต้อง deploy E9.2 ก่อน) หรือไบต์ยังไม่ขึ้น R2"
  [ "$unread_n" -gt 0 ] && echo "  และอีก $unread_n path ที่ยิงไม่ออกเลย (curl พัง/TLS filter) — อ่านไม่ได้ ≠ ผ่าน"
  exit 1
fi
echo "ครบทุก path ที่ตรวจ (200 + application/octet-stream) ✅"
