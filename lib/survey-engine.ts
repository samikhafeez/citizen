import type { Survey, Question, AnswerRecord } from "./types";

/**
 * Deterministic survey engine.
 *
 * Pure functions only — given the survey and the answers so far, decide which
 * questions are visible and what comes next. The engine NEVER calls a model and
 * NEVER changes survey content; it only controls flow and branching.
 */

function answerValue(answers: AnswerRecord[], questionId: string): string[] {
  const a = answers.find((x) => x.questionId === questionId);
  if (!a || a.value == null) return [];
  return Array.isArray(a.value) ? a.value : [a.value];
}

/** Is a question visible given the answers collected so far? */
export function isVisible(q: Question, answers: AnswerRecord[]): boolean {
  if (!q.showIf) return true;
  const vals = answerValue(answers, q.showIf.questionId);
  return vals.some((v) => q.showIf!.in.includes(v));
}

/** Ordered list of currently-visible questions. */
export function visibleQuestions(survey: Survey, answers: AnswerRecord[]): Question[] {
  return survey.questions.filter((q) => isVisible(q, answers));
}

/** The next unanswered, visible question after the given answers; null if done. */
export function nextQuestion(survey: Survey, answers: AnswerRecord[]): Question | null {
  const answered = new Set(answers.map((a) => a.questionId));
  for (const q of survey.questions) {
    if (!isVisible(q, answers)) continue;
    if (!answered.has(q.id)) return q;
  }
  return null;
}

/** Progress (0..1) based on visible questions answered. */
export function progress(survey: Survey, answers: AnswerRecord[]): number {
  const visible = visibleQuestions(survey, answers);
  if (visible.length === 0) return 0;
  const answeredVisible = visible.filter((q) =>
    answers.some((a) => a.questionId === q.id)
  ).length;
  return Math.min(1, answeredVisible / visible.length);
}

export function getQuestion(survey: Survey, questionId: string): Question | undefined {
  return survey.questions.find((q) => q.id === questionId);
}
