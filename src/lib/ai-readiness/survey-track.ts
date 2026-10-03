import { questionScopeFromUnknown } from "./template-scope.ts";

export type AiReadinessSurveyTrack =
  | "everyone"
  | "internal"
  | "use_case_expert";

type SurveyTrackMeta = {
  label: string;
  shortLabel: string;
  audience: string;
  description: string;
  feeds: string;
};

export const DEFAULT_TARGETED_SURVEY_TRACK: AiReadinessSurveyTrack = "internal";

export const AI_READINESS_SURVEY_TRACKS: Record<
  AiReadinessSurveyTrack,
  SurveyTrackMeta
> = {
  everyone: {
    label: "Survey organizzazione",
    shortLabel: "Organizzazione",
    audience: "Per tutte le persone",
    description:
      "Misura strumenti e regole d'uso, conoscenza, adozione e idee concrete.",
    feeds: "Technology (uso), Adoption e Use Cases",
  },
  internal: {
    label: "Scheda tecnica e organizzativa",
    shortLabel: "Referenti",
    audience: "Per IT, HR e referenti interni",
    description:
      "Raccoglie infrastruttura, dati e conoscenza aziendale, persone, ruoli e processi.",
    feeds: "Technology (infrastruttura), Context e Workflow",
  },
  use_case_expert: {
    label: "Raccolta use case",
    shortLabel: "Use case",
    audience: "Per esperti del processo o del business",
    description:
      "Raccoglie bisogno, processo attuale e ipotesi di applicazione dell'AI.",
    feeds: "Use Cases e Portfolio",
  },
};

export function surveyTrackMeta(track: string | null | undefined) {
  if (track === "internal" || track === "use_case_expert") {
    return AI_READINESS_SURVEY_TRACKS[track];
  }
  return AI_READINESS_SURVEY_TRACKS.everyone;
}

export function findUncoveredInternalPillarIds({
  pillarIds,
  sections,
  respondents,
}: {
  pillarIds: readonly string[];
  sections: ReadonlyArray<{
    id: string;
    pillarId: string;
    audience?: "everyone" | "internal";
  }>;
  respondents: ReadonlyArray<{
    surveyTrack: string;
    inviteStatus: string;
    questionScope: unknown;
  }>;
}) {
  const internalSections = sections.filter(
    (section) => section.audience === "internal"
  );
  const publicPillarIds = new Set(
    sections
      .filter((section) => section.audience !== "internal")
      .map((section) => section.pillarId)
  );
  const internalOnlyPillarIds = new Set(
    internalSections
      .filter((section) => !publicPillarIds.has(section.pillarId))
      .map((section) => section.pillarId)
  );
  const coveredPillarIds = new Set<string>();

  respondents
    .filter(
      (respondent) =>
        respondent.surveyTrack === "internal" &&
        respondent.inviteStatus === "completed"
    )
    .forEach((respondent) => {
      const scope = questionScopeFromUnknown(respondent.questionScope);
      const selectedSections = scope?.sectionIds?.length
        ? internalSections.filter((section) =>
            scope.sectionIds?.includes(section.id)
          )
        : internalSections;
      selectedSections.forEach((section) => {
        coveredPillarIds.add(section.pillarId);
      });
    });

  return pillarIds.filter(
    (pillarId) =>
      internalOnlyPillarIds.has(pillarId) && !coveredPillarIds.has(pillarId)
  );
}
