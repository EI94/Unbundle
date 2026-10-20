/**
 * Il prossimo passo (DESIGN §2.7): un solo motore per la testata, la
 * Panoramica e la card del dossier nella Roadmap. Sostituisce `nextActions()`
 * di `views/progress.ts`.
 *
 * - `caseNextSteps` restituisce i passi che valgono adesso, nell'ordine della
 *   tabella di §2.7: prima ciò che sblocca altre persone (inviare, firmare), poi
 *   il lavoro al tavolo di Lateral Space (verificare).
 * - `owner` dice di chi è il passo rispetto a chi guarda: «me» se tocca a lui.
 *   I passi legati a chi guarda (firme, verifica con i quattro occhi già
 *   applicati, catalogo dello sviluppatore) compaiono solo come «me».
 * - `nextStepFor` dà il pulsante pieno della testata; `whoseTurn` la riga
 *   «Tocca a …» per le cose che toccano ad altri.
 * - `href` è relativo alla radice del dossier (`/via`, `/persone?invia=1`,
 *   `/#blocchi`, `?conferma=<stato>` per i passi che si confermano in un
 *   dialogo): `resolveStepHref` lo completa.
 *
 * I dati arrivano da `loadNextStepInput` di `src/lib/db/queries/uc-next-step.ts`
 * (WP1). Modulo puro e senza dipendenze di Node.
 */
import { isCasePastG1 } from "../case-state.ts";
import type { CaseRole, CaseStatus } from "../vocab.ts";
import { formatCountIt, formatDayIt, formatRelativeIt } from "./format.ts";
import { dayWithArticle } from "./labels.ts";
import type { StatusGroup } from "./status-groups.ts";

export type StepOwner = "me" | "ls" | "cliente" | "referenti";

export type NextStepId =
  | "riprendi"
  | "riconferma_via"
  | "firma"
  | "proponi_via"
  | "avvia_sviluppo"
  | "aggiungi_referenti"
  | "invia_domande"
  | "verifica"
  | "sciogli_blocchi"
  | "manda_link_firma"
  | "indica_firmatario_privacy"
  | "scarica_catalogo"
  | "passo_avanti"
  | "risposte_referenti";

export interface NextStep {
  id: NextStepId;
  label: string;
  detail: string | null;
  /** Relativo alla radice del dossier: vedi `resolveStepHref`. */
  href: string;
  owner: StepOwner;
  /** Per i passi che si confermano in un dialogo: lo stato verso cui va il caso. */
  transition?: CaseStatus;
}

/** Una firma che aspetta chi guarda. `otherSideSigned`: l'altra parte ha già firmato. */
export interface PendingSignature {
  kind: "via" | "scheda_privacy" | "altro";
  otherSideSigned: boolean;
}

export interface NextStepInput {
  /** Per le date relative («3 giorni fa»). */
  now: Date;
  status: CaseStatus;
  statusBeforeSuspension: CaseStatus | null;
  /** Quando il caso è entrato nello stato attuale: «In pausa dal 3 ott.». */
  statusChangedAt?: Date | string | null;
  /** Il caso è oltre il via ma le indispensabili non sono più tutte a posto (`readiness.gate_reconfirm`). */
  gateReconfirm: boolean;
  g1: { required: number; ok: number; ready: boolean; byGroup: Readonly<Partial<Record<StatusGroup, number>>> };
  /** Proposta del via in attesa delle firme. */
  pendingGateReview: { lsSigned: boolean; clientSigned: boolean; lsSignedAt?: Date | string | null } | null;
  /** Referenti del caso (contatti con un link o da invitare). */
  referents: number;
  /** Indispensabili senza referente. */
  unassignedMust: number;
  /** Indispensabili non ancora partite, con o senza referente. */
  unsentMust: number;
  /** Risposte che chi guarda può verificare: i quattro occhi sono già applicati. */
  toVerifyForMe: number;
  /** Di queste, le indispensabili. */
  toVerifyMust: number;
  /** La più vecchia di quelle che chi guarda può verificare. */
  oldestToVerifyAt: Date | string | null;
  /** Tutte le risposte da verificare, di chiunque. */
  toVerifyTotal: number;
  /** Domande che aspettano una risposta dai referenti. */
  waitingOnReferents: number;
  /** Blocchi attivi che fermano domande indispensabili. */
  blockersActive: number;
  /** Indispensabili ferme per un blocco. */
  blockedMust: number;
  /** Fra i blocchi attivi c'è la scheda privacy. */
  privacyBlockerActive: boolean;
  mySignaturesPending: readonly PendingSignature[];
  /** Manca l'approvatore privacy del cliente. */
  privacySignerMissing: boolean;
  /** Il passo avanti ammesso adesso, dopo lo sviluppo (`backtest` … `misura_roi`). */
  forwardTransition: CaseStatus | null;
  nextMilestone: { title: string; date: Date | string | null } | null;
  /** Il catalogo congelato con il via. */
  catalog: { version: number; frozenAt: Date | string | null } | null;
}

