import { Component, Suspense, type ReactNode } from "react";
import { useT } from "../../i18n/context";
import { chunkErrorActions, isChunkLoadError } from "../../lib/lazyModule";

/**
 * กรอบของทุกส่วนที่โหลดเป็น chunk แยก (`lazyView`) — สองสถานะที่ต้องไม่ถูกอ่านเป็น
 * "ไม่มีข้อมูล":
 *   - ระหว่างโหลดโค้ด → วงหมุน + "กำลังโหลด..." (ไม่ใช่กล่องว่าง ไม่ใช่ "ไม่เคยดึงสำเร็จ"
 *     — ยังไม่มีการถามแหล่งข้อมูลใดเลย แค่โค้ดของแผงยังมาไม่ถึง)
 *   - โหลดโค้ดไม่สำเร็จ (ออฟไลน์ / deploy สลับ chunk) → "โหลดส่วนนี้ไม่สำเร็จ" + ลองใหม่
 *     (+ โหลดหน้าใหม่ เมื่อพลาดซ้ำ — เหตุผลอยู่ที่ `chunkErrorActions`) แทนจอขาวทั้งแอป
 *
 * `frame` ห่อทั้งวงหมุนและกล่อง error ด้วยตำแหน่งเดียวกับของจริง (เช่นป๊อปโอเวอร์ใต้
 * กระดิ่ง) ของจริงจึงไม่กระโดดไปอีกที่เมื่อโหลดเสร็จ ค่าเริ่มต้นเป็นบล็อกสูงขั้นต่ำ
 * สำหรับเนื้อหาในลิ้นชัก/แผ่นเลื่อน
 *
 * boundary นี้จับ **ทุก** error ใต้มัน ไม่ใช่แค่ chunk — `isChunkLoadError` แยกสองกรณี:
 * โหลดโค้ดไม่สำเร็จ → "โหลดส่วนนี้ไม่สำเร็จ", อย่างอื่น (โค้ดมาแล้วแต่เรนเดอร์พัง) →
 * "ส่วนนี้แสดงผลไม่สำเร็จ" (ไม่อ้างว่าเป็นเรื่องเครือข่ายเมื่อไม่ใช่) ปุ่มเหมือนกันทั้งสองกรณี:
 * ลองใหม่เรนเดอร์ใหม่ทั้งก้อน
 */
interface Props {
  children: ReactNode;
  frame?: (content: ReactNode) => ReactNode;
}

interface State {
  error: unknown;
  failures: number;
}

const defaultFrame = (content: ReactNode) => (
  <div className="flex min-h-32 items-center justify-center p-3">{content}</div>
);

export class ChunkBoundary extends Component<Props, State> {
  state: State = { error: null, failures: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error("unknown") };
  }

  componentDidCatch(): void {
    this.setState((s) => ({ failures: s.failures + 1 }));
  }

  private retry = () => this.setState({ error: null });

  render() {
    const frame = this.props.frame ?? defaultFrame;
    if (this.state.error) {
      return frame(
        <ChunkError
          failures={Math.max(1, this.state.failures)}
          chunk={isChunkLoadError(this.state.error)}
          onRetry={this.retry}
        />,
      );
    }
    return <Suspense fallback={frame(<ChunkLoading />)}>{this.props.children}</Suspense>;
  }
}

export function ChunkLoading() {
  const t = useT();
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]" role="status" aria-live="polite">
      <span
        className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-[var(--color-accent)]"
        aria-hidden="true"
      />
      {t("common.loading")}
    </div>
  );
}

function ChunkError({ failures, chunk, onRetry }: { failures: number; chunk: boolean; onRetry: () => void }) {
  const t = useT();
  const actions = chunkErrorActions(failures);
  const btn =
    "cursor-pointer rounded-md border border-white/15 px-2 py-1 text-xs text-[var(--color-fg)] transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]";
  return (
    <div role="alert" className="pointer-events-auto flex flex-wrap items-center gap-2 text-xs text-[var(--color-risk-high)]">
      <span>{t(chunk ? "common.chunkFailed" : "common.renderFailed")}</span>
      <button type="button" onClick={onRetry} className={btn}>
        {t("common.retry")}
      </button>
      {actions.reload ? (
        <button type="button" onClick={() => window.location.reload()} className={btn}>
          {t("common.reloadPage")}
        </button>
      ) : null}
    </div>
  );
}
