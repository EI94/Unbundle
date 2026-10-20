/**
 * Ordine e suddivisione della pagina del referente (DESIGN §4.2–§4.4, §4.7).
 *
 * - **Home** (`planReferentHome`): una sola scheda primaria scelta dallo stato
 *   (chiarimenti, risposte pronte, argomento a metà, percorso a un tocco,
 *   primo argomento), le righe degli argomenti e gli elenchi secondari
 *   («Lasciate per dopo», «Meglio dal computer», «Si apriranno più avanti»,
 *   «Già inviate»).
 * - **Passi**: dentro un argomento l'ordine è quello dello schema (riordinare
 *   romperebbe le coppie «avete X?» / «quanti X?»), con i tipi pesanti in
 *   fondo. Il percorso «Inizia dalle più veloci» attraversa gli argomenti, ma
 *   nell'ordine dello schema.
 * - **Indirizzi dei passi** (`parseReferentHash`, `referentHash`): `#/`,
 *   `#/a/<argomento>`, `#/a/<argomento>/<n>`, `#/a/<argomento>/invia`,
 *   `#/veloci/<n>`, `#/collega/<id>`, `#/chiarimento/<id>`. L'hash non arriva
 *   al server e il tasto indietro torna al passo di prima.
 * - **Tempi** a pesi fissi, mai dal comportamento misurato della persona.
 * - **Memorie del dispositivo** (`uc-skip:`, `uc-last:`, `uc-intro:` con il
 *   prefisso del link): solo le forme, la lettura e la scrittura stanno nella
 *   pagina, dentro try/catch.
 *
 * Modulo puro, senza import dell'app.
 */
import { isLockedPersonal, type ReferentItemView, type ReferentModuleView, type ReferentView } from "../public-view.ts";
import { estimateMinutes, isHeavyResponseType } from "../request-state.ts";
import { UUID } from "../ids.ts";
import { formatCountIt } from "./format.ts";

// ── Argomenti ─────────────────────────────────────────────────────────

/**
 * Argomento delle domande senza modulo. Le chiavi dei moduli dello schema
 * (`[a-z0-9_]` a pezzi separati da punti) non hanno mai un trattino: nessun
 * modulo può chiamarsi così.
 */
export const OTHER_TOPIC = "altre-domande";

/** Nome dell'argomento nell'indirizzo: la chiave del modulo, oppure `OTHER_TOPIC`. */
export function topicId(module: Pick<ReferentModuleView, "key">): string {
  return module.key ?? OTHER_TOPIC;
}

/** Chiavi dei moduli (anche con `_` in testa, come lo schema le ammette) e `OTHER_TOPIC`. */
const TOPIC_ID = /^[a-z0-9_][a-z0-9._-]{0,79}$/i;

/** La domanda si può ancora toccare dal link e non è fatta: è un passo. */
export function isPendingStep(item: ReferentItemView): boolean {
  return item.can.answer && !item.done && !isLockedPersonal(item);
}

/**
 * Risposta con un tocco (DESIGN §4.4 punto 2): conferma di un valore già noto
 * che il referente vede e che è già nel formato giusto, oppure sì/no e scelta
 * singola. Mai con «Valido dal» obbligatorio, mai una domanda personale (non va
 * in bozza), mai un chiarimento o una nuova versione.
 */
export function isOneTap(item: ReferentItemView): boolean {
  if (!isPendingStep(item) || item.personal || item.requiresValidFrom || item.clarification !== null || item.can.newVersionOnly) return false;
  if (item.toConfirm?.canConfirm && item.toConfirm.display !== null) return true;
  return item.toConfirm === null && (item.responseType === "si_no" || item.responseType === "scelta");
}

/** I passi di un argomento: domande aperte nell'ordine dello schema, le pesanti in fondo. */
export function topicSteps(module: Pick<ReferentModuleView, "items">): ReferentItemView[] {
  const pending = module.items.filter(isPendingStep);
  return [...pending.filter((i) => !isHeavyResponseType(i.responseType)), ...pending.filter((i) => isHeavyResponseType(i.responseType))];
}

