"use server";

/**
 * Server action della pagina «Programma» (rilascio 7, docs/programma/RILASCIO-7-PROGETTO.md).
 *
 * Ogni action è raggiungibile con una POST diretta: legge la sessione, rilegge il ruolo
 * (`getCollaboratorAccess`) e se chi chiama è di Lateral Space (`viewerFromSession`), rivalida i campi con i
 * parser della pagina (`programma/inputs.ts`) e passa a `use-case-program.ts`, che rifà i controlli
 * (area accesa, revisore, chi può scrivere, 0029 presente) prima di scrivere.
 */
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/redirect-to-login";
import {
  PROGRAM_ERRORS,
  activateCatalogKpi,
  addCustomKpi,
  addKeyResultCheckin,
  closeSal,
  linkUseCaseToKeyResult,
  recordKpiValue,
  removeKpi,
  saveCaseDev,
  saveCompanyFacts,
  saveIndexWeights,
  saveLeadershipAsks,
  saveLsCosts,
  setKeyResultBase,
  updateKpiTargets,
  type ProgramActor,
} from "@/lib/db/queries/use-case-program";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { PROGRAM_KPI_DIRECTIONS, PROGRAM_KPI_KINDS, PROGRAM_LIMITS, type ProgramKpiDirection, type ProgramKpiKind } from "@/lib/db/use-case-hub-program-ddl";
import {
  parseAmount,
  parseAsks,
  parseDay,
  parseEmployees,
  parseLsCosts,
  parseMonth,
  parseOptionalValue,
  parseRevenue,
  parseValue,
  parseWeights,
  type LsCostsInput,
} from "@/lib/programma/inputs";
import type { ServiceResult } from "@/lib/use-cases/types";
import { getCollaboratorAccess } from "@/lib/workspace-access";

type Result<T> = ServiceResult<T>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DENIED: Extract<Result<never>, { ok: false }> = { ok: false, error: "permesso_mancante", message: PROGRAM_ERRORS.denied };
const field = (name: string, message: string): Extract<Result<never>, { ok: false }> => ({ ok: false, error: "dati_non_validi", message: PROGRAM_ERRORS.invalid, fieldErrors: { [name]: message } });

async function getCollaboratorAccessActor(workspaceId: string): Promise<ProgramActor | null> {
  const session = await requireSession();
  if (typeof workspaceId !== "string" || !UUID.test(workspaceId)) return null;
  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access) return null;
  const viewer = viewerFromSession({ id: session.user.id, email: session.user.email, emailVerified: session.user.emailVerified === true }, access.role);
  return { workspaceId, userId: session.user.id, role: access.role, isLateralSpace: viewer.isLateralSpace };
}

/** Un campo di testo da una POST diretta: qualsiasi altra cosa vale vuoto (mai un'eccezione). */
const str = (value: unknown): string => (typeof value === "string" ? value : "");

function done<T>(workspaceId: string, result: Result<T>): Result<T> {
  if (result.ok) revalidatePath(`/dashboard/${workspaceId}/programma`);
  return result;
}

/** Dipendenti (obbligatori se dati) e ricavo (facoltativo). Un campo assente non cambia. */
export async function saveCompanyFactsAction(workspaceId: string, texts: { employees?: string; revenue?: string }): Promise<Result<true>> {
  const actor = await getCollaboratorAccessActor(workspaceId);
  if (!actor) return DENIED;
  const facts: { employees?: number | null; revenueEur?: number | null } = {};
  if (texts?.employees !== undefined) {
    const parsed = parseEmployees(str(texts?.employees));
    if (!parsed.ok) return field("employees", parsed.error);
    facts.employees = parsed.value;
  }
  if (texts?.revenue !== undefined) {
    const parsed = parseRevenue(str(texts?.revenue));
    if (!parsed.ok) return field("revenue", parsed.error);
    facts.revenueEur = parsed.value;
  }
  return done(workspaceId, await saveCompanyFacts(actor, facts));
}

