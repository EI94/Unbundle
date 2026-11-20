/**
 * Guscio del dossier (DESIGN §2.2, §2.3, §3.3): chi apre le pagine del guscio,
 * le 5 schede, il menu «⋯», la pagina d'arrivo, il percorso e l'avviso della
 * testata. (Rilascio 10, §3.5) La testata ha cinque elementi: percorso, titolo
 * (sempre quello dello use case), stato a puntino, il pulsante pieno con icona
 * e «?», «⋯» con Privacy · Attività · Esporta… · Impostazioni.
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
import type { NextStep, NextStepId } from "./next-step.ts";
import { canOpenPage } from "./page-access.ts";

export type UcShellPage = "panoramica" | "via" | "descrizione" | "persone" | "privacy" | "registro" | "firme" | "impostazioni" | "progetto";

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
  // (Rilascio 8.0a) Il progetto dell'agente: lo legge il team del caso; l'AI Board ci dà l'ok agli strumenti nuovi.
  progetto: ["ls_lead", "ls_analista", "ls_sviluppatore", "owner_cliente", "ai_board", "osservatore"],
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

export type CaseMenuKey = "privacy" | "attivita" | "esporta" | "progetto" | "impostazioni";

export interface CaseMenuItem {
  key: CaseMenuKey;
  label: string;
  /** Segmento sotto il dossier; null per «Esporta…», che apre il pannello. */
  segment: string | null;
}

export interface CaseMenuInput {
  /** C'è qualcosa da scaricare per chi guarda (`exportChoices`). */
  exportable: boolean;
}

/**
 * Le voci del menu «⋯» (rilascio 10, §3.5): Privacy · Attività · Esporta… ·
 * Impostazioni, solo quelle che chi guarda può aprire; Privacy non per chi ci
 * arriva già (l'approvatore privacy). Senza voci il menu non c'è.
 * «Impostazioni» è sempre l'ultima.
 *
 * - «Da firmare (n)» non c'è più: la firma è il pulsante pieno «Firma …» e il
 *   pannello delle firme (F-006).
 * - «Sviluppo con Claude» sta nella sezione «Via allo sviluppo» della
 *   Panoramica, dove era in `/via` (F-010, F-042), finché l'ondata 5b non lo
 *   porta in Costruzione.
 * - «Progetto dell'agente» resta qui finché l'ondata 5b non ne fa la scheda
 *   «Costruzione» (F-011): niente si perde nel frattempo.
 */
