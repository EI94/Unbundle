import test from "node:test";
import assert from "node:assert/strict";
import { AI_READINESS_SYSTEM_TEMPLATE } from "./default-template.ts";
import {
  filterTemplateDefinition,
  includedPillarsFromScoringConfig,
} from "./template-scope.ts";
import { scoreResponse } from "./scoring.ts";
import type { AiReadinessAnswer } from "./types.ts";

test("includedPillarsFromScoringConfig: assente o vuoto = tutti i pilastri", () => {
  assert.equal(includedPillarsFromScoringConfig(null), null);
  assert.equal(includedPillarsFromScoringConfig({}), null);
  assert.equal(includedPillarsFromScoringConfig({ includedPillars: [] }), null);
  assert.equal(
    includedPillarsFromScoringConfig({ includedPillars: "technology" }),
    null
  );
  assert.deepEqual(
    includedPillarsFromScoringConfig({ includedPillars: ["adoption"] }),
    ["adoption"]
  );
});

test("filterTemplateDefinition restringe pilastri, sezioni e domande", () => {
  const filtered = filterTemplateDefinition(AI_READINESS_SYSTEM_TEMPLATE, [
    "adoption",
  ]);
  assert.deepEqual(
    filtered.pillars.map((pillar) => pillar.id),
    ["adoption"]
  );
  assert.ok(filtered.sections.length > 0);
  assert.ok(filtered.sections.every((section) => section.pillarId === "adoption"));
  assert.ok(filtered.questions.length > 0);
  assert.ok(filtered.questions.every((question) => question.pillarId === "adoption"));
});

test("selezione senza match reale ricade sul template completo", () => {
  const filtered = filterTemplateDefinition(AI_READINESS_SYSTEM_TEMPLATE, [
    "pilastro-inventato",
  ]);
  assert.equal(filtered.pillars.length, AI_READINESS_SYSTEM_TEMPLATE.pillars.length);
});

test("lo scoring su template filtrato usa solo i pilastri inclusi", () => {
  const filtered = filterTemplateDefinition(AI_READINESS_SYSTEM_TEMPLATE, [
    "technology",
  ]);
  const answers: AiReadinessAnswer[] = filtered.questions
    .filter((question) => question.answerType === "scale")
    .map((question) => ({
      questionId: question.id,
      value: 4,
      answerType: question.answerType,
      pillarId: question.pillarId,
      sectionId: question.sectionId,
      answeredAt: "2026-07-07T00:00:00.000Z",
    }));
  const scores = scoreResponse({ template: filtered, answers });
  assert.equal(typeof scores.pillarScores.technology, "number");
  assert.ok(!("adoption" in scores.pillarScores));
  assert.equal(scores.bottleneckPillar, "technology");
  assert.ok(scores.readinessIndex != null);
});

test("applyTemplateOverrides: rimuove, modifica e aggiunge domande", async () => {
  const { applyTemplateOverrides, templateOverridesFromScoringConfig } = await import("./template-scope.ts");
  const base = AI_READINESS_SYSTEM_TEMPLATE;
  const firstScale = base.questions.find((q) => q.answerType === "scale");
  assert.ok(firstScale);
  const overrides = templateOverridesFromScoringConfig({
    templateOverrides: {
      removed: ["tech-support"],
      edited: { [firstScale.id]: { label: "Testo personalizzato dal cliente", required: false } },
      added: [
        { id: "custom-abc12345", sectionId: "adoption-usage", label: "Domanda su misura del cliente?", answerType: "scale" },
        { id: "custom-orfano", sectionId: "sezione-che-non-esiste", label: "Ignorami", answerType: "scale" },
      ],
    },
  });
  const result = applyTemplateOverrides(base, overrides);
  assert.ok(base.questions.some((q) => q.id === "tech-support"));
  assert.ok(!result.questions.some((q) => q.id === "tech-support"));
  const editedQ = result.questions.find((q) => q.id === firstScale.id);
  assert.equal(editedQ?.label, "Testo personalizzato dal cliente");
  assert.equal(editedQ?.required, false);
  const custom = result.questions.find((q) => q.id === "custom-abc12345");
  assert.equal(custom?.pillarId, "adoption");
  assert.equal(custom?.answerType, "scale");
  assert.equal(custom?.max, 5);
  assert.ok(!result.questions.some((q) => q.id === "custom-orfano"));
});

test("overrides malformati non rompono il template", async () => {
  const { applyTemplateOverrides, templateOverridesFromScoringConfig } = await import("./template-scope.ts");
  const overrides = templateOverridesFromScoringConfig({ templateOverrides: "garbage" });
  const result = applyTemplateOverrides(AI_READINESS_SYSTEM_TEMPLATE, overrides);
  assert.equal(result.questions.length, AI_READINESS_SYSTEM_TEMPLATE.questions.length);
});

