import { LIMITS } from "../core/limits";

export const LOCAL_DRAFT_STORAGE_KEY = "wordcloud-studio:source-draft:v1";

interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface CachedDraft {
  version: 1;
  sourceText: string;
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
