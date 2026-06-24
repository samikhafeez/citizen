"use client";
import type { Lang, AnswerRecord } from "./types";

// Browser-side helpers for the resident journey (pseudonymous, local resume).
const K_LANG = "cfc_lang";
const K_SESSION = "cfc_session";
const K_ANSWERS = "cfc_answers";

export function getLang(): Lang {
  if (typeof window === "undefined") return "en";
  const v = window.localStorage.getItem(K_LANG);
  return v === "ar" ? "ar" : "en";
}
export function setLang(l: Lang) {
  window.localStorage.setItem(K_LANG, l);
}
export function getSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(K_SESSION);
}
export function setSessionId(id: string) {
  window.localStorage.setItem(K_SESSION, id);
}
export function getCachedAnswers(): AnswerRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(K_ANSWERS) || "[]");
  } catch {
    return [];
  }
}
export function setCachedAnswers(a: AnswerRecord[]) {
  window.localStorage.setItem(K_ANSWERS, JSON.stringify(a));
}
export function clearSession() {
  window.localStorage.removeItem(K_SESSION);
  window.localStorage.removeItem(K_ANSWERS);
}

export async function api(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch("/api/survey", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.error || `Request failed with status ${res.status}`);
  }
  return res.json();
}

