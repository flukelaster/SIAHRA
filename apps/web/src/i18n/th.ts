/**
 * แคตตาล็อกภาษาไทย — **แหล่งความจริงของคีย์ทั้งหมด**
 *
 * `en.ts` ประกาศชนิดเป็น `Record<keyof typeof th, string>` ดังนั้นคีย์ที่ขาดหรือ
 * เกินจะเป็น error ของ tsc ตั้งแต่ตอน build และ `i18n/catalog.test.ts` ยังตรวจซ้ำ
 * อีกชั้นว่า (1) ชุดคีย์เท่ากันทั้งสองทาง (2) ไม่มีค่าไหนว่าง (ค่าว่างคือการหายไป
 * แบบเงียบ ๆ ที่ห้ามเกิด) และ (3) ตัวแปร `{...}` ในแต่ละคีย์ตรงกันทั้งสองภาษา
 *
 * ความซื่อสัตย์ต่อข้อมูล: ข้อความในกลุ่ม `time.*`, `freshness.*`, `badge.*` และ
 * `health.*` มีความหมายที่ตกลงกันไว้แล้วใน E3.2–E3.5 ห้ามแปลให้อ่อนลง โดยเฉพาะ
 * - `time.neverReceived` = ยังไม่เคยดึงสำเร็จเลย ไม่ใช่ "ไม่มีข้อมูล"
 * - `freshness.missing.staticReference` = ไม่เคย "จดเวลา" ไว้ ไม่ใช่ดึงพลาด
 * - `health.delayed` = ดึง **สำเร็จ** แต่ต้นทางยังไม่ปล่อยค่าใหม่ คนละเรื่องกับ
 *   `health.stale` ที่แปลว่าฝั่งเราดึงไม่สำเร็จมานาน
 * และห้ามมีข้อความไหนอ่านออกมาเป็นการพยากรณ์ ความน่าจะเป็น หรือคะแนนความเสี่ยง
 */
