import languageData from './languageData.json';

export type LanguageCode = keyof typeof languageData.languageCodeToName;

export const i18nLanguages = languageData.i18nLanguages as readonly LanguageCode[];
export const selectableLanguages = languageData.selectableLanguages as readonly LanguageCode[];
export const languageCodeToName = languageData.languageCodeToName as Readonly<Record<LanguageCode, string>>;
export const fallbackLanguage = languageData.fallbackLanguage as LanguageCode;