/**
 * Il giro a un tocco: fra argomenti, nell'ordine dello schema. Comprende anche
 * le risposte già pronte, così i numeri dei passi non cambiano mentre il
 * referente avanza.
 */
export function quickRound(view: Pick<ReferentView, "modules">): ReferentItemView[] {
  return view.modules.flatMap((m) => m.items).filter(isOneTap);
}

/** Le risposte con un tocco ancora da dare. */
export function quickSteps(view: Pick<ReferentView, "modules">, ready: ReadonlySet<string> = new Set()): ReferentItemView[] {
  return quickRound(view).filter((i) => !ready.has(i.id));
}

/** Minuti per le domande indicate di un argomento: stima del modulo in proporzione, oppure pesi fissi. */
export function topicMinutes(module: Pick<ReferentModuleView, "key" | "estimatedMinutes" | "questionCount">, items: readonly ReferentItemView[]): number {
  if (items.length === 0) return 0;
  const key = module.key ?? "";
  return estimateMinutes(
    module.key ? [{ key, estimatedMinutes: module.estimatedMinutes, questionCount: module.questionCount }] : [],
    items.map((i) => ({ moduleKey: module.key, responseType: i.responseType, oneTap: isOneTap(i) && i.toConfirm !== null })),
  );
}

// ── Home ──────────────────────────────────────────────────────────────

export interface PlanState {
  /** Sotto i 768 px: i tipi pesanti finiscono anche in «Meglio dal computer». */
  narrow: boolean;
  /** Domande pronte per l'invio (intento in bozza e valido). */
  ready?: ReadonlySet<string>;
  /** Domande con qualcosa scritto o deciso, anche non ancora valido. */
  touched?: ReadonlySet<string>;
  /** «Rispondi dopo» su questo dispositivo. */
  skipped?: ReadonlySet<string>;
  /** Dove si era fermato il referente su questo dispositivo. */
  last?: LastPosition | null;
  /** Argomenti di cui ha già visto l'inizio (R1b compare solo la prima volta). */
  introSeen?: ReadonlySet<string>;
}

/** Dove porta la riga di un argomento: l'inizio (R1b) la prima volta, poi il primo passo ancora da fare. */
export function topicEntryHash(topic: Pick<TopicPlan, "id" | "hasIntro" | "steps">, introSeen: ReadonlySet<string>, ready: ReadonlySet<string> = new Set()): string {
  if (topic.hasIntro && !introSeen.has(topic.id)) return referentHash({ screen: "intro", topic: topic.id });
  const firstOpen = topic.steps.findIndex((id) => !ready.has(id));
  if (topic.steps.length > 0 && firstOpen === -1) return referentHash({ screen: "invia", topic: topic.id });
  return referentHash({ screen: "passo", topic: topic.id, n: Math.max(1, firstOpen + 1) });
}

export interface LastPosition {
  topic: string;
  n: number;
}

export type TopicStatus = "nuovo" | "iniziato" | "inviato";

export interface TopicPlan {
  id: string;
  title: string;
  why: string | null;
  instructions: string | null;
  /** Domande che contano: fatte più quelle ancora da fare. */
  total: number;
  done: number;
  ready: number;
  /** Passi (domande aperte), in ordine. */
  steps: string[];
  /** Minuti stimati per i passi rimasti. */
  minutes: number;
  status: TopicStatus;
  /** Ha un perché o delle istruzioni: la prima volta si apre con R1b. */
  hasIntro: boolean;
  /** La riga sotto il titolo nella Home. */
  line: string;
}

export interface SentRow {
  id: string;
  title: string;
  /** «In verifica», «A posto», «Hai risposto «Non lo so»», «Da completare». */
  label: string;
  /** Si può ancora aggiornare (nuova versione, risposta tardiva, completamento). */
  canUpdate: boolean;
}

export interface ListRow {
  id: string;
  title: string;
  /** Dove porta la riga. */
  hash: string;
}

