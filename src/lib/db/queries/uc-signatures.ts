/**
 * Firme in attesa di chi guarda, da account (DESIGN §2.2 «Da firmare (n)»,
 * §2.7 regola 4, §3.11): via allo sviluppo, «non si applica», partenze senza
 * risposta, soluzioni provvisorie, scheda privacy e accessi ai dati personali.
 *
 * Stesse righe e stesso costruttore della pagina `/firme` (`uc-approvals.ts`,
 * `views/approvals.ts`), lette per i ruoli di chi guarda invece che per il
 * contatto designato:
 * - responsabile Lateral Space (`ls_lead`): ciò che manca della firma di
 *   Lateral Space (via, «non si applica», deroghe, ripieghi, scheda privacy);
 * - responsabile del cliente (`owner_cliente`): ciò che manca della firma del
 *   cliente, salvo la privacy;
 * - approvatore privacy: scheda privacy e accessi alla zona personale.
 *
 * Così il numero di «Da firmare (n)» e del pulsante «Firma 3 decisioni» è
 * quello dell'elenco di `/firme`. Qui solo l'elenco breve (tipo, titolo, lato);
 * testi e impronte li legge `/firme`. Modulo senza import dell'app, come
 * `uc-cases.ts`: lo usano anche i test di integrazione.
 */
import { pendingA8Sql, pendingGateSql, pendingWaiversAndFallbacksSql, pendingZoneGrantsSql } from "../../uc/sql/public.ts";
import type { Row } from "../../uc/sql/readiness.ts";
import { cast, toStatement, ucSql, type UcStatement } from "../../uc/sql/statement.ts";
import type { ApprovalKind } from "../../uc/public-view.ts";
import { buildCaseApprovals, type ApprovalStep, type PendingApprovalRows, type SignerSide } from "../../uc/views/approvals.ts";
import type { PendingSignature } from "../../uc/views/next-step.ts";
import type { CaseRole } from "../../uc/vocab.ts";
import type { UcExecutor } from "../uc-executor.ts";
import { UUID } from "../../uc/ids.ts";

export type CaseSignatureKind = "via" | "scheda_privacy" | "non_si_applica" | "partire_senza_risposta" | "soluzione_provvisoria" | "zona_personale";

export interface CaseSignature {
  kind: CaseSignatureKind;
  /** Proposta del via, domanda, blocco o persona a cui si riferisce la firma. */
  targetId: string;
  /** La domanda, per le firme su una domanda. */
  itemId: string | null;
  /** Titolo da mostrare: mai chiavi né articoli. */
  title: string;
  /** Il lato che firma chi guarda. */
  side: SignerSide;
  /** L'altro lato ha già firmato. */
  otherSideSigned: boolean;
}

/**
 * Proposte «non applicabile» aperte, come `pendingNaSql` di `sql/public.ts`,
 * più `client_link_signed`: la firma dal link conta solo se viene dal
 * responsabile del cliente designato adesso (come `naSignatures` dei comandi).
 */
function pendingNaForAccountsSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT i.id, i.key, i.title, i.na_reason, i.na_proposed_at, i.na_proposed_by_contact_id IS NOT NULL AS by_referent,
  i.na_approved_by_user_id IS NOT NULL AS ls_signed, i.na_client_approved_by_user_id IS NOT NULL AS client_user_signed,
  i.na_approved_by_contact_id AS client_contact_id,
  coalesce(i.na_approved_by_contact_id::text = (c.signers_designation #>> '{owner,contact_id}'), false) AS client_link_signed
FROM uc_items i JOIN uc_cases c ON c.id = i.case_id
WHERE i.case_id = ${cast(caseId, "uuid")} AND i.deleted_at IS NULL AND i.na_proposed_at IS NOT NULL
  AND i.na_approved_at IS NULL AND i.na_reason IS NOT NULL
ORDER BY i.sort_order, i.key`);
}

/** Le righe delle firme in attesa di un caso, nell'ordine di `parsePendingSignatures` e di `pendingRowsOf`. */
export function pendingSignatureStatements(caseId: string): UcStatement[] {
  return [pendingGateSql(caseId), pendingNaForAccountsSql(caseId), pendingWaiversAndFallbacksSql(caseId), pendingA8Sql(caseId), pendingZoneGrantsSql(caseId)];
}

/** Quante istruzioni usa `pendingSignatureStatements` (per leggere le righe di un batch). */
export const PENDING_SIGNATURE_STATEMENTS = 5;

/** Le righe di `pendingSignatureStatements` nella forma del costruttore delle firme. */
export function pendingRowsOf(rows: readonly (readonly Row[])[]): PendingApprovalRows {
  const [gates = [], na = [], waiversAndFallbacks = [], a8 = [], zone = []] = rows;
  return { gates, na, waiversAndFallbacks, a8, zone };
}

const KIND: Readonly<Record<ApprovalKind, CaseSignatureKind>> = {
  gate: "via",
  na: "non_si_applica",
  deroga: "partire_senza_risposta",
  ripiego: "soluzione_provvisoria",
  a8: "scheda_privacy",
  zona_personale: "zona_personale",
};

const quoted = (title: string | null) => (title ? `«${title}»` : "una domanda");

function shortTitle(s: ApprovalStep): string {
  switch (s.kind) {
    case "gate":
      return "Via allo sviluppo";
    case "na":
      return `Non si applica: ${quoted(s.subject)}`;
    case "deroga":
      return `Partire senza risposta: ${quoted(s.subject)}`;
    case "ripiego":
      return `Soluzione provvisoria: ${quoted(s.subject)}`;
    case "a8":
      return "Scheda privacy";
    case "zona_personale":
      return `Accesso ai dati personali: ${s.subject ?? "Persona di Lateral Space"}`;
  }
}

/** Una firma della pagina `/firme` nella forma breve della testata e del motore. */
export function toCaseSignature(s: ApprovalStep): CaseSignature {
  return { kind: KIND[s.kind], targetId: s.targetId, itemId: s.itemId, title: shortTitle(s), side: s.side, otherSideSigned: s.otherSideSigned };
}

/**
 * Le firme che aspettano chi guarda, dai suoi ruoli di adesso (già ricalcolati
 * da `requireDossierRole`). `rows` sono le righe di `pendingSignatureStatements`.
 * Stesso elenco, nello stesso ordine, della pagina `/firme`.
 */
export function parsePendingSignatures(rows: readonly (readonly Row[])[], roles: readonly CaseRole[]): CaseSignature[] {
  return buildCaseApprovals({ rows: pendingRowsOf(rows), roles }).map(toCaseSignature);
}

/** Le firme come le legge il motore del prossimo passo (DESIGN §2.7, regola 4). */
export function toPendingSignatures(list: readonly CaseSignature[]): PendingSignature[] {
  return list.map((s) => ({ kind: s.kind === "via" ? "via" : s.kind === "scheda_privacy" ? "scheda_privacy" : "altro", otherSideSigned: s.otherSideSigned }));
}

/**
 * Dove si firmava prima di `/firme` (WP1): via, Privacy o la pagina della
 * domanda. Da WP9 si firma tutto in `/firme`; resta per chi lo importa ancora,
 * finché WP13 non lo toglie.
 */
export function signatureSegment(s: Pick<CaseSignature, "kind" | "itemId">): string {
  if (s.kind === "via") return "via";
  if (s.kind === "scheda_privacy" || s.kind === "zona_personale") return "privacy";
  return s.itemId ? `domande/${s.itemId}` : "";
}

function caseInWorkspaceSql(workspaceId: string, caseId: string): UcStatement {
  return toStatement(ucSql`SELECT 1 AS ok FROM uc_cases c
WHERE c.id = ${cast(caseId, "uuid")} AND c.workspace_id = ${cast(workspaceId, "uuid")} AND c.setup_completed_at IS NOT NULL`);
}

/** Le firme che aspettano chi guarda, in un solo giro. Vuoto per un caso di un altro workspace. */
export async function loadPendingSignatures(executor: UcExecutor, i: { workspaceId: string; caseId: string; roles: readonly CaseRole[] }): Promise<CaseSignature[]> {
  if (!UUID.test(i.workspaceId) || !UUID.test(i.caseId)) return [];
  const [found, ...rows] = await executor.batch([caseInWorkspaceSql(i.workspaceId, i.caseId), ...pendingSignatureStatements(i.caseId)]);
  if (found.length === 0) return [];
  return parsePendingSignatures(rows, i.roles);
}
