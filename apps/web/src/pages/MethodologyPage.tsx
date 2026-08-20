import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import floodExposureMd from "../../../../docs/methodology/flood-exposure.md?raw";
import lowlandMd from "../../../../docs/methodology/lowland.md?raw";
import { BRAND } from "../branding";
import { renderMarkdown } from "../lib/markdown";
import { LanguageToggle } from "../components/layout/LanguageToggle";
import { useLang } from "../i18n/context";
import type { MessageKey } from "../i18n";

/**
 * หน้า `/methodology/<slug>` — เรนเดอร์เอกสารใน `docs/methodology/` ตรง ๆ
 *
 * `methodologyUrl` ของ `HazardLayerDescriptor` ชี้มาที่หน้านี้ (ไม่ใช่ลิงก์ไปยัง
 * GitHub) ตามการตัดสินใจใน docs/roadmap.md §4 เอกสารถูก import แบบ `?raw` จึงมี
 * แหล่งความจริงเดียว: ไฟล์ใน `docs/` ที่รีวิวใน PR เป็นตัวเดียวกับที่ผู้ใช้อ่าน
 *
 * เพิ่มเอกสารใหม่ = เพิ่มหนึ่งบรรทัดใน `DOCS` (E10.1 เพิ่ม flood-exposure.md แล้ว)
 *
 * **ภาษา (E7.1):** ตัวหน้า (หัวเรื่อง ปุ่มย้อนกลับ ข้อความไม่พบเอกสาร) แปลตามภาษา
 * ที่เลือก แต่ **ตัวเอกสารเองยังเป็นภาษาไทยเสมอ** เพราะ `docs/methodology/*.md`
 * มีฉบับเดียวและยังไม่ได้แปล ทางเลือกที่ซื่อสัตย์คือบอกตรง ๆ ด้วยแถบเตือนเหนือ
 * เนื้อหา ไม่ใช่ปล่อยให้ผู้อ่านภาษาอังกฤษเข้าใจว่าข้อความไทยข้างล่างคือฉบับแปล
 * (และไม่ใช่ซ่อนเอกสารทิ้งไปเลย — วิธีคำนวณของชั้น "ภาพประกอบ" ต้องเข้าถึงได้เสมอ)
 */
const DOCS: Record<string, { titleKey: MessageKey; source: string }> = {
  lowland: { titleKey: "methodology.doc.lowland", source: lowlandMd },
  "flood-exposure": { titleKey: "methodology.doc.floodExposure", source: floodExposureMd },
};

export default function MethodologyPage({ slug }: { slug: string }) {
  const { lang, t } = useLang();
  const doc = DOCS[slug];
  useEffect(() => {
    document.title = `${t(doc ? doc.titleKey : "methodology.notFound")} — ${BRAND.name}`;
  }, [doc, t]);
  return (
    <div className="min-h-screen w-full overflow-y-auto bg-[var(--color-bg)] px-5 py-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        {/* หน้านี้ไม่มีแถบบน จึงต้องมีปุ่มสลับภาษาของตัวเอง ไม่งั้นผู้อ่านที่มาจาก
            ลิงก์ `?lang=` เปลี่ยนภาษาที่นี่ไม่ได้เลย (ใช้ปุ่มตัวเดียวกับ TopBar) */}
        <div className="flex items-center justify-between gap-3">
          <a
            href="/"
            className="inline-flex w-fit items-center gap-1.5 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          >
            <ArrowLeft size={13} aria-hidden="true" />
            {t("methodology.back", { brand: BRAND.name })}
          </a>
          <LanguageToggle />
        </div>

        {doc ? (
          <article className="glass rounded-2xl px-6 py-6 text-sm">
            {/* เอกสารต้นฉบับเป็นภาษาไทยฉบับเดียว — ต้องประกาศไว้ ไม่ใช่ให้เดาเอง */}
            {lang === "en" ? (
              <p
                lang="en"
                className="mb-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[12px] text-[var(--color-fg-muted)]"
              >
                {t("methodology.thaiOnly")}
              </p>
            ) : null}
            <div lang="th">{renderMarkdown(doc.source)}</div>
          </article>
        ) : (
          // ไม่มีเอกสารตาม slug นี้ ต้องบอกตามตรงว่าไม่มี ไม่ใช่หน้าว่าง ๆ ที่ดูเหมือนกำลังโหลด
          <article className="glass rounded-2xl px-6 py-6 text-sm">
            <h1 className="mb-3 text-xl font-semibold text-[var(--color-fg)]">
              {t("methodology.notFoundTitle")}
            </h1>
            <p className="leading-relaxed text-[var(--color-fg-muted)]">
              {t("methodology.notFoundBody")}{" "}
              <code className="rounded bg-white/8 px-1 py-px font-mono">{slug}</code>{" "}
              {t("methodology.available")}{" "}
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
