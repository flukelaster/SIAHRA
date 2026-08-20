#!/usr/bin/env bash
# อัป tile จาก apps/etl/data/tiles ขึ้น R2 bucket siahra-geodata ใต้ prefix aoi/
#
#   scripts/upload-tiles.sh                          # อัปทั้งหมดขึ้น prefix เดิม (append-only)
#   scripts/upload-tiles.sh 11 12 13                 # เฉพาะจังหวัดที่ระบุ
#   scripts/upload-tiles.sh --smoke                  # อัปไฟล์เดียว ใช้ทดสอบว่า TLS/คีย์ผ่าน
#
#   # prefix แบบมีรุ่น (E9.2) — /aoi/{code}/v/{ver}/{layer}/{z}/{x}_{y}.bin
#   scripts/upload-tiles.sh --version=2026-08-17 --copy --smoke   # ก๊อปไฟล์เดียวก่อน
#   scripts/upload-tiles.sh --version=2026-08-17 --copy           # ก๊อปทั้งหมด "ในฝั่ง R2"
#   scripts/upload-tiles.sh --version=2026-08-17 --copy 11 12     # เฉพาะบางจังหวัด
#   scripts/upload-tiles.sh --version=2026-08-17                  # อัปจากเครื่องนี้แทนการก๊อป
#
# `--version` รับทั้ง `--version=2026-08-17` และ `--version 2026-08-17` — แต่ "ส่งธงมา
# พร้อมค่าว่าง" (`--version=` หรือ `--version` ที่ไม่มีค่าตามมา) เป็น error เสมอ ไม่ใช่
# การถอยไปใช้ prefix เดิม: สคริปต์ที่เรียกด้วยตัวแปรจะได้ไม่อัปผิด prefix เงียบ ๆ
#
# `--copy` = server-side copy ภายใน bucket เดียวกัน (S3 CopyObject) ไบต์ไม่วิ่งผ่าน
# เครื่องนี้เลย จึงเป็นวิธีที่ถูกต้องสำหรับชุดที่อัปขึ้นไปแล้ว 5.17 GiB / 303k ไฟล์
# ต้องมี --version คู่กันเสมอ (ก๊อปไปไหนถ้าไม่มีรุ่น) — ก่อนก๊อปแต่ละชั้น สคริปต์เทียบ
# ไบต์ในเครื่องนี้ ($TILES) กับ prefix เดิมบน R2 ด้วย `rclone check` ก่อนเสมอ (ดู
# check_copy_source() ด้านล่าง): provenance ของ manifest คำนวณจากไบต์ในเครื่องนี้
# ไม่ใช่จากสิ่งที่ --copy ก๊อปจริง สองฝั่งต้องตรงกันไม่งั้น manifest จะบรรยายไบต์ที่
# client ไม่ได้รับจริง
#
# ต้องมี env สามตัว (ใส่ใน scripts/.env.r2 ได้ — gitignored):
#   CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
# ไม่ใช้ `rclone config` — ตั้ง remote ผ่าน env ล้วน คีย์จึงไม่ตกค้างใน ~/.config
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TILES="$ROOT/apps/etl/data/tiles"
BUCKET="siahra-geodata"
PREFIX="aoi"
LAYERS=(terrain buildings features landcover)

VERSION=""
# แยก "ไม่ได้ส่ง --version มาเลย" (= ตั้งใจอัปขึ้น prefix เดิม) ออกจาก "ส่งมาแต่ค่าว่าง"
# (= ตัวแปรของผู้เรียกไม่มีค่า) ให้ได้ ไม่งั้น `--version=$VER` ที่ $VER ว่าง จะกลาย
# เป็นการอัปขึ้น prefix เดิมเงียบ ๆ ทั้งที่ผู้เรียกตั้งใจปล่อยรุ่น — และของที่ขึ้นไปแล้ว
# ถูกเสิร์ฟด้วย immutable หนึ่งปี (E9.3 release-dataset.sh เรียกสคริปต์นี้ด้วยตัวแปร)
VERSION_GIVEN=0
MODE="local"   # local = อัปจาก $TILES, copy = ก๊อปจาก prefix เดิมในฝั่ง R2
SMOKE=0
provinces=()
while [ $# -gt 0 ]; do
  case "$1" in
    --version=*) VERSION="${1#--version=}"; VERSION_GIVEN=1 ;;
    --version)
      # ค่ารุ่นต้องเป็นอาร์กิวเมนต์ถัดไป "จริง ๆ" — ห้ามกลืนธงตัวถัดไปมาเป็นชื่อรุ่น
      # (`--version --copy` ต้องเป็น error ไม่ใช่รุ่นชื่อ "--copy") และห้ามเงียบเมื่อ
      # อยู่ท้ายบรรทัดคำสั่งโดยไม่มีค่าตามมา
      [ $# -ge 2 ] || { echo "--version ต้องตามด้วยค่ารุ่น เช่น --version 2026-08-17" >&2; exit 2; }
      case "$2" in
        -*) echo "--version ตามด้วย \"$2\" ซึ่งเป็นตัวเลือก ไม่ใช่ค่ารุ่น" >&2; exit 2 ;;
      esac
      shift; VERSION="$1"; VERSION_GIVEN=1 ;;
    --copy)      MODE="copy" ;;
    --smoke)     SMOKE=1 ;;
    -*)          echo "ไม่รู้จักตัวเลือก $1 (ดูหัวไฟล์)" >&2; exit 2 ;;
    *)           provinces+=("$1") ;;
  esac
  shift
