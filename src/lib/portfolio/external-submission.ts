import { createHash } from "node:crypto";
import { z } from "zod";
import type { NewUseCase, UseCase, Workspace } from "@/lib/db/schema";
import type { ScoringModelConfig } from "@/lib/db/queries/scoring-model";
import {
  CONNECTOR_CONTRACT_VERSION,
  CONTRACT_CODE_PATTERN,
  CONTRACT_LIMITS,
  DEVELOPMENT_STATUSES,
  FREQUENCIES,
  IMPACT_FLAG_VALUES,
  QUALITY_GAINS,
  RELATION_TYPES,
} from "../connector/contract.ts";
import { reviewTeamName } from "../review-team.ts";

export const EXTERNAL_PORTFOLIO_SOURCE = "claude_mcp";
/** Fonte delle segnalazioni del connettore MCP organizzativo (contratto v2). */
export const CONNECTOR_PORTFOLIO_SOURCE = "claude_connector";

/**
 * Valori degli enum propri di un cliente (area, società, strumenti, agente): qui solo
 * la forma. Il connettore li controlla prima con l'enum del suo profilo
 * (`src/lib/connector/contract.ts`).
 */
const intakeValue = z.string().trim().regex(/^[a-z0-9_]{1,40}$/, "Valore non valido.");
const L = CONTRACT_LIMITS;
const estimateReasoning = z.string().trim().min(L.reasoning.min).max(L.reasoning.max);
const scoredEstimate = z
  .object({ score: z.number().int().min(L.score.min).max(L.score.max), reasoning: estimateReasoning })
  .strict();

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
    // Campi del contratto v2 del connettore: facoltativi, così REST, server stdio e
    // Slack continuano a funzionare senza. Finiscono in `use_cases.intake`.
    guideVersion: z.string().trim().min(L.guideVersion.min).max(L.guideVersion.max).optional(),
    area: intakeValue.optional(),
    company: intakeValue.optional(),
    tools: z.array(intakeValue).min(L.tools.min).max(L.tools.max).optional(),
    toolsOther: z.string().trim().max(L.toolsOther.max).optional(),
    frequency: z.enum(FREQUENCIES).optional(),
    beneficiaries: z.number().int().min(L.beneficiaries.min).max(100000).optional(),
    timeSavedMinutesPerRun: z
      .number()
      .min(L.timeSavedMinutesPerRun.min)
      .max(L.timeSavedMinutesPerRun.max)
      .optional(),
    valuePerRunEur: z.number().min(L.valuePerRunEur.min).max(L.valuePerRunEur.max).optional(),
    qualityGain: z.enum(QUALITY_GAINS).optional(),
    developmentStatus: z.enum(DEVELOPMENT_STATUSES).optional(),
    proposerEstimate: z
      .object({
        efficiency: scoredEstimate,
        effort: scoredEstimate,
        impactFlag: z.object({ value: z.enum(IMPACT_FLAG_VALUES), reasoning: estimateReasoning }).strict(),
      })
      .strict()
      .optional(),
    flags: z
      .object({ personalData: z.boolean(), safetyRelated: z.boolean(), outsideFoundation: z.boolean() })
      .strict()
      .optional(),
    relatedAgent: intakeValue.optional(),
    relatedCode: z.string().regex(new RegExp(CONTRACT_CODE_PATTERN)).optional(),
    relationType: z.enum(RELATION_TYPES).optional(),
    promptSnippet: z.string().trim().max(L.promptSnippet.max).optional(),
    sourceConversation: z.string().trim().max(L.sourceConversation.max).optional(),
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

/** Campi v2 che si copiano così come sono in `use_cases.intake` (mappatura del contratto). */
const INTAKE_FIELDS = [
  "guideVersion",
  "area",
  "company",
  "tools",
  "toolsOther",
  "frequency",
  "beneficiaries",
  "timeSavedMinutesPerRun",
  "valuePerRunEur",
  "qualityGain",
  "developmentStatus",
  "proposerEstimate",
  "flags",
  "relatedAgent",
  "relatedCode",
  "relationType",
  "promptSnippet",
  "sourceConversation",
] as const;

/** Canale che invia: `connector` è il connettore MCP organizzativo (contratto v2). */
export type ContributionChannel = "rest" | "connector";

/**
 * `use_cases.intake` dai campi v2 presenti; null se non ce n'è nessuno (invii v1).
 * Con relationType «integra» la segnalazione collegata diventa `possibleDuplicateOf`.
 * Dal connettore: `contractVersion` = 2 e l'email dichiarata in `submitterEmail`.
 */
export function buildContributionIntake(
  payload: ExternalContributionPayload,
  channel: ContributionChannel = "rest"
): Record<string, unknown> | null {
  const intake: Record<string, unknown> = {};
  if (channel === "connector") intake.contractVersion = CONNECTOR_CONTRACT_VERSION;
  for (const key of INTAKE_FIELDS) {
    if (payload[key] !== undefined) intake[key] = payload[key];
  }
  if (payload.relationType === "integra" && payload.relatedCode) intake.possibleDuplicateOf = payload.relatedCode;
  if (channel === "connector" && payload.submittedBy.email) intake.submitterEmail = payload.submittedBy.email;
  return Object.keys(intake).length ? intake : null;
}

/**
 * Riga `use_cases` di un invio esterno. Dal connettore (`channel: "connector"`): fonte
 * `claude_connector`, `proposed_by` = nome dichiarato (l'email va in `intake`). Gli
 * altri canali restano come prima. Non scrive mai `impact_*`, `custom_scores` né
 * `overall_*`: li calcolano auto-ranking e revisione.
 */
export function buildUseCaseDataFromExternalContribution(params: {
  payload: ExternalContributionPayload;
  workspaceId: string;
  esgEnabled: boolean;
  channel?: ContributionChannel;
}): NewUseCase {
  const { payload, workspaceId, esgEnabled } = params;
  const channel = params.channel ?? "rest";
  const submitter = payload.submittedBy;
  return {
    workspaceId,
    title: payload.title,
    description: payload.problem,
    businessCase: payload.expectedImpact,
    portfolioKind: payload.contributionKind,
    status: "proposed",
    source: channel === "connector" ? CONNECTOR_PORTFOLIO_SOURCE : EXTERNAL_PORTFOLIO_SOURCE,
    proposedBy:
      channel === "connector"
        ? submitter.name ?? submitter.email ?? submitter.externalUserId ?? "Claude user"
        : externalSubmitterLabel(submitter),
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
    intake: buildContributionIntake(payload, channel),
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
      // Stessa chiave di sempre; senza nome del workspace vale il nome predefinito (§14.2).
      aiTransformationTeamName: reviewTeamName(workspace),
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