test("v4: ogni domanda scala ha i 5 livelli spiegati e l'opzione Non so", () => {
  const scaleQuestions = AI_READINESS_SYSTEM_TEMPLATE.questions.filter(
    (q) => q.answerType === "scale"
  );
  assert.ok(scaleQuestions.length >= 20);
  for (const q of scaleQuestions) {
    assert.equal(q.levels?.length, 5, `livelli mancanti su ${q.id}`);
    assert.ok(q.levels!.every((l, i) => l.value === i + 1 && l.label.length > 3));
    assert.equal(q.allowUnsure, true, `manca Non so su ${q.id}`);
  }
});

test("v4: binari — la survey organizzazione e la scheda referenti sono separate", async () => {
  const { filterTemplateForTrack } = await import("./template-scope.ts");
  const everyone = filterTemplateForTrack(AI_READINESS_SYSTEM_TEMPLATE, "everyone");
  const internal = filterTemplateForTrack(AI_READINESS_SYSTEM_TEMPLATE, "internal");
  assert.ok(everyone.sections.every((s) => s.audience !== "internal"));
  assert.ok(internal.sections.every((s) => s.audience === "internal"));
  const everyoneIds = new Set(everyone.questions.map((q) => q.id));
  assert.ok(internal.questions.every((q) => !everyoneIds.has(q.id)));
  // survey org: strumenti, adoption e use case; scheda referenti: infra, dati, persone
  assert.ok(everyone.questions.some((q) => q.id === "tech-approved-tools"));
  assert.ok(everyone.questions.some((q) => q.id === "ad-current-usecase"));
  assert.ok(internal.questions.some((q) => q.id === "infra-cloud"));
  assert.ok(internal.questions.some((q) => q.id === "ctx-knowledge-system"));
  assert.ok(internal.questions.some((q) => q.id === "wf-roles-clarity"));
});

test("v4: 'Non so' (0,5) entra nello score senza essere clampato", () => {
  const question = AI_READINESS_SYSTEM_TEMPLATE.questions.find(
    (q) => q.answerType === "scale"
  )!;
  const scores = scoreResponse({
    template: AI_READINESS_SYSTEM_TEMPLATE,
    answers: [
      {
        questionId: question.id,
        value: 0.5,
        answerType: "scale",
        pillarId: question.pillarId,
        sectionId: question.sectionId,
        answeredAt: "2026-07-08T00:00:00.000Z",
      },
    ],
  });
  assert.equal(scores.pillarScores[question.pillarId], 0.5);
});

test("v4: livelli sovrascrivibili per assessment e custom con livelli generici", async () => {
  const { applyTemplateOverrides, templateOverridesFromScoringConfig } = await import("./template-scope.ts");
  const target = AI_READINESS_SYSTEM_TEMPLATE.questions.find((q) => q.answerType === "scale")!;
  const overrides = templateOverridesFromScoringConfig({
    templateOverrides: {
      edited: {
        [target.id]: {
          label: "Domanda riscritta dal cliente per il suo contesto",
          levels: [1, 2, 3, 4, 5].map((v) => ({ value: v, label: `Livello cliente ${v}` })),
        },
      },
      added: [
        { id: "custom-lv", sectionId: "adoption-usage", label: "Domanda custom senza livelli?", answerType: "scale" },
      ],
    },
  });
  const result = applyTemplateOverrides(AI_READINESS_SYSTEM_TEMPLATE, overrides);
  const edited = result.questions.find((q) => q.id === target.id);
  assert.equal(edited?.levels?.[2]?.label, "Livello cliente 3");
  const custom = result.questions.find((q) => q.id === "custom-lv");
  assert.equal(custom?.levels?.length, 5);
  assert.equal(custom?.allowUnsure, true);
});

test("v4: adoption resta la sezione piu ricca con use case attuali e desiderati, zero gergo", () => {
  const adoption = AI_READINESS_SYSTEM_TEMPLATE.questions.filter(
    (q) => q.pillarId === "adoption"
  );
  assert.ok(adoption.length >= 14, `adoption ha solo ${adoption.length} domande`);
  assert.ok(adoption.some((q) => q.id === "ad-current-usecase"));
  assert.ok(adoption.some((q) => q.id === "ad-future-usecase"));
  const all = AI_READINESS_SYSTEM_TEMPLATE.questions
    .map((q) => `${q.label} ${q.description ?? ""} ${(q.levels ?? []).map((l) => l.label).join(" ")}`)
    .join(" ");
  for (const jargon of ["SSO", "MFA", "LLM", "ROI", "baseline", "stack", "legacy"]) {
    assert.ok(!all.includes(jargon), `trovato gergo: ${jargon}`);
  }
});