done

# รูปแบบรุ่นต้องตรงกับ apps/web/worker/tilePath.ts และ apps/etl/src/datasetVersion.ts
# รุ่นที่ Worker ไม่รับ = ทั้ง prefix ยิงแล้ว 404 ทั้งที่ไบต์อยู่ครบใน R2
# ใช้ `[[ =~ ]]` ไม่ใช่ `grep -E`: grep ทำงานทีละ "บรรทัด" ค่าที่มี \n คั่นจึงผ่านได้
# (เช่น $'x\n2026-08-17') ขณะที่ RegExp ฝั่ง JS ทั้งสองตัวปฏิเสธ — ตัวตรวจสามตัว
# ต้องตัดสินเหมือนกันทุกค่า ไม่งั้นสคริปต์ปล่อยรุ่นที่ Worker จะตอบ 404 ขึ้นไป
# เกตเป็น VERSION_GIVEN ไม่ใช่ -n "$VERSION": ส่ง --version= มาแต่ค่าว่าง = ผิดพลาด
# ไม่ใช่ "โหมด prefix เดิม" — ตรวจตรงนี้ที่เดียว จุดใช้งานข้างล่างจึงถือได้ว่า
# VERSION ไม่ว่าง ⟺ ผู้ใช้ขอ prefix แบบมีรุ่น และค่านั้นผ่านรูปแบบแล้ว
VERSION_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$'
if [ "$VERSION_GIVEN" = "1" ] && ! [[ "$VERSION" =~ $VERSION_RE ]]; then
  echo "รุ่น \"$VERSION\" ผิดรูปแบบ — ต้องเป็น YYYY-MM-DD หรือ YYYY-MM-DD.N" >&2
  exit 2
fi
[ "$MODE" = "copy" ] && [ -z "$VERSION" ] && { echo "--copy ต้องมาคู่กับ --version=" >&2; exit 2; }

[ -f "$ROOT/scripts/.env.r2" ] && . "$ROOT/scripts/.env.r2"

command -v rclone >/dev/null || { echo "ไม่มี rclone — brew install rclone" >&2; exit 1; }
[ -d "$TILES" ] || { echo "ไม่พบ $TILES (dataset ไม่ได้ symlink?)" >&2; exit 1; }
for v in CLOUDFLARE_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
  [ -n "${!v:-}" ] || { echo "ต้องตั้ง \$$v (ดูหัวไฟล์)" >&2; exit 1; }
done

export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ENDPOINT="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_REGION=auto
# R2 ไม่รองรับ multipart ETag แบบ S3 → บอก rclone ให้ไม่พึ่ง ETag ของ multipart
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true

# tile ทุกไฟล์เป็น content-addressed โดยพฤตินัย (สร้างใหม่ = เปลี่ยน path) จึงแคชยาวได้
COMMON_BASE=(
  --transfers 32
  --checkers 32
  --checksum
  --retries 5
  --low-level-retries 20
  --header-upload "Cache-Control: public, max-age=31536000, immutable"
  --header-upload "Content-Type: application/octet-stream"
  --stats 60s
  --stats-one-line
  # stats ปกติออกที่ระดับ INFO ซึ่งถูกกลืนตอนรันแบบ non-tty (log level ปริยาย = NOTICE)
  --stats-log-level NOTICE
)
# แถบ progress เฉพาะตอนรันในเทอร์มินัลจริง — รัน background แล้ว log จะบวมเป็นสิบ MB
# (ต้องต่อเข้า COMMON_BASE **ก่อน** ประกอบ COMMON ไม่งั้นชุดหลังจะไม่มีธงนี้)
[ -t 1 ] && COMMON_BASE+=(--progress)

