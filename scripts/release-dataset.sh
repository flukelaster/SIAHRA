#!/usr/bin/env bash
# ปล่อยชุดข้อมูล tile หนึ่งรุ่น (E9.3) — ลำดับตายตัว 5 ขั้น:
#
#   1 build → 2 checksum → 3 upload → 4 verify → 5 manifest diff
#
#   scripts/release-dataset.sh --version=2026-08-21 --dry-run   # พิมพ์ทุกขั้น ไม่แตะอะไรเลย
#   scripts/release-dataset.sh --version=2026-08-21 --copy      # ก๊อปไบต์ที่อยู่บน R2 แล้วเข้ารุ่นใหม่
#   scripts/release-dataset.sh --version=2026-08-21 --build     # build ใหม่ในเครื่องแล้วอัปขึ้นไป
#   scripts/release-dataset.sh --version=2026-08-21 11 12       # ปล่อยเฉพาะบางจังหวัด
#
# **ลำดับคือทั้งหมดของงานนี้ และทำผิดแล้วแก้ไม่ได้** ทุกไฟล์ใต้ prefix ของรุ่นถูกเสิร์ฟ
# ด้วย `Cache-Control: immutable, max-age=1y` ดังนั้น
#   - manifest ต้องชี้รุ่นใหม่ **หลัง** ไบต์ขึ้นไปครบและตรวจผ่านแล้วเท่านั้น ไม่งั้นทุก tile 404
#   - ชื่อรุ่นที่ปล่อยไปแล้ว **ห้ามใช้ซ้ำ** กับไบต์ชุดอื่นเด็ดขาด (client ที่แคชไว้จะได้ของเก่า
#     ต่อไปอีกหนึ่งปีโดยไม่มีทางแก้)
# สคริปต์นี้จึงบังคับลำดับแทนคน ไม่ใช่ปล่อยให้คนจำเอง — ขั้นที่ 5 เป็นด่านสุดท้ายที่คนดู
# ด้วยตา (git diff ของ manifest) ก่อน `npm run deploy:web` ซึ่งสคริปต์นี้ **ไม่ทำให้**
#
# ตัวเลือก:
#   --version=YYYY-MM-DD[.N]  รหัสรุ่น (บังคับ; ค่าว่าง = error ไม่ใช่ "โหมด prefix เดิม")
#   --copy                    ก๊อปฝั่ง R2 ล้วน (S3 CopyObject) จาก prefix เดิมเข้ารุ่นใหม่
#   --build                   รัน `npm run build:all -w apps/etl` เป็นขั้นที่ 1 (นานหลายชั่วโมง)
#   --dry-run                 พิมพ์ทุกคำสั่งโดยไม่รันอะไรเลย (ไม่มีทั้ง R2, manifest, deploy)
#   --env-file=PATH           ไฟล์คีย์ R2 (ปริยาย $ROOT/scripts/.env.r2, หรือ $SIAHRA_R2_ENV)
#   --sample=N                ส่งต่อเป็น SAMPLE=N ให้ verify-tiles.sh (สุ่มตรวจเพิ่มต่อจังหวัด)
#   [รหัสจังหวัด...]           จำกัดการอัป/ตรวจไว้เฉพาะจังหวัดที่ระบุ (ปริยาย = ทั้งหมด)
#
# `--copy` กับ `--build` ใช้ร่วมกันไม่ได้เด็ดขาด: `--copy` ก๊อป **ไบต์ที่อยู่บน R2 อยู่แล้ว**
# (prefix เดิม) เข้ารุ่นใหม่ ถ้าเพิ่ง build ใหม่ในเครื่อง ไบต์บน prefix เดิมยังเป็นของเก่า
# ผลคือรุ่นใหม่จะบรรจุไบต์ชุดเก่า ขณะที่ checksum ใน manifest บรรยายชุดใหม่ — ผิดแบบที่
# immutable หนึ่งปีทำให้แก้ไม่ได้ ซึ่งเป็นความผิดพลาดที่ E9.1/E9.2 มีไว้กันโดยตรง
#
# เอกสารฉบับเต็ม (ขั้นตอน เงื่อนไขก่อนเริ่ม และการถอย): docs/dataset-release.md
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TILES="$ROOT/apps/etl/data/tiles"
AOI_ROOT="$ROOT/apps/web/public/aoi"
HOST="${HOST:-https://siahra-radar.co}"
ENV_FILE_DEFAULT="$ROOT/scripts/.env.r2"

VERSION=""
VERSION_GIVEN=0
COPY=0
BUILD=0
DRY_RUN=0
SAMPLE="${SAMPLE:-0}"
ENV_FILE_ARG=""
provinces=()

