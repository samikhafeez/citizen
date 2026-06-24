// Shared types for the Citizen Feedback Chatbot.

export type Lang = "en" | "ar";

export type QuestionType =
  | "single"
  | "multiple"
  | "scale"
  | "yesno"
  | "freetext";

export interface Localized {
  en: string;
  ar: string;
}

export interface Option {
  value: string;
  label: Localized;
}

export interface Question {
  id: string;
  theme: string; // theme id, or "demographics"
  type: QuestionType;
  prompt: Localized;
  options?: Option[];
  /** Free text allowed in addition to the choice (for closed questions). */
  optionalFreeText?: boolean;
  /** Show this question only when the predicate over prior answers is true. */
  showIf?: { questionId: string; in: string[] };
  required?: boolean;
  scaleLabels?: { low: Localized; high: Localized };
}

export interface Theme {
  id: string;
  title: Localized;
}

export interface Survey {
  version: string;
  themes: Theme[];
  questions: Question[];
}

export type RelevanceLabel =
  | "relevant"
  | "partially_relevant"
  | "off_topic"
  | "sensitive"
  | "unclear";

export interface AnswerRecord {
  questionId: string;
  /** Selected option value(s) for closed questions. */
  value?: string | string[];
  /** Optional / free-text content. */
  freeText?: string;
  language: Lang;
  relevance?: RelevanceLabel;
  skipped?: boolean;
  /** True when free-text was PII-scrubbed before storage. */
  scrubbed?: boolean;
  at: string; // ISO timestamp
}

export interface SessionRecord {
  id: string;
  language: Lang;
  surveyVersion: string;
  consent: { agreed: boolean; version: string; at: string } | null;
  status: "started" | "completed" | "stopped";
  answers: AnswerRecord[];
  events: InteractionEvent[];
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface InteractionEvent {
  type: "start" | "consent" | "answer" | "skip" | "back" | "redirect" | "complete" | "stop";
  questionId?: string;
  at: string;
}