# ชุดสำหรับคำสั่งที่ทำงานกับ "ต้นไม้" (sync/copy ทั้งโฟลเดอร์) เท่านั้น
# กัน prefix แบบมีรุ่นถูกลบทิ้ง: `aoi/{code}/v/...` อยู่ "ข้างใน" prefix เดิม การ
# sync ต้นไม้ในเครื่อง (ซึ่งไม่มีโฟลเดอร์ v/) ขึ้นไปทับจึงมองว่ามันเป็นขยะและลบ
# ทั้งชุด — วัดมาแล้วด้วย rclone sync --dry-run: ไม่ใส่สองบรรทัดนี้ = 5.17 GiB หาย
# กฎ filter ของ rclone ที่ไม่ขึ้นต้นด้วย `/` จะแมตช์ที่ความลึกไหนก็ได้ ดังนั้น
# `v/**` ตัวเดียวพอทั้งตอน sync ที่รากและรายจังหวัด — วัดมาแล้ว: ใส่ `v/**`
# อย่างเดียวที่รากก็รอด ส่วน `*/v/**` อย่างเดียวรายจังหวัด **ไม่รอด**
# `*/v/**` จึงเป็นตัวซ้ำซ้อน ไม่ใช่คู่ของ `v/**` คนละความลึก — อย่าอ่านว่าเป็นคู่
# แล้วลบตัวใดตัวหนึ่งทิ้ง เพราะตัวที่ทำงานจริงคือ `v/**`
# วันนี้ทั้งสคริปต์ใช้ `copy` ล้วนแล้ว (ไม่ลบอะไรเลย) สองบรรทัดนี้จึงเป็นเข็มขัดเส้นที่สอง:
# ถ้าวันหนึ่งมีใครเปลี่ยนกลับไปเป็น `sync` ชุดรุ่นจะไม่ถูกลบทิ้งเงียบ ๆ
COMMON=("${COMMON_BASE[@]}" --exclude "v/**" --exclude "*/v/**")
# ห้ามส่ง COMMON (หรือ filter ใด ๆ) ให้ `copyto` ไฟล์เดียว — rclone ปฏิเสธทันที
# ("can't limit to single files when using filters", exit 1) ทุก backend การก๊อป
# ไฟล์เดียวไม่มีต้นไม้ปลายทางให้ตัดอยู่แล้ว จึงใช้ COMMON_BASE

# ปลายทางของจังหวัด (+ชั้น) หนึ่ง ๆ
dest() {  # $1=province [$2=layer]
  if [ -n "$VERSION" ]; then echo "r2:$BUCKET/$PREFIX/$1/v/$VERSION${2:+/$2}"
  else echo "r2:$BUCKET/$PREFIX/$1${2:+/$2}"; fi
}

# ตรวจผ่าน Worker ว่า URL ที่ client จะใช้จริงตอบ 200 (HEAD เท่านั้น — ดู verify-tiles.sh)
#
# **สถานะอย่างเดียวไม่พอ และเคยพลาดมาแล้ว**: asset layer ของ siahra-web ตั้ง
# `not_found_handling: "single-page-application"` ไว้ path ที่ Worker ไม่รับ (เช่น /v/{ver}
# บน Worker รุ่นก่อน E9.2) จึงได้ `200 text/html` = หน้า index.html ไม่ใช่ 404
# วัดจริงบน prod 2026-08-20: /aoi/11/v/2026-08-17/terrain/0/0_0.bin → 200 text/html
# ไทล์จริงเป็น application/octet-stream เสมอ (Worker ตั้งเองใน worker/index.ts) การเช็ค
# content-type จึงเป็นเส้นเดียวที่แยก "ไบต์ถึงจริง" ออกจาก "SPA shell ใต้ URL immutable 1 ปี"
probe() {  # $1 = path ใต้ https://siahra-radar.co
  local out code ctype
  out=$(curl -sk -m 20 -o /dev/null -w '%{http_code} %{content_type}' -I "https://siahra-radar.co$1" 2>/dev/null || true)
  code="${out%% *}"
  ctype=""
  case "$out" in *' '*) ctype="${out#* }" ;; esac
  ctype="${ctype%%;*}"   # ตัด `;charset=…` ออก
  echo "$1 -> ${code:-000} ${ctype:-ไม่มี content-type}"
  # ยิงไม่ออก/อ่านไม่ได้ ก็คือไม่ผ่าน — ห้ามนับเป็นผ่านเด็ดขาด (ของที่ตามมาคืออัป 5.6 GB)
  [ "$code" = "200" ] || return 1
  case "$ctype" in application/octet-stream) return 0 ;; esac
  echo "   200 แต่ content-type เป็น \"${ctype:-ไม่มี}\" ไม่ใช่ application/octet-stream" >&2
  echo "   = asset layer ตอบ index.html แทน ไม่ใช่ไทล์ — ถือว่าไม่ผ่าน" >&2
  return 1
}