export function caseMenuFor(roles: readonly CaseRole[], i: CaseMenuInput): CaseMenuItem[] {
  const out: CaseMenuItem[] = [];
  if (canOpenShellPage("privacy", roles) && landingSegment(roles) !== "privacy") out.push({ key: "privacy", label: "Privacy", segment: "privacy" });
  if (canOpenShellPage("registro", roles)) out.push({ key: "attivita", label: "Attività", segment: "attivita" });
  if (i.exportable) out.push({ key: "esporta", label: isLs(roles) ? "Esporta…" : "Scarica in Excel", segment: null });
  if (canOpenShellPage("progetto", roles)) out.push({ key: "progetto", label: "Progetto dell'agente", segment: "progetto" });
  if (canOpenShellPage("impostazioni", roles)) out.push({ key: "impostazioni", label: "Impostazioni", segment: "impostazioni" });
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
 * codice c'è il titolo della scheda; senza scheda madre «‹ Realizzazioni».
 */
export function caseTrail(i: CaseTrailInput): CaseTrail {
  const ws = `/dashboard/${i.workspaceId}`;
  // (Rilascio 10, §4) Mai «Casi d'uso» a schermo: la lista è «Realizzazioni», come nella barra del telefono.
  if (!i.parent) return { kind: "lista", back: { label: "Realizzazioni", href: `${ws}/casi-duso` } };
  const code = i.parent.code?.trim() || null;
  return {
    kind: "use_case",
    root: { label: "Use case", href: `${ws}/use-cases?vista=panoramica` },
    parent: { label: code ?? i.parent.title, href: `${ws}/use-cases/${i.parent.id}?capitolo=realizzazione`, isCode: code !== null },
    current: { label: "Realizzazione", href: i.caseBase },
  };
}

/**
 * (Rilascio 10, §3.5) Il titolo della realizzazione è sempre quello dello use case (la scheda madre); senza scheda
 * madre, o con il titolo vuoto, quello del dossier. Lo stesso nella testata e nella barra fissa.
 */
export function realizationTitle(i: { caseTitle: string; parent: { title: string } | null }): string {
  return i.parent?.title?.trim() || i.caseTitle;
}

/**
 * (Rilascio 10, §3.5) L'avanzamento piccolo in testata («186/245» con la barra): per chi apre la Panoramica, dove sta
 * il numero grande. Non sulla Panoramica stessa (lo decide la testata), mai all'approvatore privacy, che non la apre.
 */
export function showsHeaderProgress(roles: readonly CaseRole[]): boolean {
  return canOpenShellPage("panoramica", roles);
}

/**
 * (Rilascio 10, §3.5, F-076) Chi ha il passo «Controlla N file»: chi può controllare a mano un PDF (`canReviewFile`:
 * responsabile o analista, persona di Lateral Space), a realizzazione aperta (non chiusa né in pausa) e non in sola
 * lettura, come i comandi sui file. Per gli altri il conteggio non si legge.
 */
export function checksFiles(i: { roles: readonly CaseRole[]; isLateralSpace: boolean; readOnly: boolean; status: CaseStatus }): boolean {
  if (!i.isLateralSpace || i.readOnly || i.status === "chiuso" || i.status === "sospeso") return false;
  return i.roles.includes("ls_lead") || i.roles.includes("ls_analista");
}

/**
 * (Rilascio 10, §3.5) Una pagina della realizzazione che non c'è o non è per chi guarda: un titolo calmo e la via
 * d'uscita, mai «Riprova» (non può riuscire). Lo stesso titolo dentro la realizzazione e fuori.
 */
export const CASE_NOT_FOUND_TEXT = Object.freeze({
  title: "Questa pagina non è disponibile.",
  /** Dentro la realizzazione: testata e schede restano. */
  toOverview: "Torna alla Panoramica",
  /** Fuori: la realizzazione non c'è o chi guarda non ne fa parte. */
  toUseCases: "Torna agli use case",
});

/** (Rilascio 10, §3.5) L'ancora della sezione «Via allo sviluppo» nella Panoramica: ci portano `/via`, `/avanzamento` e i passi del via. */
export const VIA_SECTION_ID = "via";

const VIA_PATH = /^(\/dashboard\/[^/?#]+\/casi-duso\/[^/?#]+)\/via\/?$/;

/**
 * (Rilascio 10, §3.5, F-043) Dove porta la vecchia `/via`: la Panoramica all'ancora `#via`, con la stessa query (i
 * parametri restano tutti). Null se il percorso non è il `/via` di un dossier.
 */
export function viaRedirect(pathname: string, search: string): string | null {
  const m = VIA_PATH.exec(pathname);
  if (!m) return null;
  const query = search.replace(/^\?/, "");
  return `${m[1]}${query ? `?${query}` : ""}#${VIA_SECTION_ID}`;
}

export type CaseHeadAlertKind = "riconferma" | "pausa" | "chiuso" | "configurazione";

export interface CaseHeadAlert {
  kind: CaseHeadAlertKind;
  text: string;
  tone: SemaforoColor;
  /** Link dell'avviso (solo «Vedi cosa manca»): relativo alla radice del dossier, come i passi (`resolveStepHref`). */
  action: { label: string; href: string } | null;
}

/**
 * L'unico avviso della testata (DESIGN §3.3), in quest'ordine: via da
 * riconfermare, pausa, chiusura, configurazione da completare. (Rilascio 10,
 * §3.5) Un segnale per stato: l'avviso non c'è quando il pulsante pieno dice
 * già la stessa cosa (`primary`: «Riconferma il via allo sviluppo»,
 * «Riprendi la realizzazione»). La configurazione che manca (i domini di
 * Lateral Space: tutti in sola lettura) va nel log e, finché l'ondata 6b non la
 * porta in una riga delle Impostazioni del workspace, la legge qui solo chi le
 * gestisce (F-005); niente badge «Sola lettura» per gli altri.
 */
export function caseHeadAlert(i: {
  status: CaseStatus;
  gateReconfirm: boolean;
  canOpenVia: boolean;
  primary?: NextStepId | null;
  /** I domini di Lateral Space sono configurati (altrimenti la realizzazione è in sola lettura per tutti). */
  lsConfigured?: boolean;
  /** Chi guarda gestisce le Impostazioni del workspace. */
  workspaceAdmin?: boolean;
}): CaseHeadAlert | null {
  if (i.gateReconfirm && i.status !== "chiuso" && i.primary !== "riconferma_via") {
    return {
      kind: "riconferma",
      text: "Il via allo sviluppo va riconfermato: alcune domande indispensabili non sono più a posto.",
      tone: "rosso",
      action: i.canOpenVia ? { label: "Vedi cosa manca", href: "/#via" } : null,
    };
  }
  if (i.status === "sospeso" && i.primary !== "riprendi") return { kind: "pausa", text: "Realizzazione in pausa: niente invii né promemoria finché non riprende.", tone: "grigio", action: null };
  if (i.status === "chiuso") return { kind: "chiuso", text: "Realizzazione chiusa: si può solo leggere.", tone: "grigio", action: null };
  if (i.lsConfigured === false && i.workspaceAdmin) return { kind: "configurazione", text: "Configurazione da completare: la realizzazione è in sola lettura.", tone: "giallo", action: null };
  return null;
}

/**
 * Pagine del dossier che hanno i loro comandi e il loro pulsante pieno: lì il
 * primario della testata non c'è mai (DESIGN §8.1 c, un solo pulsante pieno).
 * Impostazioni: «Aggiungi» di «Accesso al caso».
 */
export const PAGES_WITHOUT_PRIMARY: readonly string[] = ["impostazioni", "progetto"];

/**
 * (Rilascio 10, §3.5) I passi il cui comando sta nella sezione «Via allo sviluppo» della Panoramica («Proponi il via
 * allo sviluppo», «Manda il link per firmare»): lì la sezione ha il suo pulsante pieno e quello della testata si
 * nasconde, come sulla vecchia `/via`. Sulle altre schede il pulsante della testata porta lì (`/#via`).
 */
export const STEPS_WITH_PAGE_COMMAND: readonly NextStepId[] = ["proponi_via", "manda_link_firma"];

export function stepHasPageCommand(id: NextStepId): boolean {
  return STEPS_WITH_PAGE_COMMAND.includes(id);
}

/** Il pannello che apre il passo della testata: il dialogo di conferma, «Esporta…» o il pannello della pagina d'arrivo. */
export type StepPanel = { name: "conferma" | "esporta" | "apri"; value: string };

/**
 * Il pannello di un passo (rilascio 10, §3.5): `?conferma=<stato>` per i cambi di stato, `?esporta=1` per il catalogo
 * dello sviluppatore (pannelli della testata, su ogni pagina), `?apri=file` per «Controlla N file» (il pannello «File»
 * di Domande). Con un pannello il primario non si nasconde mai sulla pagina in cui porta (`stepHiddenOn`): lì lo apre.
 */
export function stepPanelOf(step: Pick<NextStep, "id" | "transition" | "panel">): StepPanel | undefined {
  if (step.transition) return { name: "conferma", value: step.transition };
  if (step.id === "scarica_catalogo") return { name: "esporta", value: "1" };
  return step.panel ? { ...step.panel } : undefined;
}

/**
 * Il pulsante primario si nasconde sulla pagina in cui porta (DESIGN §2.2),
 * anche se il passo apre lì un pannello (`/persone?invia=1` su Persone: la
 * pagina ha già i suoi comandi) o un'ancora (`/impostazioni#stato` su
 * Impostazioni). Resta sulle ancore di Panoramica (`/#blocchi`, in Panoramica)
 * e sui passi che aprono un pannello della testata (`?conferma=`, `?esporta=`).
 * Sulle pagine di `PAGES_WITHOUT_PRIMARY` non c'è mai, qualunque sia il passo.
 * (Rilascio 10, §3.5) `pageCommand`: il comando del passo sta nella pagina
 * d'arrivo (`stepHasPageCommand`), che allora ha il suo pulsante pieno: lì il
 * primario si nasconde anche se porta a un'ancora.
 */
export function stepHiddenOn(step: { href: string; caseBase: string; panel?: boolean; pageCommand?: boolean }, pathname: string): boolean {
  const clean = (p: string) => p.split(/[?#]/)[0].replace(/\/+$/, "");
  const root = clean(step.caseBase);
  const here = clean(pathname);
  if (here.startsWith(`${root}/`) && PAGES_WITHOUT_PRIMARY.includes(here.slice(root.length + 1).split("/")[0])) return true;
  if (step.panel) return false;
  const target = clean(step.href);
  if (step.pageCommand && target === here) return true;
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

/**
 * I cambi di stato delle Impostazioni del caso, divisi per sezione: in «Stato del caso» pausa, ripresa e il ritorno
 * allo sviluppo; (Ondata 0) la chiusura solo in «Zona pericolosa», non due volte nella stessa pagina. Il passo avanti
 * resta il primario della testata. `allowed` sono gli stati ammessi adesso (`loadStatusOptions`).
 */
export function settingsTransitions(current: CaseStatus, allowed: readonly CaseStatus[]): { state: CaseStatus[]; danger: CaseStatus[] } {
  const paused = current === "sospeso";
  const shown = allowed.filter((to) => to === "sospeso" || to === "chiuso" || paused || (to === "in_sviluppo" && current !== "pronto_sviluppo"));
  return { state: shown.filter((to) => to !== "chiuso"), danger: shown.filter((to) => to === "chiuso") };
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
