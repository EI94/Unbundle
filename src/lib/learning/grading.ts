import { getActivity } from "./pack.ts";
import type { AttemptResponses, ObjectiveGrade, PrivateTrainingPack, TrainingRubric } from "./types.ts";

export class LearningValidationError extends Error {
  readonly fields: string[];
  constructor(message: string, fields: string[] = []) { super(message); this.name = "LearningValidationError"; this.fields = fields; }
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function invalid(message: string, fields: string[] = []): never { throw new LearningValidationError(message, fields); }
const charCount = (value: string) => [...value].length;

/** Validates a complete draft replacement; missing answers/text are allowed until submission. */
export function validateDraftResponses(pack: PrivateTrainingPack, activityId: string, raw: unknown): AttemptResponses {
  const activity = getActivity(pack, activityId);
  if (!record(raw) || Object.keys(raw).some((key) => !["answers", "fields", "mode"].includes(key))) invalid("Campi della risposta non validi");
  if (!record(raw.answers) || !record(raw.fields)) invalid("Risposte non valide");
  if (Buffer.byteLength(JSON.stringify(raw), "utf8") > 128_000) invalid("La risposta supera la dimensione consentita");
  const answers: [string, string][] = [];
  for (const [itemId, value] of Object.entries(raw.answers)) {
    const item = pack.items.find((entry) => entry.id === itemId && entry.activity_id === activityId);
    if (!activity.item_ids?.includes(itemId) || !item || typeof value !== "string" || !item.options.some((option) => option.id === value)) invalid("Opzione o domanda non valida", [itemId]);
    answers.push([itemId, value]);
  }
  const fields: [string, string][] = [];
  for (const [fieldId, value] of Object.entries(raw.fields)) {
    const field = activity.required_text_fields?.find((entry) => entry.id === fieldId);
    if (!field || typeof value !== "string") invalid("Campo di testo non valido", [fieldId]);
    if (charCount(value) > field.max_chars) invalid(`Il testo supera il limite di ${field.max_chars} caratteri`, [fieldId]);
    fields.push([fieldId, value]);
  }
  if (raw.mode !== undefined && (typeof raw.mode !== "string" || !activity.allowed_modes?.includes(raw.mode))) invalid("Modalità non valida", ["mode"]);
  return { answers: Object.fromEntries(answers), fields: Object.fromEntries(fields), ...(typeof raw.mode === "string" ? { mode: raw.mode } : {}) };
}

/** Completeness only. Text length is never evidence of semantic quality or competence. */
export function validateCompleteness(pack: PrivateTrainingPack, activityId: string, responses: AttemptResponses): void {
  const validated = validateDraftResponses(pack, activityId, responses);
  const activity = getActivity(pack, activityId);
  const missing = (activity.item_ids ?? []).filter((itemId) => !Object.hasOwn(validated.answers, itemId));
  for (const field of activity.required_text_fields ?? []) {
    if (!Object.hasOwn(validated.fields, field.id) || charCount(validated.fields[field.id].trim()) < field.min_chars) missing.push(field.id);
  }
  if (activity.allowed_modes?.length && !validated.mode) missing.push("mode");
  if (missing.length) invalid("Completa le risposte e i campi richiesti prima di inviare", missing);
}

/** Server caller must persist this result atomically with submittedAt; never accept a client result. */
export function gradeActivity(pack: PrivateTrainingPack, activityId: string, responses: AttemptResponses): ObjectiveGrade {
  validateCompleteness(pack, activityId, responses);
  const activity = getActivity(pack, activityId);
  if (!activity.item_ids?.length || activity.grading === "human_rubric") invalid("Questa attività richiede una revisione umana");
  const items = activity.item_ids.map((itemId) => {
    const item = pack.items.find((entry) => entry.id === itemId)!;
    const selectedOptionId = responses.answers[itemId];
    const correct = item.correct_option_ids.includes(selectedOptionId);
    const evidence = item.evidence_refs.map((reference) => {
      const [source, factId] = reference.split(":");
      return factId ? pack.cases.find((entry) => entry.id === source)!.facts!.find((fact) => fact.id === factId)!.text : pack.sources[source];
    });
    return { itemId, selectedOptionId, correct, critical: item.critical, feedback: item.feedback, evidence };
  });
  const correct = items.filter((item) => item.correct).length;
  const essential_errors = items.filter((item) => item.critical && !item.correct).map((item) => item.itemId);
  const status = !activity.completion_gate ? "formative_completed" : correct >= activity.pass_min_correct! && essential_errors.length === 0 ? "consolidated" : "needs_practice";
  return { correct, total: items.length, essential_errors, status, items };
}

/** Future review hook: callers must authenticate a human reviewer and retain evidence and history. */
export function gradeRubric(rubric: TrainingRubric, raw: unknown): "consolidated" | "needs_practice" {
  if (!record(raw) || Object.keys(raw).length !== rubric.criteria.length || rubric.criteria.some((criterion) => !Object.hasOwn(raw, criterion.id))) invalid("Criteri della rubrica incompleti");
  const values = Object.values(raw);
  if (values.some((value) => typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2)) invalid("Punteggi della rubrica non validi");
  const scores = raw as Record<string, number>;
  const total = Object.values(scores).reduce((sum, value) => sum + value, 0);
  return total >= rubric.minimum_points && rubric.critical_criterion_ids.every((criterion) => scores[criterion] >= rubric.require_critical_minimum) ? "consolidated" : "needs_practice";
}