# --copy = server-side R2-to-R2 copy: ไบต์ที่ขึ้นรุ่นใหม่คือไบต์ที่ **อยู่บน prefix เดิม
# ของ R2 อยู่แล้ว** ไม่ใช่ไบต์ในเครื่องนี้เลย แต่ provenance ของ manifest (E9.1,
# apps/etl/src/provenance.ts: `builtAt`/`checksums`) คำนวณจากไบต์ **ในเครื่องนี้**
# ($TILES) เสมอไม่ว่าจะปล่อยรุ่นด้วยโหมดไหน — ถ้าเครื่องนี้ build ใหม่หลังจากอัปครั้ง
# ล่าสุดขึ้น prefix เดิม (หรือใครอัปไบต์อื่นขึ้น prefix เดิมโดยไม่ผ่านสคริปต์นี้) สองฝั่ง
# จะไม่ตรงกัน: รุ่นใหม่จะได้ไบต์เก่าจาก R2 ขณะที่ manifest ที่ release-dataset.sh เขียน
# บรรยายไบต์ในเครื่องนี้ (ใหม่กว่า) — ผิดแบบที่ immutable หนึ่งปีทำให้แก้ไม่ได้ จึงต้อง
# เทียบไบต์สองฝั่งก่อนก๊อปทุกครั้ง (อ่านอย่างเดียว ไม่โอนไบต์จริง)
#
# `rclone check` (ไม่ใส่ --size-only) เทียบทั้งขนาดและ hash (MD5/SHA1) เป็นค่าเริ่มต้น
# เป็นสองทาง (ไม่ใส่ --one-way) โดยตั้งใจ: prefix เดิมเป็น append-only (อัปด้วย `copy`
# ไม่เคยลบ — ดูหมายเหตุเรื่อง `v/**` filter ด้านล่าง) ของค้างจากรุ่นก่อน ๆ ที่ไม่มีใน
# เครื่องนี้อีกแล้วก็ยังนับเป็นความไม่ตรงกันที่ต้องรู้ตัว ไม่ใช่แค่ไฟล์ที่เครื่องนี้มีแต่
# R2 ไม่มี — ก๊อปของค้างพวกนั้นเข้ารุ่นใหม่ก็เป็น "ไบต์ที่ client ได้รับแต่ manifest ไม่ได้
# บรรยาย (เพราะ builtAt มาจากไฟล์ในเครื่องนี้ซึ่งไม่มีไฟล์นั้น)" เหมือนกัน
#
# แต่ backend บางตัวไม่มี hash ให้เทียบสำหรับบางไฟล์ (เช่นไฟล์ที่เคยอัปแบบ multipart)
# แล้ว rclone จะถอยไปเทียบแค่ขนาดสำหรับไฟล์นั้นอย่างเงียบ ๆ — **ยังนับว่า "ตรงกัน" ใน
# ผลรวมและ exit 0** มีแค่บรรทัดสรุป "N hashes could not be checked" เป็นร่องรอย ต้องจับ
# กรณีนี้แยกต่างหาก ไม่งั้น gate นี้ผ่านได้โดยไม่ได้เทียบไบต์จริงสักไฟล์ (เหมือนที่ stage 4
# ของ release-dataset.sh ต้องนับ MISSING_LOCAL/versioned_ok แยก ไม่ใช่เชื่อ exit code เฉย ๆ)
# — จับด้วย `case`/wildcard ไม่ใช่ regex ที่ผูกกับถ้อยคำ/ตำแหน่งเป๊ะ ๆ: ถ้อยคำสรุปของ
# rclone เปลี่ยนแบบเล็กน้อยได้ระหว่างเวอร์ชัน "จับไม่เจอ = ปล่อยผ่านราวกับตรวจแล้ว" คือ
# ความล้มเหลวแบบเปิด (fail-open) ที่ gate นี้มีไว้กันโดยตรง จึงต้องจับให้กว้างและ fail-closed
#
# ผ่านได้เมื่อครบสี่เงื่อนไขเท่านั้น: exit=0, "0 differences found" (มาจาก exit=0 อยู่แล้ว
# แต่ยืนยันซ้ำ), จำนวนไฟล์ที่ตรง > 0 (กัน gate ที่ไม่ได้ตรวจอะไรเลย เช่นชี้โฟลเดอร์ว่าง),
# และไม่มีข้อความ "hashes could not be checked" เลย
#
# `--combined` แยกไฟล์ที่ต่างกันเป็นสามชนิด (ดู `rclone check --help`: `= / + / - / *`)
# ใช้จำแนกเพื่อบอกวิธีแก้ที่ถูกกับแต่ละชนิด แทนคำแนะนำเดียวที่ใช้ไม่ได้กับทุกกรณี:
#   `*` เนื้อหาต่างกัน / `+` มีแต่ในเครื่องนี้ → ทั้งสองแก้ด้วยการอัปจากเครื่องนี้ทับ
#   `-` มีแต่บน R2 (ของค้างจาก prefix append-only) → อัปซ้ำแก้ไม่ได้ (`upload-tiles.sh`
#   ไม่มี --version ใช้ `copy` ไม่ใช่ `sync` จึงไม่มีทางลบของค้างออกเอง) ต้องเก็บกวาดตาม
#   docs/dataset.md §7 หรือตรวจว่าทำไมเครื่องนี้ไม่มีไฟล์นั้น (dataset ไม่ครบ?)
check_copy_source() {  # $1=โฟลเดอร์ในเครื่องนี้ (source of truth ของ provenance) $2=path บน R2 (ไม่มี "r2:" นำหน้า)
  local local_dir="$1" r2_path="$2" out rc matched combined_file
  combined_file=$(mktemp -t siahra-copycheck)
  # `set -e` ที่หัวไฟล์จะทำให้ script ออกทันทีตรงบรรทัด assignment นี้ถ้าไม่ปิดไว้ก่อน
  # (rclone check คืนค่าไม่ใช่ศูนย์เมื่อเจอความต่าง ซึ่งเป็นผลลัพธ์ปกติที่ต้องอ่านค่าต่อ
  # ไม่ใช่ error ที่อยากให้ทั้งสคริปต์ตายเงียบ ๆ โดยไม่มีข้อความอธิบาย) — รูปแบบเดียวกับ
  # ที่ release-dataset.sh ใช้รอบ npm run refresh:manifests / verify-tiles.sh
  set +e
  out=$(rclone check "$local_dir" "r2:$r2_path" --checkers 32 --combined "$combined_file" 2>&1)
  rc=$?
  set -e
  matched=$(printf '%s\n' "$out" | sed -n 's/.* \([0-9][0-9]*\) matching files$/\1/p' | tail -1)
  if [ "$rc" != "0" ]; then
    printf '%s\n' "$out" >&2
    echo "--copy: ไม่ตรง — $local_dir กับ r2:$r2_path (ดู log ข้างบน)" >&2
    if grep -q '^\*' "$combined_file" 2>/dev/null; then
      echo "  มีไฟล์เนื้อหาต่างกัน — อัปไบต์ในเครื่องนี้ทับขึ้น prefix เดิมก่อน:" >&2
      echo "    scripts/upload-tiles.sh   # ไม่ใส่ --version = อัปขึ้น prefix เดิม (append-only)" >&2
    fi
    if grep -q '^+' "$combined_file" 2>/dev/null; then
      echo "  มีไฟล์ที่มีแต่ในเครื่องนี้ ไม่มีบน prefix เดิม (เครื่องนี้ build ใหม่แล้วยังไม่เคยอัป) — อัปให้ตรงกันก่อน:" >&2
      echo "    scripts/upload-tiles.sh   # ไม่ใส่ --version = อัปขึ้น prefix เดิม (append-only)" >&2
    fi
    if grep -q '^-' "$combined_file" 2>/dev/null; then
      echo "  มีไฟล์ค้างบน prefix เดิมที่ไม่มีในเครื่องนี้อีกแล้ว — อัปซ้ำแก้ไม่ได้ (append-only," >&2
      echo "  ไม่ลบของเก่า) ต้องเก็บกวาด prefix เดิมด้วยมือตามเงื่อนไขใน docs/dataset.md §7 ก่อน" >&2
      echo "  หรือตรวจว่าทำไมเครื่องนี้ถึงไม่มีไฟล์นั้น (dataset ในเครื่องนี้ไม่ครบ?)" >&2
    fi
    echo "หรือใช้ --build แทน --copy ถ้าตั้งใจปล่อยไบต์ชุดใหม่จริง ๆ" >&2
    rm -f "$combined_file"
    return 1
  fi
  rm -f "$combined_file"
  if [ -z "$matched" ] || [ "$matched" -le 0 ]; then
    printf '%s\n' "$out" >&2
    echo "--copy: rclone check ไม่ได้เทียบไฟล์ไหนเลย ($local_dir กับ r2:$r2_path) — gate นี้ไม่มีความหมาย หยุดก่อน" >&2
    return 1
  fi
  case "$out" in
    *"hashes could not be checked"*)
      printf '%s\n' "$out" >&2
      echo "--copy: rclone เทียบ hash ไม่ได้กับบางไฟล์ (ถอยไปเทียบแค่ขนาดอย่างเงียบ ๆ) ระหว่าง" >&2
      echo "  $local_dir กับ r2:$r2_path — เทียบแค่ขนาดไม่พอสำหรับ gate นี้ หยุดก่อน" >&2
      return 1
      ;;
  esac
  return 0
}

