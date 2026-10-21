import { getTableColumns } from "drizzle-orm";
import { createUseCaseOnce, getUseCaseById } from "@/lib/db/queries/use-cases";
import { assignUseCaseCodeSafely } from "@/lib/db/queries/use-case-codes";
import {
  getDraftById,
  markDraftSubmittedIfDrafting,
  updateDraft,
} from "@/lib/db/queries/slack";
import { slackUseCaseDrafts, type NewSlackUseCaseDraft, type SlackUseCaseDraft, type UseCase } from "@/lib/db/schema";
import { SLACK_DRAFT_TEXT_COLUMNS } from "@/lib/use-cases/admin/slack-drafts";
import { dispatchNewPortfolioNotifications, wasPortfolioItemAnnounced } from "@/lib/notifications/portfolio-dispatch";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { autoScorePortfolioUseCase } from "@/lib/portfolio/ai-ranking";
import { isUntouchedUseCase } from "@/lib/portfolio/review-state";
import { followUpAfterSubmit } from "@/lib/portfolio/submit-contribution";
import { logSafeError } from "@/lib/log/safe-error";
import { buildUseCaseDataFromSlackDraft } from "./use-case-payload";

type SlackPortfolioKind = "best_practice" | "use_case_ai";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function getMissingSlackDraftFields(
  draft: SlackUseCaseDraft,
  kind: SlackPortfolioKind,
  opts?: { esgEnabled?: boolean }
): string[] {
  const requiredBp = [
    "title",
    "problem",
    "flowDescription",
    "expectedImpact",
    "humanInTheLoop",
    "dataRequirements",
  ] as const;
  const requiredUc = [
    "title",
    "problem",
    "flowDescription",
    "humanInTheLoop",
    "guardrails",
    "expectedImpact",
    "dataRequirements",
    "urgency",
  ] as const;
  const shared = opts?.esgEnabled ? (["sustainabilityImpact"] as const) : [];

  return kind === "best_practice"
    ? [...requiredBp, ...shared].filter(
        (k) => !isNonEmptyString((draft as Record<string, unknown>)[k])
      )
    : [...requiredUc, ...shared].filter(
        (k) => !isNonEmptyString((draft as Record<string, unknown>)[k])
      );
}

export type SubmitSlackContributionResult =
  /** `code`: il codice della scheda (es. XX-0012), null se il workspace non assegna codici. */
  | { ok: true; useCaseId: string; title: string; code: string | null }
  | { ok: false; error: string };

/**
 * Le colonne di testo della bozza, dall'elenco di `use-case-admin slack-drafts`
 * (`SLACK_DRAFT_TEXT_COLUMNS`, nomi SQL): un elenco solo per l'invio e per il comando.
 * Dopo l'invio riuscito vanno a NULL: la bozza non ha un collegamento alla scheda, e
 * «Oscura testo» non la raggiungerebbe (DESIGN §6.8). Si calcola a ogni invio, dentro la
 * pulizia: un nome che la tabella non ha ferma solo la pulizia (`clear_draft_failed`, poi
 * `use-case-admin slack-drafts`), mai il caricamento del modulo e con lui tutto Slack.
 * `use-case-agent.test.ts` confronta l'elenco con le colonne dello schema.
 */
function clearedDraftTexts(): Partial<NewSlackUseCaseDraft> {
  const keyOf = new Map(Object.entries(getTableColumns(slackUseCaseDrafts)).map(([key, column]) => [column.name, key]));
  const patch: Record<string, null> = {};
  for (const name of SLACK_DRAFT_TEXT_COLUMNS) {
    const key = keyOf.get(name);
    if (!key) throw new Error(`slack_use_case_drafts non ha la colonna ${name}`);
    patch[key] = null;
  }
  return patch as Partial<NewSlackUseCaseDraft>;
}

/**
 * La scheda con l'id della bozza nel workspace atteso, se c'è: dopo un errore della
 * creazione dice se l'INSERT era arrivato (risposta persa dopo il commit). Il codice si
 * assegna se manca, come fa `createUseCaseOnce` (la risposta può essersi persa prima). Se
 * non si riesce a leggerla, null: la bozza torna in `drafting` e il nuovo tentativo la ritrova.
 */
async function findCardOfDraft(draftId: string, workspaceId: string): Promise<UseCase | null> {
  let card: UseCase | null;
  try {
    card = await getUseCaseById(draftId);
  } catch (error) {
    logSafeError("slack/submit-contribution", "read_back_failed", error, { draftId });
    return null;
  }
  if (!card || card.workspaceId !== workspaceId) return null;
  if (card.code) return card;
  const code = await assignUseCaseCodeSafely(workspaceId, card.id);
  return code ? { ...card, code } : card;
}

/**
 * Submit idempotente e vincolato all'utente Slack: crea `use_cases` e notifica.
 * Usato dal tool LLM e dall'endpoint interactivity.
 *
 * L'invio è riuscito quando la scheda esiste: da lì la bozza resta `submitted` e perde i
 * testi, anche se valutazione AI o notifiche non vanno (rimetterla in `drafting` farebbe
 * nascere un doppione al «confermo» successivo). La scheda ha l'id della bozza
 * (`createUseCaseOnce`): se la creazione dà errore ma la scheda c'è (l'INSERT era arrivato,
 * la risposta si è persa), l'invio è riuscito lo stesso. Solo se la scheda non c'è, o non si
 * riesce a saperlo, la bozza torna in `drafting` con i suoi testi; il nuovo tentativo
 * ritrova la scheda, se c'era, e non ne crea una seconda.
 *
 * Valutazione AI e annuncio seguono la regola del servizio di invio condiviso
 * (`followUpAfterSubmit`): una scheda ritrovata si valuta solo se nessuno l'ha ancora
 * valutata e si annuncia solo se in più non è già stata annunciata; la valutazione scrive
 * sempre con `onlyIfUntouched`, così non copre il lavoro di un revisore arrivato prima.
 */
