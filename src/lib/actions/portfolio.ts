"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  getWorkspaceById,
  updateWorkspaceAiTransformationTeamName,
  updateWorkspaceWhatsappWebhook,
} from "@/lib/db/queries/workspaces";
import {
  createUseCase,
  getUseCaseById,
  recomputePortfolioMetricsByWorkspace,
  updateUseCaseCustomScores,
  updateUseCasePortfolioReview,
} from "@/lib/db/queries/use-cases";
import {
  DEFAULT_SCORING_MODEL_CONFIG,
  getOrCreateWorkspaceScoringModel,
  upsertWorkspaceScoringModel,
  type ScoringKpi,
  type ScoringModelConfig,
} from "@/lib/db/queries/scoring-model";
import { markSignalRead } from "@/lib/db/queries/signals";
import { dispatchNewPortfolioNotifications } from "@/lib/notifications/portfolio-dispatch";
import {
  autoScorePortfolioUseCase,
  recalibrateWorkspacePortfolioWithAi,
} from "@/lib/portfolio/ai-ranking";

// ──────────────────────────────────────────────────────────────────────
// Tipi risposta usati da useActionState nelle UI client (errori inline).
// ──────────────────────────────────────────────────────────────────────

export type FieldErrors = Record<string, string>;

export type ActionState<Data = unknown> = {
  ok: boolean;
  message?: string | null;
  fieldErrors?: FieldErrors;
  data?: Data;
};

function formString(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function toFiniteNumber(raw: FormDataEntryValue | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s.length === 0) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function clamp05(n: number) {
  return Math.max(0, Math.min(5, n));
}

// ──────────────────────────────────────────────────────────────────────
// Workspace settings (team name, webhook)
// ──────────────────────────────────────────────────────────────────────

export async function updateAiTransformationTeamNameAction(
  workspaceId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const raw = formString(formData, "aiTransformationTeamName");
  await updateWorkspaceAiTransformationTeamName(
    workspaceId,
    raw.length ? raw : null
  );
  revalidatePath(`/dashboard/${workspaceId}/portfolio`);
  return { ok: true, message: "Nome team salvato.", fieldErrors: {} };
}

export async function updateWhatsappWebhookAction(
  workspaceId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const raw = formString(formData, "whatsappWebhookUrl");
  if (raw.length > 0) {
    try {
      const u = new URL(raw);
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        return {
          ok: false,
          message: "Webhook non valido.",
          fieldErrors: {
            whatsappWebhookUrl: "Deve essere un URL http(s) valido.",
          },
        };
      }
    } catch {
      return {
        ok: false,
        message: "Webhook non valido.",
        fieldErrors: {
          whatsappWebhookUrl: "Deve essere un URL http(s) valido.",
        },
      };
    }
  }
  await updateWorkspaceWhatsappWebhook(workspaceId, raw.length ? raw : null);
  revalidatePath(`/dashboard/${workspaceId}/portfolio`);
  return { ok: true, message: "Webhook salvato.", fieldErrors: {} };
}

// ──────────────────────────────────────────────────────────────────────
// Scoring model (KPI custom, soglie, pesi globali)
// ──────────────────────────────────────────────────────────────────────

const kpiSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1, "Il nome del KPI è obbligatorio."),
    description: z.string().optional().nullable(),
    weight: z
      .number({ message: "Il peso deve essere un numero." })
      .min(0, "Il peso non può essere negativo."),
    direction: z.enum(["higher_better", "lower_better"]).optional(),
  })
  .transform((k) => ({
    id: k.id,
    label: k.label,
    description: k.description ?? undefined,
    weight: k.weight,
    direction: (k.direction === "lower_better"
      ? "lower_better"
      : "higher_better") as "higher_better" | "lower_better",
  }));

const scoringFormSchema = z.object({
  thresholds: z.object({
    highImpact: z.number().min(0).max(5),
    highFeasibility: z.number().min(0).max(5),
    midImpact: z.number().min(0).max(5),
  }),
  overall: z.object({
    impact: z.number().min(0),
    feasibility: z.number().min(0),
    esg: z.number().min(0),
  }),
  dimensions: z.object({
    impact: z.array(kpiSchema).min(1, "Serve almeno un KPI per Impatto."),
    feasibility: z
      .array(kpiSchema)
      .min(1, "Serve almeno un KPI per Fattibilità."),
    esg: z.array(kpiSchema), // 0 ok se ESG OFF
  }),
});

/**
 * Parser robusto: il client invia un JSON stringificato nel campo `payload`.
 * (Ci permette KPI list dinamiche senza dover reimplementare un parser ad-hoc.)
 */
