import type { ReactNode } from "react";

/**
 * ตัวเรนเดอร์ Markdown ขนาดจิ๋วสำหรับหน้า /methodology
 *
 * รองรับเท่าที่เอกสารใน `docs/methodology/` ใช้จริง: หัวข้อ ย่อหน้า รายการแบบจุด
 * รายการแบบตัวเลข เส้นคั่น และรูปแบบในบรรทัด (**หนา**, `โค้ด`, [ลิงก์](url))
 *
 * เขียนเองแทนที่จะลงไลบรารี Markdown ทั้งก้อน เพราะหน้านี้เป็นหน้าเสริมของแอปแผนที่
 * ที่งบขนาดบันเดิลมีจำกัด (E8.2 จะเพิ่มการตรวจงบ) และเพราะผลลัพธ์เป็น React element
 * ล้วน ๆ ไม่มี `dangerouslySetInnerHTML` จึงไม่เปิดช่องแทรก HTML เข้ามาในหน้า
 */

/** แยกรูปแบบในบรรทัดเดียว: `code`, **bold**, [text](url) */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}-i${i++}`;
    if (token.startsWith("`")) {
      out.push(
        <code key={key} className="rounded bg-white/8 px-1 py-px font-mono text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold text-[var(--color-fg)]">
          {/* วนซ้ำเข้าไปข้างใน เพราะเอกสารเขียน **ตัวหนาที่มี `โค้ด` อยู่ข้างใน** อยู่บ่อย
              ถ้าไม่วน backtick จะโผล่มาเป็นตัวอักษรจริงบนหน้า */}
          {inline(token.slice(2, -2), `${key}b`)}
        </strong>,
      );
    } else {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      out.push(
        <a
          key={key}
          href={href}
          target={href.startsWith("http") ? "_blank" : undefined}
          rel="noreferrer"
          className="text-[var(--color-accent)] hover:underline"
        >
          {label}
        </a>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const HEADING_CLASS: Record<number, string> = {
  1: "mt-0 mb-3 text-xl font-semibold text-[var(--color-fg)]",
  2: "mt-7 mb-2 text-base font-semibold text-[var(--color-fg)]",
  3: "mt-5 mb-2 text-sm font-semibold text-[var(--color-fg)]",
};

/** แปลง Markdown เป็น React element (block-level) */
export function renderMarkdown(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  // แถวของตาราง Markdown ที่กำลังสะสมอยู่ (แต่ละแถวถูกแยกเป็นเซลล์แล้ว)
  let table: string[][] | null = null;
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ");
    blocks.push(
      <p key={`p${key}`} className="my-2.5 leading-relaxed text-[var(--color-fg-muted)]">
        {inline(text, `p${key++}`)}
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const { ordered, items } = list;
    const children = items.map((item, idx) => (
      <li key={idx} className="my-1 leading-relaxed">
        {inline(item, `l${key}-${idx}`)}
      </li>
    ));
    blocks.push(
      ordered ? (
        <ol key={`l${key++}`} className="my-2.5 list-decimal space-y-0.5 pl-5 text-[var(--color-fg-muted)]">
          {children}
        </ol>
      ) : (
        <ul key={`l${key++}`} className="my-2.5 list-disc space-y-0.5 pl-5 text-[var(--color-fg-muted)]">
          {children}
        </ul>
      ),
    );
    list = null;
  };

  /**
   * ตาราง Markdown — เอกสาร `flood-exposure.md` ประกาศตารางเกณฑ์เป็นตาราง และถ้า
   * ไม่รองรับ บรรทัด `| ... |` จะกลายเป็นย่อหน้าที่อ่านไม่ออก แถวแรกเป็นหัวตาราง
   * เมื่อแถวถัดมาเป็นเส้นคั่น (`---`) ตามไวยากรณ์ปกติ
   */
  const flushTable = () => {
    if (!table) return;
    const rows = table;
    table = null;
    const hasHeader = rows.length >= 2 && rows[1].every((c) => /^:?-{3,}:?$/.test(c.trim()));
    const head = hasHeader ? rows[0] : null;
    const body = hasHeader ? rows.slice(2) : rows;
    const cellClass = "border border-white/10 px-2.5 py-1.5 align-top";
    blocks.push(
      <div key={`t${key}`} className="my-3 overflow-x-auto">
        <table className="w-full border-collapse text-[12px] text-[var(--color-fg-muted)]">
          {head ? (
            <thead>
              <tr>
                {head.map((cell, idx) => (
                  <th key={idx} className={`${cellClass} text-left font-semibold text-[var(--color-fg)]`}>
                    {inline(cell, `th${key}-${idx}`)}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className={cellClass}>
                    {inline(cell, `td${key}-${r}-${c}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    key++;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      flushTable();
      continue;
    }
    if (/^\|.*\|$/.test(line.trim())) {
      flushParagraph();
      flushList();
      table ??= [];
      table.push(line.trim().slice(1, -1).split("|").map((c) => c.trim()));
      continue;
    }
    flushTable();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const Tag = (["h1", "h2", "h3"] as const)[level - 1];
      blocks.push(
        <Tag key={`h${key}`} className={HEADING_CLASS[level]}>
          {inline(heading[2], `h${key++}`)}
        </Tag>,
      );
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushParagraph();
      flushList();
      blocks.push(<hr key={`r${key++}`} className="my-5 border-white/10" />);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);
    // บรรทัดที่ย่อหน้าต่อจากรายการเดิม (เอกสารตัดบรรทัดยาวเป็นหลายบรรทัด)
    const continuation = /^\s{2,}\S/.test(line);
    if (bullet || ordered) {
      flushParagraph();
      const isOrdered = ordered !== null;
      if (list && list.ordered !== isOrdered) flushList();
      list ??= { ordered: isOrdered, items: [] };
      list.items.push((bullet ?? ordered)![1]);
      continue;
    }
    if (list && continuation) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  flushTable();
  return blocks;
}
