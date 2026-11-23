import React, { createContext, useContext, useEffect, useState } from 'react';
import { ar } from './ar';
import { en, TranslationDict } from './en';

export type Language = 'en' | 'ar';

interface I18nContextValue {
  lang: Language;
  dir: 'ltr' | 'rtl';
  t: TranslationDict;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem('watchpm2_lang');
    return saved === 'ar' ? 'ar' : 'en';
  });

  const dir: 'ltr' | 'rtl' = lang === 'ar' ? 'rtl' : 'ltr';
  const t = lang === 'ar' ? ar : en;

  useEffect(() => {
    localStorage.setItem('watchpm2_lang', lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = (next: Language) => setLangState(next);
  const toggleLang = () => setLangState((prev) => (prev === 'en' ? 'ar' : 'en'));

  return (
    <I18nContext.Provider value={{ lang, dir, t, setLang, toggleLang }}>
      {children}
    </I18nContext.Provider>
  );
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