while [ $# -gt 0 ]; do
  case "$1" in
    --version=*)  VERSION="${1#--version=}"; VERSION_GIVEN=1 ;;
    --version)
      # ค่ารุ่นต้องเป็นอาร์กิวเมนต์ถัดไปจริง ๆ — ห้ามกลืนธงตัวถัดไปมาเป็นชื่อรุ่น
      [ $# -ge 2 ] || { echo "--version ต้องตามด้วยค่ารุ่น เช่น --version 2026-08-21" >&2; exit 2; }
      case "$2" in -*) echo "--version ตามด้วย \"$2\" ซึ่งเป็นตัวเลือก ไม่ใช่ค่ารุ่น" >&2; exit 2 ;; esac
      shift; VERSION="$1"; VERSION_GIVEN=1 ;;
    --env-file=*) ENV_FILE_ARG="${1#--env-file=}" ;;
    --sample=*)   SAMPLE="${1#--sample=}" ;;
    --copy)       COPY=1 ;;
    --build)      BUILD=1 ;;
    --dry-run)    DRY_RUN=1 ;;
    -*)           echo "ไม่รู้จักตัวเลือก $1 (ดูหัวไฟล์)" >&2; exit 2 ;;
    *)            provinces+=("$1") ;;
  esac
  shift
done

say()  { printf '%s\n' "$*"; }
die()  { printf '%s\n' "$*" >&2; exit 1; }
# แสดงคำสั่งที่กำลังจะรัน (หรือ "จะรัน" ตอน dry-run) ให้เห็นทุกครั้ง — บันทึกการปล่อยรุ่น
# ที่อ่านย้อนหลังได้ คือสิ่งเดียวที่บอกได้ว่ารุ่นนั้นถูกสร้างขึ้นมาอย่างไร
show() { printf '   $ %s\n' "$*"; }
run() {
  show "$*"
  if [ "$DRY_RUN" = "1" ]; then say "     (dry-run: ไม่รัน)"; return 0; fi
  "$@"
}
stage() { say ""; say "==== STAGE $1/5 — $2 ===="; }

# ---------------------------------------------------------------- ขั้นตรวจก่อนเริ่ม

# รูปแบบรุ่นต้องตรงกับ apps/web/worker/tilePath.ts และ apps/etl/src/datasetVersion.ts
# ทั้งสามที่ต้องตัดสินเหมือนกัน ไม่งั้นสคริปต์จะปล่อยรุ่นที่ Worker ตอบ 404 ทั้ง prefix
VERSION_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$'
[ "$VERSION_GIVEN" = "1" ] || die "ต้องระบุ --version=YYYY-MM-DD[.N] — การปล่อยรุ่นโดยไม่มีชื่อรุ่นไม่มีอยู่จริง (ดูหัวไฟล์)"
[[ "$VERSION" =~ $VERSION_RE ]] || die "รุ่น \"$VERSION\" ผิดรูปแบบ — ต้องเป็น YYYY-MM-DD หรือ YYYY-MM-DD.N"
case "$SAMPLE" in ''|*[!0-9]*) die "--sample= ต้องเป็นจำนวนเต็ม" ;; esac

if [ "$COPY" = "1" ] && [ "$BUILD" = "1" ]; then
  die "--copy กับ --build ใช้ร่วมกันไม่ได้: --copy ก๊อปไบต์ที่อยู่บน prefix เดิมของ R2 (ของเก่า)
เข้ารุ่นใหม่ ส่วน --build เพิ่งสร้างไบต์ชุดใหม่ในเครื่องนี้ ผลคือรุ่นใหม่จะบรรจุของเก่า
ขณะที่ checksum ใน manifest บรรยายของใหม่ — และ immutable หนึ่งปีทำให้แก้ไม่ได้
เลือกอย่างใดอย่างหนึ่ง: --build (อัปจากเครื่องนี้) หรือ --copy (ย้าย prefix ล้วน ๆ ไม่ได้ build)"
fi

# 1) คีย์ R2 — ตรวจก่อนอย่างอื่นทั้งหมด รวมทั้งตอน dry-run: การปล่อยรุ่นที่ไปตายเอาตอน
# ขั้นอัป (หลัง build หลายชั่วโมง) เพราะไม่มีคีย์ คือความล้มเหลวที่ถูกที่สุดที่จะเลื่อนมาไว้ต้นทาง
ENV_FILE="$ENV_FILE_ARG"
[ -n "$ENV_FILE" ] || ENV_FILE="${SIAHRA_R2_ENV:-$ENV_FILE_DEFAULT}"
if [ ! -f "$ENV_FILE" ]; then
  die "ไม่พบไฟล์คีย์ R2: $ENV_FILE — ไม่เริ่มปล่อยรุ่น