if [ "$SMOKE" = "1" ]; then
  # ไฟล์เล็กสุดที่หา ๆ ได้ ใช้พิสูจน์ว่า cert/คีย์/endpoint ใช้ได้ก่อนลงทุน 5.6 GB
  src="$TILES/11/terrain/0/0_0.bin"
  [ -f "$src" ] || src="$(find "$TILES" -name '*.bin' | head -1)"
  key="${src#"$TILES/"}"
  p="${key%%/*}"; rest="${key#*/}"
  if [ -z "$VERSION" ]; then
    echo "== smoke (prefix เดิม): $key =="
    rclone copyto "$src" "r2:$BUCKET/$PREFIX/$key" "${COMMON_BASE[@]}"
    probe "/aoi/$key" || { echo "ยังไม่ผ่าน (ดูบรรทัดบน) — อย่าเพิ่งอัปเต็มชุด" >&2; exit 1; }
  elif [ "$MODE" = "copy" ]; then
    echo "== smoke (server-side copy → v/$VERSION): $key =="
    rclone copyto "r2:$BUCKET/$PREFIX/$key" "r2:$BUCKET/$PREFIX/$p/v/$VERSION/$rest" "${COMMON_BASE[@]}"
    probe "/aoi/$p/v/$VERSION/$rest" || {
      echo "ยังไม่ผ่าน (ดูบรรทัดบน) — เช็คสองข้อก่อนก๊อปทั้งชุด: (1) siahra-web ที่ deploy อยู่มี worker/tilePath.ts" >&2
      echo "ของ E9.2 แล้วหรือยัง (รุ่นเก่าไม่รู้จัก /v/) (2) ไฟล์ต้นทาง $key มีอยู่จริงบน R2 ไหม" >&2
      exit 1
    }
  else
    echo "== smoke (อัปจากเครื่องนี้ → v/$VERSION): $key =="
    rclone copyto "$src" "r2:$BUCKET/$PREFIX/$p/v/$VERSION/$rest" "${COMMON_BASE[@]}"
    probe "/aoi/$p/v/$VERSION/$rest" || { echo "ยังไม่ผ่าน (ดูบรรทัดบน) — อย่าเพิ่งรันเต็ม" >&2; exit 1; }
  fi
  echo "== prefix เดิมต้องยังตอบ 200 อยู่ (ห้ามหาย — docs/dataset.md §7) =="
  probe "/aoi/$key" || { echo "prefix เดิมพัง — หยุดทันที" >&2; exit 1; }
  exit 0
