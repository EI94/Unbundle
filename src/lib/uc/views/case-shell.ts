/**
 * Guscio del dossier (DESIGN §2.2, §2.3, §3.3): chi apre le pagine del guscio,
 * le 5 schede, il menu «⋯», la pagina d'arrivo, il percorso e l'avviso della
 * testata.
 *
 * I permessi non cambiano (`UC_PAGE_ROLES`, `UC_SHELL_PAGE_ROLES`,
 * `CASE_ACTION_ROLES`): cambia solo la navigazione. Una scheda o una voce del
 * menu compare solo se chi guarda può aprire la pagina; mai disabilitata.
 * - Panoramica e Via allo sviluppo: chi vede la sintesi più lo sviluppatore.
 * - Soluzione (la Descrizione): come la Panoramica.
 * - Persone: chi vede tutto il caso (Lateral Space e responsabile del cliente).
 * - Privacy: chi vede i metadati privacy (con l'approvatore privacy).
 * - Attività: il responsabile Lateral Space; il cliente filtrato.
 * - Firme: chi firma (responsabile Lateral Space, del cliente, approvatore privacy).
 * - Impostazioni del caso: solo il responsabile Lateral Space.
 *
 * Modulo puro e senza dipendenze di Node: si usa anche nei componenti client.
 */
import { CASE_ACTION_ROLES } from "../permissions.ts";
import { LS_CASE_ROLES, type CaseRole, type CaseStatus, type SemaforoColor } from "../vocab.ts";
import { CASE_STATUS_TONE as STATUS_TONE } from "./labels.ts";
import { canOpenPage } from "./page-access.ts";

export type UcShellPage = "panoramica" | "via" | "descrizione" | "persone" | "privacy" | "registro" | "firme" | "impostazioni";

const unique = (roles: readonly CaseRole[]): readonly CaseRole[] => [...new Set(roles)];
const SYNTHESIS_AND_DEV = unique([...CASE_ACTION_ROLES.vedere_sintesi, "ls_sviluppatore"]);

/** Ruoli di caso ammessi per le pagine del guscio (gli altri ricevono 404 o vanno alla loro pagina d'arrivo). */
export const UC_SHELL_PAGE_ROLES: Readonly<Record<UcShellPage, readonly CaseRole[]>> = {
  panoramica: SYNTHESIS_AND_DEV,
  via: SYNTHESIS_AND_DEV,
  descrizione: SYNTHESIS_AND_DEV,
  persone: CASE_ACTION_ROLES.vedere_caso,
  privacy: CASE_ACTION_ROLES.vedere_metadati_privacy,
  registro: unique([...CASE_ACTION_ROLES.registro, ...CASE_ACTION_ROLES.registro_filtrato]),
  firme: unique([...CASE_ACTION_ROLES.firma_ls, ...CASE_ACTION_ROLES.firma_cliente, ...CASE_ACTION_ROLES.firmare_a8]),
  impostazioni: CASE_ACTION_ROLES.gestire_membri,
};

export function canOpenShellPage(page: UcShellPage, roles: readonly CaseRole[]): boolean {
  return roles.some((r) => UC_SHELL_PAGE_ROLES[page].includes(r));
}

/** Attività filtrata (art. 15.4): chi ha solo l'attività filtrata, non quella completa. */
export function seesFilteredAudit(roles: readonly CaseRole[]): boolean {
  return !roles.some((r) => CASE_ACTION_ROLES.registro.includes(r));
}

function isLs(roles: readonly CaseRole[]): boolean {
  return roles.some((r) => (LS_CASE_ROLES as readonly CaseRole[]).includes(r));
}

// ── Schede ────────────────────────────────────────────────────────────

export type CaseTabKey = "panoramica" | "domande" | "soluzione" | "valore" | "persone";

export interface CaseTab {
  key: CaseTabKey;
  /** Segmento sotto `/dashboard/<ws>/casi-duso/<caso>`; null = la Panoramica. */
  segment: string | null;
  label: string;
}

