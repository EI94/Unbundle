/**
 * `use-case-admin dossier-links` (docs/use-case/DESIGN.md §10.9, casi-duso P0-16 b): una
 * scheda madre per ogni dossier completo senza scheda, dopo la 0020 (la scheda usa `origin`).
 *
 * Per ogni `uc_cases` completo con `portfolio_use_case_id` nullo, in una sola transazione:
 * - crea uno `use_cases` con il titolo del dossier, `description` = `one_liner`,
 *   `portfolio_kind = use_case_ai`, `status = accepted`, `origin = transformation`,
 *   `source = manual`, `intake.hiddenFromSearch = true` e nessun proponente;
 * - imposta `uc_cases.portfolio_use_case_id`;
 * - assegna il codice (`ASSIGN_USE_CASE_CODE_SQL`; senza riga di config la scheda resta senza
 *   codice e lo recupera `codes` dopo `configs`).
 * Il dossier tiene il suo codice: cambiarlo romperebbe export ed email.
 *
 * Va fatto prima di togliere la voce «Casi d'uso» per il workspace (§12.2), compreso il caso
 * seedato in locale. Senza tabelle uc non c'è niente da fare.
 *
 * Modulo puro: niente import di runtime.
 */

/** I valori della scheda madre (§10.9). */
export const MOTHER_CARD = Object.freeze({
  portfolioKind: "use_case_ai",
  status: "accepted",
  origin: "transformation",
  source: "manual",
  intake: Object.freeze({ hiddenFromSearch: true }),
});

export interface OrphanDossier {
  caseId: string;
  workspaceId: string;
  /** Codice del dossier: resta suo. */
  code: string;
  title: string;
  oneLiner: string | null;
}

export interface PlannedMotherCard {
  caseId: string;
  workspaceId: string;
  caseCode: string;
  /** Id della scheda madre, deciso prima: lo usano i due statement della transazione. */
  useCaseId: string;
  title: string;
  description: string | null;
}

/** I dossier completi senza scheda. Parametro facoltativo `$1`: il workspace. */
export function orphanDossiersSql(withWorkspace: boolean): string {
  return `SELECT c.id AS case_id, c.workspace_id, c.code, c.title, c.one_liner
  FROM uc_cases c
 WHERE c.setup_completed_at IS NOT NULL AND c.portfolio_use_case_id IS NULL${withWorkspace ? " AND c.workspace_id = $1::uuid" : ""}
 ORDER BY c.workspace_id, c.created_at, c.id`;
}

export function orphanFrom(row: Record<string, unknown>): OrphanDossier {
  return {
    caseId: String(row.case_id),
    workspaceId: String(row.workspace_id),
    code: String(row.code),
    title: typeof row.title === "string" ? row.title : "",
    oneLiner: typeof row.one_liner === "string" && row.one_liner.trim() ? row.one_liner : null,
  };
}

/** Il piano: una scheda madre per ogni dossier orfano, con l'id già deciso. */
export function planDossierLinks(orphans: readonly OrphanDossier[], newId: () => string): PlannedMotherCard[] {
  return orphans.map((orphan) => ({
    caseId: orphan.caseId,
    workspaceId: orphan.workspaceId,
    caseCode: orphan.code,
    useCaseId: newId(),
    // `uc_cases.title` è obbligatorio; un titolo vuoto prende il codice del dossier.
    title: orphan.title.trim() || orphan.code,
    description: orphan.oneLiner,
  }));
}