export const th = {
  // ── ภาษา ───────────────────────────────────────────────────────────────
  "lang.switch": "ภาษา",
  "lang.option.th": "ไทย",
  "lang.option.en": "EN",
  "lang.name.th": "ภาษาไทย",
  "lang.name.en": "English",

  // ── แบรนด์ ─────────────────────────────────────────────────────────────
  "brand.tagline": "แผนที่ข้อมูลเชิงพื้นที่เพื่อการเฝ้าระวังภัยพิบัติของประเทศไทย",

  // ── ทั่วไป ─────────────────────────────────────────────────────────────
  "common.loading": "กำลังโหลด...",
  "common.close": "ปิด",
  "common.reconnecting": "กำลังลองเชื่อมต่อใหม่อัตโนมัติ...",
  "common.province": "จังหวัด",

  // ── หน่วย ──────────────────────────────────────────────────────────────
  "unit.mm": "มม.",
  "unit.m": "ม.",
  "unit.km": "กม.",
  "unit.msl": "ม.รทก.",
  "unit.mcm": "ล้าน ลบ.ม.",
  "unit.mcmPerDay": "ล้าน ลบ.ม./วัน",
  "unit.rai": "ไร่",
  "unit.stations": "สถานี",
  "unit.sites": "แห่ง",
  "unit.percent": "%",
  "unit.hours": "ชม.",
  "unit.days": "วัน",

  // ── เวลา (lib/time.ts) ────────────────────────────────────────────────
  /** fetchedAt/observedAt = null — ต้องอ่านว่า "ไม่เคยได้เลย" ไม่ใช่ "ไม่มีข้อมูล" */
  "time.neverReceived": "ยังไม่เคยได้รับข้อมูล",
  "time.soon": "อีกไม่นาน",
  "time.justNow": "เมื่อสักครู่",
  "time.minutesAgo": "{n} นาทีที่แล้ว",
  "time.hoursAgo": "{n} ชม.ที่แล้ว",
  "time.daysAgo": "{n} วันที่แล้ว",
  /** เวลาสัมบูรณ์ที่แสดงในบรรทัด "ดึงข้อมูลสำเร็จเมื่อ" */
  "time.absolute": "{time} น.",

  // ── ป้ายชนิดความรู้ (EpistemicClass) ───────────────────────────────────
  "badge.observed": "ตรวจวัดจริง",
  "badge.observed.title": "ค่าที่เครื่องมือตรวจวัด/ดาวเทียมรายงานมาโดยตรง",
  "badge.staticReference": "ข้อมูลอ้างอิงคงที่",
  "badge.staticReference.title": "ชุดข้อมูลอ้างอิงที่ฝังมากับแผนที่ ไม่ได้อัปเดตแบบเรียลไทม์",
  "badge.illustrative": "ภาพประกอบ",
  "badge.illustrative.title":
    "เราคำนวณเองจากภูมิประเทศเพื่อประกอบการอ่านแผนที่ ไม่ใช่การตรวจวัดและไม่ใช่การพยากรณ์",
  "badge.probabilistic": "แบบจำลองภายนอกที่อ้างอิงได้",
  "badge.probabilistic.title":
    "ผลจากแบบจำลองของหน่วยงานภายนอกที่ระบุที่มาได้ ไม่ใช่การคำนวณของโครงการนี้",
  "badge.unknown": "ไม่ทราบชนิดข้อมูล",
  "badge.unknown.title": "แอปรุ่นนี้ยังไม่รู้จักชนิดของชั้นข้อมูลนี้",

  // ── ความสดของชั้นข้อมูล (lib/layerFreshness.ts) ───────────────────────
  "freshness.observedAt": "ตรวจวัด {time}",
  "freshness.fetchedAt": "ดึงข้อมูล {age}",
  "freshness.missing.observed": "ยังไม่เคยได้รับข้อมูล",
  "freshness.missing.staticReference": "ไม่ได้บันทึกเวลาที่ดึงข้อมูล",
  "freshness.missing.illustrative": "คำนวณจากภูมิประเทศ ไม่มีการดึงข้อมูลรายครั้ง",
  "freshness.missing.probabilistic": "ยังไม่เคยได้รับผลจากแบบจำลอง",
  "freshness.missing.unknown": "ไม่ทราบเวลาที่ดึงข้อมูล",
  "freshness.status.unknown": "ยังไม่ทราบสถานะแหล่งข้อมูล",
  /** เวลาที่ *ต้นทาง* ประกาศว่าเผยแพร่ข้อมูลชุดนี้ — คนละเรื่องกับเวลาที่เราดึง */
  "freshness.publishedAt": "ต้นทางเผยแพร่ {time}",
  "freshness.methodology": "วิธีคำนวณ",

  // ── สถานะแหล่งข้อมูล (/api/v1/health) ─────────────────────────────────
  "health.ok": "ปกติ",
  /** ดึง "สำเร็จ" แต่ต้นทางยังไม่ปล่อยค่าตรวจวัดรอบใหม่ — ห้ามยุบรวมกับ stale */
  "health.delayed": "ต้นทางยังไม่ส่งค่าใหม่",
  /** ฝั่งเราดึงไม่สำเร็จมานานเกินงบเวลาของแหล่งนั้น */
  "health.stale": "ข้อมูลค้าง",
  "health.degraded": "บางแหล่งล้มเหลว",
  "health.down": "ดึงข้อมูลไม่ได้",
  "health.unknown": "ยังไม่ทราบ",
  "health.downNeverFetched": "ต้นทางไม่ตอบสนอง (ยังไม่เคยได้ข้อมูล)",
  "health.delayedWithAge": "{label} (ค่าล่าสุด {age})",
  /**
   * แหล่งที่ "เราคำนวณเอง" (`exposure-illustrative`) — `latestObservedAt` ของมันคือ
   * เวลาที่เราคำนวณ run ล่าสุด ไม่ใช่เวลาที่สถานีไหนถูกอ่านค่า เรียกมันว่า
   * "ค่าล่าสุด" จะทำให้อายุของค่าตรวจวัดจริงดูใหม่กว่าความเป็นจริง
   */
  "health.delayedNoRun": "ยังไม่มีรอบคำนวณใหม่",
  "health.delayedWithRunAge": "{label} (รอบล่าสุด {age})",
  "health.tooltip.fetched": " · ดึงข้อมูลสำเร็จ {age}",
  "health.tooltip.line": "{source}: {status}{fetched}",
  "status.apiDown": "เชื่อมต่อ API ไม่ได้",
  "status.apiDown.detail": "— แผนที่ยังใช้ได้ แต่ไม่มีข้อมูลตรวจวัดสด",
  "status.sources": "แหล่งข้อมูล",
  "status.updated": "อัปเดต {age}",
  "status.lastSuccess": " · ล่าสุด {age}",

  // ── แถบบน ─────────────────────────────────────────────────────────────
  "topbar.searchPlaceholder": "ค้นหาจังหวัด อำเภอ สถานี เขื่อน...",
  "topbar.searchAria": "ค้นหาจังหวัด อำเภอ สถานี หรือเขื่อน",
  "topbar.kind.province": "จังหวัด",
  "topbar.kind.amphoe": "อำเภอ/เขต",
  "topbar.kind.station": "สถานีตรวจวัด",
  "topbar.kind.dam": "เขื่อน/อ่างเก็บน้ำ",
  "topbar.share": "แชร์",
  "topbar.copied": "คัดลอกแล้ว",
  "topbar.shareTitle": "คัดลอกลิงก์มุมมองนี้",
  "topbar.snapshotTitle": "บันทึกภาพแผนที่",
  "topbar.sources": "แหล่งข้อมูล",

  // ── ตัวเลือกจังหวัด ───────────────────────────────────────────────────
  "province.select": "เลือกจังหวัด",
  "province.count": "{n} จังหวัด",
  "province.searchPlaceholder": "ค้นหาจังหวัด...",
  "province.searchAria": "กรองรายชื่อจังหวัด",
  "province.notFound": "ไม่พบจังหวัดที่ค้นหา",
  /** คำนำหน้าหน่วยการปกครองในกล่องค้นหา (กทม. ใช้ "เขต" จังหวัดอื่นใช้ "อ.") */
  "province.prefix.khet": "เขต",
  "province.prefix.amphoe": "อ.",

  // ── แผงชั้นข้อมูล / สัญลักษณ์ ─────────────────────────────────────────
  "legend.title": "ชั้นข้อมูลและสัญลักษณ์",
  "legend.layer.imagery": "ภาพดาวเทียม",
  "legend.layer.imagery.note": "พื้นผิวจริงจากภาพถ่ายดาวเทียม",
  "legend.layer.radar": "เรดาร์ฝน (กรมอุตุนิยมวิทยา)",
  "legend.layer.radar.note": "ภาพสะท้อนเรดาร์ 3 ชม. ล่าสุด เล่นวนซ้ำ · ตรวจวัดจริง",
  "legend.layer.floodExtent": "น้ำท่วมจากภาพดาวเทียม (GISTDA)",
  "legend.layer.floodExtent.note": "ตรวจพบจากภาพถ่ายดาวเทียมชุดล่าสุด · ไม่ใช่การพยากรณ์",
  "legend.layer.lowland": "พื้นที่ลุ่มต่ำ",
  "legend.layer.lowland.note": "ประมาณจากความสูงภูมิประเทศ ไม่ใช่การพยากรณ์น้ำท่วม",

  /**
   * E10.4 — ชั้น "ระดับการเผชิญน้ำ (ภาพประกอบ)"
   *
   * ถ้อยคำสองบรรทัดแรกถูกกำหนดไว้ใน docs/roadmap.md §E10.4 ตรงตัวอักษร ห้ามแก้เอง
   * ส่วนคำว่า "ไม่ใช่การพยากรณ์ ไม่ใช่ความน่าจะเป็น" เป็นประโยคปฏิเสธโดยตั้งใจ:
   * ชั้นนี้จัดอันดับค่าที่ **วัดมาแล้ว** ตามตารางเกณฑ์ที่ประกาศไว้ ไม่มีแบบจำลองใด
   * อยู่เบื้องหลัง จึงไม่มีตัวเลขความน่าจะเป็นให้แสดง และห้ามมีวันไหนที่มี
   */
  "legend.layer.exposure": "พื้นที่ลุ่มต่ำที่ขณะนี้มีฝนหนัก/น้ำสูงในบริเวณใกล้เคียง (ภาพประกอบ)",
  "legend.layer.exposure.note":
    "คำนวณเองจากภูมิประเทศ + ค่าตรวจวัดจริง ไม่ใช่การพยากรณ์ ไม่ใช่ความน่าจะเป็น",
  "legend.layer.exposure.inputs":
    "ใช้ค่าตรวจวัดจาก ThaiWater: ฝน 1 ชม. · ฝน 24 ชม. · ระยะต่ำกว่าตลิ่ง · การเปลี่ยนแปลงของระยะต่ำกว่าตลิ่ง · ระดับสถานการณ์ที่ ThaiWater ประกาศเอง — ซ้อนกับพื้นที่ลุ่มต่ำที่คำนวณจากภูมิประเทศ (DEM)",
  /** {h} มาจาก `inputs.historyWindowH` ของ run เอง ไม่ใช่ค่าที่ฝั่งเว็บตั้งไว้ */
  "legend.exposure.historyWindow": "การเปลี่ยนแปลงวัดจากช่วงย้อนหลัง {h} ชม. เป็นอัตราที่เกิดไปแล้ว",
  "legend.exposure.computedAt": "คำนวณรอบล่าสุด {age}",
  /** ต้องบอก "ตั้งแต่เมื่อไหร่" เสมอ ห้ามแค่บอกว่าใช้ไม่ได้ */
  "legend.exposure.noRunSince": "ไม่มีผลคำนวณรอบใหม่ตั้งแต่ {time} — ที่เห็นคือรอบเก่า",
  "legend.exposure.staleInputs":
    "ที่เห็นคือรอบเมื่อ {time} — แต่ ThaiWater เองผิดปกติอยู่ตอนนี้ อินพุตของรอบนี้อาจไม่ครบหรือเป็นค่าเก่าบางส่วน",
  /**
   * ใช้ได้เฉพาะตอนที่ "ถามไปแล้ว" เท่านั้น — ชั้นปิดอยู่คือยังไม่มีใครถาม จึงใช้
   * `legend.exposure.layerOff` แทน (ห้ามพูดถึงสถานะของแหล่งข้อมูลที่ไม่เคยถูกตรวจ)
   */
  "legend.exposure.noRunEver": "ยังไม่เคยได้รับผลคำนวณสักรอบ (จึงไม่มีอะไรวาดบนแผนที่)",
  "legend.exposure.layerOff": "ชั้นนี้ปิดอยู่ — ยังไม่ได้ขอผลคำนวณจากเซิร์ฟเวอร์",
  /*
   * "ติดต่อไม่ได้" ไม่ใช่ "เซิร์ฟเวอร์ไม่ได้คำนวณ" — สองข้อความข้างบนพูดถึงสิ่งที่
   * ฝั่งเซิร์ฟเวอร์ทำหรือไม่ได้ทำ ซึ่งจะพูดได้ก็ต่อเมื่อถามไปแล้วและได้คำตอบกลับมา
   * ถ้าเรียก API ไม่สำเร็จ สิ่งเดียวที่รู้คือ "เราไม่ได้คำตอบ" จะเอาไปแปลว่าไม่มี
   * รอบใหม่ไม่ได้ (AGENTS.md: ห้ามแสดงสถานะที่ไม่เคยถูกตรวจว่าเป็นข้อเท็จจริง)
   */
  "legend.exposure.apiDownSince": "ติดต่อ API ไม่ได้ — ที่เห็นคือรอบเมื่อ {time} มีรอบใหม่กว่านี้หรือไม่ ยังไม่ทราบ",
  "legend.exposure.apiDownNoRun": "ติดต่อ API ไม่ได้ — จึงยังไม่ได้รับผลคำนวณสักรอบ",
  "legend.exposure.scale": "ลำดับของค่าที่วัดได้",
  "legend.exposure.level.low": "อยู่ในแถบต่ำสุด (วัดได้แล้ว)",
  "legend.exposure.level.elevated": "สูงกว่าแถบต่ำสุด",
  "legend.exposure.level.high": "สูง",
  "legend.exposure.level.severe": "สูงที่สุดในตารางเกณฑ์",
  "legend.exposure.level.noData": "ไม่มีปัจจัยใดวัดได้ — จัดลำดับไม่ได้ ไม่ได้แปลว่าปลอดภัย",
  "legend.exposure.stationCount": "{n} สถานี",
  /** ภาษาไทยไม่ต่างรูปพหูพจน์ แต่คีย์ต้องมีครบทั้งสองภาษา (ฝั่ง en ต้องใช้จริง) */
  "legend.exposure.stationCount.one": "1 สถานี",
  "legend.exposure.integrity.mismatch":
    "ตรวจสอบความถูกต้องของภูมิประเทศไม่ผ่าน — ชั้นนี้ถูกปิด เพราะวางอยู่บนพื้นที่ลุ่มต่ำที่คำนวณจากภูมิประเทศก้อนเดียวกัน",
  /** ป้ายบนแผนที่ของสถานีที่ไม่มีปัจจัยใดวัดได้ (scene/ExposureMarkers.ts) */
  "exposure.noData.label": "ไม่มีข้อมูลจัดลำดับ",
  "exposure.noData.sub": "สถานีนี้ไม่ได้ส่งค่าใดมาเลย ไม่ได้แปลว่าปลอดภัย",
  /**
   * E9.1 — ผลตรวจ sha256 ของ terrain.bin เทียบกับลายเซ็นใน manifest
   * `unknown` = ยังไม่ได้ตรวจ (manifest ไม่มีลายเซ็น) ห้ามอ่านว่า "ตรวจแล้วไม่ผ่าน"
   * และห้ามปิดชั้นข้อมูลใด ๆ; มีแต่ `mismatch` เท่านั้นที่ปิดชั้นพื้นที่ลุ่มต่ำ
   */
  "legend.integrity.mismatch": "ตรวจสอบความถูกต้องของภูมิประเทศไม่ผ่าน — ชั้นพื้นที่ลุ่มต่ำใช้งานไม่ได้",
  "legend.integrity.unknown": "ยังตรวจความถูกต้องของภูมิประเทศไม่ได้ (manifest ไม่มีลายเซ็น)",
  "legend.layer.hazard": "บริเวณสถานีเตือนภัย",
  "legend.layer.hazard.note": "รัศมีรอบสถานีที่ตรวจพบฝนหนัก/น้ำมาก (ตรวจวัดจริง)",
  "legend.layer.stations": "สถานีตรวจวัด",
  "legend.layer.stations.note": "จุดกลม = ระดับน้ำ · ข้าวหลามตัด = น้ำฝน",
  "legend.layer.water": "แม่น้ำ / คลอง / แหล่งน้ำ (OSM)",
  "legend.layer.water.note": "ผิวน้ำ 3 มิติ วางตามระดับภูมิประเทศ · ปิดเองเมื่อกล้องสูงเกิน {km} กม.",
  "legend.layer.roads": "ถนนสายหลัก (OSM)",
  "legend.layer.roads.note": "มอเตอร์เวย์ / ทางหลวง / ถนนสายรอง · ปิดเองเมื่อกล้องสูงเกิน {km} กม.",
  "legend.layer.dams": "เขื่อน / อ่างเก็บน้ำ",
  "legend.layer.dams.note": "% ความจุที่รายงาน (ThaiWater)",
  "legend.layer.sunlight": "แสงอาทิตย์ตามเวลาจริง",
  "legend.layer.sunlight.note": "ตำแหน่งดวงอาทิตย์/ท้องฟ้าตามเวลาปัจจุบันหรือเวลาบนไทม์ไลน์",
  "legend.layer.trees": "ต้นไม้ (ESA WorldCover)",
  "legend.layer.trees.note": "ป่า/สวนจากแผนที่สิ่งปกคลุมดิน 10 ม. แสดงเมื่อซูมใกล้",
  "legend.layer.buildings": "อาคาร 3 มิติ (OSM)",
  "legend.layer.buildings.note": "ทั้งจังหวัด · มองไกลแสดงเฉพาะอาคารใหญ่/สูง · ปิดเองเมื่อกล้องสูงเกิน {km} กม.",
  "legend.layer.buildings.error": "โหลดอาคารของพื้นที่นี้ไม่สำเร็จ — สวิตช์ยังเปิดอยู่แต่ไม่มีอะไรวาดบนแผนที่",
  "legend.waterlevelScale": "สถานีวัดระดับน้ำ (เกณฑ์ ThaiWater)",
  "legend.rainScale": "ฝนสะสม 24 ชม.",
  "legend.rain.band1": "< 10 มม.",
  "legend.rain.band2": "10–35 มม.",
  "legend.rain.band3": "35–90 มม.",
  "legend.rain.band4": "> 90 มม.",
  "legend.provinceBoundary": "ขอบเขตจังหวัด",
  "legend.earthquakes": "แผ่นดินไหวที่ตรวจพบ (30 วัน)",

  // ── ระดับสถานการณ์น้ำ (เกณฑ์ ThaiWater) ───────────────────────────────
  "situation.1": "น้ำน้อยวิกฤต",
  "situation.2": "น้ำน้อย",
  "situation.3": "ปกติ",
  "situation.4": "น้ำมาก",
  "situation.5": "ล้นตลิ่ง",

  // ── คุณภาพภาพ ─────────────────────────────────────────────────────────
  "quality.label": "คุณภาพภาพ",
  "quality.auto": "อัตโนมัติ",
  "quality.high": "สูง",
  "quality.balanced": "สมดุล",
  "quality.low": "ประหยัด",
  "quality.autoWith": "(อัตโนมัติ: {level})",

  // ── มาตราส่วนแนวดิ่ง ──────────────────────────────────────────────────
  "exaggeration.label": "ขยายแนวดิ่ง",
  "exaggeration.real": "ความสูงจริง 1:1",
  "exaggeration.factor": "ขยายความสูง {n} เท่า (ไม่ใช่สัดส่วนจริง)",

  // ── ไทม์ไลน์ ──────────────────────────────────────────────────────────
  "timeline.title": "ระดับน้ำย้อนหลัง",
  "timeline.rangeLabel": "ช่วงเวลาย้อนหลัง",
  "timeline.range.72h": "72 ชม.",
  "timeline.range.7d": "7 วัน",
  "timeline.range.30d": "30 วัน",
  "timeline.notForecast": "ค่าตรวจวัดจริง · ไม่ใช่พยากรณ์",
  "timeline.fromArchive": "จากคลังถาวร · รายชั่วโมง",
  "timeline.live": "ปัจจุบัน · ค่าล่าสุด",
  "timeline.play": "เล่นย้อนหลัง",
  "timeline.pause": "หยุด",
  "timeline.backToLive": "กลับสู่ปัจจุบัน",
  "timeline.slider": "เลื่อนเวลา",
  "timeline.tick.now": "ตอนนี้",
  "timeline.tick.days": "-{n} วัน",
  "timeline.tick.hours": "-{n} ชม.",

  // ── แถบตัวเลขสรุป ─────────────────────────────────────────────────────
  "stats.none": "ไม่มีข้อมูลตรวจวัด",
  "stats.rainStations": "สถานีวัดน้ำฝน",
  "stats.maxRain24h": "ฝนสูงสุด 24 ชม.",
  "stats.waterStations": "สถานีวัดระดับน้ำ",
  "stats.aboveWarning": "เกินเกณฑ์เฝ้าระวัง",

  // ── เครดิตใต้แผนที่ ───────────────────────────────────────────────────
  "attribution.terrain": "ภูมิประเทศ Copernicus GLO-30 ({demType}) · {cell}",
  "attribution.cellLod": "{m} ม./เซลล์ (LOD ตามระยะกล้อง)",
  "attribution.cell": "{m} ม./เซลล์",
  "attribution.verticalScale": "มาตราส่วนแนวดิ่ง {scale}",
  "attribution.scaleReal": "1:1 (จริง)",
  "attribution.scaleExaggerated": "{n}:1 (ขยายแนวดิ่ง)",
  "attribution.buildings": "อาคาร OSM {n} หลัง{urban}",
  "attribution.urbanCore": " (เฉพาะเขตเมือง)",
  "attribution.stations": "สถานีตรวจวัด {n} สถานี",
  "attribution.imagery": "ภาพดาวเทียม © {text}",
  /** E9.1 — รุ่นของชุดข้อมูล ETL ที่จังหวัดนี้ใช้อยู่ (ค่าคือวันที่ build) */
  "attribution.dataset": "ชุดข้อมูล {version}",
  "attribution.sources": "แหล่งข้อมูล:",
  "attribution.noEndorsement": "หน่วยงานข้างต้นเป็นผู้เผยแพร่ข้อมูล ไม่ได้รับรองโครงการนี้",
  "attribution.imageryEsri": "ภาพดาวเทียม Esri",
  "attribution.snapshotHistorical": "ค่าย้อนหลัง {time}",

  // ── สถานะข้อมูลใต้แผงซ้าย ─────────────────────────────────────────────
  "footer.dataStatus": "สถานะข้อมูล",
  "footer.notConnected": "ยังไม่เชื่อมต่อ",
  "footer.stale": "ข้อมูลค้าง",
  "footer.ok": "ปกติ",

  // ── ปุ่มควบคุมมุมมอง ──────────────────────────────────────────────────
  "viewport.province": "จังหวัด{name}",
  "viewport.subtitle": "มุมมอง 3 มิติ · ภูมิประเทศจริง",
  "viewport.radarFrame": "เรดาร์ฝน TMD {time} น.",
  "viewport.north": "หันกลับทิศเหนือ",
  "viewport.orbit": "หมุน/เอียงมุมมอง",
  "viewport.pan": "เลื่อนแผนที่",
  "viewport.zoomIn": "ซูมเข้า",
  "viewport.zoomOut": "ซูมออก",
  "viewport.fullscreen": "เต็มหน้าจอ",
  "viewport.exitFullscreen": "ออกจากเต็มหน้าจอ",

  // ── แผ่นเลื่อนบนจอเล็ก ────────────────────────────────────────────────
  "sheet.collapse": "ย่อแผง",
  "sheet.expand": "ขยายแผง",
  "sheet.tab.province": "จังหวัด",
  "sheet.tab.layers": "ชั้นข้อมูล",
  "sheet.tab.flood": "น้ำท่วม",
  "sheet.tab.water": "ระดับน้ำ",
  "sheet.tab.rain": "ฝน",
  "sheet.tab.dams": "เขื่อน",
  "sheet.tab.quake": "แผ่นดินไหว",

  // ── การ์ดน้ำท่วมจากภาพดาวเทียม ────────────────────────────────────────
  "flood.title": "น้ำท่วมจากภาพดาวเทียม",
  "flood.observedChip": "สังเกตการณ์จริง",
  "flood.loadError": "โหลดชั้นน้ำท่วมไม่ได้: {error}",
  "flood.noScene": "ยังไม่ได้ภาพชุดล่าสุดจาก GISTDA (กำลังลองดึง) — ไม่ได้แปลว่าไม่มีน้ำท่วม",
  "flood.none": "ไม่พบพื้นที่น้ำท่วมในจังหวัดนี้จากภาพชุดล่าสุด",
  "flood.noneFetched": " (ดึงเมื่อ {age})",
  "flood.tambonCount": "ตำบลที่ท่วม",
  "flood.areaRai": "พื้นที่ (ไร่)",
  "flood.households": "บ้านเรือน",
  "flood.unknownTambon": "ไม่ระบุตำบล",
  "flood.firstSeen": "พบครั้งแรก {time}",
  "flood.note":
    "ขอบเขตน้ำท่วมแปลจากภาพดาวเทียมโดย GISTDA (ชุดข้อมูล flooding_vis) — เป็นสิ่งที่ตรวจพบแล้ว ไม่ใช่การพยากรณ์ · ภาพชุดนี้ไม่ระบุวันที่ถ่าย ระบบจึงแสดงเวลาที่ดึงข้อมูล",
  "flood.noteEarliest": " และเวลาที่พบพื้นที่แต่ละแห่งครั้งแรก (เก่าสุด {time})",

  // ── การ์ดระดับน้ำ ─────────────────────────────────────────────────────
  "water.title": "ระดับน้ำที่ตรวจวัดได้",
  "water.historicalNote":
    "กำลังดูค่าย้อนหลัง — สีจุดบนแผนที่คิดจากระยะต่ำกว่าตลิ่ง (ThaiWater ไม่เผยแพร่ระดับสถานการณ์ย้อนหลัง)",
  "water.overflowing": "มี {n} สถานีอยู่ในเกณฑ์น้ำมากหรือล้นตลิ่ง",
  "water.none": "ไม่มีสถานีวัดระดับน้ำในจังหวัดนี้",
  "water.note": "ค่าที่แสดงเป็นการตรวจวัดจริงจากสถานีโทรมาตร ไม่ใช่การพยากรณ์",
  "water.observedAt": " · ข้อมูล {time}",
  "water.stationFallback": "สถานี {id}",
  "water.aboveBank": "สูงกว่าตลิ่ง {n} {unit}",
  "water.belowBank": "ต่ำกว่าตลิ่ง {n} {unit}",
  "water.historicalChip": "ค่าย้อนหลัง",
  "water.sparkline.aria": "กราฟระดับน้ำ 72 ชั่วโมง",
  "water.sparkline.bank": "ตลิ่งต่ำสุด",
  "water.sparkline.none": "ไม่มีข้อมูลย้อนหลังเพียงพอ",
  "water.history.caption": "72 ชม. ล่าสุด · {datum} · ค่าตรวจวัดจริง 10 นาที/จุด",
  "water.datum.msl": "ม.รทก.",
  "water.datum.local": "ม. (ระดับอ้างอิงสถานี)",
  "water.datum.unknown": "ม.",

  // ── การ์ดฝน ───────────────────────────────────────────────────────────
  "rain.title": "ปริมาณฝน 24 ชั่วโมง",
  "rain.reporting": "{n} สถานี",
  "rain.wetSummary": "มีฝนตก {wet} สถานี จาก {total} สถานีที่รายงาน",
  "rain.none": "ไม่มีสถานีวัดน้ำฝนในจังหวัดนี้",
  "rain.note": "ปริมาณฝนสะสมที่ตรวจวัดจริงจากสถานีโทรมาตร ไม่ใช่การพยากรณ์",

  // ── การ์ดเขื่อน ───────────────────────────────────────────────────────
  "dam.title": "เขื่อนและอ่างเก็บน้ำ",
  "dam.count": "{n} แห่ง",
  "dam.none": "ไม่มีเขื่อน/อ่างเก็บน้ำที่รายงานในจังหวัดนี้",
  "dam.prefix": "เขื่อน",
  "dam.reservoir": "อ่างเก็บน้ำ",
  "dam.inflow": " · น้ำไหลเข้า {n}",
  "dam.released": " · ระบาย {n}",
  "dam.note":
    "ปริมาณน้ำเก็บกักตามที่กรมชลประทาน/กฟผ. รายงานผ่าน ThaiWater (สสน.) — เฉพาะค่าที่รายงานภายใน 48 ชม.",

  // ── การ์ดแผ่นดินไหว ───────────────────────────────────────────────────
  "quake.title": "แผ่นดินไหวที่ตรวจวัดได้",
  "quake.conn.connecting": "กำลังเชื่อมต่อ",
  "quake.conn.live": "เรียลไทม์",
  "quake.conn.polling": "ดึงข้อมูลเป็นช่วง",
  "quake.conn.reconnecting": "สายหลุด กำลังต่อใหม่",
  "quake.conn.error": "เชื่อมต่อไม่ได้",
  "quake.events30d": "เหตุการณ์ 30 วันล่าสุด",
  "quake.maxMag": "ขนาดสูงสุด",
  "quake.parseErrors": "ข้อความจากฟีดอ่านไม่ได้ {n} รายการ — อาจมีเหตุการณ์ที่ยังไม่ได้แสดง",
  "quake.none": "ไม่พบเหตุการณ์ในพื้นที่เฝ้าระวังช่วงเวลานี้",
  "quake.unknownPlace": "ไม่ระบุตำแหน่ง",
  "quake.unknownMagType": "ไม่ระบุมาตรา",
  "quake.depth": "ลึก {n} {unit}",
  "quake.unreviewed": "ยังไม่ตรวจสอบ",
  "quake.reviewed": "ตรวจสอบแล้ว",
  "quake.note":
    "ข้อมูลตรวจวัดจริงจาก USGS และ EMSC — เป็นเหตุการณ์ที่ตรวจพบแล้ว ไม่ใช่การพยากรณ์",
  "quake.asOf": " · ข้อมูล ณ {time}",
  "quake.nearest.inside": "ในเขต{province}",
  "quake.nearest.distance": "ห่างจาก{province} ≈ {n} กม.",
  "quake.nearest.unknown": "ยังไม่ได้คำนวณจังหวัดใกล้เคียง",
  "quake.nearest.note": "ระยะเชิงเรขาคณิตถึงขอบเขตจังหวัด (ขอบเขตจาก OpenStreetMap ซึ่งครอบคลุมพื้นที่ทะเลอาณาเขตด้วย จุดกลางทะเลจึงอาจอยู่ \"ในเขต\" จังหวัดชายฝั่งได้) ไม่ใช่แบบจำลองแรงสั่นสะเทือน",
  "quake.eventPage": "หน้าเหตุการณ์ที่ต้นทาง",
  "quake.asOfWithAge": "{time} ({age})",

  // ── กล่องข้อมูลบนแผนที่ ───────────────────────────────────────────────
  "popup.situationThaiwater": "สถานการณ์ (ThaiWater)",
  "popup.situation": "สถานการณ์",
  "popup.situationHistorical": "ค่าย้อนหลัง — ไม่ระบุ",
  "popup.waterlevel": "ระดับน้ำ",
  "popup.minBank": "ตลิ่งต่ำสุด",
  "popup.aboveBank": "สูงกว่าตลิ่ง",
  "popup.belowBank": "ต่ำกว่าตลิ่ง",
  "popup.observedAt": "เวลาตรวจวัด",
  "popup.realObserved": "ค่าตรวจวัดจริง",
  "popup.partlyArchive": " · บางส่วนจากคลังถาวร",
  "popup.noHistory": "ไม่มีข้อมูลย้อนหลัง",
  "popup.rain24h": "ฝนสะสม 24 ชม.",
  "popup.rain1h": "ฝน 1 ชม.",
  "popup.damStorage": "ความจุที่เก็บกัก",
  "popup.damVolume": "ปริมาณน้ำ",
  "popup.damMax": "ความจุสูงสุด",
  "popup.damInflow": "น้ำไหลเข้า",
  "popup.damReleased": "ระบายออก",
  "popup.reportedAt": "รายงานเมื่อ",
  "popup.quakeTitle": "แผ่นดินไหว M{mag}",
  "popup.depth": "ความลึก",
  "popup.localTime": "เวลา (ท้องถิ่น)",
  "popup.nearestProvinces": "จังหวัดใกล้เคียง",
  "popup.source": "แหล่งข้อมูล",
  "popup.status": "สถานะ",
  "popup.statusAutomatic": "ตรวจพบอัตโนมัติ ยังไม่ตรวจสอบ",
  "popup.statusReviewed": "ตรวจสอบแล้ว",
  "popup.floodTitle": "ต.{tambon} — พื้นที่น้ำท่วม",
  "popup.mapPoint": "ตำแหน่งบนแผนที่",
  "popup.coords": "พิกัด",
  "popup.elevation": "ความสูงภูมิประเทศ (DSM)",
  "popup.amphoe": "อำเภอ",
  "popup.floodArea": "พื้นที่น้ำท่วม",
  "popup.firstSeen": "พบครั้งแรก",
  "popup.lastSeen": "พบล่าสุด",
  "popup.floodNote": "แปลจากภาพดาวเทียม (GISTDA) — สิ่งที่ตรวจพบแล้ว ไม่ใช่การพยากรณ์",

  // ── ป้ายกำกับบนฉาก 3 มิติ ─────────────────────────────────────────────
  "scene.loadingTerrain": "กำลังโหลดข้อมูลภูมิประเทศ...",
  "scene.buildingBuild": "กำลังสร้างอาคาร...",
  "scene.loadingHiRes": "กำลังโหลดภูมิประเทศความละเอียดสูง...",
  "scene.loadError": "โหลดแผนที่ 3 มิติไม่สำเร็จ",
  "scene.loadingImagery": "กำลังโหลดภาพดาวเทียม",
  "scene.notBuiltTitle": "ยังไม่ได้ประมวลผลภูมิประเทศของจังหวัดนี้",
  "scene.notBuiltBody": "ข้อมูลตรวจวัดยังแสดงตามปกติในแผงด้านข้าง",
  "scene.station": "สถานี {id}",
  "scene.aboveBankHistorical": "สูงกว่าตลิ่ง {n} ม. (ค่าย้อนหลัง)",
  "scene.belowBankHistorical": "ต่ำกว่าตลิ่ง {n} ม. (ค่าย้อนหลัง)",
  "scene.overflowObserved": "ล้นตลิ่ง (ตรวจวัดจริง)",
  "scene.highWaterObserved": "น้ำมาก (ตรวจวัดจริง)",
  "scene.rain24h": "ฝน 24 ชม. {n} มม.",
  "scene.floodArea": "พื้นที่น้ำท่วม",
  "scene.floodAreaRai": "น้ำท่วม {n} ไร่ (ภาพดาวเทียม)",
  "scene.floodPlain": "น้ำท่วม (ภาพดาวเทียม)",
  "scene.quakeLabel": "แผ่นดินไหว M{mag}",
  "scene.quakeAutomatic": "ตรวจพบ · ยังไม่ตรวจสอบ",
  "scene.quakeReviewed": "ตรวจพบ · ตรวจสอบแล้ว",
  "scene.damCapacity": "ความจุ {n}% (ตรวจวัดจริง)",
  "scene.damNoCapacity": "ไม่มีข้อมูลความจุ",

  // ── ข้อความผิดพลาดของ hooks ───────────────────────────────────────────
  "error.loadFailed": "โหลดไม่สำเร็จ",
  "error.observationsFailed": "โหลดข้อมูลตรวจวัดไม่สำเร็จ",
  "error.apiUnreachable": "เชื่อมต่อ API ไม่ได้ — ตรวจสอบว่าเซิร์ฟเวอร์ API ทำงานอยู่ (npm run dev)",
  "error.networkUnreachable": "เชื่อมต่อเครือข่ายไม่ได้ กำลังลองใหม่...",
  "error.earthquakeFeed": "ไม่สามารถเชื่อมต่อข้อมูลแผ่นดินไหว",

  // ── หน้าวิธีคำนวณ ─────────────────────────────────────────────────────
  "methodology.loading": "กำลังโหลดเอกสาร...",
  "methodology.back": "กลับไปที่แผนที่ {brand}",
  "methodology.doc.lowland": "พื้นที่ลุ่มต่ำ (ภาพประกอบ)",
  "methodology.doc.floodExposure": "ระดับการเผชิญน้ำ (ภาพประกอบ)",
  "methodology.notFoundTitle": "ไม่พบเอกสารนี้",
  "methodology.notFound": "ไม่พบเอกสาร",
  "methodology.notFoundBody": "ยังไม่มีเอกสารวิธีคำนวณชื่อ",
  "methodology.available": "เอกสารที่มีตอนนี้:",
  /**
   * เอกสารต้นฉบับใน `docs/methodology/` เขียนเป็นภาษาไทย และยังไม่มีฉบับแปล —
   * ต้องบอกตรง ๆ ไม่ใช่ปล่อยให้ผู้อ่านภาษาอังกฤษเข้าใจว่านี่คือฉบับแปลแล้ว
   */
  "methodology.thaiOnly":
    "เอกสารวิธีคำนวณฉบับนี้มีเฉพาะภาษาไทย ยังไม่มีฉบับแปลเป็นภาษาอังกฤษ",
} as const;