export type PrimaryKind = "chiarimento" | "invio" | "riprendi" | "veloci" | "inizia";

export interface PrimaryCard {
  kind: PrimaryKind;
  title: string;
  text: string;
  button: string;
  hash: string;
}

export interface HomePlan {
  /** Null quando non resta nulla da fare (R9 «Hai finito»). */
  primary: PrimaryCard | null;
  quick: string[];
  topics: TopicPlan[];
  computer: ListRow[];
  locked: ListRow[];
  skipped: ListRow[];
  sent: SentRow[];
  progress: { done: number; total: number };
  /** Domande con un chiarimento di Lateral Space da rispondere. */
  clarifications: string[];
  /** Domande pronte da inviare, in ordine. */
  readyIds: string[];
  /** Non resta niente da fare né da inviare. */
  finished: boolean;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many.replace("{n}", formatCountIt(n));
}

/** «8 domande · circa 6 minuti». */
export function questionsAndMinutes(n: number, minutes: number): string {
  const q = plural(n, "1 domanda", "{n} domande");
  return minutes > 0 ? `${q} · circa ${minutesWords(minutes)}` : q;
}

/** «1 minuto», «6 minuti», «1 ora e 10 minuti». */
export function minutesWords(n: number): string {
  if (n < 60) return plural(n, "1 minuto", "{n} minuti");
  const h = Math.floor(n / 60);
  const m = n % 60;
  const hours = plural(h, "1 ora", "{n} ore");
  return m === 0 ? hours : `${hours} e ${plural(m, "1 minuto", "{n} minuti")}`;
}

function stepHash(topic: string, n: number): string {
  return referentHash({ screen: "passo", topic, n });
}

/**
 * La Home del referente (DESIGN §4.3 R1 e §4.4). Vince la prima scheda primaria
 * che si applica:
 * 1. chiarimenti in attesa;
 * 2. risposte pronte non inviate;
 * 3. un argomento a metà;
 * 4. almeno 3 risposte con un tocco;
 * 5. altrimenti il primo argomento con domande aperte.
 */
