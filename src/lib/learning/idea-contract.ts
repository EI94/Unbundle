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
export const emptyIdeaFields: IdeaFields = {
  title: "", problem: "", frequency: "", inputs: "", desiredOutput: "", contact: "", constraints: "",
};

export function validateIdeaSubmission(value: unknown): IdeaFields {
  const fields = ideaFieldsSchema.parse(value);
  for (const key of ["title", "problem", "desiredOutput"] as const) {
    if (fields[key].trim().length < 5) throw new Error(`Completa il campo ${key}.`);
  }
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
