"use server";

/**
 * Server action di Impostazioni › Valutazione (docs/use-case/DESIGN.md §7.2, §10.6, §14.3;
 * PIANO-LAVORI H3d): nome del team, prefisso dei codici, soglie, fasce del costo, «Ipotesi di
 * calcolo» di «Benefici e costi».
 *
 * Ogni action è raggiungibile con una POST diretta: legge la sessione, verifica da sé che
 * l'area sia accesa per il workspace (`isUseCaseHubWorkspace`, §12.1: altrimenti
 * `area_spenta`) e che chi chiama lo gestisca (`getCollaboratorAccess`,
 * `canManageWorkspaceSettings`), e passa a `settings-data.ts`, che rifà gli stessi controlli
 * e valida con le stesse funzioni del modulo (`settings.ts`, `validateCostBands`). Le soglie e
 * le fasce cambiano solo la loro chiave del `config` del modello e non scrivono mai
 * `scoringVersion` (§7.6). Il modello si salva ancora con `updateScoringModelAction`:
 * `saveValuationModelAction` gli passa il `payload` del modulo con «Valore alto da» e
 * «Fattibilità alta da» salvati, riletti a ogni salvataggio (`prepareSettingsModelPayload`).
 */
import { revalidatePath } from "next/cache";
import { updateScoringModelAction, type ActionState } from "@/lib/actions/portfolio";
import { requireSession } from "@/lib/auth/redirect-to-login";
import type { CostBandInfo } from "@/lib/use-cases/cost-bands";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { SERVICE_MESSAGES } from "@/lib/use-cases/service";
import { VALUATION_SETTINGS_TEXT, isUuidText, type ThresholdsValue } from "@/lib/use-cases/settings";
import {
  prepareSettingsModelPayload,
  saveCodePrefix,
  saveCostBands,
  saveReviewTeamName,
  saveThresholds,
  saveValueParams,
  type CodePrefixSaved,
} from "@/lib/use-cases/settings-data";
import type { ServiceResult } from "@/lib/use-cases/types";
import type { ValueParams } from "@/lib/use-cases/value-model";
import type { ValueParamsTexts } from "@/lib/use-cases/value-params-form";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import { canManageWorkspaceSettings } from "@/lib/workspace-permissions";

type Refused = Extract<ServiceResult<never>, { ok: false }>;

const DENIED: Refused = { ok: false, error: "permesso_mancante", message: VALUATION_SETTINGS_TEXT.denied };
const AREA_OFF: Refused = { ok: false, error: "area_spenta", message: SERVICE_MESSAGES.area_spenta };

/** Le pagine che mostrano nome del team, codici, soglie o fasce. */
function revalidateWorkspace(workspaceId: string) {
  for (const page of ["settings", "portfolio", "use-cases"]) revalidatePath(`/dashboard/${workspaceId}/${page}`);
}

function finish<T>(workspaceId: string, result: ServiceResult<T>): ServiceResult<T> {
  if (result.ok) revalidateWorkspace(workspaceId);
  return result;
}

/** «Nome del team che valuta»: vuoto vale il nome predefinito. */
export async function saveReviewTeamNameAction(workspaceId: string, teamName: string): Promise<ServiceResult<{ teamName: string | null }>> {
  const session = await requireSession();
  if (!isUuidText(workspaceId)) return DENIED;
  if (!isUseCaseHubWorkspace(workspaceId)) return AREA_OFF;
  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access || !canManageWorkspaceSettings(access.role)) return DENIED;
  return finish(workspaceId, await saveReviewTeamName(session.user.id, workspaceId, teamName));
}

/** «Codici degli use case › Prefisso»: i codici già assegnati non cambiano. */
export async function saveCodePrefixAction(workspaceId: string, prefix: string): Promise<ServiceResult<CodePrefixSaved>> {
  const session = await requireSession();
  if (!isUuidText(workspaceId)) return DENIED;
  if (!isUseCaseHubWorkspace(workspaceId)) return AREA_OFF;
  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access || !canManageWorkspaceSettings(access.role)) return DENIED;
  return finish(workspaceId, await saveCodePrefix(session.user.id, workspaceId, prefix));
}

