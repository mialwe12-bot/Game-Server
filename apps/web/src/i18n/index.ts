import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from './de';
import en from './en';

export const LANGUAGES = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
] as const;

function initialLanguage(): string {
  try {
    const stored = localStorage.getItem('gs-lang');
    if (stored === 'de' || stored === 'en') return stored;
  } catch {
    // ignorieren
  }
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: { de: { translation: de }, en: { translation: en } },
  lng: initialLanguage(),
  fallbackLng: 'de',
  interpolation: { escapeValue: false }, // React escaped bereits
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem('gs-lang', lng);
  } catch {
    // ignorieren
  }
});
document.documentElement.lang = i18n.language;

export default i18n;