export interface NextStepViewer {
  roles: readonly CaseRole[];
}

/** Passi avanti dopo lo sviluppo (riga 14), con `transitionHint` riscritto. */
const FORWARD: Partial<Record<CaseStatus, { label: string; detail: string }>> = {
  backtest: { label: "Passa alla prova sul passato", detail: "Il modello rigioca i dati storici: si misura cosa avrebbe cambiato." },
  collaudo: { label: "Passa al collaudo", detail: "Il cliente prova la soluzione con i criteri concordati." },
  stabilizzazione: { label: "Avvia il rodaggio", detail: "Per almeno 14 giorni si correggono i difetti prima dell'uso." },
  in_esercizio: { label: "Metti in uso", detail: "Dopo almeno 14 giorni di rodaggio senza anomalie bloccanti." },
  misura_roi: { label: "Misura il valore", detail: "Si confronta il valore stimato con quello misurato." },
};

function n(value: number): string {
  return formatCountIt(value);
}

/** «di 3 giorni fa», «di ieri», «del 7 ott», «dell'8 ott», «appena arrivata». */
function agoPhrase(relative: string): string {
  if (relative === "adesso") return "appena arrivata";
  return /^\d/.test(relative) && !relative.includes("fa") ? dayWithArticle("del", relative) : `di ${relative}`;
}

function signatureStep(pending: readonly PendingSignature[], isLead: boolean): NextStep {
  const count = pending.length;
  let label: string;
  if (count === 1 && pending[0].kind === "via") label = "Firma il via allo sviluppo";
  else if (count === 1 && pending[0].kind === "scheda_privacy") label = "Firma la scheda privacy";
  else label = count === 1 ? "Firma 1 decisione" : `Firma ${n(count)} decisioni`;
  const allOtherSigned = pending.every((p) => p.otherSideSigned);
  return { id: "firma", label, detail: allOtherSigned && !isLead ? "Lateral Space ha già firmato." : "Servono per andare avanti.", href: "/firme", owner: "me" };
}

