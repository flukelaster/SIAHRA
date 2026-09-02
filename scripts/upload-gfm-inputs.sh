#!/usr/bin/env bash
# อัปอินพุตของ pipeline น้ำท่วม GFM (E14.F2, apps/etl/gfm) ขึ้น R2 bucket siahra-geodata ใต้ prefix etl/
#
#   scripts/upload-gfm-inputs.sh                 # ทุกจังหวัดที่มี p{code}-clipped30.tif ใน data/work
#   scripts/upload-gfm-inputs.sh 57 58           # เฉพาะจังหวัดที่ระบุ
#   scripts/upload-gfm-inputs.sh --dry-run 57    # แปลงเป็น COG ในเครื่องแล้วพิมพ์คำสั่ง rclone โดยไม่อัป
#
# ต่อจังหวัด: apps/etl/data/work/p{code}-clipped30.tif    → etl/{code}/dem30.tif        (Int16, DEFLATE+PREDICTOR=2)
#             apps/etl/data/work/p{code}-worldcover30.tif → etl/{code}/landcover30.tif  (uint8, DEFLATE)
# ทั้งคู่เป็น tiled COG ที่ GitHub Actions ของ F3 อ่านด้วย /vsicurl/ (range request) แทนการ
# ก๊อป dataset 5.6 GB ทั้งชุด — ไบต์เดียวกับที่ terrain.bin สร้างมา ความสูงขอบน้ำและพื้นจึงมา
# จากพื้นผิวเดียวกัน (docs/methodology/flood-depth.md)
#
# **เขียนเฉพาะใต้ `etl/{code}/` เท่านั้น** — devops constraint (a): ไม่มี `rclone sync` (ไม่ลบอะไร
# เลย) และไม่แตะรากของ bucket หรือ prefix `aoi/` ใช้ `rclone copy` จากโฟลเดอร์ scratch ที่มี
# แค่สองไฟล์ของจังหวัดนั้น ไปยัง prefix ของจังหวัดนั้น — `copy` แบบปริยาย (ไม่ใส่ --size-only /
# --ignore-times) ข้ามไฟล์ที่ขนาด **และ** hash ตรงกับบน R2 อยู่แล้ว การรันซ้ำจึงไม่อัปซ้ำ
# (ไม่มี Class A ops เพิ่มนอกจาก HEAD ของแต่ละไฟล์) แต่ COG ที่ gdal_translate สร้างใหม่มีไบต์
# เดิมทุกครั้งเมื่ออินพุตเดิม จึงเทียบ hash ได้จริง
#
# ต้องมี env สามตัว (ใส่ใน scripts/.env.r2 ได้ — gitignored) เหมือน upload-tiles.sh:
#   CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
# ไม่ใช้ `rclone config` — ตั้ง remote ผ่าน env ล้วน คีย์จึงไม่ตกค้างใน ~/.config
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/apps/etl/data/work"
BUCKET="siahra-geodata"
PREFIX="etl"

DRY=0
provinces=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    -*)        echo "ไม่รู้จักตัวเลือก $1 (ดูหัวไฟล์)" >&2; exit 2 ;;
    *)         provinces+=("$1") ;;
  esac
  shift
done

[ -f "$ROOT/scripts/.env.r2" ] && . "$ROOT/scripts/.env.r2"

command -v rclone >/dev/null || { echo "ไม่มี rclone — brew install rclone" >&2; exit 1; }
command -v gdal_translate >/dev/null || { echo "ไม่มี gdal_translate — brew install gdal" >&2; exit 1; }
[ -d "$WORK" ] || { echo "ไม่พบ $WORK (dataset ไม่ได้ symlink?)" >&2; exit 1; }
if [ "$DRY" = "0" ]; then
  for v in CLOUDFLARE_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
    [ -n "${!v:-}" ] || { echo "ต้องตั้ง \$$v (ดูหัวไฟล์)" >&2; exit 1; }
  done
