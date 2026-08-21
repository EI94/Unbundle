import type { AiReadinessDraftPayload } from "./draft";
import type { AiReadinessTemplateDefinition } from "./types";

export function validateSurveyPayload(params: {
  template: AiReadinessTemplateDefinition;
  payload: AiReadinessDraftPayload;
  anonymousMode: boolean;
}) {
  const errors: Record<string, string> = {};
  if (!params.payload.consents.privacyAccepted) {
    errors.privacyAccepted = "Accetta l'informativa privacy per inviare.";
  }
  if (!params.anonymousMode) {
    if (!params.payload.identity?.firstName) {
      errors.respondentFirstName = "Inserisci il nome.";
    }
    if (!params.payload.identity?.lastName) {
      errors.respondentLastName = "Inserisci il cognome.";
    }
  }
  for (const question of params.template.questions) {
    if (!question.required) continue;
    if (params.payload.answers[question.id] == null) {
      // Solo le domande con allowUnsure mostrano davvero l'opzione «Non so»:
      // promettergliela altrove lascia il rispondente a cercare un pulsante
      // che non esiste.
      errors[`question__${question.id}`] = question.allowUnsure
        ? "Seleziona una risposta oppure «Non so»."
        : "Seleziona una risposta.";
    }
  }
  return errors;
}

export function validateOpenSurveyStartFields(params: {
  named: boolean;
  firstName: string;
  lastName: string;
  organizationUnit: string;
}) {
  const errors: Record<string, string> = {};
  if (params.named) {
    if (!params.firstName.trim()) errors.firstName = "Inserisci il nome.";
    if (!params.lastName.trim()) errors.lastName = "Inserisci il cognome.";
  }
  if (params.organizationUnit.trim().length < 2) {
    errors.organizationUnit = "Indica la tua area o team.";
  }
  return errors;
}
