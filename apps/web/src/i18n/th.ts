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
 *
 * ข้อยกเว้นเดียว (E12): คีย์ตระกูล `badge.forecast*` / `freshness.missing.forecast`
 * / `forecast.*` พูดคำว่า "พยากรณ์" ตรง ๆ ได้ เพราะเป็นผลจากแบบจำลองเชิงตัวเลขของ
 * กรมอุตุนิยมวิทยา (TMD) ที่อ้างอิงได้จริง ไม่ใช่ตัวเลขที่โครงการนี้แต่งขึ้น — แต่ทุก
 * ประโยคต้องมีคำว่า "TMD" อยู่ในประโยคเดียวกัน และยังห้ามคำตระกูลความน่าจะเป็น
 * (โอกาสเกิด / ความน่าจะเป็น / คะแนนความเสี่ยง) เด็ดขาด เพราะแบบจำลองนี้เป็นแบบ
 * deterministic (บังคับด้วยเทสใน `catalog.test.ts`)
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
  "badge.observed.title": "ค่าที่เครื่องมือวัดหรือดาวเทียมรายงานมาโดยตรง",
  "badge.staticReference": "ข้อมูลอ้างอิงคงที่",
  "badge.staticReference.title": "ชุดข้อมูลอ้างอิงที่มากับแผนที่ ไม่ได้อัปเดตแบบเรียลไทม์",
  "badge.illustrative": "ภาพประกอบ",
  "badge.illustrative.title":
    "เราคำนวณเองจากภูมิประเทศเพื่อช่วยอ่านแผนที่ ไม่ได้มาจากการตรวจวัด และไม่ใช่การพยากรณ์",
  "badge.probabilistic": "แบบจำลองภายนอกที่อ้างอิงได้",
  "badge.probabilistic.title":
    "ผลจากแบบจำลองของหน่วยงานภายนอกที่อ้างอิงที่มาได้ เราไม่ได้คำนวณเอง",
  /** ต้องมีคำว่า "TMD" ในทุกข้อความของชั้นพยากรณ์ — ดู catalog.test.ts */
  "badge.forecast": "พยากรณ์จากแบบจำลอง TMD",
  "badge.forecast.title":
    "ตัวเลขจากแบบจำลองสภาพอากาศเชิงตัวเลขของกรมอุตุนิยมวิทยา (TMD) เป็นผลพยากรณ์ของ TMD เอง ไม่ใช่ค่าที่วัดได้จริง และเราไม่ได้คำนวณเอง",
  "badge.unknown": "ไม่ทราบชนิดข้อมูล",
  "badge.unknown.title": "แอปเวอร์ชันนี้ยังไม่รู้จักชั้นข้อมูลประเภทนี้",

  // ── ความสดของชั้นข้อมูล (lib/layerFreshness.ts) ───────────────────────
  "freshness.observedAt": "ตรวจวัดเมื่อ {time}",
  "freshness.fetchedAt": "ดึงข้อมูลล่าสุด {age}",
  "freshness.missing.observed": "ยังไม่เคยได้รับข้อมูล",
  "freshness.missing.staticReference": "ไม่ได้บันทึกไว้ว่าดึงข้อมูลเมื่อไร",
  "freshness.missing.illustrative": "คำนวณจากภูมิประเทศ ไม่ได้ดึงข้อมูลใหม่เป็นรอบ ๆ",
  "freshness.missing.probabilistic": "ยังไม่เคยได้รับผลจากแบบจำลอง",
  "freshness.missing.forecast": "ยังไม่เคยได้รับผลพยากรณ์จาก TMD",
  "freshness.missing.unknown": "ไม่ทราบว่าดึงข้อมูลเมื่อไร",
  "freshness.status.unknown": "ยังไม่ทราบสถานะแหล่งข้อมูล",
  /** เวลาที่ *ต้นทาง* ประกาศว่าเผยแพร่ข้อมูลชุดนี้ — คนละเรื่องกับเวลาที่เราดึง */
  "freshness.publishedAt": "ต้นทางเผยแพร่เมื่อ {time}",
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
  "health.downNeverFetched": "ต้นทางไม่ตอบ และยังไม่เคยได้ข้อมูลเลย",
  "health.delayedWithAge": "{label} (ค่าล่าสุด {age})",
  /**
   * แหล่งที่ "เราคำนวณเอง" (`exposure-illustrative`) — `latestObservedAt` ของมันคือ
   * เวลาที่เราคำนวณ run ล่าสุด ไม่ใช่เวลาที่สถานีไหนถูกอ่านค่า เรียกมันว่า
   * "ค่าล่าสุด" จะทำให้อายุของค่าตรวจวัดจริงดูใหม่กว่าความเป็นจริง
   */
  "health.delayedNoRun": "ยังไม่มีผลคำนวณรอบใหม่",
  "health.delayedWithRunAge": "{label} (รอบล่าสุด {age})",
  "health.tooltip.fetched": " · ดึงสำเร็จล่าสุด {age}",
  "health.tooltip.line": "{source}: {status}{fetched}",
  "status.apiDown": "เชื่อมต่อ API ไม่ได้",
  "status.apiDown.detail": "— ยังดูแผนที่ได้ แต่ไม่มีค่าตรวจวัดสด",
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
  "topbar.repoTitle": "ดูซอร์สโค้ดบน GitHub (โอเพนซอร์ส)",

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
  "legend.layer.radar.note": "ภาพเรดาร์ย้อนหลัง 3 ชั่วโมง เล่นวนซ้ำ เป็นค่าที่ตรวจวัดจริง",
  "legend.layer.floodExtent": "น้ำท่วมจากภาพดาวเทียม (GISTDA)",
  "legend.layer.floodExtent.note": "พื้นที่ที่ตรวจพบจากภาพดาวเทียมชุดล่าสุด ไม่ใช่การพยากรณ์",
  "legend.layer.lowland": "พื้นที่ลุ่มต่ำ",
  "legend.layer.lowland.note": "ประมาณจากความสูงภูมิประเทศ ไม่ใช่การพยากรณ์น้ำท่วม",

  /**
   * E14.F4 — สองชั้นซ้อนกันจาก Copernicus GFM: พื้นที่ท่วม = ตรวจวัดจริง (ภาพเรดาร์
   * Sentinel-1 หนึ่งรอบบิน มีเวลาบันทึกภาพจริง) ส่วนความลึก = ภาพประกอบที่เราคำนวณ
   * ต่อด้วย FwDET (docs/methodology/flood-depth.md) — "ไม่ได้ประมาณ" ต้องมีคำของตัวเอง
   * เพราะมันไม่ใช่ 0 ม. และ `likelihood` ของ GFM ถ้าจะพูดถึงต้องเรียกว่า
   * "ความเชื่อมั่นของการจำแนกภาพ" เท่านั้น (ยังไม่แสดงใน F4)
   */
  "legend.layer.floodGfm": "น้ำท่วมจากดาวเทียม Sentinel-1 (Copernicus GFM)",
  "legend.layer.floodGfm.note": "แยกพื้นที่น้ำท่วมจากภาพเรดาร์ Sentinel-1 ทีละภาพตามรอบที่ดาวเทียมโคจรผ่าน เป็นข้อมูลที่ตรวจวัดจริง ไม่ใช่การพยากรณ์",
  "legend.layer.floodDepth": "ความลึกน้ำโดยประมาณ (ภาพประกอบ, FwDET)",
  "legend.layer.floodDepth.note":
    "เราคำนวณเองด้วยวิธี FwDET จากขอบน้ำในภาพและความสูงของพื้นที่ ไม่ได้วัดจริง และไม่ใช่การพยากรณ์",
  "legend.floodGfm.scene": "ภาพ {id} · ถ่ายเมื่อ {time}",
  "legend.floodGfm.area": "พื้นที่น้ำท่วมในภาพ {km2} ตร.กม. (คิดบนกริดภาพรวมของจังหวัด)",
  "legend.floodGfm.dry": "ภาพนี้ไม่พบน้ำท่วม — ดาวเทียมถ่ายภาพแล้วจริง ไม่ใช่ว่าไม่มีภาพ",
  /** {days} = หน้าต่างย้อนหลัง (FLOOD_SCENE_MAX_AGE_MS) — ไม่มีภาพ ≠ ไม่มีน้ำท่วม */
  "legend.floodGfm.noSceneInWindow": "ไม่มีภาพในช่วง {days} วันก่อนเวลาที่เลือก — ไม่ได้แปลว่าไม่มีน้ำท่วม",
  "legend.floodGfm.latestBefore": "ภาพล่าสุดก่อนหน้านั้นถ่ายเมื่อ {time}",
  "legend.floodGfm.noScenesForProvince": "ยังไม่มีภาพของจังหวัดนี้ในระบบ — ไม่ได้แปลว่าไม่มีน้ำท่วม",
  /** "ถามไม่ได้" — ห้ามอ่านเป็น "ไม่มีฉาก" */
  "legend.floodGfm.indexError": "โหลดรายการภาพไม่ได้: {error}",
  "legend.floodGfm.fieldError": "โหลดภาพไม่ได้: {error}",
  "legend.floodGfm.loading": "กำลังโหลดภาพ...",
  "legend.floodDepth.scale": "ความลึกโดยประมาณ (ม.)",
  "legend.floodDepth.notEstimated": "ประมาณไม่ได้",
  "legend.floodDepth.notEstimated.why":
    "บริเวณที่มีอาคารหรือต้นไม้ ข้อมูลความสูงวัดถึงหลังคาหรือยอดไม้ จึงประมาณความลึกไม่ได้ (ไม่ได้แปลว่าลึก 0 ม.)",
  "legend.floodDepth.estimated": "ประมาณความลึกได้ {pct}% ของพื้นที่ที่ท่วม ลึกสุด {max} ม.",
  "legend.floodDepth.noneEstimated": "น้ำท่วมในภาพนี้อยู่เฉพาะบริเวณที่ประมาณความลึกไม่ได้",
  "legend.floodDepth.needsExtent": "ต้องเปิดชั้น Sentinel-1 ด้วย เพราะความลึกคำนวณจากภาพนั้น จึงแสดงแยกเดี่ยว ๆ ไม่ได้",

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
    "ใช้ค่าตรวจวัดจาก ThaiWater ได้แก่ ฝน 1 ชม., ฝน 24 ชม., ระยะที่น้ำต่ำกว่าตลิ่งและการเปลี่ยนแปลงของระยะนี้ และระดับสถานการณ์ที่ ThaiWater ประกาศ แล้วนำไปซ้อนกับพื้นที่ลุ่มต่ำที่คำนวณจากความสูงของพื้นที่ (DEM)",
  /** {h} มาจาก `inputs.historyWindowH` ของ run เอง ไม่ใช่ค่าที่ฝั่งเว็บตั้งไว้ */
  "legend.exposure.historyWindow": "การเปลี่ยนแปลงคิดจากข้อมูลย้อนหลัง {h} ชม. ที่เกิดขึ้นไปแล้ว",
  "legend.exposure.computedAt": "คำนวณล่าสุด {age}",
  /** ต้องบอก "ตั้งแต่เมื่อไหร่" เสมอ ห้ามแค่บอกว่าใช้ไม่ได้ */
  "legend.exposure.noRunSince": "ยังไม่มีผลคำนวณใหม่ตั้งแต่ {time} — ที่เห็นอยู่เป็นผลรอบเก่า",
  "legend.exposure.staleInputs":
    "ที่เห็นเป็นผลรอบ {time} แต่ตอนนี้ ThaiWater ขัดข้องอยู่ ข้อมูลที่ใช้คำนวณรอบนี้อาจไม่ครบหรือเก่าไปบางส่วน",
  /**
   * ใช้ได้เฉพาะตอนที่ "ถามไปแล้ว" เท่านั้น — ชั้นปิดอยู่คือยังไม่มีใครถาม จึงใช้
   * `legend.exposure.layerOff` แทน (ห้ามพูดถึงสถานะของแหล่งข้อมูลที่ไม่เคยถูกตรวจ)
   */
  "legend.exposure.noRunEver": "ยังไม่เคยได้ผลคำนวณเลยสักรอบ แผนที่จึงยังไม่มีอะไรให้แสดง",
  /**
   * ต่างจาก `noRunEver`: กรณีนี้เซิร์ฟเวอร์เคยเผยแพร่ run จริง (หรือไม่รู้ว่าเคยไหม)
   * แต่ตอนนี้ตอบค่าที่ขอไม่ได้ — ห้ามใช้ `noRunEver` เพราะเป็นการยืนยันเท็จว่า
   * "ไม่เคยมี" และไม่ใช่ `apiDown*` เพราะเซิร์ฟเวอร์ตอบมาแล้วจริง ๆ (ดู
   * `reason: "missing" | "error"` ใน apps/api/src/routes/exposure.ts)
   */
  "legend.exposure.runUnavailable": "ผลคำนวณอาจมีอยู่แล้ว แต่ตอนนี้ดึงมาแสดงไม่ได้",
  "legend.exposure.layerOff": "ชั้นนี้ปิดอยู่ จึงยังไม่ได้ขอผลคำนวณจากเซิร์ฟเวอร์",
  /*
   * "ติดต่อไม่ได้" ไม่ใช่ "เซิร์ฟเวอร์ไม่ได้คำนวณ" — สองข้อความข้างบนพูดถึงสิ่งที่
   * ฝั่งเซิร์ฟเวอร์ทำหรือไม่ได้ทำ ซึ่งจะพูดได้ก็ต่อเมื่อถามไปแล้วและได้คำตอบกลับมา
   * ถ้าเรียก API ไม่สำเร็จ สิ่งเดียวที่รู้คือ "เราไม่ได้คำตอบ" จะเอาไปแปลว่าไม่มี
   * รอบใหม่ไม่ได้ (AGENTS.md: ห้ามแสดงสถานะที่ไม่เคยถูกตรวจว่าเป็นข้อเท็จจริง)
   */
  "legend.exposure.apiDownSince": "ติดต่อ API ไม่ได้ — ที่เห็นอยู่เป็นผลรอบ {time} และยังไม่รู้ว่ามีรอบใหม่กว่านี้หรือไม่",
  "legend.exposure.apiDownNoRun": "ติดต่อ API ไม่ได้ จึงยังไม่ได้รับผลคำนวณเลย",
  "legend.exposure.scale": "ระดับของค่าที่วัดได้",
  "legend.exposure.level.low": "ต่ำสุด (วัดได้จริง)",
  "legend.exposure.level.elevated": "สูงกว่าระดับต่ำสุด",
  "legend.exposure.level.high": "สูง",
  "legend.exposure.level.severe": "สูงสุดตามเกณฑ์",
  "legend.exposure.level.noData": "ไม่มีค่าที่วัดได้ จึงจัดระดับไม่ได้ (ไม่ได้แปลว่าปลอดภัย)",
  "legend.exposure.stationCount": "{n} สถานี",
  /** ภาษาไทยไม่ต่างรูปพหูพจน์ แต่คีย์ต้องมีครบทั้งสองภาษา (ฝั่ง en ต้องใช้จริง) */
  "legend.exposure.stationCount.one": "1 สถานี",
  "legend.exposure.integrity.mismatch":
    "ข้อมูลภูมิประเทศไม่ผ่านการตรวจสอบ ชั้นนี้จึงถูกปิด เพราะอาศัยพื้นที่ลุ่มต่ำที่คำนวณจากข้อมูลชุดเดียวกัน",
  /** ป้ายบนแผนที่ของสถานีที่ไม่มีปัจจัยใดวัดได้ (scene/ExposureMarkers.ts) */
  "exposure.noData.label": "ไม่มีข้อมูลให้จัดระดับ",
  "exposure.noData.sub": "สถานีนี้ไม่ได้ส่งค่าใดมาเลย ไม่ได้แปลว่าปลอดภัย",
  /**
   * E9.1 — ผลตรวจ sha256 ของ terrain.bin เทียบกับลายเซ็นใน manifest
   * `unknown` = ยังไม่ได้ตรวจ (manifest ไม่มีลายเซ็น) ห้ามอ่านว่า "ตรวจแล้วไม่ผ่าน"
   * และห้ามปิดชั้นข้อมูลใด ๆ; มีแต่ `mismatch` เท่านั้นที่ปิดชั้นพื้นที่ลุ่มต่ำ
   */
  "legend.integrity.mismatch": "ข้อมูลภูมิประเทศไม่ผ่านการตรวจสอบ จึงใช้ชั้นพื้นที่ลุ่มต่ำไม่ได้",
  "legend.integrity.unknown": "ยังตรวจสอบข้อมูลภูมิประเทศไม่ได้ เพราะ manifest ไม่มีค่า checksum ให้เทียบ",
  "legend.layer.hazard": "บริเวณสถานีเตือนภัย",
  "legend.layer.hazard.note": "วงรอบสถานีที่วัดฝนหนักหรือน้ำสูงได้จริง",
  "legend.layer.stations": "สถานีตรวจวัด",
  "legend.layer.stations.note": "จุดกลมคือสถานีวัดระดับน้ำ ข้าวหลามตัดคือสถานีวัดฝน",
  "legend.layer.water": "แม่น้ำ / คลอง / แหล่งน้ำ (OSM)",
  "legend.layer.water.note": "ผิวน้ำ 3 มิติตามความสูงของพื้นที่ ซ่อนเองเมื่อกล้องสูงเกิน {km} กม.",
  "legend.layer.roads": "ถนนสายหลัก (OSM)",
  "legend.layer.roads.note": "มอเตอร์เวย์ ทางหลวง และถนนสายรอง ซ่อนเองเมื่อกล้องสูงเกิน {km} กม.",
  "legend.layer.dams": "เขื่อน / อ่างเก็บน้ำ",
  "legend.layer.dams.note": "% ความจุตามที่ ThaiWater รายงาน",
  "legend.layer.cctv": "กล้อง CCTV (กรมทรัพยากรน้ำ และ iTIC)",
  "legend.layer.cctv.note":
    "หมุดวงกลมคือกล้องริมน้ำที่สถานีโทรมาตรของกรมทรัพยากรน้ำ ภาพนิ่งอัปเดตราว 15 นาทีครั้ง เวลาที่แสดงคือเวลาถ่ายภาพ และกด \"ดูสด\" เพื่อดูภาพสดได้ เราจะขอภาพจาก DWR ก็ต่อเมื่อคลิกหมุดเท่านั้น",
  "legend.layer.cctv.error": "โหลดรายการกล้องของกรมทรัพยากรน้ำไม่สำเร็จ ({error}) บนแผนที่จึงไม่มีหมุดกล้อง DWR",
  "legend.layer.cctv.errorItic": "โหลดรายการกล้องถนนของ iTIC ไม่สำเร็จ ({error}) บนแผนที่จึงไม่มีหมุดกล้องถนน",
  "legend.layer.cctv.noteItic":
    "หมุดสี่เหลี่ยมสีอำพันคือกล้องถนนของกรมทางหลวงและหน่วยงานพันธมิตร ผ่านมูลนิธิ iTIC (รายการกล้องจาก Longdo) — หมุดรูปสามเหลี่ยม \"เล่น\" คือวิดีโอสด หมุดรูปกล้องคือภาพนิ่งที่ขอใหม่ทุก ~5 วินาที (บางกล้องในกรุงเทพฯ) เราจะขอจาก iTIC ก็ต่อเมื่อคลิกหมุดเท่านั้น",
  "legend.layer.cctv.iticOnly": "กล้องถนน (iTIC)",
  "legend.layer.cctv.dwrOnly": "ภาพกล้อง CCTV (กรมทรัพยากรน้ำ)",
  "legend.layer.sunlight": "แสงอาทิตย์ตามเวลาจริง",
  "legend.layer.sunlight.note": "ตำแหน่งดวงอาทิตย์และสีท้องฟ้าตามเวลาปัจจุบัน หรือตามเวลาที่เลือกบนไทม์ไลน์",
  "legend.layer.trees": "ต้นไม้ (ESA WorldCover)",
  "legend.layer.trees.note": "ป่าและสวนจากแผนที่สิ่งปกคลุมดินความละเอียด 10 ม. แสดงเมื่อซูมเข้าใกล้",
  "legend.layer.buildings": "อาคาร 3 มิติ (OSM)",
  "legend.layer.buildings.note": "ครบทั้งจังหวัด มองจากไกลจะเห็นเฉพาะอาคารใหญ่หรือสูง ซ่อนเองเมื่อกล้องสูงเกิน {km} กม.",
  "legend.layer.buildings.error": "โหลดอาคารของพื้นที่นี้ไม่สำเร็จ สวิตช์ยังเปิดอยู่แต่แผนที่ไม่มีอาคารให้แสดง",
  "legend.layer.localAuthorities": "ขอบเขต อปท. (OpenStreetMap)",
  "legend.layer.localAuthorities.note":
    "แสดงเฉพาะ อปท. ที่มีขอบเขตใน OSM ซึ่งมีเทศบาลนครครบทุกแห่ง แต่เทศบาลเมือง เทศบาลตำบล และ อบต. มีเพียงบางส่วน ไม่ครบทั้ง 7,849 แห่ง",
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
  "exaggeration.factor": "ขยายความสูง {n} เท่า (ไม่ใช่ขนาดจริง)",

  // ── ไทม์ไลน์ ──────────────────────────────────────────────────────────
  "timeline.title": "ระดับน้ำย้อนหลัง",
  "timeline.rangeLabel": "ช่วงเวลาย้อนหลัง",
  "timeline.range.72h": "72 ชม.",
  "timeline.range.7d": "7 วัน",
  "timeline.range.30d": "30 วัน",
  "timeline.notForecast": "ค่าตรวจวัดจริง · ไม่ใช่พยากรณ์",
  "timeline.fromArchive": "จากคลังข้อมูล · รายชั่วโมง",
  "timeline.live": "ปัจจุบัน · ค่าล่าสุด",
  "timeline.play": "เล่นย้อนหลัง",
  "timeline.pause": "หยุด",
  "timeline.backToLive": "กลับไปเวลาปัจจุบัน",
  "timeline.slider": "เลื่อนเวลา",
  "timeline.tick.now": "ตอนนี้",
  "timeline.tick.days": "-{n} วัน",
  "timeline.tick.hours": "-{n} ชม.",
  /** E14.F5 — เวลาที่เลือกเก่ากว่าช่วงของแถบ: หัวเลื่อนที่ชิดซ้ายไม่ใช่ "30 วันที่แล้ว" */
  "timeline.outOfRange": "นอกช่วงของแถบเลื่อน",
  "timeline.marks": "ภาพจาก Sentinel-1",
  "timeline.mark.flooded": "ภาพ Sentinel-1 {time} · ท่วม {km2} ตร.กม.",
  "timeline.mark.dry": "ภาพ Sentinel-1 {time} · ไม่พบน้ำท่วม",

  // ── แถบตัวเลขสรุป ─────────────────────────────────────────────────────
  "stats.none": "ไม่มีข้อมูลตรวจวัด",
  "stats.rainStations": "สถานีวัดน้ำฝน",
  "stats.maxRain24h": "ฝนสูงสุด 24 ชม.",
  "stats.waterStations": "สถานีวัดระดับน้ำ",
  "stats.aboveWarning": "เกินเกณฑ์เฝ้าระวัง",

  // ── เครดิตใต้แผนที่ ───────────────────────────────────────────────────
  "attribution.terrain": "ภูมิประเทศ Copernicus GLO-30 ({demType}) · {cell}",
  "attribution.cellLod": "{m} ม./เซลล์ (ละเอียดขึ้นเมื่อซูมเข้า)",
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
  "attribution.noEndorsement": "หน่วยงานเหล่านี้เป็นผู้เผยแพร่ข้อมูล แต่ไม่ได้รับรองโครงการนี้",
  "attribution.imageryEsri": "ภาพดาวเทียม Esri",
  "attribution.snapshotHistorical": "ข้อมูลย้อนหลัง ณ {time}",

  // ── สถานะข้อมูลใต้แผงซ้าย ─────────────────────────────────────────────
  "footer.dataStatus": "สถานะข้อมูล",
  "footer.notConnected": "ยังไม่เชื่อมต่อ",
  "footer.stale": "ข้อมูลค้าง",
  "footer.ok": "ปกติ",

  // ── ปุ่มควบคุมมุมมอง ──────────────────────────────────────────────────
  "viewport.province": "จังหวัด{name}",
  "viewport.subtitle": "มุมมอง 3 มิติจากภูมิประเทศจริง",
  "viewport.radarFrame": "เรดาร์ฝน TMD {time} น.",
  "viewport.north": "หันกลับทิศเหนือ",
  "viewport.orbit": "หมุน/เอียงมุมมอง",
  "viewport.pan": "เลื่อนแผนที่",
  "viewport.zoomIn": "ซูมเข้า",
  "viewport.zoomOut": "ซูมออก",
  "viewport.fullscreen": "เต็มหน้าจอ",
  "viewport.exitFullscreen": "ออกจากเต็มหน้าจอ",
  /** ป้ายข้างชื่อจังหวัดเมื่อไทม์ไลน์ถูกเลื่อนย้อนหลัง — ต้องบอกเสมอว่าไม่ใช่ค่าปัจจุบัน */
  "viewport.historical": "ดูย้อนหลัง {time}",

  // ── แผงข้อมูล (rail + drawer บนจอกว้าง / แท็บของแผ่นเลื่อนบนมือถือ) ─────
  "rail.aria": "แผงข้อมูล",
  "drawer.close": "ปิดแผง",
  "panel.layers": "ชั้นข้อมูล",
  "panel.flood": "น้ำท่วม",
  "panel.impact": "ผลกระทบรายพื้นที่",
  "panel.water": "ระดับน้ำ",
  "panel.rain": "ฝน",
  // แผงนี้ไม่อยู่ในรายการ key ที่ยกเว้นคำว่า "พยากรณ์" ของ catalog.test.ts
  // (ผูกเฉพาะ `forecast.*`/`badge.forecast*`) จึงใช้ชื่อหน่วยงานตรง ๆ แทน
  "panel.forecast": "TMD",
  "panel.dams": "เขื่อน",
  "panel.quake": "แผ่นดินไหว",

  // ── แผ่นเลื่อนบนจอเล็ก ────────────────────────────────────────────────
  "sheet.collapse": "ย่อแผง",
  "sheet.expand": "ขยายแผง",
  "sheet.dragHandle": "ลากเพื่อย่อหรือขยายแผง",

  // ── ชิปจังหวัดในแถบบน ─────────────────────────────────────────────────
  "province.chip.aria": "เปลี่ยนจังหวัด (ตอนนี้: {name})",

  // ── แถบสถานะแหล่งข้อมูลใน dock ────────────────────────────────────────
  "status.openAll": "ดูสถานะทุกแหล่งข้อมูล",
  /** โผล่ข้างจุดสถานะเสมอเมื่อมีแหล่งใดไม่ปกติ — แหล่งที่เสื่อมต้องอ่านออกแม้ drawer ปิด */
  "status.degradedCount": "{n} แหล่งผิดปกติ",

  // ── เครดิตแบบย่อ/ขยาย ─────────────────────────────────────────────────
  "attribution.expand": "ดูรายละเอียดภูมิประเทศ มาตราส่วน และชุดข้อมูล",
  "attribution.collapse": "ซ่อนรายละเอียดภูมิประเทศ",
  /** มือถือ: ปุ่มที่กางรายการลิงก์แหล่งข้อมูลทั้ง {n} แห่ง (บรรทัดย่อมีที่ไม่พอสำหรับลิงก์ทั้งหมด) */
  "attribution.sourcesCount": "แหล่งข้อมูล ({n})",

  // ── toast / badge แจ้งเตือน อปท. (lib/alertSummary.ts) ─────────────────
  "alert.toast.active": "มีแจ้งเตือน อปท. {n} รายการ",
  "alert.toast.unreachable": "ติดต่อระบบแจ้งเตือน อปท. ไม่ได้",
  "alert.toast.degraded": "ดึงข้อมูลแจ้งเตือน อปท. รอบล่าสุดไม่สำเร็จ รายการอาจยังไม่อัปเดต",
  "alert.toast.open": "เปิดดู",
  "alert.badge.neverEvaluated": "ระบบแจ้งเตือนยังไม่เคยทำงานสักรอบ",

  // ── การ์ดน้ำท่วมจากภาพดาวเทียม ────────────────────────────────────────
  "flood.title": "น้ำท่วมจากภาพดาวเทียม",
  "flood.observedChip": "ตรวจพบจริง",
  "flood.loadError": "โหลดชั้นน้ำท่วมไม่ได้: {error}",
  "flood.noScene": "ยังไม่ได้ภาพชุดล่าสุดจาก GISTDA (กำลังลองดึงอยู่) — ไม่ได้แปลว่าไม่มีน้ำท่วม",
  "flood.none": "ภาพชุดล่าสุดไม่พบพื้นที่น้ำท่วมในจังหวัดนี้",
  "flood.noneFetched": " (ดึงเมื่อ {age})",
  "flood.historicalScene": "ภาพ ณ {time} เป็นชุดที่ GISTDA มีในช่วงเวลาที่เลือก ไม่ใช่ชุดล่าสุด",
  "flood.noArchivedScene":
    "ไม่มีภาพที่เก็บไว้ ณ {time} เพราะเราเริ่มเก็บขอบเขตน้ำท่วมตั้งแต่เปิดใช้ชั้นนี้ — ไม่ได้แปลว่าไม่มีน้ำท่วม",
  "flood.noneHistorical": "ภาพในช่วงเวลาที่เลือกไม่พบพื้นที่น้ำท่วมในจังหวัดนี้",
  "flood.tambonCount": "ตำบลที่ท่วม",
  "flood.areaRai": "พื้นที่ (ไร่)",
  "flood.households": "บ้านเรือน",
  "flood.unknownTambon": "ไม่ระบุตำบล",
  "flood.firstSeen": "พบครั้งแรก {time}",
  "flood.note":
    "GISTDA แปลขอบเขตน้ำท่วมจากภาพดาวเทียม (ชุดข้อมูล flooding_vis) เป็นพื้นที่ที่ตรวจพบแล้ว ไม่ใช่การพยากรณ์ ภาพชุดนี้ไม่ระบุวันที่ถ่าย เราจึงแสดงเวลาที่ดึงข้อมูลแทน",
  "flood.noteEarliest": " พร้อมเวลาที่พบแต่ละพื้นที่ครั้งแรก (เก่าสุด {time})",

  // ── การ์ดฉาก Sentinel-1 / Copernicus GFM (E14.F5) ───────────────────
  "floodScenes.section.shown": "ภาพที่แสดงอยู่ · Sentinel-1 (Copernicus GFM)",
  "floodScenes.section.passes": "ภาพทั้งหมดจาก Sentinel-1",
  "floodScenes.section.events": "ช่วงน้ำท่วมที่เห็นจากดาวเทียม",
  "floodScenes.section.gistda": "ขอบเขตน้ำท่วมจาก GISTDA",
  "floodScenes.sceneId": "รหัสภาพ",
  "floodScenes.observedAt": "ถ่ายเมื่อ",
  "floodScenes.publishedAt": "GFM เผยแพร่เมื่อ",
  "floodScenes.publishedAt.unknown": "ต้นทางไม่ได้ระบุ",
  "floodScenes.area": "พื้นที่ท่วมในภาพ",
  "floodScenes.area.value": "{km2} ตร.กม. (คิดบนกริดภาพรวม)",
  "floodScenes.depthShare": "สัดส่วนที่ประมาณความลึกได้",
  "floodScenes.maxDepth": "ลึกสุด (ภาพประกอบ)",
  "floodScenes.medianDepth": "ค่ากลาง (ภาพประกอบ)",
  /** ระยะจากภาพถึงเวลาที่เลือก — บอกแค่ว่าภาพเก่ากว่าเท่าไร ห้ามอ่านเป็นสภาพ ณ เวลาที่เลือก */
  "floodScenes.gap": "ภาพล่าสุดก่อนเวลาที่เลือก: {duration}",
  "floodScenes.gap.why": "ภาพบอกสภาพตอนที่ถ่ายเท่านั้น ไม่ใช่สภาพ ณ เวลาที่เลือก",
  "floodScenes.gap.days": "{d} วัน {h} ชม.",
  "floodScenes.gap.hours": "{h} ชม. {m} นาที",
  "floodScenes.gap.minutes": "{m} นาที",
  "floodScenes.jumpToLatest": "ไปที่ภาพล่าสุดก่อนเวลานั้น",
  "floodScenes.selectedTime": "เวลาที่เลือก: {time}",
  "floodScenes.dry": "ไม่ท่วม",
  "floodScenes.km2": "{km2} ตร.กม.",
  "floodScenes.shownMarker": "กำลังแสดง",
  "floodScenes.selectScene": "แสดงภาพนี้",
  "floodScenes.more": "…และอีก {n} ภาพ",
  "floodScenes.event.peak": "ท่วมมากสุด {km2} ตร.กม. เมื่อ {time}",
  "floodScenes.event.scenes": "{n} ภาพ",
  "floodScenes.event.scenes.one": "1 ภาพ",
  "floodScenes.event.select": "แสดงภาพที่ท่วมมากที่สุดของช่วงนี้",
  "floodScenes.events.none": "ไม่มีภาพไหนในรายการนี้ที่พบน้ำท่วม",
  "floodScenes.events.note":
    "ภาพที่พบน้ำท่วมและถ่ายห่างกันไม่เกิน 7 วันจะนับเป็นช่วงน้ำท่วมเดียวกัน ระหว่างภาพสองภาพไม่มีข้อมูล จึงไม่รู้ว่าช่วงนั้นเป็นอย่างไร",
  "floodScenes.passes.note": "แต่ละรายการคือภาพหนึ่งภาพจากการที่ดาวเทียมโคจรผ่านหนึ่งครั้ง ภาพที่ไม่พบน้ำท่วมก็นับเป็นข้อมูล เพราะดาวเทียมถ่ายแล้วจริง",

  // ── การ์ดระดับน้ำ ─────────────────────────────────────────────────────
  "water.title": "ระดับน้ำที่ตรวจวัดได้",
  "water.historicalNote":
    "กำลังดูข้อมูลย้อนหลัง สีจุดบนแผนที่จึงคิดจากระยะที่น้ำต่ำกว่าตลิ่ง เพราะ ThaiWater ไม่เผยแพร่ระดับสถานการณ์ย้อนหลัง",
  "water.overflowing": "มี {n} สถานีอยู่ในเกณฑ์น้ำมากหรือล้นตลิ่ง",
  "water.none": "ไม่มีสถานีวัดระดับน้ำในจังหวัดนี้",
  "water.note": "ค่าที่วัดจริงจากสถานีโทรมาตร ไม่ใช่การพยากรณ์",
  "water.observedAt": " · ข้อมูลเมื่อ {time}",
  "water.stationFallback": "สถานี {id}",
  "water.aboveBank": "สูงกว่าตลิ่ง {n} {unit}",
  "water.belowBank": "ต่ำกว่าตลิ่ง {n} {unit}",
  "water.historicalChip": "ข้อมูลย้อนหลัง",
  "water.sparkline.aria": "กราฟระดับน้ำ 72 ชั่วโมง",
  "water.sparkline.bank": "ตลิ่งต่ำสุด",
  "water.sparkline.none": "ข้อมูลย้อนหลังไม่พอให้วาดกราฟ",
  "water.history.caption": "72 ชม. ล่าสุด · {datum} · วัดจริงทุก 10 นาที",
  "water.datum.msl": "ม.รทก.",
  "water.datum.local": "ม. (เทียบระดับอ้างอิงของสถานี)",
  "water.datum.unknown": "ม.",

  // ── การ์ดฝน ───────────────────────────────────────────────────────────
  "rain.title": "ปริมาณฝน 24 ชั่วโมง",
  "rain.reporting": "{n} สถานี",
  "rain.wetSummary": "ฝนตก {wet} จาก {total} สถานีที่รายงาน",
  "rain.none": "ไม่มีสถานีวัดน้ำฝนในจังหวัดนี้",
  "rain.note": "ปริมาณฝนสะสมที่วัดจริงจากสถานีโทรมาตร ไม่ใช่การพยากรณ์",

  // ── การ์ดพยากรณ์ TMD (E12.3) ─────────────────────────────────────────
  // ทุกคีย์ที่พูดคำว่า "พยากรณ์" ต้องมีคำว่า "TMD" อยู่ในสตริงเดียวกันเสมอ
  // (ข้อยกเว้นใน catalog.test.ts) และห้ามคำตระกูลความน่าจะเป็นเด็ดขาด
  "forecast.title": "พยากรณ์อากาศ TMD",
  "forecast.headerCount": "{n} ชม. ข้างหน้า",
  "forecast.none": "ยังไม่เคยได้รับผลพยากรณ์จาก TMD สำหรับจังหวัดนี้",
  "forecast.staleNote": "TMD ยังไม่ส่งผลพยากรณ์ชุดใหม่ตามกำหนด ตัวเลขด้านล่างเป็นชุดล่าสุดที่มี",
  "forecast.note": "ตัวเลขจากแบบจำลองสภาพอากาศเชิงตัวเลขของ TMD (NWP) เป็นค่าที่แบบจำลองคำนวณออกมาค่าเดียว ไม่ใช่ความน่าจะเป็น",
  "forecast.hourly.title": "รายชั่วโมง",
  "forecast.hourly.unit": "มม./ชม.",
  "forecast.hourly.none": "ชุดนี้ TMD ไม่ได้ส่งปริมาณฝนรายชั่วโมงมา",
  "forecast.hourly.chartAria": "กราฟปริมาณฝนรายชั่วโมง 48 ชั่วโมงข้างหน้า",
  "forecast.daily.title": "รายวัน",
  "forecast.daily.unit": "มม./24 ชม.",
  "forecast.daily.none": "ชุดนี้ TMD ไม่ได้ส่งปริมาณฝนรายวันมา",

  // ── แถบเวลาพยากรณ์ (ForecastStrip, E12.4a) ────────────────────────────
  "forecast.strip.clear": "ล้างการเลือก",
  "forecast.strip.slider": "เลื่อนดูตัวเลขรายชั่วโมง",
  "forecast.strip.notSelected": "ยังไม่ได้เลือกชั่วโมง",
  "forecast.strip.prompt": "ลากเพื่อดูตัวเลขของชั่วโมงนั้น",
  "forecast.strip.rain": "ฝน",
  "forecast.strip.temp": "อุณหภูมิ",
  "forecast.strip.cond": "สภาพอากาศ (รหัส)",
  "forecast.strip.notSent": "TMD ไม่ได้ส่งค่านี้มา",
  "forecast.strip.tickHours": "+{n} ชม.",
  "forecast.strip.noSteps": "ชุดนี้ TMD ไม่ได้ส่งข้อมูลรายชั่วโมงมาเลย",

  // ── แถบฝนพยากรณ์รายวันบนแผนที่ 3 มิติ (E12.4b) ────────────────────────
  "forecast.band.label": "ฝนพยากรณ์ 24 ชม. จาก TMD",
  // TMD ส่งค่ามาจริง และค่านั้นต่ำกว่าเกณฑ์ที่ต้องเน้นสี — ข้อเท็จจริงที่แบบจำลอง
  // ยืนยัน ต้องไม่ใช้ข้อความเดียวกับ noValue (ซึ่งคือ "เราไม่รู้")
  "forecast.band.belowThreshold": "TMD พยากรณ์ฝนวันนี้ไว้ต่ำกว่าเกณฑ์ที่จะแสดงสีบนแผนที่",
  // ไม่มีขั้นรายวันของวันนี้เลย หรือมีขั้นแต่ค่าฝนเป็น null — สองกรณีนี้คือ
  // "ไม่มีค่าให้อ่าน" เหมือนกันจากมุมของผู้ใช้ ต้องแยกจาก belowThreshold ข้างบน
  "forecast.band.noValue": "TMD ไม่มีค่าฝนพยากรณ์ของวันนี้",

  // ── การ์ดเขื่อน ───────────────────────────────────────────────────────
  "dam.title": "เขื่อนและอ่างเก็บน้ำ",
  "dam.count": "{n} แห่ง",
  "dam.none": "ไม่มีเขื่อนหรืออ่างเก็บน้ำที่รายงานข้อมูลในจังหวัดนี้",
  "dam.prefix": "เขื่อน",
  "dam.reservoir": "อ่างเก็บน้ำ",
  "dam.inflow": " · น้ำไหลเข้า {n}",
  "dam.released": " · ระบาย {n}",
  "dam.note":
    "ปริมาณน้ำตามที่กรมชลประทานและ กฟผ. รายงานผ่าน ThaiWater (สสน.) แสดงเฉพาะค่าที่รายงานภายใน 48 ชม.",

  // ── การ์ดแผ่นดินไหว ───────────────────────────────────────────────────
  "quake.title": "แผ่นดินไหวที่ตรวจวัดได้",
  "quake.conn.connecting": "กำลังเชื่อมต่อ",
  "quake.conn.live": "เรียลไทม์",
  "quake.conn.polling": "ดึงข้อมูลเป็นระยะ",
  "quake.conn.reconnecting": "หลุดการเชื่อมต่อ กำลังต่อใหม่",
  "quake.conn.error": "เชื่อมต่อไม่ได้",
  "quake.events30d": "เหตุการณ์ 30 วันล่าสุด",
  "quake.maxMag": "ขนาดสูงสุด",
  "quake.parseErrors": "อ่านข้อมูลจากฟีดไม่ได้ {n} รายการ อาจมีเหตุการณ์ที่ยังไม่แสดง",
  "quake.none": "ช่วงนี้ไม่พบแผ่นดินไหวในพื้นที่ที่เฝ้าดู",
  "quake.unknownPlace": "ไม่ระบุตำแหน่ง",
  "quake.unknownMagType": "ไม่ระบุชนิดขนาด",
  "quake.depth": "ลึก {n} {unit}",
  "quake.unreviewed": "ยังไม่ตรวจสอบ",
  "quake.reviewed": "ตรวจสอบแล้ว",
  "quake.note":
    "ข้อมูลตรวจวัดจริงจาก USGS และ EMSC เป็นเหตุการณ์ที่เกิดขึ้นแล้ว ไม่ใช่การพยากรณ์",
  "quake.asOf": " · ข้อมูล ณ {time}",
  "quake.nearest.inside": "ในเขต{province}",
  "quake.nearest.distance": "ห่างจาก{province} ≈ {n} กม.",
  "quake.nearest.unknown": "ยังไม่ได้คำนวณจังหวัดที่ใกล้ที่สุด",
  "quake.nearest.note": "เป็นระยะทางตรงถึงขอบเขตจังหวัด ไม่ได้บอกระดับแรงสั่นสะเทือน ขอบเขตจาก OpenStreetMap รวมทะเลอาณาเขตด้วย จุดกลางทะเลจึงอาจนับว่าอยู่ \"ในเขต\" จังหวัดชายฝั่งได้",
  "quake.eventPage": "ดูรายละเอียดที่เว็บต้นทาง",
  "quake.asOfWithAge": "{time} ({age})",

  // ── กล่องข้อมูลบนแผนที่ ───────────────────────────────────────────────
  "popup.situationThaiwater": "สถานการณ์ (ThaiWater)",
  "popup.situation": "สถานการณ์",
  "popup.situationHistorical": "ข้อมูลย้อนหลัง ไม่มีระดับสถานการณ์",
  "popup.waterlevel": "ระดับน้ำ",
  "popup.minBank": "ตลิ่งต่ำสุด",
  "popup.aboveBank": "สูงกว่าตลิ่ง",
  "popup.belowBank": "ต่ำกว่าตลิ่ง",
  "popup.observedAt": "เวลาตรวจวัด",
  "popup.realObserved": "ค่าตรวจวัดจริง",
  "popup.partlyArchive": " · บางส่วนมาจากคลังข้อมูล",
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
  "popup.cctv.fallbackName": "กล้อง {code}",
  "popup.cctv.loading": "กำลังขอภาพล่าสุดจาก DWR…",
  "popup.cctv.alt": "ภาพล่าสุดจากกล้อง {name}",
  "popup.cctv.takenAt": "ถ่ายเมื่อ",
  "popup.cctv.takenAtUnknown": "ไม่ทราบ (DWR ไม่ได้ระบุเวลาในรูปแบบที่อ่านได้)",
  "popup.cctv.fetchedAt": "ดึงภาพเมื่อ",
  "popup.cctv.age": "อายุภาพ",
  "popup.cctv.stale": "ภาพนี้ไม่ใช่ภาพปัจจุบัน",
  "popup.cctv.old": "ภาพเก่ากว่า 24 ชม.",
  "popup.cctv.unreachable":
    "ติดต่อ DWR ไม่ได้ ({detail}) เราจึงขอภาพไม่สำเร็จ และบอกอะไรเกี่ยวกับกล้องหรือพื้นที่นี้ไม่ได้",
  "popup.cctv.noImage": "DWR ตอบกลับมาแล้ว แต่ไม่มีภาพจากกล้องนี้ ซึ่งไม่ได้บอกอะไรเกี่ยวกับสภาพพื้นที่",
  "popup.cctv.refresh": "ขอภาพใหม่",
  "popup.cctv.credit": "ภาพ: กรมทรัพยากรน้ำ (DWR)",
  "popup.cctv.rights": "© กรมทรัพยากรน้ำ ซึ่งไม่ได้รับรองหรือเกี่ยวข้องกับโครงการนี้",
  "popup.cctv.nearest": "กล้องใกล้เคียง ({km} กม.)",
  "popup.cctv.open": "ดูภาพ",
  "popup.cctv.modeLabel": "แบบภาพ",
  "popup.cctv.modeSnapshot": "ภาพนิ่ง",
  "popup.cctv.modeLive": "ดูสด",
  "popup.cctv.snapshotBadge": "ภาพนิ่ง · ถ่าย {time}",
  "popup.cctv.snapshotBadgeNoTime": "ภาพนิ่ง · ไม่ทราบเวลาถ่าย",
  "popup.cctv.liveAlt": "ภาพสดจากกล้อง {name}",
  "popup.cctv.liveConnecting":
    "กำลังเชื่อมต่อ… (ภาพสดจาก DWR ใช้เวลาราว 4–6 วินาทีกว่าจะได้เฟรมแรก)",
  "popup.cctv.liveFailed":
    "ไม่ได้ภาพสดจากกล้องนี้ — DWR ไม่ส่งภาพ หรือเราเชื่อมต่อไม่ได้ (เบราว์เซอร์ไม่บอกว่าแบบไหน) จึงบอกอะไรเกี่ยวกับกล้องหรือพื้นที่นี้ไม่ได้",
  "popup.cctv.liveBadge": "สด",
  "popup.cctv.livePausedBadge": "หยุดดูสดแล้ว",
  "popup.cctv.liveReconnectingBadge": "กำลังเชื่อมต่อใหม่…",
  "popup.cctv.liveReconnecting":
    "ไม่ได้เฟรมใหม่จาก DWR มาสักพัก กำลังเชื่อมต่อใหม่ — ภาพที่เห็นคือเฟรมสุดท้ายที่ได้รับ ไม่ใช่ภาพสด",
  "popup.cctv.livePaused":
    "หยุดดูสดเองหลัง 5 นาที เพื่อไม่ต่อเซิร์ฟเวอร์ของ DWR ค้างไว้ — ภาพที่เห็นคือเฟรมสุดท้ายที่ได้รับ ไม่ใช่ภาพปัจจุบัน",
  "popup.cctv.liveNoTime":
    "ภาพสดจาก DWR (ต่อใหม่ทุก ~15 วินาที) — สตรีมนี้ไม่มีเวลาถ่ายกำกับ จึงไม่แสดงเวลา",
  "popup.cctv.liveResume": "ดูสดต่อ",
  "popup.cctv.liveRetry": "ลองใหม่",
  "popup.itic.fallbackName": "กล้อง {id}",
  "popup.itic.videoLabel": "วิดีโอสดจากกล้อง {name}",
  "popup.itic.loading": "กำลังเชื่อมต่อสตรีมวิดีโอของ iTIC…",
  "popup.itic.suspended":
    "iTIC ไม่มีสตรีมจากกล้องนี้ตอนนี้ ({detail}) — อาจถูกระงับชั่วคราว; ไม่ได้บอกอะไรเกี่ยวกับสภาพถนนหรือพื้นที่",
  "popup.itic.unreachable":
    "เปิดสตรีมจากเซิร์ฟเวอร์วิดีโอของ iTIC ไม่สำเร็จ ({detail}) — เครือข่ายล้มเหลว หรือเซิร์ฟเวอร์ตอบในแบบที่เบราว์เซอร์อ่านไม่ได้ (แยกสองกรณีนี้ไม่ได้) จึงบอกอะไรเกี่ยวกับกล้องหรือถนนนี้ไม่ได้",
  "popup.itic.unsupported":
    "เบราว์เซอร์นี้เล่นวิดีโอนี้ไม่ได้ ({detail}) — สตรีมเป็น H.264; ไม่ได้บอกอะไรเกี่ยวกับกล้องหรือถนน",
  "popup.itic.streamTime": "เวลาในสตรีม",
  "popup.itic.noStreamTime":
    "สตรีมนี้ไม่มีเวลากำกับ (ไม่มี EXT-X-PROGRAM-DATE-TIME) จึงไม่แสดงเวลาถ่าย",
  "popup.itic.owner": "กล้อง: {org}",
  "popup.itic.credit": "วิดีโอ: มูลนิธิ iTIC",
  "popup.itic.listCredit": "รายการกล้อง: Longdo",
  "popup.itic.rights":
    "ภาพเป็นของเจ้าของกล้องตามที่ระบุ เผยแพร่ผ่าน iTIC — ไม่มีหน่วยงานใดรับรองหรือเกี่ยวข้องกับโครงการนี้",
  "popup.itic.retry": "ลองใหม่",
  "popup.itic.bufferingBadge": "กำลังบัฟเฟอร์…",
  "popup.itic.buffering":
    "วิดีโอหยุดรอข้อมูลจาก iTIC — ภาพที่ค้างอยู่ไม่ใช่ภาพสด; ไม่ได้บอกอะไรเกี่ยวกับกล้องหรือถนน",
  "popup.itic.pausedBadge": "หยุดชั่วคราว",
  "popup.itic.paused": "หยุดชั่วคราว — ภาพที่ค้างอยู่ไม่ใช่ภาพสด; กดเล่นต่อจะกระโดดกลับไปที่ภาพล่าสุด",
  "popup.itic.coLocated": "กล้องที่ตำแหน่งเดียวกัน",
  "popup.itic.nearest": "กล้องถนนใกล้เคียง ({km} กม.)",
  "popup.itic.open": "ดูวิดีโอสด",
  "popup.itic.creditImage": "ภาพ: มูลนิธิ iTIC",
  "popup.itic.snapshotAlt": "ภาพนิ่งล่าสุดจากกล้อง {name}",
  "popup.itic.snapshotLoading": "กำลังขอภาพนิ่งจากเซิร์ฟเวอร์ภาพของ iTIC…",
  "popup.itic.snapshotDetail.error": "เกิดข้อผิดพลาด",
  "popup.itic.snapshotDetail.timeout": "หมดเวลารอ",
  "popup.itic.snapshotDetail.rejected": "ลิงก์ภาพไม่ผ่านการตรวจ",
  "popup.itic.snapshotUnreachable": "ขอภาพจากเซิร์ฟเวอร์ภาพของ iTIC ไม่สำเร็จ ({detail}) — เครือข่ายล้มเหลว หรือ iTIC ตอบกลับมาโดยไม่มีภาพ (แยกสองกรณีนี้ไม่ได้) จึงบอกอะไรเกี่ยวกับกล้องหรือถนนนี้ไม่ได้; จะลองขอใหม่เรื่อย ๆ",
  "popup.itic.snapshotPaused": "หยุดรีเฟรชอัตโนมัติแล้วหลังเปิดดู {min} นาที — ภาพที่เห็นอาจไม่ใช่ภาพล่าสุด",
  "popup.itic.snapshotPausedBadge": "หยุดรีเฟรชแล้ว",
  "popup.itic.snapshotBadge": "ภาพนิ่งรีเฟรชอัตโนมัติ",
  "popup.itic.snapshotFetchedAt": "ได้ภาพล่าสุดเมื่อ",
  "popup.itic.snapshotNeverFetched": "ยังไม่ได้ภาพ",
  "popup.itic.snapshotCaptureTime": "กล้องนี้ให้ภาพนิ่ง ไม่ใช่วิดีโอ เราขอภาพใหม่ทุก ~{s} วินาทีขณะเปิดดู — เวลาถ่ายกล้องพิมพ์ไว้บนภาพเอง ไม่มีเป็นข้อมูลให้อ่าน เวลาด้านบนคือตอนที่เบราว์เซอร์ได้ภาพ ไม่ใช่เวลาถ่าย",
  "popup.itic.snapshotResume": "รีเฟรชต่อ",
  "popup.itic.openSnapshot": "ดูภาพนิ่ง",
  "popup.itic.kindSnapshot": "ภาพนิ่ง",
  "popup.itic.kindVideo": "วิดีโอสด",
  "popup.status": "สถานะ",
  "popup.statusAutomatic": "ตรวจพบโดยอัตโนมัติ ยังไม่มีคนตรวจสอบ",
  "popup.statusReviewed": "ตรวจสอบแล้ว",
  "popup.floodTitle": "ต.{tambon} — พื้นที่น้ำท่วม",
  "popup.mapPoint": "ตำแหน่งบนแผนที่",
  "popup.coords": "พิกัด",
  "popup.elevation": "ความสูงภูมิประเทศ (DSM)",
  "popup.amphoe": "อำเภอ",
  "popup.floodArea": "พื้นที่น้ำท่วม",
  "popup.firstSeen": "พบครั้งแรก",
  "popup.lastSeen": "พบล่าสุด",
  "popup.floodNote": "GISTDA แปลจากภาพดาวเทียม เป็นพื้นที่ที่ตรวจพบแล้ว ไม่ใช่การพยากรณ์",
  /** E14.F5 — เซลล์ของฉาก Copernicus GFM ใต้จุดที่คลิก: หกคลาส หกประโยค ห้ามพับรวม */
  "popup.gfm.title": "ภาพ Sentinel-1 (Copernicus GFM)",
  "popup.gfm.flooded": "ท่วม · ความลึกโดยประมาณ {m} ม. (ภาพประกอบ)",
  "popup.gfm.floodedNoDepth": "ท่วม · จุดนี้ไม่มีค่าความลึก",
  /** ความเชื่อมั่นของ ensemble ของ GFM ว่าจำแนกถูก — ไม่ใช่ความน่าจะเป็นของอะไรที่ยังไม่เกิด */
  "popup.gfm.confidence": "ความมั่นใจในการจำแนกภาพ {n}/100",
  "popup.gfm.notEstimated": "ท่วม · ประมาณความลึกไม่ได้ (มีอาคารหรือต้นไม้)",
  "popup.gfm.referenceWater": "แหล่งน้ำถาวร",
  "popup.gfm.excluded": "จำแนกไม่ได้ (เรดาร์มองไม่เห็นจุดนี้)",
  "popup.gfm.noObservation": "ภาพนี้ไม่ครอบคลุมจุดนี้",
  "popup.gfm.dry": "ไม่พบน้ำท่วมในภาพ",
  "popup.gfm.unknownClass": "ไม่รู้จักรหัสประเภท ({cls})",
  "popup.gfm.acquired": "ถ่ายเมื่อ {time} · ภาพ {id}",

  // ── ป้ายกำกับบนฉาก 3 มิติ ─────────────────────────────────────────────
  "scene.loadingTerrain": "กำลังโหลดข้อมูลภูมิประเทศ...",
  "scene.buildingBuild": "กำลังสร้างอาคาร...",
  "scene.loadingHiRes": "กำลังโหลดภูมิประเทศความละเอียดสูง...",
  "scene.loadError": "โหลดแผนที่ 3 มิติไม่สำเร็จ",
  "scene.loadingImagery": "กำลังโหลดภาพดาวเทียม",
  "scene.notBuiltTitle": "ยังไม่ได้เตรียมข้อมูลภูมิประเทศของจังหวัดนี้",
  "scene.notBuiltBody": "ค่าตรวจวัดยังดูได้ตามปกติในแผงข้าง",
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
  "scene.quakeAutomatic": "ตรวจพบอัตโนมัติ · ยังไม่ตรวจสอบ",
  "scene.quakeReviewed": "ตรวจพบ · ตรวจสอบแล้ว",
  "scene.damCapacity": "น้ำ {n}% ของความจุ (ตรวจวัดจริง)",
  "scene.damNoCapacity": "ไม่มีข้อมูลความจุ",

  // ── ข้อความผิดพลาดของ hooks ───────────────────────────────────────────
  "error.loadFailed": "โหลดไม่สำเร็จ",
  "error.observationsFailed": "โหลดข้อมูลตรวจวัดไม่สำเร็จ",
  "error.apiUnreachable": "เชื่อมต่อ API ไม่ได้ — ตรวจสอบว่าเซิร์ฟเวอร์ API ทำงานอยู่ (npm run dev)",
  "error.networkUnreachable": "เชื่อมต่อเครือข่ายไม่ได้ กำลังลองใหม่...",
  "error.earthquakeFeed": "เชื่อมต่อข้อมูลแผ่นดินไหวไม่ได้",

  // ── หน้าวิธีคำนวณ ─────────────────────────────────────────────────────
  "methodology.loading": "กำลังโหลดเอกสาร...",
  "methodology.back": "กลับไปที่แผนที่ {brand}",
  "methodology.doc.lowland": "พื้นที่ลุ่มต่ำ (ภาพประกอบ)",
  "methodology.doc.floodExposure": "ระดับการเผชิญน้ำ (ภาพประกอบ)",
  "methodology.doc.floodDepth": "น้ำท่วมจากดาวเทียม Sentinel-1 และความลึกโดยประมาณ (FwDET)",
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

  // ── ประเภท อปท. (E11.1) ───────────────────────────────────────────────
  "localAuthority.type.provincial_admin_org": "อบจ.",
  "localAuthority.type.city_municipality": "เทศบาลนคร",
  "localAuthority.type.town_municipality": "เทศบาลเมือง",
  "localAuthority.type.subdistrict_municipality": "เทศบาลตำบล",
  "localAuthority.type.subdistrict_admin_org": "อบต.",
  "localAuthority.type.special_admin_area": "ท้องถิ่นรูปแบบพิเศษ",
  // ไม่ใช่ อปท. — กรุงเทพฯ ไม่อยู่ในทะเบียนของ DLA จึงแสดงเป็นเขตของ กทม. แยกชัดเจน
  "localAuthority.type.bma_district": "เขต (กทม.)",

  // ── สรุปผลกระทบ อปท. (E11.6) ─────────────────────────────────────────
  "impact.card.title": "สรุปผลกระทบ อปท.",
  "impact.card.title.bma": "สรุปผลกระทบรายเขต (กทม.)",
  "impact.card.selectPrompt": "เลือก อปท. หรือเขตจากรายการเพื่อดูรายละเอียด",
  "impact.card.noCoverage":
    "อปท. นี้ยังไม่มีขอบเขตหรือข้อมูลพื้นฐานจริงให้คำนวณผลกระทบ",
  "impact.card.loadError": "โหลดข้อมูลผลกระทบไม่สำเร็จ: {error}",
  "impact.section.baseline": "ข้อมูลพื้นฐาน (ไม่เปลี่ยนตามสถานการณ์)",
  "impact.section.flood": "ผลกระทบจากน้ำท่วมปัจจุบัน",
  "impact.section.flood.dated": "ผลกระทบจากน้ำท่วมตามภาพ GISTDA ที่ดึงเมื่อ {date}",
  "impact.population.label": "ประชากร",
  "impact.population.estimateNote": "ค่าประมาณจาก WorldPop 2020 ไม่ใช่ตัวเลขจากการนับจริง",
  "impact.buildings.label": "อาคาร (ข้อมูลพื้นฐาน)",
  "impact.floodedArea.label": "พื้นที่น้ำท่วม",
  "impact.floodedFraction.label": "สัดส่วนที่ถูกน้ำท่วม",
  "impact.floodedFraction.neverFetched": "ยังไม่เคยดึงภาพน้ำท่วมจาก GISTDA สำเร็จเลย",
  "impact.flood.staleScene":
    "ตัวเลขชุดนี้มาจากภาพ GISTDA ที่ดึงเมื่อ {date} ไม่ใช่สถานการณ์ปัจจุบัน",
  "impact.facilitiesExposed.label": "สถานที่สำคัญในพื้นที่น้ำท่วม",
  "impact.facilitiesExposed.hospitals": "โรงพยาบาล {n}",
  "impact.facilitiesExposed.schools": "โรงเรียน {n}",
  "impact.facilitiesExposed.fireStations": "สถานีดับเพลิง {n}",
  "impact.facilitiesExposed.none": "ตอนนี้ไม่มีสถานที่สำคัญอยู่ในพื้นที่น้ำท่วม",
  "impact.facilitiesExposed.none.dated": "ในภาพนั้นไม่มีสถานที่สำคัญอยู่ในพื้นที่น้ำท่วม",
  "impact.populationExposed.label": "ประชากรที่อาจได้รับผลกระทบ (ประมาณตามสัดส่วนพื้นที่ท่วม)",
  "impact.buildingsExposed.label": "อาคารที่อาจได้รับผลกระทบ (ประมาณตามสัดส่วนพื้นที่ท่วม)",
  "impact.method.areaWeighted":
    "ประมาณตามสัดส่วนพื้นที่ที่ถูกน้ำท่วม ไม่ได้นับทีละหลัง และไม่ใช่การพยากรณ์",

  // ── แถบแจ้งเตือน อปท. (E11.6) ─────────────────────────────────────────
  "alert.banner.title": "การแจ้งเตือน อปท.",
  "alert.banner.neverEvaluated": "ระบบแจ้งเตือนยังไม่เคยทำงานเลยสักรอบ",
  "alert.banner.unreachable": "ติดต่อระบบแจ้งเตือนไม่ได้ในขณะนี้",
  "alert.banner.none": "ตรวจแล้ว ตอนนี้ไม่มีการแจ้งเตือน",
  "alert.banner.degraded": "รอบล่าสุดเชื่อมต่อระบบแจ้งเตือนไม่ได้ รายการด้านล่างอาจยังไม่อัปเดต",
  "alert.banner.evaluatedAge": "ตรวจล่าสุด {age}",
  "alert.banner.stale": "ข้อมูลค้าง เพราะรอบล่าสุดไม่ได้ข้อมูลจากสถานี",
  "alert.banner.triggeredAt": "เริ่มเมื่อ {time}",
  "alert.banner.count": "กำลังแจ้งเตือน {n} รายการ",

  // ── รายชื่อ อปท. ที่ได้รับผลกระทบ (E11.6) ───────────────────────────────
  "authorityList.title": "อปท. ที่ได้รับผลกระทบ",
  "authorityList.title.bma": "เขตของกรุงเทพฯ ที่ได้รับผลกระทบ",
  "authorityList.empty.noCoverage":
    "จังหวัดนี้ยังไม่มีขอบเขต อปท. ในข้อมูล OpenStreetMap ให้คำนวณพื้นที่น้ำท่วม — จึงยังแสดงรายการไม่ได้",
  "authorityList.explain":
    "% = สัดส่วนพื้นที่ที่ภาพดาวเทียมของ GISTDA ตรวจพบน้ำท่วม ไม่ใช่ระดับน้ำจากสถานี (จุดสีคือการแจ้งเตือนระดับน้ำ/ฝนจากสถานี ThaiWater ซึ่งเป็นคนละแหล่ง)",
  "authorityList.sceneDate": "ภาพ GISTDA ที่ดึงเมื่อ {date}",
  "authorityList.notice.unreachable":
    "ติดต่อ GISTDA ไม่ได้ในรอบล่าสุด — ตัวเลขด้านล่างมาจากภาพล่าสุดที่ดึงสำเร็จ ({date}) ไม่ใช่สถานการณ์ปัจจุบัน",
  "authorityList.notice.noNewScene":
    "GISTDA ยังไม่ปล่อยภาพใหม่ — ตัวเลขด้านล่างมาจากภาพ {date} ไม่ใช่สถานการณ์ปัจจุบัน",
  "authorityList.notice.old":
    "ภาพ GISTDA ที่ใช้คำนวณเก่ากว่ารอบปรับปรุงปกติ ({date}) — ตัวเลขด้านล่างอาจไม่ตรงกับสถานการณ์ปัจจุบัน",
  "authorityList.notice.noneMapped":
    "ดึงภาพ GISTDA ได้ล่าสุด {date} — ภาพนั้นไม่มีพื้นที่น้ำท่วมในเขตพื้นที่ที่แสดงด้านล่าง",
  "authorityList.loadError": "โหลดรายชื่อ อปท. ไม่สำเร็จ: {error}",
  "authorityList.floodedFraction": "ท่วม {pct}%",
  "authorityList.neverFetched": "ยังไม่เคยดึงข้อมูลจาก GISTDA สำเร็จ",
  "authorityList.unavailable": "ตรวจผลกระทบของ อปท. นี้ไม่สำเร็จ",
  "authorityList.facilitiesCount": "สถานที่สำคัญในพื้นที่ท่วม {n} แห่ง",
} as const;