type TabDef = CaseTab & { allowed: (roles: readonly CaseRole[]) => boolean };

/** Le 5 schede, nell'ordine di DESIGN §2.2. */
const TABS: readonly TabDef[] = [
  { key: "panoramica", segment: null, label: "Panoramica", allowed: (r) => canOpenShellPage("panoramica", r) },
  { key: "domande", segment: "domande", label: "Domande", allowed: (r) => canOpenPage("voci", r) },
  { key: "soluzione", segment: "soluzione", label: "Soluzione", allowed: (r) => canOpenShellPage("descrizione", r) },
  { key: "valore", segment: "valore", label: "Valore", allowed: (r) => canOpenPage("roi", r) },
  { key: "persone", segment: "persone", label: "Persone", allowed: (r) => canOpenShellPage("persone", r) },
];

/** Schede che chi guarda può aprire, nell'ordine fisso. L'approvatore privacy non ne ha: niente barra. */
export function caseTabsFor(roles: readonly CaseRole[]): CaseTab[] {
  return TABS.filter((t) => t.allowed(roles)).map(({ key, segment, label }) => ({ key, segment, label }));
}

/**
 * Dove porta la radice del dossier: null se chi guarda vede la Panoramica,
 * altrimenti il segmento della sua prima scheda o, senza schede, Privacy
 * (l'approvatore privacy). `undefined` se non può aprire nulla.
 */
export function landingSegment(roles: readonly CaseRole[]): string | null | undefined {
  const first = caseTabsFor(roles)[0];
  if (first) return first.segment;
  if (canOpenShellPage("privacy", roles)) return "privacy";
  if (canOpenShellPage("registro", roles)) return "attivita";
  return undefined;
}

/**
 * Scheda attiva dal primo segmento sotto il dossier: `domande/<id>` resta
 * Domande, `soluzione/mappa` resta Soluzione. Le pagine senza scheda (`via`,
 * `firme`, `privacy`, `attivita`, `impostazioni`) non ne accendono nessuna.
 */
export function activeTabKey(segment: string | null): CaseTabKey | null {
  const t = TABS.find((x) => x.segment === segment);
  return t ? t.key : null;
}

/** I segmenti di Soluzione per ruolo (DESIGN §2.3): Dati solo per Lateral Space. */
export type SolutionSegment = "descrizione" | "mappa" | "regole" | "dati";

export function solutionSegmentsFor(roles: readonly CaseRole[]): { key: SolutionSegment; label: string; segment: string }[] {
  const out: { key: SolutionSegment; label: string; segment: string }[] = [];
  if (canOpenShellPage("descrizione", roles)) out.push({ key: "descrizione", label: "Descrizione", segment: "soluzione" });
  if (canOpenPage("mappa", roles)) out.push({ key: "mappa", label: "Mappa", segment: "soluzione/mappa" });
  if (canOpenPage("regole", roles)) out.push({ key: "regole", label: "Regole", segment: "soluzione/regole" });
  if (canOpenPage("modello_dati", roles) && isLs(roles)) out.push({ key: "dati", label: "Dati", segment: "soluzione/dati" });
  return out;
}

// ── Menu «⋯» ──────────────────────────────────────────────────────────

export type CaseMenuKey = "firme" | "privacy" | "attivita" | "esporta" | "claude" | "impostazioni";

export interface CaseMenuItem {
  key: CaseMenuKey;
  label: string;
  /** Segmento sotto il dossier (con l'ancora); null per «Esporta…», che apre il pannello. */
  segment: string | null;
}

export interface CaseMenuInput {
  /** Firme in attesa per chi guarda. */
  pendingSignatures: number;
  /** Il caso è oltre il via allo sviluppo (anche se in pausa). */
  pastVia: boolean;
  /** C'è qualcosa da scaricare per chi guarda (`exportChoices`). */
  exportable: boolean;
}

