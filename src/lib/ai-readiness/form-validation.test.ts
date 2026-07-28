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