/** I passi che valgono adesso, nell'ordine della tabella di DESIGN §2.7. */
export function caseNextSteps(input: NextStepInput, viewer: NextStepViewer): NextStep[] {
  const has = (role: CaseRole) => viewer.roles.includes(role);
  const lead = has("ls_lead");
  const forLead = (): StepOwner => (lead ? "me" : "ls");
  const steps: NextStep[] = [];

  // 1. Caso chiuso: nessun passo.
  if (input.status === "chiuso") return steps;

  // 2. In pausa: solo la ripresa.
  if (input.status === "sospeso") {
    const since = formatDayIt(input.statusChangedAt ?? null, { now: input.now });
    steps.push({ id: "riprendi", label: "Riprendi il caso", detail: since ? `In pausa ${dayWithArticle("dal", since)}.` : null, href: "/impostazioni#stato", owner: forLead() });
    return steps;
  }

  // 3. Via allo sviluppo da riconfermare.
  if (input.gateReconfirm) {
    const lost = Math.max(0, input.g1.required - input.g1.ok);
    steps.push({
      id: "riconferma_via",
      label: "Riconferma il via allo sviluppo",
      detail: lost === 0 ? null : lost === 1 ? "1 domanda indispensabile non è più a posto." : `${n(lost)} domande indispensabili non sono più a posto.`,
      href: "/via",
      owner: forLead(),
    });
  }

  // 4. Firme in attesa per chi guarda.
  if ((lead || has("owner_cliente") || has("approvatore_privacy")) && input.mySignaturesPending.length > 0) {
    steps.push(signatureStep(input.mySignaturesPending, lead));
  }

  // 5. Indispensabili a posto, nessuna proposta: si propone il via.
  if (input.status === "raccolta" && input.g1.ready && !input.pendingGateReview) {
    const required = input.g1.required;
    steps.push({
      id: "proponi_via",
      label: "Proponi il via allo sviluppo",
      detail: required === 1 ? "La domanda indispensabile è a posto." : `Le ${n(required)} domande indispensabili sono a posto.`,
      href: "/via",
      owner: forLead(),
    });
  }

  // 6. Pronto per lo sviluppo.
  if (input.status === "pronto_sviluppo") {
    steps.push({
      id: "avvia_sviluppo",
      label: "Avvia lo sviluppo",
      detail: input.catalog ? `Il catalogo v${input.catalog.version} è pronto.` : "Il catalogo validato è pronto.",
      href: "?conferma=in_sviluppo",
      owner: forLead(),
      transition: "in_sviluppo",
    });
  }

  // 7. Nessun referente ancora.
  if ((input.status === "bozza" || input.status === "raccolta") && input.referents === 0) {
    steps.push({ id: "aggiungi_referenti", label: "Aggiungi i referenti", detail: "Ognuno riceve un link con le sue domande.", href: "/persone?nuovo=1", owner: forLead() });
  }

  // 8. Indispensabili senza referente o non ancora partite.
  const unsent = Math.max(input.unsentMust, input.unassignedMust);
  if (unsent > 0) {
    steps.push({
      id: "invia_domande",
      label: "Invia le domande",
      detail: unsent === 1 ? "1 indispensabile non è ancora partita." : `${n(unsent)} indispensabili non sono ancora partite.`,
      href: "/persone?invia=1",
      owner: forLead(),
    });
  }

  // 9. Risposte da verificare da chi guarda (quattro occhi già applicati).
  if ((lead || has("ls_analista")) && input.toVerifyForMe > 0) {
    const count = input.toVerifyForMe;
    const parts: string[] = [];
    if (input.toVerifyMust > 0) parts.push(input.toVerifyMust === 1 ? "1 è indispensabile." : `${n(input.toVerifyMust)} sono indispensabili.`);
    const oldest = formatRelativeIt(input.oldestToVerifyAt, input.now);
    if (oldest) parts.push(count === 1 ? `È ${agoPhrase(oldest)}.` : `La più vecchia è ${agoPhrase(oldest)}.`);
    steps.push({
      id: "verifica",
      label: count === 1 ? "Verifica 1 risposta" : `Verifica ${n(count)} risposte`,
      detail: parts.length ? parts.join(" ") : null,
      href: "/domande/verifica",
      owner: "me",
    });
  }

  // 10. Blocchi che fermano domande indispensabili.
  if (input.blockersActive > 0 && input.blockedMust > 0) {
    const one = input.blockersActive === 1;
    const verb = one ? "Ferma" : "Fermano";
    steps.push({
      id: "sciogli_blocchi",
      label: one ? "Sciogli il blocco" : `Sciogli ${n(input.blockersActive)} blocchi`,
      detail: input.blockedMust === 1 ? `${verb} 1 domanda indispensabile.` : `${verb} ${n(input.blockedMust)} domande indispensabili.`,
      href: one && input.privacyBlockerActive ? "/privacy" : "/#blocchi",
      owner: forLead(),
    });
  }

  // 11. Lateral Space ha firmato la proposta, il cliente no.
  const review = input.pendingGateReview;
  if (review && review.lsSigned && !review.clientSigned) {
    const on = formatDayIt(review.lsSignedAt ?? null, { now: input.now });
    const who = lead ? (on ? `Hai firmato ${dayWithArticle("il", on)}.` : "Hai firmato.") : on ? `Lateral Space ha firmato ${dayWithArticle("il", on)}.` : "Lateral Space ha firmato.";
    steps.push({ id: "manda_link_firma", label: "Manda il link per firmare", detail: `${who} Manca il responsabile del cliente.`, href: "/via", owner: forLead() });
  }

  // 12. Manca chi firma la privacy per il cliente.
  if (input.privacySignerMissing) {
    steps.push({
      id: "indica_firmatario_privacy",
      label: "Indica chi firma la privacy",
      detail: "Serve per usare dati reali.",
      href: "/persone",
      owner: has("owner_cliente") ? "me" : "cliente",
    });
  }

  // 13. Sviluppatore, dopo il via: il catalogo validato.
  if (has("ls_sviluppatore") && isCasePastG1(input.status, input.statusBeforeSuspension)) {
    const frozen = input.catalog ? formatDayIt(input.catalog.frozenAt, { now: input.now }) : null;
    steps.push({
      id: "scarica_catalogo",
      label: "Scarica il catalogo validato",
      detail: input.catalog ? `Catalogo v${input.catalog.version}${frozen ? `, congelato ${dayWithArticle("il", frozen)}` : ""}.` : null,
      href: "?esporta=1",
      owner: "me",
    });
  }

  // 14. Passo avanti dopo lo sviluppo.
  const forward = input.forwardTransition ? FORWARD[input.forwardTransition] : undefined;
  if (forward && input.forwardTransition && !["bozza", "raccolta", "pronto_sviluppo"].includes(input.status)) {
    steps.push({ id: "passo_avanti", label: forward.label, detail: forward.detail, href: `?conferma=${input.forwardTransition}`, owner: forLead(), transition: input.forwardTransition });
  }

  // Domande che aspettano i referenti: non è un pulsante, serve a Panoramica e a `whoseTurn`.
  if (input.waitingOnReferents > 0) {
    const count = input.waitingOnReferents;
    steps.push({
      id: "risposte_referenti",
      label: "Rispondono i referenti",
      detail: count === 1 ? "1 domanda è da loro. I promemoria partono da soli." : `${n(count)} domande sono da loro. I promemoria partono da soli.`,
      href: "/persone",
      owner: "referenti",
    });
  }

  return steps;
}