/**
 * Le voci del menu «⋯» (DESIGN §2.2, §2.3), solo quelle che servono:
 * «Da firmare (n)» solo con firme in attesa, «Sviluppo con Claude» solo per
 * Lateral Space dopo il via, Privacy non per chi ci arriva già (l'approvatore
 * privacy). Senza voci il menu non c'è. «Impostazioni del caso» è sempre
 * l'ultima.
 */
export function caseMenuFor(roles: readonly CaseRole[], i: CaseMenuInput): CaseMenuItem[] {
  const out: CaseMenuItem[] = [];
  if (i.pendingSignatures > 0 && canOpenShellPage("firme", roles)) out.push({ key: "firme", label: `Da firmare (${i.pendingSignatures})`, segment: "firme" });
  if (canOpenShellPage("privacy", roles) && landingSegment(roles) !== "privacy") out.push({ key: "privacy", label: "Privacy", segment: "privacy" });
  if (canOpenShellPage("registro", roles)) out.push({ key: "attivita", label: "Attività", segment: "attivita" });
  if (i.exportable) out.push({ key: "esporta", label: isLs(roles) ? "Esporta…" : "Scarica in Excel", segment: null });
  if (i.pastVia && isLs(roles)) out.push({ key: "claude", label: "Sviluppo con Claude", segment: "via#sviluppo-con-claude" });
  if (canOpenShellPage("impostazioni", roles)) out.push({ key: "impostazioni", label: "Impostazioni del caso", segment: "impostazioni" });
  return out;
}

// ── Percorso e avvisi della testata ───────────────────────────────────

export interface CaseTrailInput {
  workspaceId: string;
  caseBase: string;
  /** La scheda madre (`use_cases`), con il suo codice se la colonna esiste. */
  parent: { id: string; code: string | null; title: string } | null;
}

export type CaseTrail =
  | { kind: "use_case"; root: { label: string; href: string }; parent: { label: string; href: string; isCode: boolean }; current: { label: string; href: string } }
  | { kind: "lista"; back: { label: string; href: string } };

/**
 * Il percorso sopra il titolo (DESIGN §3.3): «Use case › XX-0012 ›
 * Realizzazione». Senza codice (ramo senza la colonna `code`) al posto del
 * codice c'è il titolo della scheda; senza scheda madre resta «‹ Casi d'uso».
 */
export function caseTrail(i: CaseTrailInput): CaseTrail {
  const ws = `/dashboard/${i.workspaceId}`;
  if (!i.parent) return { kind: "lista", back: { label: "Casi d'uso", href: `${ws}/casi-duso` } };
  const code = i.parent.code?.trim() || null;
  return {
    kind: "use_case",
    root: { label: "Use case", href: `${ws}/use-cases?vista=roadmap` },
    parent: { label: code ?? i.parent.title, href: `${ws}/use-cases/${i.parent.id}?capitolo=realizzazione`, isCode: code !== null },
    current: { label: "Realizzazione", href: i.caseBase },
  };
}

export type CaseHeadAlertKind = "riconferma" | "pausa" | "chiuso" | "configurazione";

export interface CaseHeadAlert {
  kind: CaseHeadAlertKind;
  text: string;
  tone: SemaforoColor;
  /** Link dell'avviso (solo «Vedi cosa manca»): segmento sotto il dossier. */
  action: { label: string; segment: string } | null;
}

/**
 * L'unico avviso della testata (DESIGN §3.3), in quest'ordine: via da
 * riconfermare, pausa, chiusura, configurazione da completare (solo per chi
 * gestisce il workspace; gli altri vedono il badge «Sola lettura»).
 */