ไฟล์นี้ต้องมีสามบรรทัดนี้ (KEY=value, ไม่มีในคลัง git และห้าม commit):
  CLOUDFLARE_ACCOUNT_ID=...
  R2_ACCESS_KEY_ID=...
  R2_SECRET_ACCESS_KEY=...
worktree ไม่มีไฟล์นี้ติดมาด้วย (scripts/.env.r2 อยู่ใน .gitignore) — ชี้ไปที่ของ checkout หลัก
แทนการคัดลอกคีย์เข้ามา (คัดลอก = คีย์อีกหนึ่งชุดที่ต้องตามลบทีหลัง):
  ln -s /path/to/main-checkout/scripts/.env.r2 $ENV_FILE_DEFAULT   # ทางที่แนะนำ
  SIAHRA_R2_ENV=/path/to/scripts/.env.r2 $0 --version=$VERSION ...
  $0 --env-file=/path/to/scripts/.env.r2 --version=$VERSION ..."
fi
# ลำดับความสำคัญกลับด้านได้เงียบ ๆ: upload-tiles.sh จะ source $ROOT/scripts/.env.r2 ทับ
# ค่าที่เรา export ไป ถ้ามีทั้งสองไฟล์ การปล่อยรุ่นจะใช้คีย์ของไฟล์ปริยาย ไม่ใช่ไฟล์ที่ผู้ใช้สั่ง
if [ "$ENV_FILE" != "$ENV_FILE_DEFAULT" ] && [ -f "$ENV_FILE_DEFAULT" ]; then
  die "มีไฟล์คีย์สองแหล่ง — เลือกไม่ได้ว่าจะใช้อันไหน:
  ที่สั่งมา: $ENV_FILE
  ที่มีอยู่: $ENV_FILE_DEFAULT (upload-tiles.sh จะ source ไฟล์นี้ทับเสมอ)
ลบ/ย้าย symlink ที่ไม่ได้ใช้ออกไปหนึ่งอัน แล้วรันใหม่"
fi
# `set -a` = export ทุกตัวที่ไฟล์ตั้ง เพื่อให้ตกทอดถึง upload-tiles.sh/verify-tiles.sh
# ที่เป็นโปรเซสลูก (ไฟล์คีย์เขียนแบบ KEY=value เฉย ๆ ได้ ไม่ต้องมี export)
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
for v in CLOUDFLARE_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
  [ -n "${!v:-}" ] || die "$ENV_FILE ไม่ได้ตั้ง \$$v (ต้องครบสามตัว)"
done
# ไม่พิมพ์ค่าคีย์ ไม่พิมพ์แม้บางส่วน — บอกแค่ว่าครบแล้วและมาจากไฟล์ไหน
say "คีย์ R2: ครบสามตัว จาก $ENV_FILE"

# 2) เครื่องมือและชุดข้อมูล
for c in rclone curl jq git npm; do
  command -v "$c" >/dev/null || die "ไม่มีคำสั่ง $c — ติดตั้งก่อน (rclone/jq: brew install)"
