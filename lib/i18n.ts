import en from "../locales/en.json";
import ar from "../locales/ar.json";
import type { Lang } from "./types";

const DICTS: Record<Lang, Record<string, string>> = { en, ar };

/** Resolve a UI string for a language; falls back to the key if missing. */
export function t(lang: Lang, key: string): string {
  return DICTS[lang]?.[key] ?? DICTS.en[key] ?? key;
}

export function dir(lang: Lang): "rtl" | "ltr" {
  return lang === "ar" ? "rtl" : "ltr";
}

export const LANGS: Lang[] = ["en", "ar"];
