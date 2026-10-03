import { z } from "zod";

export const ideaFieldsSchema = z.object({
  title: z.string().max(200),
  problem: z.string().max(3000),
  frequency: z.string().max(300),
  inputs: z.string().max(2000),
  desiredOutput: z.string().max(2000),
  contact: z.string().max(300),
  constraints: z.string().max(2000),
}).strict();

export type IdeaFields = z.infer<typeof ideaFieldsSchema>;
const ideaScope = { workspaceId: z.uuid(), programId: z.uuid(), expectedUserId: z.uuid() };
export const ideaSaveRequestSchema = z.object({
  ...ideaScope, draftId: z.uuid().nullable(), expectedRevision: z.number().int().positive().nullable(), fields: ideaFieldsSchema,
}).strict().refine(value => (value.draftId === null) === (value.expectedRevision === null), {
  path: ["draftId"], message: "Identifica la stessa bozza e revisione oppure una nuova bozza.",
});
export const ideaSubmitRequestSchema = z.object({
  ...ideaScope, draftId: z.uuid(), expectedRevision: z.number().int().positive(), idempotencyKey: z.uuid(),
}).strict();
export type IdeaSaveRequest = z.infer<typeof ideaSaveRequestSchema>;
export type IdeaSubmitRequest = z.infer<typeof ideaSubmitRequestSchema>;
export const emptyIdeaFields: IdeaFields = {
  title: "", problem: "", frequency: "", inputs: "", desiredOutput: "", contact: "", constraints: "",
};

export const requiredIdeaFields = ["title", "problem", "desiredOutput"] as const;
export const ideaSubmissionSchema = ideaFieldsSchema.superRefine((fields, context) => {
  for (const key of requiredIdeaFields) {
    if (fields[key].trim().length < 5) context.addIssue({ code: "custom", path: [key], message: "Inserisci almeno 5 caratteri, esclusi gli spazi iniziali e finali, per inviare la proposta." });
  }
});

export function ideaValidationErrors(error: z.ZodError): Partial<Record<keyof IdeaFields, string>> {
  const errors: Partial<Record<keyof IdeaFields, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0] === "fields" ? issue.path[1] : issue.path[0];
    if (typeof field === "string" && Object.hasOwn(ideaFieldsSchema.shape, field)) errors[field as keyof IdeaFields] ??= issue.message;
  }
  return errors;
}

export function validateIdeaSubmission(value: unknown): IdeaFields {
  const fields = ideaSubmissionSchema.parse(value);
  return Object.fromEntries(Object.entries(fields).map(([key, text]) => [key, text.trim()])) as IdeaFields;
}

/** Whitelist: no attempt responses, scores or private grading data can enter the portfolio. */
export function ideaPortfolioFields(fields: IdeaFields) {
  return {
    title: fields.title,
    description: fields.problem,
    businessCase: [
      `Frequenza: ${fields.frequency}`, `Risultato desiderato: ${fields.desiredOutput}`,
      `Referente indicato: ${fields.contact}`,
    ].join("\n\n"),
    dataRequirements: fields.inputs,
    guardrails: fields.constraints,
  };
}
