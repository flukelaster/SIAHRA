import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LANGS, translator, type Lang } from "../../i18n";
import { LanguageContext } from "../../i18n/context";
import { DEFAULT_LAYERS } from "../../lib/defaultLayers";
import { LayerPresetCard } from "./LayerPresetCard";

const render = (lang: Lang, props: Partial<Parameters<typeof LayerPresetCard>[0]>) =>
  renderToStaticMarkup(
    createElement(
      LanguageContext.Provider,
      { value: { lang, setLang: () => {}, t: translator(lang) } },
      createElement(LayerPresetCard, { topic: "overview", layers: DEFAULT_LAYERS, following: true, onReset: () => {}, ...props }),
    ),
  );

describe("LayerPresetCard", () => {
  it.each(LANGS)("สามสถานะ: เดินตาม (ไม่มีปุ่มคืนค่า) / ยังเป็นชุดเริ่มต้น / ปรับเองแล้ว (%s)", (lang) => {
    const t = translator(lang);
    const following = render(lang, {});
    expect(following).toContain(t("layers.preset.title", { topic: t("topic.overview") }));
    expect(following).toContain(t("layers.preset.following"));
    expect(following).not.toContain(t("layers.preset.reset"));
    const pending = render(lang, { topic: "water" });
    expect(pending).toContain(t("layers.preset.pending"));
    expect(pending).toContain(t("layers.preset.reset"));
    const custom = render(lang, { following: false });
    expect(custom).toContain(t("layers.preset.custom"));
    expect(custom).toContain(t("layers.preset.reset"));
  });

  it.each(LANGS)("โหลดกฎของชุดหัวข้อไม่สำเร็จ = บรรทัดบอกว่าชั้นยังเหมือนเดิม ไม่เงียบ (%s)", (lang) => {
    const t = translator(lang);
    const line = t("layers.preset.loadFailed", { error: "chunk 404" });
    expect(render(lang, { topic: "water", loadError: "chunk 404" })).toContain(line);
    expect(render(lang, { topic: "water", loadError: null })).not.toContain(line);
  });
});