/** «Valore alto da» e «Costo basso fino alla fascia» (D18). */
export async function saveThresholdsAction(
  workspaceId: string,
  thresholds: { highImpact: string; costLowBand: string },
): Promise<ServiceResult<ThresholdsValue>> {
  const session = await requireSession();
  if (!isUuidText(workspaceId)) return DENIED;
  if (!isUseCaseHubWorkspace(workspaceId)) return AREA_OFF;
  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access || !canManageWorkspaceSettings(access.role)) return DENIED;
  return finish(workspaceId, await saveThresholds(session.user.id, workspaceId, thresholds));
}

/** «Fasce del costo»: 4 confini, 5 etichette, valore della quinta nei totali. */
export async function saveCostBandsAction(
  workspaceId: string,
  bands: { limits: string[]; labels: string[]; topReferenceEur: string },
): Promise<ServiceResult<{ costBands: readonly CostBandInfo[]; custom: boolean }>> {
  const session = await requireSession();
  if (!isUuidText(workspaceId)) return DENIED;
  if (!isUseCaseHubWorkspace(workspaceId)) return AREA_OFF;
  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access || !canManageWorkspaceSettings(access.role)) return DENIED;
  return finish(workspaceId, await saveCostBands(session.user.id, workspaceId, bands));
}

/** «Ipotesi di calcolo»: costo orario e di una giornata, soglie in euro del Valore, mesi della curva. */
export async function saveValueParamsAction(
  workspaceId: string,
  texts: ValueParamsTexts,
): Promise<ServiceResult<{ valueParams: ValueParams; storedOriginMonth: string | null }>> {
  const session = await requireSession();
  if (!isUuidText(workspaceId)) return DENIED;
  if (!isUseCaseHubWorkspace(workspaceId)) return AREA_OFF;
  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access || !canManageWorkspaceSettings(access.role)) return DENIED;
  return finish(workspaceId, await saveValueParams(session.user.id, workspaceId, texts));
}

/** Un rifiuto del servizio come lo mostra il modulo del modello. */
function refusedState(result: Refused): ActionState {
  return { ok: false, message: result.message, fieldErrors: result.fieldErrors ?? {} };
}

/** L'errore di `updateScoringModelAction` per la dimensione d'impatto senza KPI, che qui si chiama «Valore». */
const IMPACT_KPI_REQUIRED = "Serve almeno un KPI per Impatto.";

/**
 * L'esito di `updateScoringModelAction` con le parole di questa sezione (§14.1): salvato è
 * «Modello salvato.», e la dimensione d'impatto senza KPI dice «Valore». Gli altri errori
 * restano quelli dell'action.
 */
function settingsModelState(result: ActionState): ActionState {
  if (result.ok) return { ok: true, message: VALUATION_SETTINGS_TEXT.model.saved, fieldErrors: {} };
  const fieldErrors = { ...(result.fieldErrors ?? {}) };
  if (fieldErrors["dimensions.impact"] === IMPACT_KPI_REQUIRED) fieldErrors["dimensions.impact"] = VALUATION_SETTINGS_TEXT.model.valueKpiRequired;
  return { ...result, fieldErrors };
}

/**
 * «Modello di valutazione» di questa sezione: KPI, pesi e «Valore medio da». «Valore alto da» e
 * «Fattibilità alta da» non sono campi del modulo: partono quelli salvati, riletti ora, così una
 * pagina vecchia (un'altra scheda del browser, un altro manager) non riporta indietro le
 * «Soglie» salvate prima. Poi salva e ricalcola `updateScoringModelAction`, come il pannello di
 * oggi. Le «Soglie» salvate proprio mentre questa action gira restano scoperte
 * (`prepareSettingsModelPayload`).
 */
export async function saveValuationModelAction(workspaceId: string, previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!isUuidText(workspaceId)) return refusedState(DENIED);
  if (!isUseCaseHubWorkspace(workspaceId)) return refusedState(AREA_OFF);
  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access || !canManageWorkspaceSettings(access.role)) return refusedState(DENIED);
  const prepared = await prepareSettingsModelPayload(session.user.id, workspaceId, formData.get("payload"));
  if (!prepared.ok) return refusedState(prepared);
  const form = new FormData();
  form.set("payload", prepared.value.payload);
  const result = await updateScoringModelAction(workspaceId, previous, form);
  if (result.ok) revalidateWorkspace(workspaceId);
  return settingsModelState(result);
}
