import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import type { AttemptOrder, LearnerActivityDTO, PrivateTrainingPack, TrainingActivity } from "./types.ts";

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/).refine((value) => !["__proto__", "constructor", "prototype"].includes(value));
const text = z.string().trim().min(1).max(20_000);
const positive = z.number().int().positive().max(10_000);
const identifiers = z.array(id).max(500);
const movement = z.strictObject({ id, origin: text, destination: text, day: text, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) });
const field = z.strictObject({ id, label: text, min_chars: positive, max_chars: positive, grading: z.literal("unscored_reflection").optional() });
const activity = z.strictObject({
  id, module_id: id, type: z.enum(["knowledge_check", "case_review", "prompt_lab", "skill_blueprint"]), title: text,
  item_ids: identifiers.optional(), case_id: id.optional(), purpose: z.enum(["formative", "practice", "post_module", "retake"]),
  ai_assistance: z.enum(["not_allowed", "allowed_after_individual_decisions", "declared_allowed"]), completion_gate: z.boolean(),
  estimated_minutes: positive, pass_min_correct: positive.optional(), required_critical_correct: z.boolean().optional(),
  required_text_fields: z.array(field).max(30).optional(), allowed_modes: z.array(z.enum(["review_reference_output", "execute_authorized_assistant"])).min(1).optional(),
  retake_activity_id: id.optional(), parallel_form_status: text.optional(), rubric_id: id.optional(), grading: z.literal("human_rubric").optional(), retake_policy: text.optional(),
});
const packSchema = z.strictObject({
  schema_version: z.literal("1.0.0"), content_version: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/), status: text, visibility: z.string().includes("PRIVATE"), language: id, client_pack: id,
  source_snapshot_sha: z.string().regex(/^[0-9a-f]{40}$/),
  modules: z.array(z.strictObject({ id, title: text, subtitle: text, objective: text,
    cohorts: z.array(z.strictObject({ id, start_local: text, end_local: text, timezone: text })).min(1).max(30), duration_minutes: positive,
  })).min(1).max(20),
  competencies: z.array(z.strictObject({ id, label: text })).min(1).max(100),
  cases: z.array(z.strictObject({
    id, title: text, source: text, synthetic: z.literal(true), text: text.optional(), facts: z.array(z.strictObject({ id, text })).max(100).optional(),
    prepared_bad_output: text.optional(), reference_output: text, task: text.optional(), prompt: text.optional(), boundaries: z.array(text).min(1).max(100),
    request: z.strictObject({ outbound_origin: text, outbound_destination: text, outbound_day: text, return_origin: text, return_destination: text, return_day: text, passengers: positive }).optional(),
    movements: z.array(movement).max(100).optional(),
    test_variants: z.array(z.strictObject({ id, expected_direct_candidates: identifiers, add_movement: movement.optional(), meaning: text.optional() })).max(100).optional(),
    missing: z.array(text).max(100).optional(),
    rows: z.array(z.strictObject({ id, supplier: text, document: text, order: id.nullable(), amount_cents: z.number().int().nonnegative().safe() })).max(500).optional(),
    orders: z.array(z.strictObject({ id, amount_cents: z.number().int().nonnegative().safe() })).max(500).optional(), change_note: text.optional(),
  })).max(100),
  activities: z.array(activity).min(1).max(100),
  items: z.array(z.strictObject({
    id, module_id: id, activity_id: id, type: z.literal("single_choice"), prompt: text,
    options: z.array(z.strictObject({ id, text })).min(2).max(20), correct_option_ids: z.array(id).length(1), points: z.literal(1), critical: z.boolean(),
    competency_id: id, feedback: text, evidence_refs: z.array(text).min(1).max(30), version: positive,
  })).min(1).max(500),
  rubrics: z.array(z.strictObject({
    id, max_points: positive, minimum_points: positive, critical_criterion_ids: identifiers, require_critical_minimum: z.number().int().min(0).max(2),
    criteria: z.array(z.strictObject({ id, label: text, anchors: z.strictObject({ "0": text, "1": text, "2": text }) })).min(1).max(30), review_rules: z.array(text).min(1).max(30),
  })).max(30),
  sources: z.record(id, text),
  policy: z.strictObject({
    graded_answers_authority: z.literal("server_only"), survey_linking: z.literal("forbidden_for_anonymous_responses"), confidence: z.literal("separate_optional_not_scored"),
    public_leaderboard: z.literal(false), first_attempt_preserved: z.literal(true), completion_not_certification: z.literal(true), llm_grade_is_final: z.literal(false),
    m1_has_no_llm_dependency: z.literal(true), raw_answers_in_analytics: z.literal(false),
  }),
});

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Pacchetto formazione non valido: ${message}`);
}
function unique(values: string[], label: string) { invariant(new Set(values).size === values.length, `${label}: identificativi duplicati`); }
function ids(values: { id: string }[]) { return values.map((value) => value.id); }

/** Rejects invalid dates and both DST gaps and ambiguous repeated wall-clock times. */
export function localDateTimeToUtc(local: string, timeZone: string): Date {
  invariant(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local), "data locale non valida");
  const naive = Date.parse(`${local}Z`);
  invariant(Number.isFinite(naive) && new Date(naive).toISOString().slice(0, 19) === local, "data locale inesistente");
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  } catch { throw new Error("Pacchetto formazione non valido: fuso orario non valido"); }
  const wallTime = (time: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(time)).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  };
  const offsets = new Set<number>();
  for (let hour = -36; hour <= 36; hour += 6) {
    const sample = naive + hour * 3_600_000;
    offsets.add(Date.parse(`${wallTime(sample)}Z`) - sample);
  }
  const candidates = [...offsets].map((offset) => naive - offset).filter((candidate) => wallTime(candidate) === local);
  invariant(candidates.length === 1, "orario inesistente o ambiguo nel fuso indicato");
  return new Date(candidates[0]);
}

/** Strict import boundary. Never log the input or detailed schema values (the pack contains keys). */
export function parseTrainingPack(raw: unknown): PrivateTrainingPack {
  invariant(Buffer.byteLength(JSON.stringify(raw) ?? "", "utf8") <= 2_000_000, "dimensione eccessiva");
  const parsed = packSchema.safeParse(raw);
  invariant(parsed.success, "schema o versione non supportati");
  const pack = parsed.data;
  for (const [label, values] of Object.entries({ modules: pack.modules, competencies: pack.competencies, cases: pack.cases, activities: pack.activities, items: pack.items, rubrics: pack.rubrics })) unique(ids(values), label);
  unique(pack.modules.flatMap((module) => ids(module.cohorts)), "coorti");
  const moduleIds = new Set(ids(pack.modules));
  const competencyIds = new Set(ids(pack.competencies));
  const activities = new Map(pack.activities.map((value) => [value.id, value]));
  const items = new Map(pack.items.map((value) => [value.id, value]));
  const cases = new Map(pack.cases.map((value) => [value.id, value]));
  const rubrics = new Set(ids(pack.rubrics));
  for (const trainingModule of pack.modules) for (const cohort of trainingModule.cohorts) {
    const start = localDateTimeToUtc(cohort.start_local, cohort.timezone);
    const end = localDateTimeToUtc(cohort.end_local, cohort.timezone);
    invariant(end.getTime() - start.getTime() === trainingModule.duration_minutes * 60_000, "durata sessione non coerente");
  }
  for (const item of pack.items) {
    unique(ids(item.options), "opzioni");
    invariant(item.options.some((option) => option.id === "unsure"), "opzione di incertezza mancante");
    invariant(item.correct_option_ids[0] !== "unsure" && item.options.some((option) => option.id === item.correct_option_ids[0]), "chiave opzione non valida");
    invariant(moduleIds.has(item.module_id) && competencyIds.has(item.competency_id), "riferimento modulo o competenza mancante");
    const parent = activities.get(item.activity_id);
    invariant(parent?.module_id === item.module_id && parent.item_ids?.includes(item.id), "item non assegnato o incoerente");
    for (const reference of item.evidence_refs) {
      const [sourceId, factId, extra] = reference.split(":");
      invariant(!extra && (factId ? cases.get(sourceId)?.facts?.some((fact) => fact.id === factId) : Object.hasOwn(pack.sources, sourceId)), "fonte di evidenza mancante");
    }
  }
  for (const entry of pack.cases) {
    unique(ids(entry.facts ?? []), "fatti"); unique(ids(entry.movements ?? []), "movimenti"); unique(ids(entry.rows ?? []), "righe"); unique(ids(entry.orders ?? []), "ordini"); unique(ids(entry.test_variants ?? []), "varianti");
    invariant(Boolean(entry.text || entry.request || entry.rows?.length), "caso senza materiale");
    for (const row of entry.rows ?? []) invariant(row.order === null || entry.orders?.some((order) => order.id === row.order), "ordine non trovato");
    for (const variant of entry.test_variants ?? []) {
      const movementIds = [...ids(entry.movements ?? []), ...(variant.add_movement ? [variant.add_movement.id] : [])];
      unique(movementIds, "movimenti variante"); unique(variant.expected_direct_candidates, "candidati variante");
      invariant(variant.expected_direct_candidates.every((candidate) => movementIds.includes(candidate)), "candidato variante non trovato");
    }
  }
  for (const entry of pack.activities) {
    invariant(moduleIds.has(entry.module_id), "modulo attività mancante");
    invariant(!entry.case_id || cases.has(entry.case_id), "caso mancante");
    invariant(!entry.rubric_id || rubrics.has(entry.rubric_id), "rubrica mancante");
    unique(entry.item_ids ?? [], "item attività"); unique(ids(entry.required_text_fields ?? []), "campi"); unique(entry.allowed_modes ?? [], "modalità");
    for (const field of entry.required_text_fields ?? []) invariant(field.min_chars <= field.max_chars, "limiti testo incoerenti");
    const objective = entry.type === "knowledge_check" || entry.type === "case_review";
    invariant(objective ? Boolean(entry.item_ids?.length) && !entry.rubric_id && !entry.grading : !entry.item_ids?.length && Boolean(entry.rubric_id) && entry.grading === "human_rubric", "tipo valutazione incoerente");
    for (const itemId of entry.item_ids ?? []) invariant(items.get(itemId)?.activity_id === entry.id && items.get(itemId)?.module_id === entry.module_id, "riferimento item incoerente");
    if (objective && entry.completion_gate) {
      invariant(entry.pass_min_correct && entry.pass_min_correct <= (entry.item_ids?.length ?? 0), "soglia non valida");
      invariant(entry.required_critical_correct === true, "controllo dei punti essenziali richiesto");
    }
    if (entry.type === "case_review") {
      const material = cases.get(entry.case_id ?? "");
      invariant(material?.text && material.prepared_bad_output && material.task && entry.required_text_fields?.length && entry.allowed_modes?.length, "caso guidato incompleto");
    }
    if (entry.retake_activity_id) {
      const retake = activities.get(entry.retake_activity_id);
      invariant(retake && retake.id !== entry.id && retake.module_id === entry.module_id && retake.purpose === "retake" && !retake.retake_activity_id, "recupero incoerente");
    }
  }
  for (const rubric of pack.rubrics) {
    unique(ids(rubric.criteria), "criteri"); unique(rubric.critical_criterion_ids, "criteri essenziali");
    invariant(rubric.max_points === rubric.criteria.length * 2 && rubric.minimum_points <= rubric.max_points, "soglia rubrica incoerente");
    invariant(rubric.critical_criterion_ids.every((criterion) => rubric.criteria.some((entry) => entry.id === criterion)), "criterio essenziale mancante");
  }
  return pack;
}

export function trainingPackHash(pack: PrivateTrainingPack): string { return createHash("sha256").update(JSON.stringify(pack)).digest("hex"); }
export function getActivity(pack: PrivateTrainingPack, activityId: string): TrainingActivity {
  const activity = pack.activities.find((entry) => entry.id === activityId);
  if (!activity) throw new Error("Attività non disponibile");
  return activity;
}
function shuffle<T>(input: T[]): T[] {
  const values = [...input];
  for (let index = values.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [values[index], values[other]] = [values[other], values[index]];
  }
  return values;
}
/** Generate on start only; persist the returned order with the attempt. */
export function createAttemptOrder(pack: PrivateTrainingPack, activityId: string): AttemptOrder {
  const activity = getActivity(pack, activityId);
  const itemIds = shuffle(activity.item_ids ?? []);
  return { itemIds, optionIds: Object.fromEntries(itemIds.map((itemId) => {
    const item = pack.items.find((entry) => entry.id === itemId);
    invariant(item, "item mancante");
    return [itemId, shuffle(ids(item.options))];
  })) };
}
function exactPermutation(actual: string[], expected: string[]): boolean { return actual.length === expected.length && new Set(actual).size === expected.length && actual.every((entry) => expected.includes(entry)); }
/** Allowlist DTO: never spread private activity, item, case, policy or source objects. */
export function getLearnerActivity(pack: PrivateTrainingPack, activityId: string, order: AttemptOrder): LearnerActivityDTO {
  const activity = getActivity(pack, activityId);
  invariant(exactPermutation(order.itemIds, activity.item_ids ?? []) && exactPermutation(Object.keys(order.optionIds), order.itemIds), "ordine tentativo non valido");
  const material = pack.cases.find((entry) => entry.id === activity.case_id);
  return {
    id: activity.id, moduleId: activity.module_id, title: activity.title, type: activity.type, purpose: activity.purpose,
    aiAssistance: activity.ai_assistance, estimatedMinutes: activity.estimated_minutes, completionGate: activity.completion_gate,
    passMinCorrect: activity.pass_min_correct ?? null, requiresCriticalCorrect: activity.required_critical_correct ?? false,
    allowedModes: [...(activity.allowed_modes ?? [])],
    requiredTextFields: (activity.required_text_fields ?? []).map((field) => ({ id: field.id, label: field.label, minChars: field.min_chars, maxChars: field.max_chars })),
    items: order.itemIds.map((itemId) => {
      const item = pack.items.find((entry) => entry.id === itemId)!;
      invariant(exactPermutation(order.optionIds[itemId], ids(item.options)), "ordine opzioni non valido");
      return { id: item.id, prompt: item.prompt, options: order.optionIds[itemId].map((optionId) => {
        const option = item.options.find((entry) => entry.id === optionId)!;
        return { id: option.id, text: option.text };
      }) };
    }),
    case: material ? { id: material.id, title: material.title, synthetic: true, text: material.text ?? null, preparedBadOutput: material.prepared_bad_output ?? null, task: material.task ?? null } : null,
  };
}
/** Caller must authorize a committed submission before returning this separate DTO. */
export function getSubmittedCaseExample(pack: PrivateTrainingPack, activityId: string): { referenceOutput: string; prompt: string | null } | null {
  const activity = getActivity(pack, activityId);
  const material = pack.cases.find((entry) => entry.id === activity.case_id);
  return material ? { referenceOutput: material.reference_output, prompt: material.prompt ?? null } : null;
}
