import { z } from "zod";

const score1to5 = z.number().min(1).max(5);

/** Body per `PATCH .../scores`: almeno un campo obbligatorio. */
export const patchUseCaseScoresBodySchema = z
  .object({
    impactEconomic: score1to5.optional(),
    impactTime: score1to5.optional(),
    impactQuality: score1to5.optional(),
    impactCoordination: score1to5.optional(),
    impactSocial: score1to5.optional(),
    feasibilityData: score1to5.optional(),
    feasibilityWorkflow: score1to5.optional(),
    feasibilityRisk: score1to5.optional(),
    feasibilityTech: score1to5.optional(),
    feasibilityTeam: score1to5.optional(),
    esgEnvironmental: score1to5.optional(),
    esgSocial: score1to5.optional(),
    esgGovernance: score1to5.optional(),
  })
  .refine((o) => Object.values(o).some((v) => v !== undefined), {
    message: "Includi almeno un punteggio da aggiornare.",
  });

export type PatchUseCaseScoresBody = z.infer<typeof patchUseCaseScoresBodySchema>;