export function planReferentHome(view: Pick<ReferentView, "modules">, state: PlanState): HomePlan {
  const ready = state.ready ?? new Set<string>();
  const touched = state.touched ?? new Set<string>();
  const skippedSet = state.skipped ?? new Set<string>();
  const items = view.modules.flatMap((m) => m.items);

  const topics: TopicPlan[] = view.modules.map((m) => {
    const steps = topicSteps(m);
    const counted = m.items.filter((i) => !isLockedPersonal(i) && (i.done || i.can.answer));
    const done = counted.filter((i) => i.done).length;
    const readyHere = steps.filter((i) => ready.has(i.id)).length;
    const open = steps.filter((i) => !ready.has(i.id));
    const minutes = topicMinutes(m, open);
    const started = done > 0 || readyHere > 0 || steps.some((i) => touched.has(i.id));
    const status: TopicStatus = steps.length === 0 && counted.length > 0 ? "inviato" : started ? "iniziato" : "nuovo";
    const line =
      status === "inviato"
        ? plural(counted.length, "1 domanda inviata", "{n} domande inviate")
        : status === "iniziato"
          ? `${done + readyHere} di ${counted.length}${readyHere > 0 ? ` · ${plural(readyHere, "1 pronta da inviare", "{n} pronte da inviare")}` : ""}`
          : questionsAndMinutes(steps.length, minutes);
    return {
      id: topicId(m),
      title: m.title,
      why: m.why,
      instructions: m.instructions,
      total: counted.length,
      done,
      ready: readyHere,
      steps: steps.map((i) => i.id),
      minutes,
      status,
      hasIntro: Boolean(m.why || m.instructions),
      line,
    };
  });
  const visibleTopics = topics.filter((t) => t.total > 0);

  const stepOf = new Map<string, { topic: string; n: number }>();
  for (const t of topics) t.steps.forEach((id, i) => stepOf.set(id, { topic: t.id, n: i + 1 }));
  const rowFor = (i: ReferentItemView): ListRow => {
    const at = stepOf.get(i.id);
    return { id: i.id, title: i.title, hash: at ? stepHash(at.topic, at.n) : referentHash({ screen: "voce", itemId: i.id }) };
  };

  const pending = items.filter(isPendingStep);
  const clarifications = pending.filter((i) => i.clarification !== null).map((i) => i.id);
  const readyIds = pending.filter((i) => ready.has(i.id)).map((i) => i.id);
  const quick = quickSteps(view, ready).map((i) => i.id);
  const counted = items.filter((i) => !isLockedPersonal(i) && (i.done || i.can.answer));
  const progress = { done: counted.filter((i) => i.done).length, total: counted.length };

  const computer = state.narrow ? pending.filter((i) => isHeavyResponseType(i.responseType) && !ready.has(i.id)).map(rowFor) : [];
  const locked = items.filter(isLockedPersonal).map((i) => ({ id: i.id, title: i.title, hash: "" }));
  const skipped = pending.filter((i) => skippedSet.has(i.id) && !ready.has(i.id)).map(rowFor);
  const sent: SentRow[] = items.filter((i) => i.done).map((i) => ({ id: i.id, title: i.title, label: i.label, canUpdate: i.can.answer }));

  let primary: PrimaryCard | null = null;
  if (clarifications.length > 0) {
    primary = {
      kind: "chiarimento",
      title: "Ti chiediamo un chiarimento",
      text: plural(clarifications.length, "Su una risposta che ci hai dato.", "Su {n} risposte che ci hai dato."),
      button: "Rispondi",
      hash: referentHash({ screen: "chiarimento", itemId: clarifications[0] }),
    };
  } else if (readyIds.length > 0) {
    const withReady = topics.filter((t) => t.ready > 0);
    const preferred = withReady.find((t) => t.id === state.last?.topic) ?? withReady[0];
    if (withReady.length === 1) {
      primary = {
        kind: "invio",
        title: "Manca solo l'invio",
        text: `${plural(preferred.ready, "1 risposta pronta", "{n} risposte pronte")} in «${preferred.title}».`,
        button: "Controlla e invia",
        hash: referentHash({ screen: "invia", topic: preferred.id }),
      };
    } else {
      primary = {
        kind: "invio",
        title: "Manca solo l'invio",
        text: `${plural(readyIds.length, "1 risposta pronta", "{n} risposte pronte")} in ${withReady.length} argomenti.`,
        button: "Controlla e invia",
        hash: referentHash({ screen: "invia", topic: QUICK }),
      };
    }
  } else {
    // «Riprendi» solo per un argomento a metà: aprire un passo e tornare indietro non basta.
    // `uc-last` dice quale preferire e da che passo riprendere (DESIGN §4.3 R1, §4.4 punto 4).
    const resumable = (t: TopicPlan) => t.steps.length > 0 && t.status === "iniziato";
    const lastTopic = state.last ? topics.find((t) => t.id === state.last!.topic && resumable(t)) : undefined;
    const resume = lastTopic ?? topics.find(resumable);
    if (resume) {
      const n = lastTopic && state.last ? Math.min(Math.max(1, state.last.n), resume.steps.length) : 1;
      primary = {
        kind: "riprendi",
        title: "Riprendi da dove eri",
        text: `${resume.title} · ${resume.done + resume.ready} di ${resume.total}`,
        button: "Riprendi",
        hash: stepHash(resume.id, n),
      };
    } else if (quick.length >= 3) {
      const round = quickRound(view);
      primary = {
        kind: "veloci",
        title: "Inizia dalle più veloci",
        text: `${plural(quick.length, "1 risposta con un tocco", "{n} risposte con un tocco")} · circa ${minutesWords(Math.max(1, Math.ceil(quick.length * 0.5)))}`,
        button: "Inizia",
        hash: referentHash({ screen: "veloci", n: Math.max(1, round.findIndex((i) => !ready.has(i.id)) + 1) }),
      };
    } else {
      const first = topics.find((t) => t.steps.length > 0);
      if (first) {
        primary = {
          kind: "inizia",
          title: `Iniziamo da ${first.title}`,
          text: questionsAndMinutes(first.steps.length, first.minutes),
          button: "Inizia",
          hash: topicEntryHash(first, state.introSeen ?? new Set(), ready),
        };
      }
    }
  }

  return {
    primary,
    quick,
    topics: visibleTopics,
    computer,
    locked,
    skipped,
    sent,
    progress,
    clarifications,
    readyIds,
    finished: pending.length === 0 && progress.total > 0,
  };
}

