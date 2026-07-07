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


/**
 * Filtra il template per binario: "everyone" = survey per tutta
 * l'organizzazione; "internal" = schede compilate dai referenti (IT, HR,
 * business). Le sezioni senza audience contano come "everyone".
 */
export function filterTemplateForTrack(
  definition: AiReadinessTemplateDefinition,
  track: string | null | undefined
): AiReadinessTemplateDefinition {
  const wantInternal = track === "internal";
  const sections = definition.sections.filter((section) =>
    wantInternal
      ? section.audience === "internal"
      : section.audience !== "internal"
  );
  if (sections.length === 0) return definition;
  const sectionIds = new Set(sections.map((section) => section.id));
  const questions = definition.questions.filter((question) =>
    sectionIds.has(question.sectionId)
  );
  const pillarIds = new Set(questions.map((question) => question.pillarId));
  return {
    ...definition,
    sections,
    questions,
    pillars: definition.pillars.filter((pillar) => pillarIds.has(pillar.id)),
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
  scaleAnchors?: { min: string; max: string };
  levels?: Array<{ value: number; label: string }>;
};

export type AiReadinessCustomQuestion = {
  id: string;
  sectionId: string;
  label: string;
  description?: string;
  answerType: "scale" | "text";
  required?: boolean;
  scaleAnchors?: { min: string; max: string };
  levels?: Array<{ value: number; label: string }>;
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
        ...(edit.scaleAnchors?.min?.trim() && edit.scaleAnchors?.max?.trim()
          ? {
              scaleAnchors: {
                min: edit.scaleAnchors.min.trim(),
                max: edit.scaleAnchors.max.trim(),
              },
            }
          : {}),
        ...(Array.isArray(edit.levels) && edit.levels.length === 5
          ? {
              levels: edit.levels.map((level, i) => ({
                value: i + 1,
                label: String(level.label ?? "").trim(),
              })),
            }
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
      ...(custom.answerType !== "text"
        ? {
            allowUnsure: true,
            levels:
              Array.isArray(custom.levels) && custom.levels.length === 5
                ? custom.levels.map((level, i) => ({
                    value: i + 1,
                    label: String(level.label ?? "").trim(),
                  }))
                : [
                    { value: 1, label: "Per niente / mai" },
                    { value: 2, label: "Poco" },
                    { value: 3, label: "In parte" },
                    { value: 4, label: "Molto" },
                    { value: 5, label: "Completamente / sempre" },
                  ],
          }
        : {}),
      ...(custom.scaleAnchors?.min?.trim() && custom.scaleAnchors?.max?.trim()
        ? {
            scaleAnchors: {
              min: custom.scaleAnchors.min.trim(),
              max: custom.scaleAnchors.max.trim(),
            },
          }
        : {}),
    });
  }

  return { ...definition, questions };
}
