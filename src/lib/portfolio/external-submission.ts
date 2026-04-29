import { createHash } from "node:crypto";
import { z } from "zod";
import type { NewUseCase, UseCase, Workspace } from "@/lib/db/schema";
import type { ScoringModelConfig } from "@/lib/db/queries/scoring-model";

export const EXTERNAL_PORTFOLIO_SOURCE = "claude_mcp";

export const externalContributionPayloadSchema = z
  .object({
    idempotencyKey: z
      .string()
      .trim()
      .min(8, "idempotencyKey troppo corto.")
      .max(128, "idempotencyKey troppo lungo."),
    confirmedByUser: z.literal(true, {
      message:
        "Prima di salvare in Unbundle serve conferma esplicita dell'utente.",
    }),
    contributionKind: z.enum(["best_practice", "use_case_ai"]),
    submittedBy: z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        email: z.string().trim().email().max(255).optional(),
        externalUserId: z.string().trim().min(2).max(120).optional(),
      })
      .strict()
      .refine((value) => !!(value.email || value.name || value.externalUserId), {
        message: "submittedBy deve contenere almeno email, name o externalUserId.",
      }),
    title: z.string().trim().min(3).max(500),
    problem: z.string().trim().min(14).max(4000),
    flowDescription: z.string().trim().min(14).max(6000),
    humanInTheLoop: z.string().trim().min(8).max(4000),
    guardrails: z.string().trim().min(8).max(4000).optional(),
    expectedImpact: z.string().trim().min(10).max(4000),
    dataRequirements: z.string().trim().min(8).max(4000),
    sustainabilityImpact: z.string().trim().min(8).max(4000).optional(),
    urgency: z.string().trim().min(2).max(255).optional(),
  })
  .strict();

export type ExternalContributionPayload = z.infer<
  typeof externalContributionPayloadSchema
>;

export type ExternalContributionValidationResult =
  | { ok: true; data: ExternalContributionPayload }
  | {
      ok: false;
      code: "invalid_payload" | "missing_esg" | "missing_guardrails";
      fieldErrors: Record<string, string>;
    };

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stable(item)])
  );
}

export function hashExternalContributionPayload(
  payload: ExternalContributionPayload
) {
  return createHash("sha256")
    .update(JSON.stringify(stable(payload)), "utf8")
    .digest("hex");
}

export function validateExternalContributionPayload(
  input: unknown,
  opts: { esgEnabled: boolean }
): ExternalContributionValidationResult {
  const parsed = externalContributionPayloadSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".") || "payload"] = issue.message;
    }
    return { ok: false, code: "invalid_payload", fieldErrors };
  }

  const data = parsed.data;
  if (data.contributionKind === "use_case_ai" && !data.guardrails?.trim()) {
    return {
      ok: false,
      code: "missing_guardrails",
      fieldErrors: {
        guardrails:
          "Per uno use case AI servono guardrail espliciti: controlli, limiti o escalation umana.",
      },
    };
  }

  if (opts.esgEnabled && !data.sustainabilityImpact?.trim()) {
    return {
      ok: false,
      code: "missing_esg",
      fieldErrors: {
        sustainabilityImpact:
          "In questo workspace ESG è attivo: serve l'impatto ambientale e sociale dichiarato dall'utente.",
      },
    };
  }

  return { ok: true, data };
}

export function externalSubmitterLabel(
  submitter: ExternalContributionPayload["submittedBy"]
) {
  return submitter.email ?? submitter.name ?? submitter.externalUserId ?? "Claude user";
}

export function buildUseCaseDataFromExternalContribution(params: {
  payload: ExternalContributionPayload;
  workspaceId: string;
  esgEnabled: boolean;
}): NewUseCase {
  const { payload, workspaceId, esgEnabled } = params;
  return {
    workspaceId,
    title: payload.title,
    description: payload.problem,
    businessCase: payload.expectedImpact,
    portfolioKind: payload.contributionKind,
    status: "proposed",
    source: EXTERNAL_PORTFOLIO_SOURCE,
    proposedBy: externalSubmitterLabel(payload.submittedBy),
    flowDescription: payload.flowDescription,
    humanInTheLoop: payload.humanInTheLoop,
    guardrails:
      payload.contributionKind === "use_case_ai"
        ? payload.guardrails ?? null
        : payload.guardrails ?? null,
    dataRequirements: payload.dataRequirements,
    sustainabilityImpact: esgEnabled
      ? payload.sustainabilityImpact ?? null
      : null,
    timeline:
      payload.contributionKind === "use_case_ai" ? payload.urgency ?? null : null,
    submittedAt: new Date(),
    portfolioReviewStatus: "needs_inputs",
  };
}