/** Canone di supporto, periodo e percentuale dello sviluppo di Lateral Space. */
export async function saveLsCostsAction(workspaceId: string, texts: LsCostsInput): Promise<Result<true>> {
  const actor = await getCollaboratorAccessActor(workspaceId);
  if (!actor) return DENIED;
  const parsed = parseLsCosts({ supportMonthEur: str(texts?.supportMonthEur), supportFrom: str(texts?.supportFrom), supportTo: str(texts?.supportTo), devPct: str(texts?.devPct) });
  if (!parsed.ok) return { ok: false, error: "dati_non_validi", message: PROGRAM_ERRORS.invalid, fieldErrors: parsed.fieldErrors as Record<string, string> };
  return done(workspaceId, await saveLsCosts(actor, parsed.value));
}

/** Lo sviluppo di Lateral Space di uno use case: «percentuale», «importo» (con l'importo) o «nessuno». */
export async function saveCaseDevAction(workspaceId: string, useCaseId: string, mode: "percentuale" | "importo" | "nessuno", amount: string): Promise<Result<true>> {
  const actor = await getCollaboratorAccessActor(workspaceId);
  if (!actor) return DENIED;
  if (mode === "importo") {
    const parsed = parseAmount(str(amount), PROGRAM_LIMITS.caseAmountEurMax);
    if (!parsed.ok || parsed.value === null) return field("amountEur", parsed.ok ? "Scrivi l'importo." : parsed.error);
    return done(workspaceId, await saveCaseDev(actor, str(useCaseId), { mode, amountEur: parsed.value }));
  }
  if (mode !== "percentuale" && mode !== "nessuno") return field("mode", "Scelta non valida.");
  return done(workspaceId, await saveCaseDev(actor, str(useCaseId), { mode: mode === "nessuno" ? null : "percentuale", amountEur: null }));
}

/** I pesi dell'indice AI-native. */
export async function saveIndexWeightsAction(workspaceId: string, texts: Record<"persone" | "use_case" | "valore" | "adozione", string>): Promise<Result<true>> {
  const actor = await getCollaboratorAccessActor(workspaceId);
  if (!actor) return DENIED;
  const parsed = parseWeights({ persone: str(texts?.persone), use_case: str(texts?.use_case), valore: str(texts?.valore), adozione: str(texts?.adozione) });
  if (!parsed.ok) return field("weights", parsed.error);
  return done(workspaceId, await saveIndexWeights(actor, parsed.value));
}

/** Le decisioni per la leadership, tutte insieme. */
export async function saveLeadershipAsksAction(workspaceId: string, asks: Array<{ id: string; text: string }>): Promise<Result<true>> {
  const actor = await getCollaboratorAccessActor(workspaceId);
  if (!actor) return DENIED;
  if (!Array.isArray(asks)) return field("asks", "Decisioni non valide.");
  const parsed = parseAsks(asks.map((a) => ({ id: String(a?.id ?? ""), text: String(a?.text ?? "") })));
  if (!parsed.ok) return field("asks", parsed.error);
  return done(workspaceId, await saveLeadershipAsks(actor, parsed.value));
}

/** «Chiudi il SAL»: la fotografia di oggi. */
export async function closeSalAction(workspaceId: string): Promise<Result<{ on: string }>> {
  const actor = await getCollaboratorAccessActor(workspaceId);
  if (!actor) return DENIED;
  return done(workspaceId, await closeSal(actor));
}

/** Attiva un KPI del catalogo. */
export async function activateKpiAction(workspaceId: string, key: string): Promise<Result<{ id: string }>> {
  const actor = await getCollaboratorAccessActor(workspaceId);
  if (!actor) return DENIED;
  return done(workspaceId, await activateCatalogKpi(actor, str(key)));
}