fi

ALL=0
if [ ${#provinces[@]} -eq 0 ]; then
  ALL=1
  provinces=($(ls "$TILES" | sort))
fi
for p in "${provinces[@]}"; do
  [ -d "$TILES/$p" ] || { echo "ไม่มีจังหวัด $p ใน $TILES" >&2; exit 1; }
done

if [ -z "$VERSION" ]; then
  # prefix เดิมเป็น **append-only** เหมือนกัน: ใช้ `copy` ไม่ใช่ `sync` เพราะ
  # docs/dataset.md §7 บอกว่า aoi/{code}/{layer}/… ห้ามลบไม่มีกำหนด — tile ถูกส่งด้วย
  # immutable 1 ปี เบราว์เซอร์ที่เคยโหลด URL เดิมยังยิงซ้ำได้อีกเต็มปี การ `sync`
  # ต้นไม้ที่ rebuild แล้วขาดไทล์ไปหนึ่งใบ = ไทล์นั้นหายจาก R2 ทันที = รูกลางแผนที่
  # ของ client เก่า ซึ่งคือ "ข้อมูลหายเงียบ ๆ" ที่กฎความซื่อสัตย์ห้ามไว้
  # สิ่งที่แลกไป (ตั้งใจ ห้าม "แก้" กลับเป็น sync): ไทล์ที่ถูกลบในเครื่องจะไม่ถูกลบ
  # ตามบน R2 อีกแล้ว ของค้างสะสมเป็นค่า storage — ถ้าต้องเก็บกวาดจริง ๆ ให้ลบด้วยมือ
  # ตามเงื่อนไขใน §7 (เฉพาะรุ่นกลางที่ไม่มี manifest ชี้ และเก่ากว่า max-age เต็มปี)
  if [ "$ALL" = "1" ]; then
    echo "== อัปทั้งหมด ($(find "$TILES/" -type f | wc -l | tr -d ' ') ไฟล์) — ใช้เวลา 1–3 ชม. =="
    rclone copy "$TILES" "r2:$BUCKET/$PREFIX" "${COMMON[@]}"
  else
    for p in "${provinces[@]}"; do
      echo "== อัปจังหวัด $p → $(dest "$p") =="
      rclone copy "$TILES/$p" "$(dest "$p")" "${COMMON[@]}"
    done
  fi
else
  # prefix แบบมีรุ่นเป็น **append-only**: ใช้ `copy` ไม่ใช่ `sync` — ไฟล์ที่ปล่อยไป
  # แล้วถูกส่งด้วย immutable 1 ปี การลบทิ้งคือการทำให้ client ที่ยังถืออยู่พัง
  # และรุ่นเดิมต้อง "ไม่เปลี่ยนไบต์" อยู่แล้วตามกฎใน apps/etl/src/datasetVersion.ts
  for p in "${provinces[@]}"; do
    for layer in "${LAYERS[@]}"; do
      [ -d "$TILES/$p/$layer" ] || continue
      if [ "$MODE" = "copy" ]; then
        # ก๊อปทีละชั้น ไม่ใช่ทั้งจังหวัด: ปลายทาง aoi/$p/v/$VERSION อยู่ "ใต้" ต้นทาง
        # aoi/$p การสั่งทั้งจังหวัดจึงเป็นการก๊อปโฟลเดอร์เข้าไปในตัวเอง
        echo "== ตรวจก่อนก๊อป: $TILES/$p/$layer เทียบกับ prefix เดิม aoi/$p/$layer บน R2 =="
        check_copy_source "$TILES/$p/$layer" "$BUCKET/$PREFIX/$p/$layer" || exit 1
        echo "== copy (ในฝั่ง R2) $p/$layer → v/$VERSION =="
        rclone copy "r2:$BUCKET/$PREFIX/$p/$layer" "$(dest "$p" "$layer")" "${COMMON[@]}"
      else
        echo "== upload $p/$layer → v/$VERSION =="
        rclone copy "$TILES/$p/$layer" "$(dest "$p" "$layer")" "${COMMON[@]}"
      fi
    done
  done
fi

echo
if [ -n "$VERSION" ]; then
  echo "เสร็จแล้ว — ตรวจด้วย scripts/verify-tiles.sh (ตรวจทั้ง prefix เดิมและ v/$VERSION)"
  echo "อย่าลืม: manifest ต้องชี้รุ่นนี้ด้วย — npm run refresh:manifests -w apps/etl -- --dataset-version=$VERSION"
else
  echo "เสร็จแล้ว — ตรวจด้วย scripts/verify-tiles.sh"
fi