export function caseHeadAlert(i: { status: CaseStatus; gateReconfirm: boolean; lsConfigured: boolean; workspaceAdmin: boolean; canOpenVia: boolean }): CaseHeadAlert | null {
  if (i.gateReconfirm && i.status !== "chiuso") {
    return {
      kind: "riconferma",
      text: "Il via allo sviluppo va riconfermato: alcune domande indispensabili non sono più a posto.",
      tone: "rosso",
      action: i.canOpenVia ? { label: "Vedi cosa manca", segment: "via" } : null,
    };
  }
  if (i.status === "sospeso") return { kind: "pausa", text: "Caso in pausa: niente invii né promemoria finché non riprende.", tone: "grigio", action: null };
  if (i.status === "chiuso") return { kind: "chiuso", text: "Caso chiuso: si può solo leggere.", tone: "grigio", action: null };
  if (!i.lsConfigured && i.workspaceAdmin) return { kind: "configurazione", text: "Configurazione da completare: la sezione è in sola lettura.", tone: "giallo", action: null };
  return null;
}

/** Il badge «Sola lettura» accanto allo stato: configurazione da completare, per chi non gestisce il workspace. */
export function showsReadOnlyBadge(i: { lsConfigured: boolean; workspaceAdmin: boolean }): boolean {
  return !i.lsConfigured && !i.workspaceAdmin;
}

/**
 * Pagine del dossier che hanno i loro comandi e il loro pulsante pieno: lì il
 * primario della testata non c'è mai (DESIGN §8.1 c, un solo pulsante pieno).
 * Impostazioni: «Aggiungi» di «Accesso al caso».
 */
export const PAGES_WITHOUT_PRIMARY: readonly string[] = ["impostazioni"];

/**
 * Il pulsante primario si nasconde sulla pagina in cui porta (DESIGN §2.2),
 * anche se il passo apre lì un pannello (`/persone?invia=1` su Persone: la
 * pagina ha già i suoi comandi) o un'ancora (`/impostazioni#stato` su
 * Impostazioni). Resta sulle ancore di Panoramica (`/#blocchi`, in Panoramica)
 * e sui passi che aprono un pannello della testata (`?conferma=`, `?esporta=`).
 * Sulle pagine di `PAGES_WITHOUT_PRIMARY` non c'è mai, qualunque sia il passo.
 */
export function stepHiddenOn(step: { href: string; caseBase: string; panel?: boolean }, pathname: string): boolean {
  const clean = (p: string) => p.split(/[?#]/)[0].replace(/\/+$/, "");
  const root = clean(step.caseBase);
  const here = clean(pathname);
  if (here.startsWith(`${root}/`) && PAGES_WITHOUT_PRIMARY.includes(here.slice(root.length + 1).split("/")[0])) return true;
  if (step.panel) return false;
  const target = clean(step.href);
  if (target === root && step.href.includes("#")) return false;
  return target === here;
}

// ── Stato del caso ────────────────────────────────────────────────────

/** Colore del puntino dello stato del caso: riesportato da `labels.ts`, l'unica fonte (la pausa è grigia). */
export const CASE_STATUS_TONE: Readonly<Record<CaseStatus, SemaforoColor>> = STATUS_TONE;

/** Stati del caso che chiedono il motivo (sospensione e chiusura). */
export function transitionNeedsReason(to: CaseStatus): boolean {
  return to === "sospeso" || to === "chiuso";
}

/** Spiegazione breve di un cambio di stato, per «Stato del caso» e il dialogo di conferma. */
export function transitionHint(from: CaseStatus, to: CaseStatus): string {
  if (to === "chiuso") return "Il caso si chiude per sempre: i link dei referenti e gli accessi di Claude si revocano. Si può solo duplicare.";
  if (to === "sospeso") return "Il caso si ferma: niente invii né promemoria, i link restano in sola lettura.";
  if (from === "sospeso") return "Il caso riprende dallo stato in cui era.";
  if (to === "in_sviluppo") return from === "pronto_sviluppo" ? "Il team parte con lo sviluppo sul catalogo validato." : "Si torna allo sviluppo per correggere.";
  if (to === "in_esercizio") return "Dopo almeno 14 giorni di rodaggio senza anomalie bloccanti.";
  if (to === "misura_roi") return "Si confronta il valore stimato con quello misurato.";
  return "";
}
