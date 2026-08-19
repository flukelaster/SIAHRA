/**
 * เฮดเดอร์ความปลอดภัยของ siahra-api (E4.2)
 *
 * siahra-api กับ siahra-web อยู่บนโฮสต์เดียวกัน (siahra-radar.co) แต่ทำหน้าที่ต่างกัน
 * จึงตั้งใจให้ "ชุดร่วม" เหมือนกันเป๊ะ และให้ CSP ต่างกัน:
 *
 * - HSTS / nosniff / Referrer-Policy / X-Frame-Options / Permissions-Policy
 *   ต้องตรงกันทั้งสอง Worker เพราะเป็นคำสั่งระดับ "โฮสต์นี้" — ถ้าสองตัวพูดไม่ตรงกัน
 *   ผลลัพธ์จะขึ้นกับว่าเบราว์เซอร์บังเอิญเห็นคำตอบไหนก่อน ซึ่งเป็นสถานะที่ debug ไม่ได้
 *   (HSTS: `max-age` อย่างเดียว ไม่มี includeSubDomains ไม่มี preload — docs/roadmap.md §4)
 * - CSP ต่างกันได้และควรต่าง: CSP ผูกกับ "เอกสาร" ที่โหลดทรัพยากร ไม่ใช่กับคำตอบ JSON
 *   คำตอบของ API ไม่เคยเป็นเอกสาร จึงประกาศนโยบายที่แคบที่สุดคือห้ามโหลดอะไรเลย
 *   ซึ่งไม่มีทางไปกระทบ CSP ของหน้าเว็บ (นั่นมาจาก apps/web/public/_headers)
 *
 * หมายเหตุ: นี่เป็นการ "เพิ่มชั้น" ไม่ใช่การแทนที่ — ด่านกันข้ามโดเมนและ rate limit
 * ใน router.ts/rateLimit.ts ยังทำงานเหมือนเดิมทุกประการ
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy":
    "accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=()",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
});

/**
 * ใส่เฮดเดอร์ชุดข้างบนให้คำตอบ โดยใช้ `set` ไม่ใช่ `append` — CSP สองอันบนคำตอบเดียว
 * เบราว์เซอร์จะเอา "ส่วนร่วม" ของทั้งสอง ซึ่งแปลว่าเฮดเดอร์ซ้ำไม่ใช่เรื่องความสวยงาม
 * แต่ทำให้นโยบายแคบลงเงียบ ๆ
 *
 * ข้อยกเว้นสองอย่างที่ห้ามแตะ:
 * - 101 (WebSocket upgrade) — Response ที่มี `webSocket` สร้างใหม่ไม่ได้ การพยายาม
 *   ห่อมันคือการทำให้ /api/v1/earthquakes/live ต่อไม่ติด
 * - 204/205/304 เป็น null-body status สร้าง Response พร้อม body ไม่ได้
 *
 * คำตอบที่เฮดเดอร์แก้ไม่ได้ (immutable — เช่นที่มาจาก DO หรือ R2 โดยตรง) จะถูกสร้างใหม่
 */
export function withSecurityHeaders(res: Response): Response {
  if (res.status === 101) return res;
  const nullBody = res.status === 204 || res.status === 205 || res.status === 304;
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(nullBody ? null : res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