export function buildExternalContributionResponse(params: {
  useCase: UseCase;
  workspaceId: string;
  duplicate: boolean;
}) {
  const { useCase, workspaceId, duplicate } = params;
  return {
    ok: true,
    duplicate,
    useCase: {
      id: useCase.id,
      workspaceId,
      title: useCase.title,
      portfolioKind: useCase.portfolioKind,
      status: useCase.status,
      portfolioReviewStatus: useCase.portfolioReviewStatus,
      overallScore: useCase.overallScore,
      overallImpactScore: useCase.overallImpactScore,
      overallFeasibilityScore: useCase.overallFeasibilityScore,
      overallEsgScore: useCase.overallEsgScore,
      createdAt: useCase.createdAt.toISOString(),
    },
    links: {
      portfolio: `/dashboard/${workspaceId}/portfolio`,
      review: `/dashboard/${workspaceId}/portfolio/review/${useCase.id}`,
    },
  };
}

function fieldSpec(name: string, description: string, required: boolean) {
  return { name, description, required };
}

export function buildWorkspaceIntakeRequirements(params: {
  workspace: Workspace;
  config: ScoringModelConfig;
}) {
  const { workspace, config } = params;
  const esgEnabled = workspace.esgEnabled === true;

  return {
    ok: true,
    workspace: {
      id: workspace.id,
      name: workspace.name,
      esgEnabled,
      aiTransformationTeamName:
        workspace.aiTransformationTeamName?.trim() || "AI Transformation",
    },
    contributionKinds: ["use_case_ai", "best_practice"] as const,
    requiredFields: {
      use_case_ai: [
        fieldSpec("title", "Titolo breve e chiaro.", true),
        fieldSpec("problem", "Situazione attuale o frizione da migliorare.", true),
        fieldSpec("flowDescription", "Flusso as-is -> to-be con AI.", true),
        fieldSpec("humanInTheLoop", "Ruolo umano di revisione, approvazione o controllo.", true),
        fieldSpec("guardrails", "Controlli e limiti per evitare errori o rischi.", true),
        fieldSpec("expectedImpact", "Benefici concreti attesi, senza inventare numeri economici.", true),
        fieldSpec("dataRequirements", "Dati, documenti, accessi o materiali necessari.", true),
        fieldSpec("urgency", "Quick win o progetto strutturato.", false),
        fieldSpec("sustainabilityImpact", "Impatto ambientale e sociale.", esgEnabled),
      ],
      best_practice: [
        fieldSpec("title", "Titolo breve e chiaro.", true),
        fieldSpec("problem", "Com'era il processo prima dell'AI.", true),
        fieldSpec("flowDescription", "Come funziona adesso con l'AI.", true),
        fieldSpec("expectedImpact", "Beneficio osservato.", true),
        fieldSpec("humanInTheLoop", "Chi la usa o ne beneficia.", true),
        fieldSpec("dataRequirements", "Cosa serve per replicarla.", true),
        fieldSpec("sustainabilityImpact", "Impatto ambientale e sociale.", esgEnabled),
      ],
    },
    scoringModel: {
      impact: config.dimensions.impact,
      feasibility: config.dimensions.feasibility,
      esg: esgEnabled ? config.dimensions.esg : [],
      overall: config.overall,
      thresholds: config.thresholds,
      note:
        "I KPI monetari devono restare vuoti se l'utente non fornisce dati verificabili. Non inventare EUR, ricavi, saving o margini.",
    },
    confirmationPolicy:
      "Prima di chiamare il tool di submit, mostra il riepilogo all'utente e chiama il tool solo se l'utente conferma esplicitamente.",
  };
}
