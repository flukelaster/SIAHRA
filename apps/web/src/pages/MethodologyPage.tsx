import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import lowlandMd from "../../../../docs/methodology/lowland.md?raw";
import { BRAND } from "../branding";
import { renderMarkdown } from "../lib/markdown";

/**
 * หน้า `/methodology/<slug>` — เรนเดอร์เอกสารใน `docs/methodology/` ตรง ๆ
 *
 * `methodologyUrl` ของ `HazardLayerDescriptor` ชี้มาที่หน้านี้ (ไม่ใช่ลิงก์ไปยัง
 * GitHub) ตามการตัดสินใจใน docs/roadmap.md §4 เอกสารถูก import แบบ `?raw` จึงมี
 * แหล่งความจริงเดียว: ไฟล์ใน `docs/` ที่รีวิวใน PR เป็นตัวเดียวกับที่ผู้ใช้อ่าน
 *
 * เพิ่มเอกสารใหม่ = เพิ่มหนึ่งบรรทัดใน `DOCS` (E10.1 จะเพิ่ม flood-exposure.md)
 */
const DOCS: Record<string, { title: string; source: string }> = {
  lowland: { title: "พื้นที่ลุ่มต่ำ (ภาพประกอบ)", source: lowlandMd },
};

export default function MethodologyPage({ slug }: { slug: string }) {
  const doc = DOCS[slug];
  useEffect(() => {
    document.title = `${doc ? doc.title : "ไม่พบเอกสาร"} — ${BRAND.name}`;
  }, [doc]);
  return (
    <div className="min-h-screen w-full overflow-y-auto bg-[var(--color-bg)] px-5 py-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <a
          href="/"
          className="inline-flex w-fit items-center gap-1.5 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        >
          <ArrowLeft size={13} aria-hidden="true" />
          กลับไปที่แผนที่ {BRAND.name}
        </a>

        {doc ? (
          <article className="glass rounded-2xl px-6 py-6 text-sm">{renderMarkdown(doc.source)}</article>
        ) : (
          // ไม่มีเอกสารตาม slug นี้ ต้องบอกตามตรงว่าไม่มี ไม่ใช่หน้าว่าง ๆ ที่ดูเหมือนกำลังโหลด
          <article className="glass rounded-2xl px-6 py-6 text-sm">
            <h1 className="mb-3 text-xl font-semibold text-[var(--color-fg)]">ไม่พบเอกสารนี้</h1>
            <p className="leading-relaxed text-[var(--color-fg-muted)]">
              ยังไม่มีเอกสารวิธีคำนวณชื่อ <code className="rounded bg-white/8 px-1 py-px font-mono">{slug}</code>{" "}
              เอกสารที่มีตอนนี้:{" "}
              {Object.keys(DOCS).map((key, i) => (
                <span key={key}>
                  {i > 0 ? ", " : ""}
                  <a className="text-[var(--color-accent)] hover:underline" href={`/methodology/${key}`}>
                    {key}
                  </a>
                </span>
              ))}
            </p>
          </article>
        )}
      </div>
    </div>
  );
}
