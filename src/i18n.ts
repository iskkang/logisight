// src/i18n.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ko from './locales/ko.json';
import ru from './locales/ru.json';
import uz from './locales/uz.json';
import zh from './locales/zh.json';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ko: { translation: ko },
    ru: { translation: ru },
    uz: { translation: uz },
    zh: { translation: zh },
  },
  lng: 'ko',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
