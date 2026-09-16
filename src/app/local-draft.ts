import { LIMITS } from "../core/limits";
import type { LayoutStyle } from "../core/layout";

export const LOCAL_DRAFT_STORAGE_KEY = "wordcloud-studio:source-draft:v1";
export const LOCAL_STOP_WORDS_STORAGE_KEY = "wordcloud-studio:stop-words:v1";
export const LOCAL_DICTIONARY_STORAGE_KEY = "wordcloud-studio:dictionary:v1";
export const LOCAL_STYLE_STORAGE_KEY = "wordcloud-studio:style-preferences:v1";
export const TOKEN_INPUT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const CACHE_VERSION = 1 as const;

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface CachedDraft {
  version: 1;
  sourceText: string;
}

interface CachedTokenList {
  version: typeof CACHE_VERSION;
  values: string[];
  expiresAt: number;
}

interface CachedStylePreferences {
  version: typeof CACHE_VERSION;
  minFontSize: number;
  maxFontSize: number;
  padding: number;
  rotationAngle: number;
  palette: string[];
}

export interface CachedEditorPreferences {
  stopWords?: string[];
  dictionary?: string[];
  presentation?: Pick<
    LayoutStyle,
    "minFontSize" | "maxFontSize" | "padding" | "rotations" | "palette"
  >;
}

function browserStorage(): DraftStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function fitsSourceLimit(sourceText: string): boolean {
  return (
    new TextEncoder().encode(sourceText).byteLength <= LIMITS.maxSourceBytes
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isNumberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function readCachedTokenList(
  key: string,
  storage: DraftStorage | undefined,
  now: number,
): string[] | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(key);
    if (!raw) return undefined;
    const cached = JSON.parse(raw) as Partial<CachedTokenList>;
    if (
      cached.version !== CACHE_VERSION ||
      !isStringArray(cached.values) ||
      typeof cached.expiresAt !== "number" ||
      !Number.isFinite(cached.expiresAt) ||
      cached.expiresAt <= now
    ) {
      storage.removeItem(key);
      return undefined;
    }
    return [...cached.values];
  } catch {
    return undefined;
  }
}

function writeCachedTokenList(
  key: string,
  values: string[],
  storage: DraftStorage | undefined,
  now: number,
): void {
  if (!storage) return;
  try {
    if (values.length === 0) {
      storage.removeItem(key);
      return;
    }
    const cached: CachedTokenList = {
      version: CACHE_VERSION,
      values: [...values],
      expiresAt: now + TOKEN_INPUT_CACHE_TTL_MS,
    };
    storage.setItem(key, JSON.stringify(cached));
  } catch {
    // localStorage may be unavailable or full; the editor still works in memory.
  }
}

function readCachedStyle(
  storage: DraftStorage | undefined,
): CachedEditorPreferences["presentation"] {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(LOCAL_STYLE_STORAGE_KEY);
    if (!raw) return undefined;
    const cached = JSON.parse(raw) as Partial<CachedStylePreferences>;
    if (
      cached.version !== CACHE_VERSION ||
      !isNumberInRange(cached.minFontSize, 8, 80) ||
      !isNumberInRange(cached.maxFontSize, 24, 160) ||
      cached.minFontSize > cached.maxFontSize ||
      !isNumberInRange(cached.padding, LIMITS.minPadding, 24) ||
      !isNumberInRange(cached.rotationAngle, 0, 120) ||
      !isStringArray(cached.palette)
    ) {
      storage.removeItem(LOCAL_STYLE_STORAGE_KEY);
      return undefined;
    }
    return {
      minFontSize: cached.minFontSize,
      maxFontSize: cached.maxFontSize,
      padding: cached.padding,
      rotations:
        cached.rotationAngle === 0
          ? [0]
          : [0, -cached.rotationAngle, cached.rotationAngle],
      palette: [...cached.palette],
    };
  } catch {
    return undefined;
  }
}

export function readCachedStopWords(
  storage = browserStorage(),
  now = Date.now(),
): string[] | undefined {
  return readCachedTokenList(LOCAL_STOP_WORDS_STORAGE_KEY, storage, now);
}

export function writeCachedStopWords(
  values: string[],
  storage = browserStorage(),
  now = Date.now(),
): void {
  writeCachedTokenList(LOCAL_STOP_WORDS_STORAGE_KEY, values, storage, now);
}

export function readCachedDictionary(
  storage = browserStorage(),
  now = Date.now(),
): string[] | undefined {
  return readCachedTokenList(LOCAL_DICTIONARY_STORAGE_KEY, storage, now);
}

export function writeCachedDictionary(
  values: string[],
  storage = browserStorage(),
  now = Date.now(),
): void {
  writeCachedTokenList(LOCAL_DICTIONARY_STORAGE_KEY, values, storage, now);
}

export function readCachedEditorPreferences(
  storage = browserStorage(),
  now = Date.now(),
): CachedEditorPreferences {
  return {
    stopWords: readCachedStopWords(storage, now),
    dictionary: readCachedDictionary(storage, now),
    presentation: readCachedStyle(storage),
  };
}

export function writeCachedStylePreferences(
  presentation: LayoutStyle,
  storage = browserStorage(),
): void {
  if (!storage) return;
  try {
    const rotationAngle = Math.min(
      120,
      Math.max(
        0,
        ...presentation.rotations.map((rotation) => Math.abs(rotation)),
      ),
    );
    const cached: CachedStylePreferences = {
      version: CACHE_VERSION,
      minFontSize: presentation.minFontSize,
      maxFontSize: presentation.maxFontSize,
      padding: presentation.padding,
      rotationAngle,
      palette: [...presentation.palette],
    };
    storage.setItem(LOCAL_STYLE_STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // localStorage may be unavailable or full; the editor still works in memory.
  }
}

export function readCachedSource(storage = browserStorage()): string {
  if (!storage) return "";
  try {
    const raw = storage.getItem(LOCAL_DRAFT_STORAGE_KEY);
    if (!raw) return "";
    const cached = JSON.parse(raw) as Partial<CachedDraft>;
    if (
      cached.version !== 1 ||
      typeof cached.sourceText !== "string" ||
      !fitsSourceLimit(cached.sourceText)
    ) {
      return "";
    }
    return cached.sourceText;
  } catch {
    return "";
  }
}

export function writeCachedSource(
  sourceText: string,
  storage = browserStorage(),
): void {
  if (!storage) return;
  try {
    if (!sourceText || !fitsSourceLimit(sourceText)) {
      storage.removeItem(LOCAL_DRAFT_STORAGE_KEY);
      return;
    }
    const cached: CachedDraft = { version: 1, sourceText };
    storage.setItem(LOCAL_DRAFT_STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // localStorage may be unavailable or full; the editor still works in memory.
  }
}

export function clearCachedSource(storage = browserStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(LOCAL_DRAFT_STORAGE_KEY);
  } catch {
    // Clearing the cache is best effort and must not interrupt a new document.
  }
}