export async function submitSlackContributionDraft(params: {
  draftId: string;
  actingSlackUserId: string;
  expectedWorkspaceId: string;
}): Promise<SubmitSlackContributionResult> {
  const draft = await getDraftById(params.draftId);
  if (!draft) {
    return { ok: false, error: "Draft non trovato" };
  }

  if (draft.slackUserId !== params.actingSlackUserId) {
    return { ok: false, error: "Non autorizzato su questo draft" };
  }

  if (draft.workspaceId !== params.expectedWorkspaceId) {
    return { ok: false, error: "Workspace non valido per questo draft" };
  }

  if (draft.status !== "drafting") {
    return { ok: false, error: "Questo contributo è già stato inviato" };
  }

  const kind = draft.contributionKind as SlackPortfolioKind | null;
  if (!kind) {
    return { ok: false, error: "Tipologia mancante nel draft" };
  }

  const workspace = await getWorkspaceById(params.expectedWorkspaceId);
  const esgEnabled = workspace?.esgEnabled === true;
  const missing = getMissingSlackDraftFields(draft, kind, { esgEnabled });
  if (missing.length > 0) {
    return { ok: false, error: `Campi mancanti: ${missing.join(", ")}` };
  }

  const locked = await markDraftSubmittedIfDrafting(params.draftId);
  if (!locked) {
    return { ok: false, error: "Invio già in corso o completato" };
  }

  let createdUseCase: UseCase;
  /** Falso quando la scheda è stata ritrovata (un tentativo precedente, o una risposta persa). */
  let created: boolean;
  try {
    ({ useCase: createdUseCase, created } = await createUseCaseOnce({
      ...buildUseCaseDataFromSlackDraft({
        draft,
        actingSlackUserId: params.actingSlackUserId,
        expectedWorkspaceId: params.expectedWorkspaceId,
        esgEnabled,
      }),
      id: draft.id,
    }));
  } catch (e) {
    // Solo nome e codice dell'errore: quello del database può riportare i testi (DESIGN §11).
    logSafeError("slack/submit-contribution", "create_failed", e, { draftId: params.draftId });
    const existing = await findCardOfDraft(draft.id, params.expectedWorkspaceId);
    if (existing) {
      // L'INSERT era arrivato: l'invio è riuscito, la bozza resta `submitted`.
      createdUseCase = existing;
      created = false;
    } else {
      try {
        await updateDraft(params.draftId, {
          status: "drafting",
          submittedAt: null,
        });
      } catch (revertErr) {
        logSafeError("slack/submit-contribution", "revert_draft_failed", revertErr, { draftId: params.draftId });
      }
      return {
        ok: false,
        error: "Errore durante la creazione del use case. Contatta un admin.",
      };
    }
  }

  // La scheda ha i testi: la bozza non li tiene più (DESIGN §6.8). Se non riesce, li
  // toglie dopo `use-case-admin slack-drafts`; l'invio resta riuscito.
  try {
    await updateDraft(params.draftId, clearedDraftTexts(), { touchUpdatedAt: false });
  } catch (error) {
    logSafeError("slack/submit-contribution", "clear_draft_failed", error, { draftId: params.draftId });
  }

  // Una scheda ritrovata può essere già nell'inbox: niente seconda valutazione su una scheda
  // già valutata (o archiviata), niente secondo annuncio. Se non si riesce a sapere se è
  // stata annunciata, non si annuncia di nuovo.
  let announced = false;
  if (!created) {
    try {
      announced = await wasPortfolioItemAnnounced({ workspaceId: params.expectedWorkspaceId, useCaseId: createdUseCase.id });
    } catch (error) {
      logSafeError("slack/submit-contribution", "announced_read_failed", error, { useCaseId: createdUseCase.id });
      announced = true;
    }
  }
  const followUp = followUpAfterSubmit({ created, untouched: isUntouchedUseCase(createdUseCase), announced });

  let useCase = createdUseCase;
  if (followUp.rank) {
    try {
      useCase = await autoScorePortfolioUseCase({
        workspaceId: params.expectedWorkspaceId,
        useCaseId: createdUseCase.id,
        noteLabel: "Auto-ranking AI",
        onlyIfUntouched: true,
      });
    } catch (error) {
      logSafeError("slack/submit-contribution", "auto_score_failed", error, { useCaseId: createdUseCase.id });
    }
  }

  if (followUp.notify) {
    try {
      await dispatchNewPortfolioNotifications({
        useCase,
        workspaceId: params.expectedWorkspaceId,
        source: "slack",
        slackTeamId: draft.slackTeamId,
      });
    } catch (error) {
      logSafeError("slack/submit-contribution", "notifications_failed", error, { useCaseId: createdUseCase.id });
    }
  }

  return {
    ok: true,
    useCaseId: createdUseCase.id,
    title: createdUseCase.title,
    code: useCase.code ?? createdUseCase.code ?? null,
  };
}
