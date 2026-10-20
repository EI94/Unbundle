/**
 * Chi apre le pagine interne del caso costruite da WP9 (PIANO §3.3, §5.1).
 *
 * Una sola tabella, così pagine, schede del caso e collegamenti tra le pagine
 * dicono la stessa cosa. Le liste seguono la matrice `can` di `permissions.ts`:
 * - catalogo, regole, modello dati e documenti: chi vede il caso
 *   (`vedere_caso`) più lo sviluppatore di Lateral Space, che del catalogo vede
 *   solo le voci verdi o blu;
 * - coda di verifica: chi valida (`validare`);
 * - KPI e mappa: chi vede la sintesi (`vedere_sintesi`) più lo sviluppatore;
 * - ROI: chi vede la sintesi.
 * L'approvatore privacy non è in nessuna lista: vede la pagina Privacy.
 *
 * Modulo puro.
 */
import { CASE_ACTION_ROLES } from "../permissions.ts";
import { CLIENT_CASE_ROLES, LS_CASE_ROLES, type CaseRole, type ItemStatus } from "../vocab.ts";

export type UcViewPage = "voci" | "voce" | "verifica" | "regole" | "modello_dati" | "kpi" | "roi" | "documenti" | "mappa";

const CATALOG: readonly CaseRole[] = [...new Set<CaseRole>([...CASE_ACTION_ROLES.vedere_caso, "ls_sviluppatore"])];
const SYNTHESIS_AND_DEV: readonly CaseRole[] = [...new Set<CaseRole>([...CASE_ACTION_ROLES.vedere_sintesi, "ls_sviluppatore"])];

/** Ruoli di caso ammessi per ogni pagina (gli altri ricevono 404). */
export const UC_PAGE_ROLES: Readonly<Record<UcViewPage, readonly CaseRole[]>> = {
  voci: CATALOG,
  voce: CATALOG,
  verifica: CASE_ACTION_ROLES.validare,
  regole: CATALOG,
  modello_dati: CATALOG,
  documenti: CATALOG,
  kpi: SYNTHESIS_AND_DEV,
  mappa: SYNTHESIS_AND_DEV,
  roi: CASE_ACTION_ROLES.vedere_sintesi,
};

export function canOpenPage(page: UcViewPage, roles: readonly CaseRole[]): boolean {
  return roles.some((r) => UC_PAGE_ROLES[page].includes(r));
}

/** Stati che lo sviluppatore vede nel catalogo: solo verde e blu. */
export const VALIDATED_STATUSES: readonly ItemStatus[] = ["validata", "non_applicabile"];

/**
 * Vede solo le voci verdi o blu? Vale per chi ha soltanto il ruolo di
 * sviluppatore: con un ruolo che vede tutto il caso il limite non serve.
 */
export function seesValidatedOnly(roles: readonly CaseRole[]): boolean {
  return roles.includes("ls_sviluppatore") && !roles.some((r) => CASE_ACTION_ROLES.vedere_caso.includes(r));
}

/** Può aprire il dettaglio di questa voce? */
export function canOpenItem(roles: readonly CaseRole[], status: ItemStatus): boolean {
  if (!canOpenPage("voce", roles)) return false;
  return !seesValidatedOnly(roles) || VALIDATED_STATUSES.includes(status);
}

/**
 * Ruoli del cliente (art. 15.4): niente date né nomi accanto a ciò che ha fatto
 * un referente, niente eventi dei referenti nella cronologia. Chi ha anche un
 * ruolo di Lateral Space non è un ruolo del cliente (i due non convivono).
 */
export function isClientViewer(roles: readonly CaseRole[]): boolean {
  if (roles.some((r) => (LS_CASE_ROLES as readonly string[]).includes(r))) return false;
  return roles.some((r) => (CLIENT_CASE_ROLES as readonly string[]).includes(r) || r === "osservatore");
}

/** Vede i commenti interni di Lateral Space? */
export function seesInternalComments(roles: readonly CaseRole[]): boolean {
  return roles.some((r) => CASE_ACTION_ROLES.vedere_commenti_interni.includes(r));
}

/** Vede i metadati dei file della zona personale (mai il contenuto)? */
export function seesPersonalZoneMetadata(roles: readonly CaseRole[]): boolean {
  return roles.some((r) => (LS_CASE_ROLES as readonly string[]).includes(r) || r === "approvatore_privacy");
}
