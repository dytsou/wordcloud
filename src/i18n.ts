import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { TokenizerDiagnostic } from "./core/types";
import {
  DE_MESSAGES,
  EN_MESSAGES,
  ES_MESSAGES,
  FR_MESSAGES,
  JA_MESSAGES,
  KO_MESSAGES,
  TH_MESSAGES,
  ZH_HANS_MESSAGES,
  ZH_HANT_MESSAGES,
} from "./i18n/messages";
import type {
  MessageMap,
  Translate,
  TranslationKey,
} from "./i18n/messages/types";

export type { Translate, TranslationKey } from "./i18n/messages/types";

export const UI_LOCALE_OPTIONS = [
  { value: "zh-Hant", label: "繁體中文" },
  { value: "zh-Hans", label: "简体中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt", label: "Português" },
  { value: "th", label: "ไทย" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "id", label: "Bahasa Indonesia" },
  { value: "it", label: "Italiano" },
  { value: "ru", label: "Русский" },
  { value: "ar", label: "العربية" },
  { value: "hi", label: "हिन्दी" },
] as const;

export type UiLocale = (typeof UI_LOCALE_OPTIONS)[number]["value"];

const UI_LOCALE_STORAGE_KEY = "wordcloud-studio:ui-locale:v1";

const TRANSLATIONS: Partial<Record<UiLocale, MessageMap>> = {
  "zh-Hant": ZH_HANT_MESSAGES,
  "zh-Hans": ZH_HANS_MESSAGES,
  ja: JA_MESSAGES,
  ko: KO_MESSAGES,
  es: ES_MESSAGES,
  fr: FR_MESSAGES,
  de: DE_MESSAGES,
  th: TH_MESSAGES,
};

function interpolate(
  template: string,
  variables?: Record<string, string | number>,
) {
  if (!variables) return template;
  return template.replace(/\{\{(\w+)\}\}/gu, (_, key: string) =>
    String(variables[key] ?? "{{" + key + "}}"),
  );
}

export function translate(
  locale: UiLocale,
  key: TranslationKey,
  variables?: Record<string, string | number>,
): string {
  const message = TRANSLATIONS[locale]?.[key] ?? EN_MESSAGES[key];
  return interpolate(message, variables);
}

function localeFromString(value: string): UiLocale | undefined {
  const normalized = value.toLowerCase();
  if (normalized.startsWith("zh-tw") || normalized.startsWith("zh-hk"))
    return "zh-Hant";
  if (normalized.startsWith("zh-cn") || normalized.startsWith("zh-sg"))
    return "zh-Hans";
  if (normalized === "zh") return "zh-Hans";
  const exact = UI_LOCALE_OPTIONS.find(
    (option) => option.value.toLowerCase() === normalized,
  );
  if (exact) return exact.value;
  const base = normalized.split("-")[0];
  const byBase = UI_LOCALE_OPTIONS.find(
    (option) => option.value.toLowerCase() === base,
  );
  return byBase?.value;
}

export function normalizeUiLocale(value: string): UiLocale {
  return localeFromString(value) ?? "en";
}

function browserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function detectUiLocale(): UiLocale {
  const storage = browserStorage();
  try {
    const cached = storage?.getItem(UI_LOCALE_STORAGE_KEY);
    if (cached && localeFromString(cached)) return localeFromString(cached)!;
  } catch {
    // Continue with the browser preferences when localStorage is blocked.
  }

  if (typeof navigator !== "undefined") {
    const candidates = [
      ...(Array.isArray(navigator.languages) ? navigator.languages : []),
      navigator.language,
    ];
    for (const candidate of candidates) {
      const locale = localeFromString(candidate);
      if (locale) return locale;
    }
  }
  return "en";
}

export function tokenizerLocaleLabel(
  locale: string,
  uiLocale: UiLocale,
): string {
  const nativeNames: Record<string, string> = {
    en: "English",
    "zh-Hant": "繁體中文",
    "zh-Hans": "简体中文",
    ja: "日本語",
    ko: "한국어",
    th: "ไทย",
    vi: "Tiếng Việt",
    id: "Bahasa Indonesia",
    ms: "Bahasa Melayu",
    fr: "Français",
    de: "Deutsch",
    es: "Español",
    it: "Italiano",
    pt: "Português",
    ru: "Русский",
    uk: "Українська",
    pl: "Polski",
    nl: "Nederlands",
    tr: "Türkçe",
    ar: "العربية",
    he: "עברית",
    hi: "हिन्दी",
    bn: "বাংলা",
    fa: "فارسی",
    ur: "اردو",
    sv: "Svenska",
    da: "Dansk",
    nb: "Norsk bokmål",
    no: "Norsk",
    fi: "Suomi",
    cs: "Čeština",
    sk: "Slovenčina",
    ro: "Română",
    bg: "Български",
    el: "Ελληνικά",
    hu: "Magyar",
    ca: "Català",
    hr: "Hrvatski",
    sl: "Slovenščina",
    sr: "Српски",
    et: "Eesti",
    lv: "Latviešu",
    lt: "Lietuvių",
    sw: "Kiswahili",
  };
  const native = nativeNames[locale] ?? locale;
  if (uiLocale === "en") return native + " · " + locale;
  return native + " · " + locale;
}

const DIAGNOSTIC_KEYS: Record<
  TokenizerDiagnostic["code"],
  keyof typeof EN_MESSAGES
> = {
  SOURCE_LIMIT: "diagnosticSourceLimit",
  RULE_LIMIT: "diagnosticRuleLimit",
  RULE_INVALID: "diagnosticRuleInvalid",
  RULE_CYCLE: "diagnosticRuleCycle",
  UNSUPPORTED_LOCALE: "diagnosticUnsupportedLocale",
  SEGMENTER_UNAVAILABLE: "diagnosticSegmenterUnavailable",
  TOKEN_LIMIT: "diagnosticTokenLimit",
  UNIQUE_TERM_LIMIT: "diagnosticUniqueTermLimit",
  TERM_LIMIT: "diagnosticTermLimit",
  EMPTY_INPUT: "diagnosticEmptyInput",
  NO_WORDS: "diagnosticNoWords",
};

export function translateTokenizerDiagnostic(
  diagnostic: TokenizerDiagnostic,
  t: Translate,
): string {
  return t(DIAGNOSTIC_KEYS[diagnostic.code]);
}

interface I18nContextValue {
  locale: UiLocale;
  setLocale: (locale: UiLocale) => void;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "en",
  setLocale: () => undefined,
  t: (key, variables) => translate("en", key, variables),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<UiLocale>(detectUiLocale);
  const setLocale = useCallback((next: UiLocale) => {
    setLocaleState(next);
    try {
      browserStorage()?.setItem(UI_LOCALE_STORAGE_KEY, next);
    } catch {
      // The interface still changes for this session when storage is blocked.
    }
  }, []);
  const t = useCallback<Translate>(
    (key, variables) => translate(locale, key, variables),
    [locale],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    document.title = t("appTitle");
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", t("metaDescription"));
  }, [locale, t]);

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );
  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