/** Il primo passo di chi guarda: il pulsante pieno della testata. */
export function nextStepFor(steps: readonly NextStep[]): NextStep | null {
  return steps.find((s) => s.owner === "me") ?? null;
}

/** I passi di chi guarda, al massimo `max` («Da fare adesso» ne mostra 3). */
export function myNextSteps(steps: readonly NextStep[], max = 3): NextStep[] {
  return steps.filter((s) => s.owner === "me").slice(0, max);
}

/**
 * La riga «Tocca a …» per ciò che tocca ad altri (si usa il primo
 * applicabile). Se tocca anche a chi guarda dice «Tocca anche a …»; se non
 * tocca a nessun altro e chi guarda ha i suoi passi, non c'è riga.
 *
 * «Tutto in ordine» vale solo quando non resta un passo di nessuno, salvo il
 * passo avanti dopo lo sviluppo: un passo di altri senza una riga sua in §2.7
 * (riconfermare il via, sciogliere i blocchi, indicare chi firma la privacy,
 * una firma che manca a Lateral Space) non dà riga. Lo dicono già i passi e
 * l'avviso della testata.
 */
export function whoseTurn(steps: readonly NextStep[], input: NextStepInput): string | null {
  if (input.status === "chiuso") return "Caso chiuso: si può solo leggere.";
  if (input.status === "sospeso") return null;
  const mine = steps.some((s) => s.owner === "me");
  const also = mine ? "Tocca anche" : "Tocca";
  // `toVerifyForMe` conta solo per chi verifica davvero (il passo «verifica» è suo).
  const verifyingMine = steps.some((s) => s.owner === "me" && s.id === "verifica") ? input.toVerifyForMe : 0;
  const othersToVerify = Math.max(0, input.toVerifyTotal - verifyingMine);
  if (othersToVerify > 0) {
    return `${also} a Lateral Space: stanno verificando ${othersToVerify === 1 ? "1 risposta" : `${n(othersToVerify)} risposte`}.`;
  }
  const referents = steps.find((s) => s.owner === "referenti");
  if (referents) return `${also} ai referenti: ${referents.detail}`;
  const review = input.pendingGateReview;
  const signingIsMine = steps.some((s) => s.owner === "me" && s.id === "firma" && input.mySignaturesPending.some((p) => p.kind === "via"));
  if (review && review.lsSigned && !review.clientSigned && !signingIsMine) return `${also} al cliente: manca la firma del responsabile del cliente.`;
  if (mine) return null;
  // Il passo avanti dopo lo sviluppo è un'opportunità, non un'attesa: resta «Tutto in ordine».
  if (steps.some((s) => s.id !== "passo_avanti")) return null;
  if (review && !(review.lsSigned && review.clientSigned)) return null;
  const milestone = input.nextMilestone ? formatDayIt(input.nextMilestone.date, { now: input.now }) : null;
  return milestone ? `Tutto in ordine. Prossima tappa: ${milestone}.` : "Tutto in ordine.";
}

/** Completa l'`href` di un passo con la radice del dossier (`/dashboard/<ws>/casi-duso/<id>`). */
export function resolveStepHref(caseBase: string, href: string): string {
  const base = caseBase.replace(/\/+$/, "");
  if (href.startsWith("?") || href.startsWith("#")) return `${base}${href}`;
  if (href.startsWith("/#")) return `${base}${href.slice(1)}`;
  if (href === "/") return base;
  return `${base}${href.startsWith("/") ? href : `/${href}`}`;
}
