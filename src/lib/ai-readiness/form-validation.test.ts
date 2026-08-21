import test from "node:test";
import assert from "node:assert/strict";
import { AI_READINESS_SYSTEM_TEMPLATE } from "./default-template.ts";
import { filterTemplateForQuestionScope, filterTemplateForTrack } from "./template-scope.ts";
import {
  validateOpenSurveyStartFields,
  validateSurveyPayload,
} from "./form-validation.ts";

test("survey validation: segnala solo le domande nello scope del link", () => {
  const template = filterTemplateForQuestionScope(
    filterTemplateForTrack(AI_READINESS_SYSTEM_TEMPLATE, "internal"),
    { sectionIds: ["workflow-people"] }
  );
  const errors = validateSurveyPayload({
    template,
    anonymousMode: true,
    payload: {
      answers: {},
      consents: {
        privacyAccepted: false,
        benchmarkConsent: false,
        marketingConsent: false,
      },
      useCase: {},
    },
  });
  assert.equal(errors.privacyAccepted, "Accetta l'informativa privacy per inviare.");
  assert.ok(errors["question__wf-roles-clarity"]);
  assert.ok(!errors["question__infra-cloud"]);
});

test("survey validation: survey nominativa richiede nome e cognome", () => {
  const template = filterTemplateForQuestionScope(
    filterTemplateForTrack(AI_READINESS_SYSTEM_TEMPLATE, "everyone"),
    { sectionIds: ["technology-rules"] }
  );
  const answers = Object.fromEntries(
    template.questions.map((question) => [question.id, "3"])
  );
  const errors = validateSurveyPayload({
    template,
    anonymousMode: false,
    payload: {
      answers,
      consents: {
        privacyAccepted: true,
        benchmarkConsent: false,
        marketingConsent: false,
      },
      useCase: {},
      identity: { firstName: "", lastName: "" },
    },
  });
  assert.deepEqual(errors, {
    respondentFirstName: "Inserisci il nome.",
    respondentLastName: "Inserisci il cognome.",
  });
});

test("open start validation: niente tooltip nativo, errori espliciti", () => {
  assert.deepEqual(
    validateOpenSurveyStartFields({
      named: true,
      firstName: "",
      lastName: "",
      organizationUnit: "",
    }),
    {
      firstName: "Inserisci il nome.",
      lastName: "Inserisci il cognome.",
      organizationUnit: "Indica la tua area o team.",
    }
  );
});

test("l'errore promette «Non so» solo dove l'opzione esiste davvero", () => {
  const base = {
    id: "q",
    pillarId: "adoption" as const,
    sectionId: "s",
    label: "L",
    required: true,
  };
  const template = {
    pillars: [],
    sections: [],
    scoringSchema: AI_READINESS_SYSTEM_TEMPLATE.scoringSchema,
    questions: [
      { ...base, id: "con-nonso", answerType: "scale" as const, allowUnsure: true },
      { ...base, id: "senza-nonso", answerType: "single_choice" as const },
    ],
  };
  const errors = validateSurveyPayload({
    template,
    anonymousMode: true,
    payload: { answers: {}, consents: { privacyAccepted: true, benchmarkConsent: false, marketingConsent: false }, useCase: {} },
  });
  assert.match(errors["question__con-nonso"], /Non so/);
  assert.doesNotMatch(errors["question__senza-nonso"], /Non so/);
});

test("le 4 domande a scelta singola obbligatorie della survey non promettono più un'opzione assente", () => {
  const everyone = filterTemplateForTrack(AI_READINESS_SYSTEM_TEMPLATE, "everyone");
  const senzaNonSo = everyone.questions.filter(
    (q) => q.required && q.answerType === "single_choice" && !q.allowUnsure
  );
  assert.ok(senzaNonSo.length > 0, "atteso almeno un single_choice obbligatorio");
  const errors = validateSurveyPayload({
    template: everyone,
    anonymousMode: true,
    payload: { answers: {}, consents: { privacyAccepted: true, benchmarkConsent: false, marketingConsent: false }, useCase: {} },
  });
  for (const q of senzaNonSo) {
    assert.doesNotMatch(
      errors[`question__${q.id}`] ?? "",
      /Non so/,
      `${q.id} promette «Non so» ma non lo mostra`
    );
  }
});

test("la survey organizzazione chiede già le idee: il blocco use case a 13 campi è ridondante", () => {
  // Stessa condizione usata da RespondentSurveyForm per nascondere il blocco.
  const asksForIdeas = (t: { questions: Array<{ answerType: string; pillarId: string; id: string }> }) =>
    t.questions.some(
      (q) =>
        q.answerType === "text" &&
        (q.pillarId === "use_cases" || q.id === "ad-future-usecase")
    );
  assert.equal(asksForIdeas(filterTemplateForTrack(AI_READINESS_SYSTEM_TEMPLATE, "everyone")), true);
  assert.equal(asksForIdeas(filterTemplateForTrack(AI_READINESS_SYSTEM_TEMPLATE, "internal")), false);
});

test("supportEmail con più indirizzi: mailto valido e resa leggibile", async () => {
  const { parseSupportContacts } = await import("./support-contacts.ts");
  const due = parseSupportContacts("d.berdini@cqop.it, pierpaolo@lateralspace.ai");
  assert.equal(due?.mailto, "mailto:d.berdini@cqop.it,pierpaolo@lateralspace.ai");
  assert.equal(due?.label, "d.berdini@cqop.it o pierpaolo@lateralspace.ai");
  const uno = parseSupportContacts("solo@uno.it");
  assert.equal(uno?.mailto, "mailto:solo@uno.it");
  assert.equal(uno?.label, "solo@uno.it");
  assert.equal(parseSupportContacts(""), null);
  assert.equal(parseSupportContacts(null), null);
  assert.equal(parseSupportContacts("non-una-email"), null);
});