/** Il prossimo argomento con domande aperte dopo `afterTopic` (R7 «Prossimo: …»), oppure il primo. */
export function nextTopic(topics: readonly TopicPlan[], afterTopic: string | null): TopicPlan | null {
  const open = (t: TopicPlan) => t.steps.length > t.ready;
  const index = afterTopic ? topics.findIndex((t) => t.id === afterTopic) : -1;
  return topics.slice(index + 1).find(open) ?? topics.slice(0, Math.max(0, index)).find(open) ?? null;
}

// ── Indirizzi dei passi ───────────────────────────────────────────────

/** Inizio degli indirizzi del percorso a un tocco: `#/veloci/<n>`, `#/veloci/invia`. */
const QUICK_PATH = "veloci";

/**
 * Argomento finto del percorso a un tocco, per il riepilogo e l'invio. Non è
 * una chiave possibile di un modulo (comincia con un trattino), così un modulo
 * chiamato «veloci» resta un argomento come gli altri.
 */
export const QUICK = "-veloci";

export type ReferentRoute =
  | { screen: "home" }
  | { screen: "intro"; topic: string }
  | { screen: "passo"; topic: string; n: number }
  | { screen: "invia"; topic: string }
  | { screen: "inviate"; topic: string }
  | { screen: "veloci"; n: number }
  /** `#/collega/<id>`; con `/argomento` parte già scelto «tutto l'argomento» (R1b). */
  | { screen: "collega"; itemId: string; wholeTopic?: boolean }
  | { screen: "chiarimento"; itemId: string }
  | { screen: "voce"; itemId: string };

/** L'hash della pagina → passo. Un hash che non si riconosce porta alla Home. */
export function parseReferentHash(hash: string | null | undefined): ReferentRoute {
  const raw = (hash ?? "").replace(/^#/, "");
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return { screen: "home" };
  }
  const parts = path.split("/").filter(Boolean);
  const n = (s: string | undefined) => (s && /^\d{1,4}$/.test(s) ? Number(s) : null);
  if (parts.length === 0) return { screen: "home" };
  const [head, a, b] = parts;
  if (head === "a" && a && TOPIC_ID.test(a)) {
    if (parts.length === 2) return { screen: "intro", topic: a };
    if (parts.length === 3 && b === "invia") return { screen: "invia", topic: a };
    if (parts.length === 3 && b === "inviate") return { screen: "inviate", topic: a };
    const step = n(b);
    if (parts.length === 3 && step !== null && step >= 1) return { screen: "passo", topic: a, n: step };
  }
  if (head === QUICK_PATH && parts.length === 2) {
    if (a === "invia") return { screen: "invia", topic: QUICK };
    if (a === "inviate") return { screen: "inviate", topic: QUICK };
    const step = n(a);
    if (step !== null && step >= 1) return { screen: "veloci", n: step };
  }
  if (head === "collega" && parts.length === 3 && a && UUID.test(a) && b === "argomento") {
    return { screen: "collega", itemId: a.toLowerCase(), wholeTopic: true };
  }
  if ((head === "collega" || head === "chiarimento" || head === "voce") && parts.length === 2 && a && UUID.test(a)) {
    return { screen: head, itemId: a.toLowerCase() };
  }
  return { screen: "home" };
}

