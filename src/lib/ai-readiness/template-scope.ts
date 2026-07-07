import type { AiReadinessTemplateDefinition } from "./types";

/**
 * Pilastri inclusi in un assessment, letti da scoringConfig.includedPillars.
 * `null` = tutti i pilastri del template (default, retrocompatibile con gli
 * assessment esistenti che non hanno la chiave).
 */
export function includedPillarsFromScoringConfig(
  scoringConfig: Record<string, unknown> | null | undefined
): string[] | null {
  const raw = scoringConfig?.includedPillars;
  if (!Array.isArray(raw)) return null;
  const pillars = raw.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );
  return pillars.length > 0 ? pillars : null;
}

/**
 * Restringe il template ai soli pilastri selezionati: sezioni e domande dei
 * pilastri esclusi spariscono da survey, scoring e dashboard.
 */
export function filterTemplateDefinition(
  definition: AiReadinessTemplateDefinition,
  includedPillars: string[] | null
): AiReadinessTemplateDefinition {
  if (!includedPillars) return definition;
  const allowed = new Set(includedPillars);
  const pillars = definition.pillars.filter((pillar) => allowed.has(pillar.id));
  // Se la selezione non matcha nessun pilastro reale (config corrotta),
  // meglio il template completo di una survey vuota.
  if (pillars.length === 0) return definition;
  return {
    ...definition,
    pillars,
    sections: definition.sections.filter((section) => allowed.has(section.pillarId)),
    questions: definition.questions.filter((question) => allowed.has(question.pillarId)),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Personalizzazione per assessment: ogni singola domanda puo essere rimossa,
// modificata (testo/descrizione/obbligatorieta) o aggiunta (scala 0–5 o testo
// libero, cosi lo scoring resta sempre 0–5). Salvata in
// scoringConfig.templateOverrides.
// ────────────────────────────────────────────────────────────────────────────

export type AiReadinessQuestionEdit = {
  label?: string;
  description?: string;
  required?: boolean;
};

export type AiReadinessCustomQuestion = {
  id: string;
  sectionId: string;
  label: string;
  description?: string;
  answerType: "scale" | "text";
  required?: boolean;
};

export type AiReadinessTemplateOverrides = {
  removed?: string[];
  edited?: Record<string, AiReadinessQuestionEdit>;
  added?: AiReadinessCustomQuestion[];
};

export function templateOverridesFromScoringConfig(
  scoringConfig: Record<string, unknown> | null | undefined
): AiReadinessTemplateOverrides {
  const raw = scoringConfig?.templateOverrides;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const overrides = raw as AiReadinessTemplateOverrides;
  return {
    removed: Array.isArray(overrides.removed)
      ? overrides.removed.filter((id): id is string => typeof id === "string")
      : [],
    edited:
      overrides.edited && typeof overrides.edited === "object"
        ? overrides.edited
        : {},
    added: Array.isArray(overrides.added) ? overrides.added : [],
  };
}

export function applyTemplateOverrides(
  definition: AiReadinessTemplateDefinition,
  overrides: AiReadinessTemplateOverrides
): AiReadinessTemplateDefinition {
  const removed = new Set(overrides.removed ?? []);
  const edited = overrides.edited ?? {};
  const sectionById = new Map(definition.sections.map((s) => [s.id, s]));

  const questions = definition.questions
    .filter((question) => !removed.has(question.id))
    .map((question) => {
      const edit = edited[question.id];
      if (!edit) return question;
      return {
        ...question,
        ...(typeof edit.label === "string" && edit.label.trim()
          ? { label: edit.label.trim() }
          : {}),
        ...(typeof edit.description === "string"
          ? { description: edit.description.trim() || undefined }
          : {}),
        ...(typeof edit.required === "boolean"
          ? { required: edit.required }
          : {}),
      };
    });

  for (const custom of overrides.added ?? []) {
    const section = sectionById.get(custom.sectionId);
    if (!section) continue; // sezione fuori dai pilastri inclusi: ignora
    if (removed.has(custom.id)) continue;
    if (!custom.label?.trim()) continue;
    questions.push({
      id: custom.id,
      pillarId: section.pillarId,
      sectionId: section.id,
      label: custom.label.trim(),
      description: custom.description?.trim() || undefined,
      answerType: custom.answerType === "text" ? "text" : "scale",
      required: custom.required !== false && custom.answerType !== "text",
      min: 0,
      max: 5,
      weight: 1,
    });
  }

  return { ...definition, questions };
}