done
[ -d "$TILES" ] || die "ไม่พบ $TILES (dataset ไม่ได้ symlink?) — ไม่มีชุด tile ก็ปล่อยรุ่นไม่ได้"
[ -d "$AOI_ROOT" ] || die "ไม่พบ $AOI_ROOT"
if [ ${#provinces[@]} -eq 0 ]; then
  ALL=1
  province_count=$(ls "$TILES" | wc -l | tr -d ' ')
else
  ALL=0
  province_count=${#provinces[@]}
  for p in "${provinces[@]}"; do
    [ -d "$TILES/$p" ] || die "ไม่มีจังหวัด $p ใน $TILES"
  done
fi
[ "$province_count" -gt 0 ] || die "ไม่มีจังหวัดให้ปล่อยเลย"

# 3) manifest ต้องสะอาดก่อนเริ่ม — ขั้นที่ 5 คือ `git diff` ของ manifest และมันคือด่าน
# สุดท้ายที่คนตรวจด้วยตา diff ที่ปนของค้างไว้ก่อนหน้าอ่านไม่ได้ = ด่านนั้นหายไปทั้งด่าน
# เทียบกับ HEAD ไม่ใช่ index: `git diff` เฉย ๆ มองข้ามของที่ `git add` ไปแล้ว การแก้ที่ stage ไว้
# จึงอ่านว่า "สะอาด" แล้วไปโผล่ปนใน diff ของขั้นที่ 5 ทั้งที่ไม่ได้เกิดจากการปล่อยรุ่นครั้งนี้
if ! git -C "$ROOT" diff --quiet HEAD -- "$AOI_ROOT" 2>/dev/null; then
  die "apps/web/public/aoi มีการแก้ค้างอยู่ (รวมของที่ git add ไว้แล้ว) — commit หรือ stash ก่อน
ขั้นที่ 5 แสดง git diff ของ manifest เป็นด่านตรวจสุดท้ายก่อน deploy; diff ที่ปนของค้างอ่านไม่ออก"
fi

# 4) รุ่นที่ manifest ประกาศอยู่ตอนนี้ (ไว้บอกคน ไม่ใช่เงื่อนไข) — เท่ากับรุ่นที่กำลังปล่อย
# แปลว่านี่คือการรันซ้ำหลังจากรอบก่อนไปไม่สุด ซึ่งทำได้ (ทุกขั้นเป็น idempotent)
current_versions=$(jq -r '.provenance.datasetVersion // "ไม่มี"' "$AOI_ROOT"/*/manifest.json 2>/dev/null | sort -u | tr '\n' ' ')
say "รุ่นที่ manifest ประกาศอยู่ตอนนี้: ${current_versions:-ไม่มี}"
say "กำลังจะปล่อยรุ่น: $VERSION · $province_count จังหวัด · โหมด$([ "$COPY" = 1 ] && echo " copy (ฝั่ง R2)" || echo "อัปจากเครื่องนี้")$([ "$DRY_RUN" = 1 ] && echo " · DRY-RUN")"

# 5) เงื่อนไขก่อนเริ่มที่ทำให้คนอ่านผลผิดได้ง่ายที่สุด: siahra-web ที่ deploy อยู่ต้องรู้จัก
# path แบบ /v/{ver} (E9.2) แล้ว — Worker รุ่นก่อนหน้าไม่รับ path รูปนี้ แล้วโยนให้ asset layer
# ซึ่งตั้ง `not_found_handling: "single-page-application"` ไว้ ผลคือมันตอบ **200 text/html**
# (index.html) ไม่ใช่ 404 ทั้งที่ยังไม่มีไบต์อยู่ตรงนั้นเลย
#
# วัดจริงบน prod ด้วย `curl -I` (2026-08-20):
#   /aoi/11/terrain/0/0_0.bin                → 200 application/octet-stream   ไทล์จริงจาก Worker
#   /aoi/11/v/2026-08-17/terrain/0/0_0.bin   → 200 text/html                  SPA shell ของ asset layer
#   /aoi/11/terrain/0/9999_9999.bin          → 404 text/plain;charset=UTF-8   404 ของ Worker เอง
# และ 404 ของ Worker ที่ deploy อยู่ **ไม่มี header Content-Security-Policy เลย** (header ครบชุด:
# date, content-type, report-to, nel, server, cf-ray, alt-svc) สัญญาณที่ใช้แยกได้จริงจึงเหลือ
# content-type อย่างเดียว: octet-stream = ไทล์, text/html = asset layer, text/plain = Worker
# **status อย่างเดียวแยกไม่ออก** และแย่กว่านั้นคือมันอ่านว่า "ผ่าน" ให้กับกรณีที่ยังไม่ได้อัปเลย
#
# ยิงสอง path เสมอ: แบบมีรุ่น + path เดิมของไฟล์เดียวกันเป็น "ตัวคุม" (รู้ว่าอยู่บน R2 แล้ว)
# ตัวคุมตอบเป็นไทล์จริง = เส้นทางเครือข่ายอ่านค่าได้ ผลของ path แบบมีรุ่นจึงสรุปได้
# ตัวคุมอ่านไม่ได้เอง = **เตือน ไม่ใช่หยุด และไม่ใช่ผ่าน** (จงใจไม่มีธง --skip: การข้ามที่สั่งได้
# คือการข้ามที่จะถูกสั่งจริงในวันที่รีบ) เพราะขั้นถัดไปคือ --smoke ซึ่งเป็นไฟล์เดียว ล้มเร็ว
# และเช็ค content-type เหมือนกัน

# อ่าน "code ctype" ของหนึ่ง path ด้วย HEAD — ctype ตัด `;charset=…` ทิ้ง ยิงไม่ออก = "000 -"
head_probe() {  # $1 = path → พิมพ์ "code ctype"
  local out code ctype
  out=$(curl -sk -I -m 20 -o /dev/null -w '%{http_code} %{content_type}' "$HOST$1" 2>/dev/null || true)
  code="${out%% *}"
  ctype=""
  case "$out" in *' '*) ctype="${out#* }" ;; esac
  ctype="${ctype%%;*}"
  printf '%s %s\n' "${code:-000}" "${ctype:--}"
}

worker_precondition() {
  local first z f vpath lpath vcode vtype lcode ltype
  if [ "$ALL" = "1" ]; then first=$(ls "$TILES" | sort | head -1); else first="${provinces[0]}"; fi
  z=$(ls "$TILES/$first/terrain" 2>/dev/null | sort -n | head -1)
  [ -n "$z" ] || { say "ข้ามการตรวจ Worker: $first ไม่มีชั้น terrain ในเครื่องนี้"; return 0; }
  f=$(ls "$TILES/$first/terrain/$z" | head -1)
  vpath="/aoi/$first/v/$VERSION/terrain/$z/$f"
  lpath="/aoi/$first/terrain/$z/$f"
  show "curl -sk -I $HOST$vpath   # siahra-web รู้จัก /v/ แล้วหรือยัง"
  show "curl -sk -I $HOST$lpath   # ตัวคุม: ไฟล์เดียวกันบน prefix เดิม"
  if [ "$DRY_RUN" = "1" ]; then say "     (dry-run: ไม่ยิง)"; return 0; fi
  read -r vcode vtype <<<"$(head_probe "$vpath")"
  read -r lcode ltype <<<"$(head_probe "$lpath")"
  say "     แบบมีรุ่น → $vcode $vtype · ตัวคุม (prefix เดิม) → $lcode $ltype"

  # ผ่านได้สองทางเท่านั้น และทั้งสองทางต้องมี content-type ยืนยัน
  if [ "$vcode" = "200" ] && [ "$vtype" = "application/octet-stream" ]; then
    say "Worker: เสิร์ฟ path แบบมีรุ่นเป็นไบต์ไทล์จริงแล้ว (ไฟล์นี้เคยถูกอัปไปแล้ว)"
    return 0
  fi
  if [ "$vcode" = "404" ] && [ "$vtype" = "text/plain" ]; then
    say "Worker: 404 ของตัว Worker เอง (text/plain) — รู้จัก /v/ แล้ว ยังไม่มีไฟล์นี้ในรุ่น ซึ่งถูกต้อง"
    return 0
  fi
  # asset layer เป็นคนตอบ — สรุปได้ต่อเมื่อตัวคุมพิสูจน์แล้วว่าอ่านค่าจริงจากเน็ตได้
  if [ "$vtype" = "text/html" ] && [ "$lcode" = "200" ] && [ "$ltype" = "application/octet-stream" ]; then
    die "siahra-web ที่ deploy อยู่ยังไม่รู้จัก path แบบ /v/{ver} — asset layer เป็นคนตอบแทน
  $vpath
    → $vcode $vtype (index.html ของ SPA fallback ไม่ใช่ไทล์ — ไม่ใช่ 404 ด้วยซ้ำ)
  $lpath
    → $lcode $ltype (ไทล์จริงจาก Worker: เส้นทางเครือข่ายอ่านค่าได้ ผลข้างบนจึงเชื่อได้)
ต้อง deploy โค้ด E9.2 ขึ้นไปก่อน: npm run deploy:web
การ deploy ก่อนปลอดภัย เพราะ manifest ทั้งหมดยังชี้ prefix เดิมอยู่ (docs/dataset-release.md §เงื่อนไขก่อนเริ่ม)"
  fi
  say "เตือน: **ตรวจไม่ได้** ว่า siahra-web รู้จัก /v/ หรือยัง — อ่านไม่ได้ ไม่ใช่ผ่าน"
  say "      แบบมีรุ่น $vcode $vtype · ตัวคุม $lcode $ltype"
  say "      (ตัวคุมต้องเป็น 200 application/octet-stream ก่อน ผลของ path แบบมีรุ่นจึงสรุปได้)"
  say "      เครื่องนี้อยู่หลัง TLS filter ที่แทนคำตอบได้ (docs/deploy.md §6) — ตรวจเองว่า deploy ล่าสุดของ"
  say "      siahra-web มี worker/tilePath.ts ของ E9.2 แล้ว ถ้ายังไม่มี ขั้น --smoke ข้างล่างจะล้มด้วยเหตุนั้น"
}
worker_precondition

# ---------------------------------------------------------------- 1/5 build

stage 1 "build ชุด tile ในเครื่อง"
if [ "$BUILD" = "1" ]; then
  say "build ใหม่ทั้งชุด (หลายชั่วโมง) — builtAt รายชั้นใน manifest มาจาก mtime ของโฟลเดอร์ที่ได้จากขั้นนี้"
  run npm run build:all -w apps/etl
else
  say "ข้าม (ไม่ได้ส่ง --build) — ใช้ tile ที่มีอยู่แล้วใน $TILES ตามสภาพ"
  say "ขั้นที่ 2 จะเป็นคนบอกเองว่าไบต์ในเครื่องตรงกับที่ manifest ประกาศไว้หรือไม่"
fi

# ---------------------------------------------------------------- 2/5 checksum

# ขั้นนี้คือ `refresh:manifests --dry-run`: มันคำนวณ checksum กับ builtAt รายชั้นใหม่ทั้งหมด
# แล้วเทียบกับที่ manifest ประกาศไว้ (diffTileContent) โดยไม่เขียนไฟล์ — เป็นด่านที่บอกว่า
# "ชื่อรุ่นนี้ใช้ได้ไหม" **ก่อน** ลงทุนอัป 5.17 GiB ขึ้นไปใต้ชื่อที่ใช้ซ้ำไม่ได้
stage 2 "checksum + ตรวจว่าชื่อรุ่นยังใช้ได้ (ยังไม่เขียนอะไร)"
set +e
run npm run refresh:manifests -w apps/etl -- "--dataset-version=$VERSION" --dry-run
rc=$?
set -e
if [ "$rc" != "0" ]; then
  die "
ขั้นที่ 2 ไม่ผ่าน (exit $rc) — หยุดการปล่อยรุ่นตรงนี้ ยังไม่มีอะไรขึ้น R2 และไม่มี manifest ถูกเขียน
ถ้าเหตุผลคือ \"tile ใต้รุ่น $VERSION เปลี่ยนไปแล้ว\" แปลว่าชื่อรุ่นนี้ผูกกับไบต์ชุดอื่นไปแล้ว
ทางแก้มีทางเดียว: **ตั้งชื่อรุ่นใหม่** แล้วรันสคริปต์นี้ใหม่ เช่น --version=$VERSION.1
อย่ารันซ้ำด้วย --allow-version-reuse: รุ่นที่เคยขึ้น R2 แล้วถูกเสิร์ฟด้วย immutable หนึ่งปี
การทับชื่อเดิม = client ที่แคชไว้ได้ไบต์ชุดเก่าต่อไปทั้งปีโดยแก้ไม่ได้ (docs/dataset-release.md §ถอย)"
fi

# ---------------------------------------------------------------- 3/5 upload

stage 3 "อัป/ก๊อป tile ขึ้น prefix ของรุ่น v/$VERSION"
UPLOAD_ARGS=("--version=$VERSION")
[ "$COPY" = "1" ] && UPLOAD_ARGS+=(--copy)
say "ไฟล์เดียวก่อนเสมอ (พิสูจน์ TLS/คีย์/endpoint และว่า Worker เสิร์ฟ path แบบมีรุ่นได้จริง):"
run "$ROOT/scripts/upload-tiles.sh" "${UPLOAD_ARGS[@]}" --smoke
say ""
say "แล้วจึงทั้งชุด (append-only — ไม่มีอะไรถูกลบ ทั้ง prefix เดิมและ prefix ของรุ่น):"
if [ "$ALL" = "1" ]; then
  run "$ROOT/scripts/upload-tiles.sh" "${UPLOAD_ARGS[@]}"
else
  run "$ROOT/scripts/upload-tiles.sh" "${UPLOAD_ARGS[@]}" "${provinces[@]}"
fi

# ---------------------------------------------------------------- 4/5 verify

# ต้องบังคับ VERSION= เพราะ manifest ยังประกาศรุ่นเก่าอยู่ (ขั้นที่ 5 ยังไม่ได้รัน)
# ปล่อยว่างไว้จะกลายเป็นการตรวจ prefix ของรุ่นก่อนหน้า แล้วผ่านฉลุยโดยไม่ได้ตรวจรุ่นใหม่เลย
# "ตอบ 200" ที่นับในขั้นนี้คือ `200 application/octet-stream` เท่านั้น — `200 text/html` คือ
# index.html ของ asset layer และเคยทำให้ทั้งขั้นนี้ผ่านโดยที่ยังไม่มีไบต์อยู่จริงสักไฟล์
stage 4 "ตรวจว่า URL จริงตอบไบต์ไทล์ (200 + octet-stream) ทั้ง prefix เดิมและ v/$VERSION"
if [ "$DRY_RUN" = "1" ]; then
  if [ "$ALL" = "1" ]; then
    show "VERSION=$VERSION SAMPLE=$SAMPLE scripts/verify-tiles.sh"
  else
    show "VERSION=$VERSION SAMPLE=$SAMPLE scripts/verify-tiles.sh ${provinces[*]}"
  fi
  say "     (dry-run: ไม่ยิง)"
else
  # สร้างไฟล์ชั่วคราวเฉพาะตอนรันจริง — dry-run ต้องไม่แตะระบบไฟล์เลยแม้แต่ไฟล์เดียว
  VERIFY_LOG="$(mktemp -t siahra-verify)"
  trap 'rm -f "$VERIFY_LOG"' EXIT
  # บรรทัดที่โชว์ต้องเป็นคำสั่งที่รันจริง รวมรายชื่อจังหวัดตอนปล่อยบางส่วนด้วย —
  # transcript ของการรันคือบันทึกเดียวที่บอกว่ารุ่นนี้ถูกสร้างมาอย่างไร (ดูหัวไฟล์)
  if [ "$ALL" = "1" ]; then
    show "VERSION=$VERSION SAMPLE=$SAMPLE scripts/verify-tiles.sh"
  else
    show "VERSION=$VERSION SAMPLE=$SAMPLE scripts/verify-tiles.sh ${provinces[*]}"
  fi
  set +e
  if [ "$ALL" = "1" ]; then
    VERSION="$VERSION" SAMPLE="$SAMPLE" "$ROOT/scripts/verify-tiles.sh" 2>&1 | tee "$VERIFY_LOG"
  else
    VERSION="$VERSION" SAMPLE="$SAMPLE" "$ROOT/scripts/verify-tiles.sh" "${provinces[@]}" 2>&1 | tee "$VERIFY_LOG"
  fi
  rc=${PIPESTATUS[0]}
  set -e
  [ "$rc" = "0" ] || die "
ขั้นที่ 4 ไม่ผ่าน (exit $rc) — manifest **ยังไม่ถูกแตะ** และยังชี้ prefix เดิมที่เสิร์ฟได้อยู่
ยังไม่มีอะไรพังสำหรับผู้ใช้ ณ ตอนนี้: prefix เดิมไม่เคยถูกลบ (docs/dataset.md §7)
แก้ต้นเหตุแล้วรันสคริปต์นี้ใหม่ด้วยรุ่นเดิมได้ (ทุกขั้นเป็น idempotent) — อย่ารันขั้นที่ 5 ด้วยมือ
บรรทัด \"แบบมีรุ่นไม่ผ่าน\" ที่ verify-tiles.sh พิมพ์ บอกว่ายังก๊อปไม่ครบ หรือ Worker ยังไม่รู้จัก /v/"

  # verify-tiles.sh ผ่านแบบ "ไม่ได้ตรวจอะไรเลย" ได้: ถ้ารายการ path ว่าง (เช่นชั้นไหน
  # ไม่มีในเครื่อง) มันจะไม่มีอะไรให้ fail แล้วพิมพ์ ✅ ออกมา — การตรวจที่ไม่ได้ตรวจอะไร
  # ต้องไม่ปลดล็อกให้ manifest ไปชี้รุ่นใหม่ จึงนับจำนวน 200 ของ path แบบมีรุ่นซ้ำอีกชั้น
  if grep -q MISSING_LOCAL "$VERIFY_LOG"; then
    die "ขั้นที่ 4: verify-tiles.sh รายงาน MISSING_LOCAL (บางชั้นไม่มีในเครื่องนี้) — ชุดข้อมูลไม่ครบ
รุ่นที่ปล่อยจากชุดที่ไม่ครบ = ไทล์หายทั้งชั้นแบบถาวรใต้ชื่อรุ่นนั้น หยุดก่อน"
  fi
  versioned_ok=$(sed -n 's/.*แบบมีรุ่น \([0-9][0-9]*\)).*/\1/p' "$VERIFY_LOG" | tail -1)
  [ -n "$versioned_ok" ] || die "ขั้นที่ 4: อ่านจำนวน path แบบมีรุ่นที่ผ่านจากผลของ verify-tiles.sh ไม่ได้ — หยุดก่อน"
  # พื้นที่รับประกันของ verify-tiles.sh: จังหวัดละ 4 ชั้น × (z ตื้นสุด + z ลึกสุด) = ปกติ 8 path
  # ตั้งเกณฑ์ไว้ที่ "จังหวัดละ 2" ซึ่งต่ำกว่าของจริงมาก โดยตั้งใจ — มันมีไว้จับกรณี "ผ่านเพราะ
  # ไม่ได้ตรวจอะไรเลย" ไม่ใช่ไว้เดาจำนวนไทล์ (ชั้นที่หายไปมี MISSING_LOCAL เป็นคนจับอยู่แล้ว)
  min_versioned=$((province_count * 2))
  if [ "$versioned_ok" -lt "$min_versioned" ]; then
    die "ขั้นที่ 4: มี path แบบมีรุ่นที่ตอบ 200 เพียง $versioned_ok รายการ จาก $province_count จังหวัด
(ต้องอย่างน้อย $min_versioned — ปกติได้ราวจังหวัดละ 8) verify ที่แทบไม่ได้ตรวจอะไร ห้ามปลดล็อกขั้นที่ 5"
  fi
  say "ตรวจแล้ว: path แบบมีรุ่นตอบ 200 จำนวน $versioned_ok รายการ ($province_count จังหวัด, ขั้นต่ำ $min_versioned)"
fi

# ---------------------------------------------------------------- 5/5 manifest diff

# ถึงตรงนี้เท่านั้นที่ manifest ถูกเขียนให้ชี้รุ่นใหม่ได้ — ไบต์อยู่ครบและตอบ 200 แล้ว
stage 5 "เขียน manifest ให้ชี้ v/$VERSION แล้วโชว์ diff ให้คนตรวจ"
set +e
run npm run refresh:manifests -w apps/etl -- "--dataset-version=$VERSION"
rc=$?
set -e
if [ "$rc" != "0" ]; then
  die "
ขั้นที่ 5 ล้มเหลว (exit $rc) — refreshManifests.ts ทำต่อจนจบแล้วค่อยคืนค่าไม่ศูนย์ แปลว่า
**บาง manifest ถูกเขียนไปแล้ว บางอันไม่** ตอนนี้ working tree อยู่ในสภาพผสม
ห้าม deploy สภาพนี้ ให้ถอย manifest กลับก่อนแล้วค่อยหาสาเหตุ:
  git -C $ROOT checkout -- apps/web/public/aoi
ไบต์ที่อัปขึ้น R2 ไปแล้วปล่อยทิ้งไว้ได้ ไม่ต้องลบ (append-only) — แต่ชื่อรุ่น $VERSION ถือว่าใช้ไปแล้ว"
fi

if [ "$DRY_RUN" = "1" ]; then
  say ""
  say "dry-run จบแล้ว — ไม่มีไบต์ขึ้น R2, ไม่มี manifest ถูกเขียน, ไม่มีการ deploy"
  say "ตรวจซ้ำได้ด้วย: git status --short"
  say "รันจริงด้วยคำสั่งเดิมโดยตัด --dry-run ออก"
  exit 0
fi

say ""
say "-- git diff --stat HEAD -- apps/web/public/aoi --"
git -C "$ROOT" diff --stat HEAD -- "$AOI_ROOT" || true
diff_all=$(git -C "$ROOT" diff HEAD -- "$AOI_ROOT" || true)
if [ -z "$diff_all" ]; then
  say ""
  say "manifest ไม่เปลี่ยนเลย — แปลว่าทุกอันชี้ v/$VERSION อยู่ก่อนแล้ว (รันซ้ำรอบที่สอง)"
  say "ถ้าไม่ได้ตั้งใจรันซ้ำ ให้เช็คว่าใช้ชื่อรุ่นถูกตัวหรือเปล่า ก่อน deploy"
else
  added=$(printf '%s\n' "$diff_all" | grep -c '^+.*"urlTemplate"' || true)
  removed=$(printf '%s\n' "$diff_all" | grep -c '^-.*"urlTemplate"' || true)
  wrong=$(printf '%s\n' "$diff_all" | grep '^+.*"urlTemplate"' | grep -vc "/v/$VERSION/" || true)
  say ""
  say "-- urlTemplate ที่ถูกชี้ใหม่ (แสดง 8 บรรทัดแรกจาก ${added:-0}; ของเดิมที่ถูกแทน ${removed:-0}) --"
  printf '%s\n' "$diff_all" | grep '^[-+].*"urlTemplate"' | head -8
  if [ "${wrong:-0}" -gt 0 ]; then
    die "
มี urlTemplate ที่เขียนใหม่ $wrong บรรทัดที่ **ไม่ได้** ชี้ /v/$VERSION/ — อย่า deploy
ดู git diff เต็ม ๆ แล้วถอยด้วย: git -C $ROOT checkout -- apps/web/public/aoi"
  fi
  say "ทุกบรรทัดที่เขียนใหม่ชี้ /v/$VERSION/ ครบ"
fi

say ""
say "==== เหลืออีกสามอย่าง ที่สคริปต์นี้ไม่ทำให้ (ตั้งใจ) ===="
say "  1. อ่าน diff ข้างบนด้วยตา แล้ว commit: git add apps/web/public/aoi && git commit"
say "  2. deploy: npm run deploy:web    (manifest ถูก track และ ship ไปกับ deploy unit เดียวกัน)"
say "  3. ตรวจซ้ำโดยไม่บังคับรุ่น: scripts/verify-tiles.sh   (คราวนี้ค่าที่อ่านได้ต้องเป็น $VERSION เอง)"
say ""
say "ถอยยังไงถ้าอะไรพลาดหลังจากนี้: git checkout ตัว manifest แล้ว deploy ใหม่ — prefix เดิมยัง"
say "เสิร์ฟอยู่ตลอดและไม่เคยถูกลบ ส่วนไบต์ใต้ v/$VERSION ปล่อยค้างไว้ ไม่ต้องลบ (docs/dataset-release.md)"