/** Passo → hash della pagina. */
export function referentHash(route: ReferentRoute): string {
  switch (route.screen) {
    case "home":
      return "#/";
    case "intro":
      return `#/a/${encodeURIComponent(route.topic)}`;
    case "passo":
      return `#/a/${encodeURIComponent(route.topic)}/${route.n}`;
    case "invia":
      return route.topic === QUICK ? `#/${QUICK_PATH}/invia` : `#/a/${encodeURIComponent(route.topic)}/invia`;
    case "inviate":
      return route.topic === QUICK ? `#/${QUICK_PATH}/inviate` : `#/a/${encodeURIComponent(route.topic)}/inviate`;
    case "veloci":
      return `#/${QUICK_PATH}/${route.n}`;
    case "collega":
      return `#/collega/${route.itemId}${route.wholeTopic ? "/argomento" : ""}`;
    case "chiarimento":
    case "voce":
      return `#/${route.screen}/${route.itemId}`;
  }
}

// ── Testi per i lettori di schermo e il titolo della scheda ───────────

/** `document.title` di un passo: «Domanda 3 di 12 · Prezzi e sconti · Unbundle». */
export function stepDocumentTitle(n: number, total: number, topicTitle: string): string {
  return `Domanda ${n} di ${total} · ${topicTitle} · Unbundle`;
}

/** «36 di 112 risposte». */
export function homeProgressText(done: number, total: number): string {
  return `${formatCountIt(done)} di ${formatCountIt(total)} ${total === 1 ? "risposta" : "risposte"}`;
}

/** `aria-valuetext` della barra: «36 risposte su 112». */
export function progressValueText(done: number, total: number): string {
  return `${formatCountIt(done)} ${done === 1 ? "risposta" : "risposte"} su ${formatCountIt(total)}`;
}

/** Scadenza del link nella Home: in fondo, oppure in alto e ambra negli ultimi 3 giorni. */
export function expiryNotice(expiresAtIso: string, now: Date): { soon: boolean; text: string } | null {
  const at = Date.parse(expiresAtIso);
  if (!Number.isFinite(at)) return null;
  const left = at - now.getTime();
  if (left <= 0) return null;
  const days = Math.ceil(left / 86_400_000);
  if (days <= 3) {
    return { soon: true, text: `Il link scade ${days === 1 ? "tra 1 giorno" : `tra ${days} giorni`}. Se ti serve più tempo, scrivi a chi te l'ha mandato.` };
  }
  const date = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", timeZone: "Europe/Rome" }).format(new Date(at));
  return { soon: false, text: `Vale fino ${/^(8|11)\s/.test(date) ? "all'" : "al "}${date}.` };
}

// ── Memorie del dispositivo ───────────────────────────────────────────

/** Chiavi con il solo prefisso del link (non basta a ricostruirlo), come le bozze. */
export function storageKey(kind: "skip" | "last" | "intro", token: string): string {
  return `uc-${kind}:${token.slice(0, 12)}`;
}

/** Elenco di id dalla memoria (`uc-skip:`, `uc-intro:`), al massimo 500, solo forme valide. */
export function decodeIdList(text: string | null | undefined, kind: "item" | "topic" = "item"): string[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    const valid = kind === "item" ? UUID : TOPIC_ID;
    return [...new Set(parsed.filter((x): x is string => typeof x === "string" && valid.test(x)))].slice(0, 500);
  } catch {
    return [];
  }
}

export function encodeIdList(ids: Iterable<string>): string {
  return JSON.stringify([...new Set(ids)].slice(0, 500));
}

/** Ultima posizione dalla memoria (`uc-last:`), oppure null. */
export function decodeLast(text: string | null | undefined): LastPosition | null {
  if (!text) return null;
  try {
    const o = JSON.parse(text) as unknown;
    if (!o || typeof o !== "object") return null;
    const { argomento, n } = o as Record<string, unknown>;
    if (typeof argomento !== "string" || !TOPIC_ID.test(argomento) || typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 9999) return null;
    return { topic: argomento, n };
  } catch {
    return null;
  }
}

export function encodeLast(last: LastPosition): string {
  return JSON.stringify({ argomento: last.topic, n: last.n });
}