/** Un KPI personalizzato: a mano, o con una formula. */
export async function addCustomKpiAction(
  workspaceId: string,
  input: { label: string; unit: string; kind: string; direction: string; formula: string },
): Promise<Result<{ id: string }>> {
  const actor = await getCollaboratorAccessActor(workspaceId);
  if (!actor) return DENIED;
  const kind = (PROGRAM_KPI_KINDS as readonly string[]).includes(str(input?.kind)) ? (input.kind as ProgramKpiKind) : null;
  const direction = (PROGRAM_KPI_DIRECTIONS as readonly string[]).includes(str(input?.direction)) ? (input.direction as ProgramKpiDirection) : null;
  if (!kind) return field("kind", "Scegli il tipo.");
  if (!direction) return field("direction", "Scegli il verso.");
  return done(
    workspaceId,
    await addCustomKpi(actor, { label: str(input.label), unit: str(input.unit), kind, direction, formula: str(input.formula).trim() ? str(input.formula) : null }),
  );
}

/** Base, obiettivo e risultato chiave di un KPI. */
export async function updateKpiTargetsAction(workspaceId: string, kpiId: string, texts: { base: string; target: string; keyResultId: string }): Promise<Result<true>> {
  const actor = await getCollaboratorAccessActor(workspaceId);
  if (!actor) return DENIED;
  const base = parseOptionalValue(str(texts?.base));
  const target = parseOptionalValue(str(texts?.target));
  if (!base.ok) return field("base", base.error);
  if (!target.ok) return field("target", target.error);
  return done(workspaceId, await updateKpiTargets(actor, kpiId, { base: base.value, target: target.value, keyResultId: str(texts?.keyResultId) || null }));
}

/** Toglie un KPI. */
export async function removeKpiAction(workspaceId: string, kpiId: string): Promise<Result<true>> {
  const actor = await getCollaboratorAccessActor(workspaceId);
  if (!actor) return DENIED;
  return done(workspaceId, await removeKpi(actor, str(kpiId)));
}

/** Il valore di un KPI a mano per un mese. */
export async function recordKpiValueAction(workspaceId: string, kpiId: string, period: string, value: string): Promise<Result<true>> {
  const actor = await getCollaboratorAccessActor(workspaceId);
  if (!actor) return DENIED;
  const month = parseMonth(str(period));
  if (!month.ok || !month.value) return field("period", month.ok ? "Scegli un mese." : month.error);
  const parsed = parseValue(str(value));
  if (!parsed.ok) return field("value", parsed.error);
  return done(workspaceId, await recordKpiValue(actor, kpiId, month.value, parsed.value));
}

/** La base di un risultato chiave. */
export async function setKeyResultBaseAction(workspaceId: string, goalId: string, value: string, on: string): Promise<Result<true>> {
  const actor = await getCollaboratorAccessActor(workspaceId);
  if (!actor) return DENIED;
  const parsed = parseValue(str(value));
  if (!parsed.ok) return field("value", parsed.error);
  const day = parseDay(str(on));
  if (!day.ok) return field("on", day.error);
  return done(workspaceId, await setKeyResultBase(actor, goalId, parsed.value, day.value));
}

/** Un aggiornamento di un risultato chiave. */
export async function addKeyResultCheckinAction(workspaceId: string, goalId: string, value: string, on: string, note: string): Promise<Result<true>> {
  const actor = await getCollaboratorAccessActor(workspaceId);
  if (!actor) return DENIED;
  const parsed = parseValue(str(value));
  if (!parsed.ok) return field("value", parsed.error);
  const day = parseDay(str(on));
  if (!day.ok) return field("on", day.error);
  const text = typeof note === "string" ? note.trim() : "";
  if (text.length > PROGRAM_LIMITS.checkinNote) return field("note", `Al massimo ${PROGRAM_LIMITS.checkinNote} caratteri.`);
  return done(workspaceId, await addKeyResultCheckin(actor, goalId, parsed.value, day.value, text || null));
}

/** Collega o scollega uno use case a un risultato chiave. */
export async function linkUseCaseToKeyResultAction(workspaceId: string, goalId: string, useCaseId: string, linked: boolean): Promise<Result<true>> {
  const actor = await getCollaboratorAccessActor(workspaceId);
  if (!actor) return DENIED;
  return done(workspaceId, await linkUseCaseToKeyResult(actor, goalId, useCaseId, linked === true));
}