fi

export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ENDPOINT="https://${CLOUDFLARE_ACCOUNT_ID:-unset}.r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-}"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-}"
export RCLONE_CONFIG_R2_REGION=auto
# R2 ไม่รองรับ multipart ETag แบบ S3 → บอก rclone ให้ไม่พึ่ง ETag ของ multipart
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true

# อินพุตของ ETL ไม่ได้เสิร์ฟให้เบราว์เซอร์ — ไม่ต้องแคชยาว; content-type ของ GeoTIFF
COMMON=(
  --transfers 4
  --checkers 4
  --retries 5
  --low-level-retries 20
  --header-upload "Content-Type: image/tiff"
  --stats 60s
  --stats-one-line
  --stats-log-level NOTICE
)
[ -t 1 ] && COMMON+=(--progress)

if [ ${#provinces[@]} -eq 0 ]; then
  provinces=($(ls "$WORK" | sed -n 's/^p\([0-9][0-9]*\)-clipped30\.tif$/\1/p' | sort))
fi
[ ${#provinces[@]} -gt 0 ] || { echo "ไม่พบ p{code}-clipped30.tif ใน $WORK" >&2; exit 1; }
for p in "${provinces[@]}"; do
  [ -f "$WORK/p$p-clipped30.tif" ] || { echo "ไม่มี $WORK/p$p-clipped30.tif" >&2; exit 1; }
  [ -f "$WORK/p$p-worldcover30.tif" ] || { echo "ไม่มี $WORK/p$p-worldcover30.tif" >&2; exit 1; }
done

SCRATCH="$(mktemp -d -t siahra-gfm-inputs)"
trap 'rm -rf "$SCRATCH"' EXIT

# COG แบบ tiled + DEFLATE: DEM เป็น Int16 ใช้ PREDICTOR=STANDARD (= predictor 2 ของ GTiff: ผลต่าง
# แนวนอน บีบภูมิประเทศได้ดีกว่ามาก), WorldCover เป็น uint8 คลาส ใช้ PREDICTOR=NO (คลาสไม่ต่อเนื่อง
# ผลต่างไม่ช่วย) — ไดรเวอร์ COG รับค่าเป็นคำ ไม่ใช่เลข 1/2 ของไดรเวอร์ GTiff
# ไม่สร้าง overview (ETL อ่านความละเอียดเต็มเสมอ; overview = ไบต์ที่ไม่มีใครอ่าน)
to_cog() {  # $1=src $2=dst $3=predictor (STANDARD|NO)
  gdal_translate -q -of COG \
    -co COMPRESS=DEFLATE -co PREDICTOR="$3" -co BLOCKSIZE=512 -co OVERVIEWS=NONE -co NUM_THREADS=ALL_CPUS \
    "$1" "$2"
}

for p in "${provinces[@]}"; do
  dir="$SCRATCH/$p"
  mkdir -p "$dir"
  echo "== $p: แปลงเป็น COG =="
  to_cog "$WORK/p$p-clipped30.tif"    "$dir/dem30.tif"       STANDARD
  to_cog "$WORK/p$p-worldcover30.tif" "$dir/landcover30.tif" NO
  ls -l "$dir" | sed 's/^/   /'
  dest="r2:$BUCKET/$PREFIX/$p"
  if [ "$DRY" = "1" ]; then
    echo "   [dry-run] rclone copy $dir $dest ${COMMON[*]}"
  else
    echo "== $p: rclone copy → $dest (ข้ามไฟล์ที่ขนาด+hash ตรงอยู่แล้ว) =="
    rclone copy "$dir" "$dest" "${COMMON[@]}"
  fi
  rm -rf "$dir"
done

echo
echo "เสร็จแล้ว — F3 อ่าน https://<r2>/etl/{code}/dem30.tif และ landcover30.tif ด้วย /vsicurl/"