function parseScoringPayload(formData: FormData) {
  const raw = formString(formData, "payload");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function updateScoringModelAction(
  workspaceId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) {
    return { ok: false, message: "Workspace non trovato.", fieldErrors: {} };
  }
  const esgEnabled = workspace.esgEnabled === true;

  const payload = parseScoringPayload(formData);
  if (!payload) {
    return {
      ok: false,
      message: "Payload del form non valido.",
      fieldErrors: {},
    };
  }

  const parsed = scoringFormSchema.safeParse(payload);
  if (!parsed.success) {
    const fieldErrors: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".")] = issue.message;
    }
    return {
      ok: false,
      message: "Controlla i campi evidenziati.",
      fieldErrors,
    };
  }

  const fieldErrors: FieldErrors = {};

  const validateDim = (
    dim: "impact" | "feasibility" | "esg",
    kpis: ScoringKpi[]
  ) => {
    const labels = new Set<string>();
    const ids = new Set<string>();
    let sum = 0;
    for (let i = 0; i < kpis.length; i++) {
      const k = kpis[i];
      const label = k.label.trim().toLowerCase();
      if (labels.has(label)) {
        fieldErrors[`dimensions.${dim}.${i}.label`] =
          "Nomi KPI duplicati nella stessa dimensione.";
      }
      labels.add(label);
      if (ids.has(k.id)) {
        fieldErrors[`dimensions.${dim}.${i}.id`] =
          "ID KPI duplicato (ricarica la pagina).";
      }
      ids.add(k.id);
      sum += Math.max(0, k.weight);
    }
    if (kpis.length > 0 && sum <= 0) {
      fieldErrors[`dimensions.${dim}`] =
        "Almeno un KPI deve avere peso > 0.";
    }
  };

  validateDim("impact", parsed.data.dimensions.impact);
  validateDim("feasibility", parsed.data.dimensions.feasibility);
  if (esgEnabled) validateDim("esg", parsed.data.dimensions.esg);

  const overall = parsed.data.overall;
  const overallSum =
    Math.max(0, overall.impact) +
    Math.max(0, overall.feasibility) +
    (esgEnabled ? Math.max(0, overall.esg) : 0);
  if (overallSum <= 0) {
    fieldErrors["overall"] =
      "Almeno uno dei pesi globali deve essere > 0.";
  }

  const th = parsed.data.thresholds;
  if (th.midImpact > th.highImpact) {
    fieldErrors["thresholds.midImpact"] =
      "Mid Impact non può essere maggiore di High Impact.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      message: "Controlla i campi evidenziati.",
      fieldErrors,
    };
  }

  const config: ScoringModelConfig = {
    dimensions: {
      impact: parsed.data.dimensions.impact.map((k) => ({
        id: k.id,
        label: k.label.trim(),
        description: k.description?.trim() || undefined,
        weight: Math.max(0, k.weight),
        direction: k.direction,
      })),
      feasibility: parsed.data.dimensions.feasibility.map((k) => ({
        id: k.id,
        label: k.label.trim(),
        description: k.description?.trim() || undefined,
        weight: Math.max(0, k.weight),
        direction: k.direction,
      })),
      esg: esgEnabled
        ? parsed.data.dimensions.esg.map((k) => ({
            id: k.id,
            label: k.label.trim(),
            description: k.description?.trim() || undefined,
            weight: Math.max(0, k.weight),
            direction: k.direction,
          }))
        : DEFAULT_SCORING_MODEL_CONFIG.dimensions.esg,
    },
    overall: {
      impact: clamp05(Math.max(0, overall.impact) || 0),
      feasibility: clamp05(Math.max(0, overall.feasibility) || 0),
      esg: esgEnabled ? clamp05(Math.max(0, overall.esg) || 0) : 0,
    },
    thresholds: {
      highImpact: clamp05(th.highImpact),
      highFeasibility: clamp05(th.highFeasibility),
      midImpact: clamp05(th.midImpact),
    },
  };

  try {
    await upsertWorkspaceScoringModel({
      workspaceId,
      impactFlagEnabled: false, // deprecated: ora ESG dipende solo da esgEnabled
      config,
      updatedByUserId: session.user.id,
    });
  } catch (err) {
    console.error("[actions/portfolio] upsertWorkspaceScoringModel failed:", err);
    return {
      ok: false,
      message:
        "Salvataggio fallito lato server. Riprova; se persiste, contatta un admin.",
      fieldErrors: {},
    };
  }

  await recomputePortfolioMetricsByWorkspace(workspaceId);

  revalidatePath(`/dashboard/${workspaceId}/portfolio`);
  revalidatePath(`/dashboard/${workspaceId}/use-cases`);
  return {
    ok: true,
    message: "Modello di ranking aggiornato.",
    fieldErrors: {},
  };
}

