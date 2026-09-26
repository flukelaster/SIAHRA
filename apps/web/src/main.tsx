import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Root } from './Root.tsx'
import { LanguageProvider } from './i18n/LanguageProvider.tsx'
import { DEFAULT_LANG, hasCatalog, loadCatalog, type Lang } from './i18n'
import { readInitialLang } from './i18n/initialLang'

function render(lang: Lang) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <LanguageProvider initialLang={lang}>
        <Root />
      </LanguageProvider>
    </StrictMode>,
  )
}

// อ่านภาษาเริ่มต้นครั้งเดียว (มันเขียน sessionStorage เมื่อมาจาก `?lang=`) ไทยเรนเดอร์
// ทันที — ภาษาอื่นรอ chunk แคตตาล็อกก่อน จะได้ไม่มีข้อความไทยวาบแล้วสลับ และถ้าโหลด
// ไม่สำเร็จ (ออฟไลน์/หลัง deploy) เปิดเป็นภาษาไทยตามจริง แทนหน้าขาว
const initialLang = readInitialLang()
if (hasCatalog(initialLang)) render(initialLang)
else loadCatalog(initialLang).then(() => render(initialLang), () => render(DEFAULT_LANG))
