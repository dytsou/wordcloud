import type { EN_MESSAGES } from "./en";

export type TranslationKey = keyof typeof EN_MESSAGES;
export type MessageMap = Partial<Record<TranslationKey, string>>;
export type Translate = (
  key: TranslationKey,
  variables?: Record<string, string | number>,
) => string;