// ──────────────────────────────────────────────────────────────────────
// Submission contributo (employee) e valutazione (reviewer)
// ──────────────────────────────────────────────────────────────────────

const submitSchema = z.object({
  portfolioKind: z.enum(["best_practice", "use_case_ai"]),
  title: z.string().trim().min(3, "Titolo troppo corto (min 3 caratteri)."),
  problem: z.string().trim().min(3, "Scrivi almeno 3 caratteri."),
  flowDescription: z.string().trim().min(3, "Scrivi almeno 3 caratteri."),
  expectedImpact: z.string().trim().min(3, "Scrivi almeno 3 caratteri."),
  humanInTheLoop: z.string().trim().min(3, "Scrivi almeno 3 caratteri."),
  dataRequirements: z.string().trim().min(3, "Scrivi almeno 3 caratteri."),
  sustainabilityImpact: z.string().optional(),
  guardrails: z.string().optional(),
  urgency: z.string().optional(),
});

export async function createPortfolioSubmissionAction(
  workspaceId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) {
    return { ok: false, message: "Workspace non trovato.", fieldErrors: {} };
  }
  const esgEnabled = workspace.esgEnabled === true;

  const parsed = submitSchema.safeParse({
    portfolioKind: String(formData.get("portfolioKind") ?? ""),
    title: String(formData.get("title") ?? ""),
    problem: String(formData.get("problem") ?? ""),
    flowDescription: String(formData.get("flowDescription") ?? ""),
    expectedImpact: String(formData.get("expectedImpact") ?? ""),
    humanInTheLoop: String(formData.get("humanInTheLoop") ?? ""),
    dataRequirements: String(formData.get("dataRequirements") ?? ""),
    sustainabilityImpact: String(formData.get("sustainabilityImpact") ?? ""),
    guardrails: String(formData.get("guardrails") ?? ""),
    urgency: String(formData.get("urgency") ?? ""),
  });
  if (!parsed.success) {
    const fieldErrors: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".")] = issue.message;
    }
    return {
      ok: false,
      message: "Compila tutti i campi richiesti.",
      fieldErrors,
    };
  }

  const fieldErrors: FieldErrors = {};
  if (
    esgEnabled &&
    (!parsed.data.sustainabilityImpact ||
      parsed.data.sustainabilityImpact.trim().length < 3)
  ) {
    fieldErrors.sustainabilityImpact =
      "Con ESG attivo racconta l'impatto ambientale e sociale del processo.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      message: "Compila tutti i campi richiesti.",
      fieldErrors,
    };
  }

  const kind = parsed.data.portfolioKind;
  const createdUseCase = await createUseCase({
    workspaceId,
    title: parsed.data.title,
    description: parsed.data.problem,
    businessCase: parsed.data.expectedImpact,
    portfolioKind: kind,
    status: "proposed",
    source: "web_proposed",
    proposedBy: session.user.email ?? session.user.id,
    flowDescription: parsed.data.flowDescription,
    humanInTheLoop: parsed.data.humanInTheLoop,
    guardrails: kind === "use_case_ai" ? parsed.data.guardrails ?? null : null,
    dataRequirements: parsed.data.dataRequirements,
    sustainabilityImpact:
      esgEnabled && parsed.data.sustainabilityImpact?.trim().length
        ? parsed.data.sustainabilityImpact.trim()
        : null,
    timeline: kind === "use_case_ai" ? parsed.data.urgency ?? null : null,
    submittedAt: new Date(),
    portfolioReviewStatus: "needs_inputs",
  });

  let useCase = createdUseCase;
  try {
    useCase = await autoScorePortfolioUseCase({
      workspaceId,
      useCaseId: createdUseCase.id,
      reviewedBy: session.user.id,
      noteLabel: "Auto-ranking AI",
    });
  } catch (error) {
    console.error("[actions/portfolio] autoScorePortfolioUseCase failed:", error);
  }

  await dispatchNewPortfolioNotifications({
    useCase,
    workspaceId,
    source: "web",
  });

  revalidatePath(`/dashboard/${workspaceId}/portfolio`);
  redirect(`/dashboard/${workspaceId}/portfolio?thanks=1&created=${useCase.id}`);
}

// ──────────────────────────────────────────────────────────────────────
// Review: scrittura punteggi KPI (custom) + stato review/nota
// ──────────────────────────────────────────────────────────────────────

