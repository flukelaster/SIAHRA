#!/usr/bin/env bash
# อัป tile จาก apps/etl/data/tiles ขึ้น R2 bucket siahra-geodata ใต้ prefix aoi/
#
#   scripts/upload-tiles.sh              # sync ทั้งหมด (ข้ามไฟล์ที่มีอยู่แล้ว)
#   scripts/upload-tiles.sh 11 12 13     # เฉพาะจังหวัดที่ระบุ
#   scripts/upload-tiles.sh --smoke      # อัปไฟล์เดียว ใช้ทดสอบว่า TLS/คีย์ผ่าน
#
# ต้องมี env สามตัว (ใส่ใน scripts/.env.r2 ได้ — gitignored):
#   CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
# ไม่ใช้ `rclone config` — ตั้ง remote ผ่าน env ล้วน คีย์จึงไม่ตกค้างใน ~/.config
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TILES="$ROOT/apps/etl/data/tiles"
BUCKET="siahra-geodata"
PREFIX="aoi"

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
COMMON=(
  --transfers 32
  --checkers 32
  --checksum
  --retries 5
  --low-level-retries 20
  --header-upload "Cache-Control: public, max-age=31536000, immutable"
  --header-upload "Content-Type: application/octet-stream"
  --stats 60s
  --stats-one-line
)
# แถบ progress เฉพาะตอนรันในเทอร์มินัลจริง — รัน background แล้ว log จะบวมเป็นสิบ MB
[ -t 1 ] && COMMON+=(--progress)

if [ "${1:-}" = "--smoke" ]; then
  # ไฟล์เล็กสุดที่หา ๆ ได้ ใช้พิสูจน์ว่า cert/คีย์/endpoint ใช้ได้ก่อนลงทุน 5.6 GB
  src="$TILES/11/terrain/0/0_0.bin"
  [ -f "$src" ] || src="$(find "$TILES" -name '*.bin' | head -1)"
  key="${src#"$TILES/"}"
  echo "== smoke: $key =="
  rclone copyto "$src" "r2:$BUCKET/$PREFIX/$key" "${COMMON[@]}"
  echo "== ตรวจบน prod =="
  code=$(curl -sk -o /dev/null -w '%{http_code}' -I "https://siahra-radar.co/aoi/$key")
  echo "/aoi/$key -> $code"
  [ "$code" = "200" ] || { echo "ยังไม่ 200 — อย่าเพิ่งรัน sync เต็ม" >&2; exit 1; }
  exit 0
fi

if [ $# -gt 0 ]; then
  for p in "$@"; do
    [ -d "$TILES/$p" ] || { echo "ไม่มีจังหวัด $p ใน $TILES" >&2; exit 1; }
    echo "== sync จังหวัด $p =="
    rclone sync "$TILES/$p" "r2:$BUCKET/$PREFIX/$p" "${COMMON[@]}"
  done
else
  echo "== sync ทั้งหมด ($(find "$TILES" -type f | wc -l | tr -d ' ') ไฟล์) — ใช้เวลา 1–3 ชม. =="
  rclone sync "$TILES" "r2:$BUCKET/$PREFIX" "${COMMON[@]}"
fi

echo
echo "เสร็จแล้ว — ตรวจด้วย scripts/verify-tiles.sh"
