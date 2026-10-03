import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_READINESS_SURVEY_TRACKS,
  DEFAULT_TARGETED_SURVEY_TRACK,
  findUncoveredInternalPillarIds,
  surveyTrackMeta,
} from "./survey-track.ts";

test("il link mirato apre sulla scheda referenti, non sulla survey generale", () => {
  assert.equal(DEFAULT_TARGETED_SURVEY_TRACK, "internal");
  assert.match(
    AI_READINESS_SURVEY_TRACKS.internal.feeds,
    /Technology.*Context.*Workflow/
  );
});

test("ogni percorso dichiara in modo distinto cosa alimenta", () => {
  assert.notEqual(
    AI_READINESS_SURVEY_TRACKS.everyone.feeds,
    AI_READINESS_SURVEY_TRACKS.internal.feeds
  );
  assert.match(AI_READINESS_SURVEY_TRACKS.everyone.feeds, /Adoption/);
  assert.match(AI_READINESS_SURVEY_TRACKS.internal.feeds, /Context/);
  assert.match(AI_READINESS_SURVEY_TRACKS.use_case_expert.feeds, /Portfolio/);
});

test("track legacy o non riconosciuto resta survey organizzazione", () => {
  assert.equal(surveyTrackMeta(undefined).label, "Survey organizzazione");
  assert.equal(surveyTrackMeta("legacy").label, "Survey organizzazione");
});

const coverageSections = [
  { id: "tools", pillarId: "technology", audience: "everyone" as const },
  { id: "infra", pillarId: "technology", audience: "internal" as const },
  { id: "data", pillarId: "context", audience: "internal" as const },
  { id: "people", pillarId: "workflow", audience: "internal" as const },
];

test("una survey organizzazione completata non copre Context e Workflow", () => {
  assert.deepEqual(
    findUncoveredInternalPillarIds({
      pillarIds: ["technology", "context", "workflow"],
      sections: coverageSections,
      respondents: [
        {
          surveyTrack: "everyone",
          inviteStatus: "completed",
          questionScope: { sectionIds: ["tools"] },
        },
      ],
    }),
    ["context", "workflow"]
  );
});

test("una scheda referenti completa copre tutti i pilastri solo interni", () => {
  assert.deepEqual(
    findUncoveredInternalPillarIds({
      pillarIds: ["technology", "context", "workflow"],
      sections: coverageSections,
      respondents: [
        {
          surveyTrack: "internal",
          inviteStatus: "completed",
          questionScope: null,
        },
      ],
    }),
    []
  );
});

test("lo scope della scheda referenti segnala il pilastro ancora scoperto", () => {
  assert.deepEqual(
    findUncoveredInternalPillarIds({
      pillarIds: ["technology", "context", "workflow"],
      sections: coverageSections,
      respondents: [
        {
          surveyTrack: "internal",
          inviteStatus: "completed",
          questionScope: { sectionIds: ["data"] },
        },
        {
          surveyTrack: "internal",
          inviteStatus: "invited",
          questionScope: { sectionIds: ["people"] },
        },
      ],
    }),
    ["workflow"]
  );
});