export async function savePortfolioReviewAction(
  workspaceId: string,
  useCaseId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const workspace = await getWorkspaceById(workspaceId);
  const model = await getOrCreateWorkspaceScoringModel(workspaceId);
  if (!workspace) {
    return { ok: false, message: "Workspace non trovato.", fieldErrors: {} };
  }
  const esgEnabled = workspace.esgEnabled === true;
  const config = model.resolvedConfig;

  const fieldErrors: FieldErrors = {};
  const customScores: {
    impact: Record<string, number>;
    feasibility: Record<string, number>;
    esg: Record<string, number>;
  } = { impact: {}, feasibility: {}, esg: {} };

  const collect = (
    dim: "impact" | "feasibility" | "esg",
    kpis: ScoringKpi[]
  ) => {
    for (const k of kpis) {
      const raw = toFiniteNumber(formData.get(`score__${dim}__${k.id}`));
      if (raw == null) continue;
      if (raw < 1 || raw > 5) {
        fieldErrors[`score__${dim}__${k.id}`] = "Il punteggio deve essere tra 1 e 5.";
        continue;
      }
      customScores[dim][k.id] = raw;
    }
  };
  collect("impact", config.dimensions.impact);
  collect("feasibility", config.dimensions.feasibility);
  if (esgEnabled) collect("esg", config.dimensions.esg);

  const reviewStatus = formString(formData, "portfolioReviewStatus") ||
    "in_review";
  const allowed = new Set(["needs_inputs", "in_review", "scored", "archived"]);
  if (!allowed.has(reviewStatus)) {
    fieldErrors["portfolioReviewStatus"] = "Stato non valido.";
  }

  const reviewNotesRaw = formString(formData, "reviewNotes");
  const reviewNotes = reviewNotesRaw.length ? reviewNotesRaw : null;

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      message: "Controlla i campi evidenziati.",
      fieldErrors,
    };
  }

  try {
    await updateUseCaseCustomScores(useCaseId, workspaceId, customScores);
    await updateUseCasePortfolioReview(useCaseId, workspaceId, {
      portfolioReviewStatus: reviewStatus as never,
      reviewNotes,
      reviewedBy: session.user.id,
      reviewedAt: new Date(),
    });
  } catch (err) {
    console.error("[actions/portfolio] savePortfolioReview failed:", err);
    return {
      ok: false,
      message: "Salvataggio fallito. Riprova.",
      fieldErrors: {},
    };
  }

  revalidatePath(`/dashboard/${workspaceId}/portfolio`);
  revalidatePath(`/dashboard/${workspaceId}/portfolio/review/${useCaseId}`);
  return { ok: true, message: "Valutazione salvata.", fieldErrors: {} };
}

// ──────────────────────────────────────────────────────────────────────
// Suggerimento AI sui KPI configurati
// ──────────────────────────────────────────────────────────────────────

export async function suggestPortfolioScoresWithAiAction(
  workspaceId: string,
  useCaseId: string
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const useCase = await getUseCaseById(useCaseId);
  if (!useCase || useCase.workspaceId !== workspaceId) {
    return { ok: false, message: "Use case non trovato.", fieldErrors: {} };
  }
  try {
    await autoScorePortfolioUseCase({
      workspaceId,
      useCaseId,
      reviewedBy: session.user.id,
      noteLabel: "Suggerimento AI",
    });
  } catch (err) {
    console.error("[actions/portfolio] AI suggest failed:", err);
    return {
      ok: false,
      message: "Suggerimento AI non disponibile. Riprova tra un momento.",
      fieldErrors: {},
    };
  }

  revalidatePath(`/dashboard/${workspaceId}/portfolio`);
  revalidatePath(`/dashboard/${workspaceId}/portfolio/review/${useCaseId}`);
  return {
    ok: true,
    message: "Punteggi suggeriti dall'AI applicati (puoi modificarli prima di salvare).",
    fieldErrors: {},
  };
}

export async function recalibratePortfolioScoresAction(
  workspaceId: string
): Promise<ActionState<{ updated: number }>> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  try {
    const updated = await recalibrateWorkspacePortfolioWithAi({
      workspaceId,
      reviewedBy: session.user.id,
      noteLabel: "Ricalibrazione AI",
    });
    revalidatePath(`/dashboard/${workspaceId}/portfolio`);
    return {
      ok: true,
      message: `Ricalibrati ${updated.length} contributi con il modello corrente.`,
      fieldErrors: {},
      data: { updated: updated.length },
    };
  } catch (error) {
    console.error("[actions/portfolio] recalibratePortfolioScoresAction failed:", error);
    return {
      ok: false,
      message: "Ricalibrazione non riuscita. Riprova tra poco.",
      fieldErrors: {},
    };
  }
}

// ──────────────────────────────────────────────────────────────────────
// Inbox notifiche (campanella)
// ──────────────────────────────────────────────────────────────────────

export async function markSignalReadAction(
  workspaceId: string,
  signalId: string
) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  await markSignalRead(signalId);
  revalidatePath(`/dashboard/${workspaceId}`);
  return { ok: true } as const;
}
