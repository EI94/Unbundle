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
