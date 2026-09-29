/**
 * i18n bootstrap for NDM.
 * English is the source of truth; every other locale falls back to it key by
 * key, so a missing translation degrades gracefully instead of rendering a raw
 * key. The chosen language persists in localStorage ('ndm_lang') and is applied
 * to <html lang/dir> so Arabic and Persian flip the whole UI to RTL.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import tr from './locales/tr';
import de from './locales/de';
import fr from './locales/fr';
import es from './locales/es';
import ar from './locales/ar';
import fa from './locales/fa';

export const NDM_LANG_KEY = 'ndm_lang';

/** Languages that render right-to-left; everything else stays LTR. */
export const RTL_LANGUAGES = ['ar', 'fa'];

export interface NdmLanguage {
  code: string;
  /** Native name, always shown in its own language. */
  nativeName: string;
  dir: 'ltr' | 'rtl';
}

export const NDM_LANGUAGES: NdmLanguage[] = [
  { code: 'en', nativeName: 'English', dir: 'ltr' },
  { code: 'tr', nativeName: 'Türkçe', dir: 'ltr' },
  { code: 'de', nativeName: 'Deutsch', dir: 'ltr' },
  { code: 'fr', nativeName: 'Français', dir: 'ltr' },
  { code: 'es', nativeName: 'Español', dir: 'ltr' },
  { code: 'ar', nativeName: 'العربية', dir: 'rtl' },
  { code: 'fa', nativeName: 'فارسی', dir: 'rtl' },
];

function detectInitialLanguage(): string {
  try {
    const saved = localStorage.getItem(NDM_LANG_KEY);
    if (saved && NDM_LANGUAGES.some((l) => l.code === saved)) return saved;
  } catch {}
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return NDM_LANGUAGES.some((l) => l.code === nav) ? nav : 'en';
}

export function applyDocumentDirection(lang: string): void {
  const lang0 = lang.slice(0, 2);
  const dir = RTL_LANGUAGES.includes(lang0) ? 'rtl' : 'ltr';
  document.documentElement.lang = lang0;
  document.documentElement.dir = dir;
}

export function changeLanguage(lang: string): void {
  void i18n.changeLanguage(lang);
  try {
    localStorage.setItem(NDM_LANG_KEY, lang);
  } catch {}
  applyDocumentDirection(lang);
}

applyDocumentDirection(detectInitialLanguage());

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    tr: { translation: tr },
    de: { translation: de },
    fr: { translation: fr },
    es: { translation: es },
    ar: { translation: ar },
    fa: { translation: fa },
  },
  lng: detectInitialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

export default i18n;
