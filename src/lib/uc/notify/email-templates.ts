/**
 * Testi delle email della realizzazione (PIANO §7.1), in italiano semplice.
 *
 * - Testo semplice più HTML minimo: **nessun pixel, nessuna risorsa esterna**
 *   oltre al marchio statico dell'intestazione (rilascio 10, §3.12: «intestazione
 *   come le altre», `emailBrand`). Il tracciamento di aperture e clic va spento sul
 *   dominio Resend (nota in `AMBIENTE.md`): riscriverebbe i link `/r/`.
 * - (Rilascio 10, §3.12) Il modello unico: l'oggetto al massimo di 55 caratteri,
 *   «{Cliente}: {cosa} «{Titolo}»» (`emailSubject`); il corpo corto; niente chiavi
 *   («richiesta.durata»), niente «k3» né «coding agent» dove non serve.
 * - Nessun valore delle risposte, nessun dato riservato, nessun nome di persona:
 *   cliente, caso, conteggi, minuti stimati, scadenza, etichette di ruolo,
 *   chiavi e titoli delle voci (solo per l'Owner). (9b) Nel riepilogo i numeri
 *   di «Contesto» e, solo per l'Owner, fino a tre impegni del cliente «Per
 *   tutti»: mai il testo di un fatto.
 * - Il link arriva al momento dell'invio (`dispatch`), mai dalla coda: qui si
 *   controlla solo che sia un link pulito, senza parametri. L'unico frammento
 *   ammesso è `#/chiarimento/<id>`, che apre il chiarimento (DESIGN §4.3 R8).
 * - Le email ai referenti passano il controllo dei testi (`copy-guard`): niente
 *   chiavi, codici o gergo.
 *
 * Modulo puro.
 */
import type { ItemStatus } from "../vocab.ts";
import { UUID } from "../ids.ts";
import { emailSubject, formatDateIt, multiLine, oneLine, render, untilDayIt, type Block, type EmailBrand, type RenderedEmail } from "./email-render.ts";

// Il motore di composizione (testo semplice più HTML minimo, piè di pagina) sta in `email-render.ts`:
// lo usano anche le email di «Chiedi al referente». Qui restano esportati come prima.
export { UC_EMAIL_SENDER_NAME, escapeHtml, formatDateIt, type RenderedEmail } from "./email-render.ts";

interface CaseRef {
  /** Nome del cliente (workspace o organizzazione). */
  clientName: string;
  caseTitle: string;
  /** (8.0c) Va a chi costruisce il caso da fuori Lateral Space: il piede non dice «interna» (`builderFooter`). */
  external?: boolean;
}

/**
 * (8.0c) Il piede delle e-mail di chi costruisce: a Lateral Space «Email interna di Lateral Space.», come prima; a chi
 * costruisce il caso da fuori Lateral Space l'e-mail non è interna, e il piede dice solo da dove arriva.
 */
function builderFooter(input: { external?: boolean }): Block {
  return { small: input.external === true ? "Email automatica di Unbundle." : "Email interna di Lateral Space." };
}

export interface WeeklyCaseSummary {
  code: string;
  title: string;
  total: number;
  counts: Partial<Record<ItemStatus, number>>;
  greenPct: number;
  g1: { required: number; ok: number } | null;
  /** Solo per l'Owner: voci mancanti (chiave e titolo), al massimo 10. */
  redItems?: readonly { key: string; title: string }[];
  nextMilestone?: { title: string; label: string | null; isProposal: boolean; toConfirm: boolean } | null;
  /** Solo per Lateral Space: link alla pagina del caso. */
  link?: string | null;
}

/** (9b) Gli impegni del cliente che l'Owner legge nel riepilogo: al massimo tre (RILASCIO-9b-COSTRUZIONE.md §2.9). */
export const WEEKLY_CONTEXT_COMMITMENTS_MAX = 3;

/**
 * (9b) Il blocco «Contesto» del riepilogo per Lateral Space (RILASCIO-9b-COSTRUZIONE.md §2.9, D6): solo numeri del
 * workspace e il link alla pagina «Contesto». Nessun testo di un fatto.
 */
export interface WeeklyContextLs {
  /** Fatti nati negli ultimi 7 giorni (nuovi o aggiornati). */
  novelties: number;
  /** Proposte da confermare. */
  toConfirm: number;
  /** Fatti da verificare (fermi da più di 6 mesi). */
  toCheck: number;
  /** Impegni aperti scaduti o in scadenza nei 7 giorni. */
  due: { ours: number; theirs: number };
  /** La pagina «Contesto» del workspace: `/dashboard/<ws>/contesto`. */
  link: string;
}

/** (9b) Il blocco «Contesto» del riepilogo per l'Owner del cliente: solo quello che è «Per tutti», nessun link. */
export interface WeeklyContextOwner {
  /** Fatti «Per tutti» nuovi o aggiornati negli ultimi 7 giorni. */
  novelties: number;
  /** Fino a tre impegni del cliente «Per tutti», scaduti o in scadenza nei 7 giorni: il testo e la scadenza (AAAA-MM-GG). */
  commitments: readonly { statement: string; dueOn: string }[];
  /** Il giorno di Roma dell'invio (AAAA-MM-GG): dice se un impegno è scaduto e se la sua data vuole l'anno. */
  today: string;
}

export type EmailInput =
  | (CaseRef & { template: "richiesta_inviata"; questions: number; minutes: number | null; expiresAt: Date; link: string; message?: string | null })
  | (CaseRef & { template: "promemoria_1" | "promemoria_2"; questions: number; minutes: number | null; expiresAt: Date; link: string })
  | (CaseRef & { template: "segnalazione_owner"; roleLabel: string | null; items: readonly { key: string; title: string }[] })
  | (CaseRef & {
      template: "chiarimento";
      itemTitle: string | null;
      expiresAt: Date;
      link: string;
      /** La domanda del chiarimento: il link apre direttamente la risposta (`#/chiarimento/<id>`, DESIGN §4.3 R8). */
      itemId?: string | null;
    })
  | (CaseRef & {
      template: "delega";
      audience: "collega";
      fromRoleLabel: string | null;
      questions: number;
      minutes: number | null;
      expiresAt: Date;
      link: string;
      message?: string | null;
    })
  | (CaseRef & { template: "delega"; audience: "delegante"; questions: number })
  | (CaseRef & { template: "richiesta_approvazione"; designation: "owner" | "privacy"; pending: number; expiresAt: Date; link: string })
  // (9b) `context`: il blocco «Contesto» di ogni pubblico (un tipo per pubblico: all'Owner non arrivano mai i numeri di
  // Lateral Space né il link); null o assente, niente blocco.
  | { template: "riepilogo_settimanale"; audience: "owner"; clientName: string | null; week: string; cases: readonly WeeklyCaseSummary[]; context?: WeeklyContextOwner | null }
  | { template: "riepilogo_settimanale"; audience: "ls"; clientName: string | null; week: string; cases: readonly WeeklyCaseSummary[]; context?: WeeklyContextLs | null }
  | (CaseRef & { template: "progetto_da_approvare" | "strumento_da_approvare" | "pacchetto_aggiornato" | "modifica_richiesta" | "domanda_proposta"; version: number | null; link: string; tools?: number })
  // (8.0b) Alla persona: una CLI di Unbundle è collegata al suo account nel workspace. Il link porta a «Il tuo account»
  // (rilascio 10: `/dashboard/<ws>/account`, che apre il foglio su «Claude e terminale»).
  | { template: "cli_collegata"; clientName: string; connectedAt: Date; expiresAt: Date | null; link: string }
  // (8.1a) I compiti, a chi costruisce: il link porta al progetto dell'agente dello use case.
  // `responsabile`: il compito fermo detto al responsabile del caso, non a chi lo ha.
  | (CaseRef & { template: "compito_chiesto" | "compito_passato" | "compito_fermo" | "compiti_pronti"; ref: string | null; link: string; responsabile?: boolean })
  // (8.1b) Una pull request di un caso è pronta da rivedere: al team che costruisce, tranne chi ha il compito.
  | (CaseRef & { template: "pr_da_rivedere"; ref: string | null; repo: string; pr: number; link: string })
  // (8.1b) Ci sono proposte di compito da decidere (da GitHub): al team che costruisce.
  | (CaseRef & { template: "compito_proposto"; link: string })
  // (8.2a) Il banco di prova consiglia un altro modello per un ruolo: al team che costruisce, tranne chi l'ha lanciato.
  // `model`: il nome del catalogo («Claude Haiku 5.5»); null per un modello fuori dal catalogo, che non si scrive mai.
  | (CaseRef & { template: "banco_consiglio"; role: string; model: string | null; link: string })
  // (8.2a) Le evals di main sono sotto soglia o giù di almeno 5 punti (`drop`, 0..1): al team che costruisce, tranne chi
  // le ha mandate. `quality`: già scritta («80%»).
  | (CaseRef & { template: "evals_in_calo"; alert: "sotto_soglia" | "in_calo"; quality: string; drop: number | null; link: string })
  // (8.0c) A chi entra tra chi costruisce i casi di un cliente da fuori Lateral Space, e a chi ne esce: senza caso, solo
  // con l'ok ai sub-responsabili del cliente. `cases`: null per «tutti, anche quelli che si apriranno».
  | { template: "team_aggiunto"; clientName: string; cases: number | null; link: string }
  | { template: "team_tolto"; clientName: string };

// ── Aiuti ─────────────────────────────────────────────────────────────

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)$/;
const REQUEST_PATH = /^\/r\/ucr_[A-Za-z0-9_-]{32}$/;
const DASHBOARD_PATH = /^\/dashboard\/[0-9a-f-]{36}\/(casi-duso(\/[0-9a-f-]{36}(\/progetto)?)?|use-cases\/[0-9a-f-]{36}\/(proposte|progetto)|settings|account|agent-factory|contesto)$/;

/**
 * Il link è pulito? https (http solo in locale), nessuna credenziale, nessun
 * parametro né frammento, e il percorso atteso: `/r/<token>` per i referenti,
 * la pagina del caso per Lateral Space. (9b) Anche la pagina «Contesto» del
 * workspace (`/dashboard/<ws>/contesto`), e niente sotto di lei. (Rilascio 10) E
 * `/dashboard/<ws>/account`, «Il tuo account › Claude e terminale» della persona.
 */
export function checkEmailLink(link: string, kind: "referente" | "dashboard"): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error("Link dell'email non valido");
  }
  const local = LOCAL_HOSTS.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("Il link dell'email deve essere https");
  if (url.username || url.password || url.search || url.hash) throw new Error("Il link dell'email non può avere parametri");
  const path = kind === "referente" ? REQUEST_PATH : DASHBOARD_PATH;
  if (!path.test(url.pathname)) throw new Error("Percorso del link dell'email non ammesso");
  return url.toString();
}

/**
 * Link al chiarimento di una domanda: il link pulito più il solo frammento
 * `#/chiarimento/<id>`. Il frammento non arriva al server e non porta dati.
 */
export function clarificationLink(link: string, itemId: string | null | undefined): string {
  const clean = checkEmailLink(link, "referente");
  return itemId && UUID.test(itemId) ? `${clean}#/chiarimento/${itemId.toLowerCase()}` : clean;
}

const TIME_IT = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
/** I punti di qualità di un calo delle evals: «6,4». */
const POINTS_IT = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
const DAY_IT = new Intl.DateTimeFormat("it-IT", { day: "numeric", timeZone: "Europe/Rome" });

/** «il 12 novembre», ma «l'11 novembre» (e così l'1 e l'8); `al` dà «al 12» e «all'11». */
function onDate(d: Date, article: "il" | "al"): string {
  const elided = ["1", "8", "11"].includes(DAY_IT.format(d));
  return `${elided ? (article === "il" ? "l'" : "all'") : `${article} `}${formatDateIt(d)}`;
}

/**
 * Una percentuale con la preposizione, come si legge: «al 91%», ma «all'80%», «all'88,9%», «all'8%», «all'11%»,
 * «all'1%» (ottanta, otto, undici, uno) e «allo 0%».
 */
function atPercent(quality: string): string {
  const whole = /^\d+/.exec(quality)?.[0] ?? "";
  if (whole === "0") return `allo ${quality}`;
  return `${whole === "1" || whole === "11" || whole.startsWith("8") ? "all'" : "al "}${quality}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function minutesText(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 1) return null;
  return `circa ${Math.round(minutes)} ${Math.round(minutes) === 1 ? "minuto" : "minuti"}`;
}

/** (Rilascio 10, §3.12) «{Cliente}: {cosa} «{Titolo}»», al massimo 55 caratteri, mai il codice. */
function caseSubject(c: CaseRef, what: string): string {
  return emailSubject(c.clientName, what, c.caseTitle);
}

/**
 * (Rilascio 10, §3.12) La riga piccola delle email ai referenti, una sola: «Il link è solo tuo e vale fino al 26
 * novembre. Se le domande sono per un'altra persona, chiedile dalla pagina.»
 */
function linkNote(expiresAt: Date): string {
  return `Il link è solo tuo e vale ${untilDayIt(expiresAt)}. Se le domande sono per un'altra persona, chiedile dalla pagina.`;
}

/** (Rilascio 10, §3.12) Nel riepilogo una riga per caso d'uso: «Titolo — 45 % a posto · prossima tappa: …». */
function weeklyLine(c: WeeklyCaseSummary): string {
  const pieces = [`${oneLine(c.title, 120)} — ${Math.round(c.greenPct)} % a posto`];
  if (c.nextMilestone) {
    const tag = c.nextMilestone.isProposal ? " (proposta)" : c.nextMilestone.toConfirm ? " (da confermare)" : "";
    pieces.push(`prossima tappa: ${oneLine(c.nextMilestone.title, 120)}${c.nextMilestone.label ? `, ${oneLine(c.nextMilestone.label, 120)}` : ""}${tag}`);
  }
  return pieces.join(" · ");
}

// ── (9b) Il blocco «Contesto» del riepilogo (RILASCIO-9b-COSTRUZIONE.md §2.9) ──
// Dopo i casi, prima della chiusura. Una riga solo per un numero che non è zero; tutto a zero, niente blocco.

/** Un numero da scrivere: un intero positivo. */
function counted(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

const CIVIL_DAY = /^(\d{4})-\d{2}-\d{2}$/;
const SHORT_DAY_IT = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", timeZone: "Europe/Rome" });
const SHORT_DAY_YEAR_IT = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Rome" });

/** Una scadenza (AAAA-MM-GG) come nelle pagine di «Contesto»: «25 nov», con l'anno se non è quello di oggi. Non valida: null. */
function dueDay(dueOn: string, today: string): string | null {
  const match = CIVIL_DAY.exec(dueOn);
  if (!match) return null;
  const noon = new Date(`${dueOn}T12:00:00Z`);
  if (Number.isNaN(noon.getTime()) || noon.toISOString().slice(0, 10) !== dueOn) return null;
  return (match[1] === today.slice(0, 4) ? SHORT_DAY_IT : SHORT_DAY_YEAR_IT).format(noon);
}

/** Per Lateral Space: «Contesto del cliente:», i numeri e «Apri il contesto». Nessun testo di un fatto. */
function lsContextBlocks(c: WeeklyContextLs | null | undefined): Block[] {
  if (!c) return [];
  const lines: string[] = [];
  if (counted(c.novelties)) lines.push(`${c.novelties} novità questa settimana`);
  if (counted(c.toConfirm)) lines.push(plural(c.toConfirm, "proposta da confermare", "proposte da confermare"));
  if (counted(c.toCheck)) lines.push(c.toCheck === 1 ? "1 fatto da verificare (fermo da più di 6 mesi)" : `${c.toCheck} fatti da verificare (fermi da più di 6 mesi)`);
  const due = [counted(c.due.ours) ? plural(c.due.ours, "nostro", "nostri") : null, counted(c.due.theirs) ? `${c.due.theirs} del cliente` : null].filter(
    (part): part is string => part !== null,
  );
  if (due.length > 0) lines.push(`Impegni in scadenza: ${due.join(", ")}`);
  if (lines.length === 0) return [];
  return [{ p: "Contesto del cliente:" }, { list: lines }, { link: { href: checkEmailLink(c.link, "dashboard"), label: "Apri il contesto" } }];
}

/**
 * Per l'Owner del cliente: «Che cosa sappiamo del vostro lavoro:» con i fatti nuovi o aggiornati, e «Impegni del
 * vostro team in scadenza:» con al massimo tre impegni. Ogni titolo solo con le sue righe; nessun link.
 */
function ownerContextBlocks(c: WeeklyContextOwner | null | undefined): Block[] {
  if (!c) return [];
  const blocks: Block[] = [];
  if (counted(c.novelties)) {
    blocks.push({ p: "Che cosa sappiamo del vostro lavoro:" }, { list: [`${plural(c.novelties, "fatto nuovo o aggiornato", "fatti nuovi o aggiornati")} questa settimana`] });
  }
  const lines: string[] = [];
  for (const item of c.commitments.slice(0, WEEKLY_CONTEXT_COMMITMENTS_MAX)) {
    const day = dueDay(item.dueOn, c.today);
    const statement = oneLine(item.statement, 200);
    if (!day || !statement) continue;
    // «entro il 25 nov», ma «entro l'8 gen» (così l'1 e l'11); passata la data, «scaduto il …», come nella pagina.
    const article = ["1", "8", "11"].includes(String(Number(item.dueOn.slice(8, 10)))) ? "l'" : "il ";
    lines.push(`${statement} · ${item.dueOn < c.today ? "scaduto" : "entro"} ${article}${day}`);
  }
  if (lines.length > 0) blocks.push({ p: "Impegni del vostro team in scadenza:" }, { list: lines });
  return blocks;
}

// ── Testi ─────────────────────────────────────────────────────────────

/**
 * L'email di un modello, con l'intestazione (rilascio 10, §3.12: `brand`, come le email dell'area «Use case»).
 * Senza `brand` (l'anteprima di «Invia le domande») l'HTML non ha il marchio.
 */
export function renderEmail(input: EmailInput, brand?: EmailBrand): RenderedEmail {
  const out = (subject: string, blocks: Block[]) => render(subject, blocks, brand);
  switch (input.template) {
    case "richiesta_inviata": {
      const link = checkEmailLink(input.link, "referente");
      const mins = minutesText(input.minutes);
      const subject = caseSubject(input, `${plural(input.questions, "domanda", "domande")} su`);
      const blocks: Block[] = [
        { p: "Buongiorno," },
        {
          p: `per il caso d'uso «${oneLine(input.caseTitle, 120)}» di ${oneLine(input.clientName, 80)} ci servono alcune informazioni da te: ${plural(input.questions, "domanda", "domande")}${mins ? `, ${mins}` : ""}.`,
        },
        { p: "Le risposte si salvano da sole. Se non sai una cosa, scegli «Non lo so»." },
      ];
      if (input.message && input.message.trim()) blocks.push({ quote: multiLine(input.message, 1000) });
      blocks.push({ link: { href: link, label: "Apri le domande" } }, { small: linkNote(input.expiresAt) });
      return out(subject, blocks);
    }
    case "promemoria_1":
    case "promemoria_2": {
      const link = checkEmailLink(input.link, "referente");
      const second = input.template === "promemoria_2";
      const mins = minutesText(input.minutes);
      const subject = caseSubject(input, second ? "ultimo promemoria su" : "promemoria su");
      return out(subject, [
        { p: "Buongiorno," },
        {
          p: `ti ricordiamo ${input.questions === 1 ? "una domanda ancora aperta" : `${input.questions} domande ancora aperte`} per il caso d'uso «${oneLine(input.caseTitle, 120)}»${mins ? ` (${mins})` : ""}.`,
        },
        // (Rilascio 10, §3.12) Un solo «Riprendi»; l'ultimo promemoria ricorda «Non lo so». Genere neutro.
        second ? { p: "È l'ultimo promemoria: se non sai qualcosa, scegli «Non lo so»." } : { p: "Le risposte già scritte sono salvate: riprendi da lì." },
        { link: { href: link, label: "Riprendi" } },
        { small: linkNote(input.expiresAt) },
      ]);
    }
    case "segnalazione_owner": {
      const role = input.roleLabel ? `«${oneLine(input.roleLabel, 80)}»` : "indicato";
      const shown = input.items.slice(0, 30);
      const subject = caseSubject(input, "domande in attesa su");
      const blocks: Block[] = [
        { p: "Buongiorno," },
        {
          p: `per il caso d'uso «${oneLine(input.caseTitle, 120)}» ${plural(input.items.length, "domanda per il ruolo " + role + " aspetta", "domande per il ruolo " + role + " aspettano")} ancora una risposta, dopo due promemoria.`,
        },
        { p: "Puoi aiutarci a capire chi può rispondere, oppure dirci se qualche domanda non serve. Lateral Space ti contatterà per decidere insieme." },
      ];
      // (Rilascio 10, §3.12) Solo i titoli delle domande, mai le chiavi («richiesta.durata»).
      if (shown.length > 0) blocks.push({ list: shown.map((i) => oneLine(i.title, 200)) });
      if (input.items.length > shown.length) blocks.push({ small: `E altre ${input.items.length - shown.length}.` });
      return out(subject, blocks);
    }
    case "chiarimento": {
      const link = clarificationLink(input.link, input.itemId);
      const subject = caseSubject(input, "un chiarimento su");
      return out(subject, [
        { p: "Buongiorno," },
        {
          p: input.itemTitle
            ? `su una tua risposta (${oneLine(input.itemTitle, 160)}) ci serve un chiarimento. Trovi la nostra domanda nella pagina.`
            : "su una tua risposta ci serve un chiarimento. Trovi la nostra domanda nella pagina.",
        },
        { link: { href: link, label: "Rispondi" } },
        { small: linkNote(input.expiresAt) },
      ]);
    }
    case "delega": {
      if (input.audience === "delegante") {
        const subject = caseSubject(input, "domande girate su");
        return out(subject, [
          { p: "Buongiorno," },
          { p: `abbiamo mandato alla persona che hai indicato ${plural(input.questions, "domanda", "domande")} del caso d'uso «${oneLine(input.caseTitle, 120)}». Grazie.` },
          { small: "Le altre domande restano nella tua pagina." },
        ]);
      }
      const link = checkEmailLink(input.link, "referente");
      const mins = minutesText(input.minutes);
      const from = input.fromRoleLabel ? ` (${oneLine(input.fromRoleLabel, 60)})` : "";
      const subject = caseSubject(input, `${plural(input.questions, "domanda", "domande")} per te su`);
      const blocks: Block[] = [
        { p: "Buongiorno," },
        {
          p: `una persona${from} di ${oneLine(input.clientName, 80)} ti chiede di rispondere a ${plural(input.questions, "domanda", "domande")} per il caso d'uso «${oneLine(input.caseTitle, 120)}»${mins ? `, ${mins}` : ""}.`,
        },
      ];
      if (input.message && input.message.trim()) blocks.push({ quote: multiLine(input.message, 1000) });
      blocks.push({ p: "Se non sai una cosa, scegli «Non lo so»." }, { link: { href: link, label: "Apri le domande" } }, { small: linkNote(input.expiresAt) });
      return out(subject, blocks);
    }
    case "richiesta_approvazione": {
      const link = checkEmailLink(input.link, "referente");
      // (Rilascio 10, §4) «Firma», come nella pagina: mai «approvazione».
      const who = input.designation === "privacy" ? "come responsabile della firma privacy" : "come responsabile del cliente";
      const subject = caseSubject(input, "da firmare");
      return out(subject, [
        { p: "Buongiorno," },
        {
          p: `ti scriviamo ${who} per il caso d'uso «${oneLine(input.caseTitle, 120)}»: ${plural(input.pending, "decisione aspetta", "decisioni aspettano")} la tua firma.`,
        },
        { p: "Nella pagina trovi il testo esatto. Puoi firmare o rifiutare, con un motivo." },
        { link: { href: link, label: "Leggi e decidi" } },
        { small: `Il link è solo tuo e vale ${untilDayIt(input.expiresAt)}.` },
      ]);
    }
    case "riepilogo_settimanale": {
      const owner = input.audience === "owner";
      const week = oneLine(input.week, 10);
      const subject = owner && input.clientName ? emailSubject(input.clientName, "riepilogo della settimana") : emailSubject("Riepilogo dei casi d'uso", `settimana ${week}`);
      const blocks: Block[] = [{ p: "Buongiorno," }, { p: `ecco a che punto sono i casi d'uso (settimana ${week}).` }];
      if (input.cases.length === 0) blocks.push({ p: "Nessun caso attivo questa settimana." });
      // (Rilascio 10, §3.12) Una riga per caso d'uso: «Titolo — 45 % a posto · prossima tappa: …».
      for (const c of [...input.cases].sort((a, b) => a.code.localeCompare(b.code))) {
        blocks.push({ p: weeklyLine(c) });
        if (owner && c.redItems && c.redItems.length > 0) {
          blocks.push({ p: "Mancano ancora:" }, { list: c.redItems.slice(0, 10).map((i) => oneLine(i.title, 200)) });
        }
        if (!owner && c.link) blocks.push({ link: { href: checkEmailLink(c.link, "dashboard"), label: `Apri ${oneLine(c.code, 40)}` } });
      }
      // (9b) Il blocco «Contesto», per pubblico: all'Owner solo quello che è «Per tutti».
      blocks.push(...(input.audience === "owner" ? ownerContextBlocks(input.context) : lsContextBlocks(input.context)));
      blocks.push({ small: owner ? "Per non riceverlo più, scrivi a Lateral Space." : "Riepilogo interno di Lateral Space." });
      return out(subject, blocks);
    }
    case "progetto_da_approvare": {
      const link = checkEmailLink(input.link, "dashboard");
      return out(caseSubject(input, "progetto da approvare"), [
        { p: "Buongiorno," },
        { p: `l'impostazione del caso d'uso «${oneLine(input.caseTitle, 120)}» è pronta: il progetto dell'agente aspetta la tua approvazione.` },
        { p: "Nella pagina trovi le dieci scelte con il loro perché, gli strumenti nuovi, la stima e il pacchetto." },
        ...(input.tools && input.tools > 0
          ? [{ p: `Usa ${input.tools === 1 ? "uno strumento nuovo" : `${input.tools} strumenti nuovi`} per il cliente: prima dell'approvazione serve anche l'ok dell'AI Board.` }]
          : []),
        { link: { href: link, label: "Apri il progetto" } },
        { small: "Email interna di Lateral Space." },
      ]);
    }
    case "strumento_da_approvare": {
      const link = checkEmailLink(input.link, "dashboard");
      return out(caseSubject(input, "strumento da approvare"), [
        { p: "Buongiorno," },
        { p: `il progetto dell'agente del caso d'uso «${oneLine(input.caseTitle, 120)}» usa uno strumento nuovo per il cliente: prima dell'approvazione serve l'ok dell'AI Board.` },
        { p: "Se l'ok è già arrivato, registralo nella pagina con chi l'ha dato e quando." },
        { link: { href: link, label: "Apri il progetto" } },
        { small: "Email interna di Lateral Space." },
      ]);
    }
    case "pacchetto_aggiornato": {
      const link = checkEmailLink(input.link, "dashboard");
      // (Rilascio 10, §3.12) Niente «k3» nell'oggetto e nel testo: «una nuova versione del pacchetto».
      return out(caseSubject(input, "nuovo pacchetto"), [
        { p: "Buongiorno," },
        { p: `c'è una nuova versione del pacchetto del caso d'uso «${oneLine(input.caseTitle, 120)}»: la scheda è cambiata.` },
        { p: "Nel repository del caso la porta «unbundle start». Fino ad allora si lavora con il pacchetto di prima." },
        { link: { href: link, label: "Leggi il pacchetto" } },
        builderFooter(input),
      ]);
    }
    case "domanda_proposta": {
      const link = checkEmailLink(input.link, "dashboard");
      return out(caseSubject(input, "domanda proposta"), [
        { p: "Buongiorno," },
        { p: `durante la costruzione dell'agente del caso d'uso «${oneLine(input.caseTitle, 120)}» è arrivata una domanda proposta per il referente.` },
        { p: "Non parte da sola: in «Cosa serve» la aggiungi alle domande da fare, oppure la lasci stare." },
        { link: { href: link, label: "Guarda le proposte" } },
        { small: "Email interna di Lateral Space." },
      ]);
    }
    case "compito_chiesto":
    case "compito_passato":
    case "compito_fermo":
    case "compiti_pronti": {
      const link = checkEmailLink(input.link, "dashboard");
      const caso = `del caso d'uso «${oneLine(input.caseTitle, 120)}»`;
      const ref = input.ref ?? "";
      const text: Record<typeof input.template, { subject: string; lines: string[] }> = {
        compito_chiesto: {
          subject: `chiedono il compito ${ref}`.trim(),
          lines: [`qualcuno del team vorrebbe prendere il compito ${ref} ${caso}, che oggi hai tu.`, "Se va bene, passaglielo con «unbundle passa», con la nota di passaggio. Finché non lo passi, resta tuo."],
        },
        compito_passato: {
          subject: `il compito ${ref} è tuo`.replace("  ", " "),
          lines: [`il compito ${ref} ${caso} adesso è tuo.`, "La nota di passaggio (fatto, da fare, dubbi, come riprendere) la vedi con «unbundle compiti»."],
        },
        compito_fermo: input.responsabile
          ? {
              subject: `compito ${ref} fermo da giorni`.replace("  ", " "),
              lines: [
                `da almeno quattro giorni lavorativi il compito ${ref} ${caso} non ha segnali; chi lo ha ha già ricevuto un promemoria.`,
                "Parlane con chi lo ha («unbundle compiti» dice di chi è). Se serve, lascialo tu («unbundle lascia») o passalo («unbundle passa»).",
              ],
            }
          : {
              subject: `compito ${ref} fermo`.replace("  ", " "),
              lines: [
                `da almeno due giorni lavorativi il compito ${ref} ${caso} non ha segnali.`,
                "Se ci stai lavorando, riprendilo con «unbundle take»: basta questo. Se no, lascialo con una nota, così qualcun altro del team può prenderlo. Nessuno lo riassegna da solo.",
              ],
            },
        compiti_pronti: {
          subject: "compiti da prendere",
          lines: [`il progetto ${caso} è approvato e ci sono compiti da prendere.`, "«unbundle compiti» li elenca; «unbundle take» ne prende uno e prepara il ramo."],
        },
      };
      const t = text[input.template];
      return out(caseSubject(input, t.subject), [
        { p: "Buongiorno," },
        ...t.lines.map((p) => ({ p })),
        { link: { href: link, label: "Apri il progetto" } },
        builderFooter(input),
      ]);
    }
    case "pr_da_rivedere": {
      const link = checkEmailLink(input.link, "dashboard");
      const what = input.ref ? `del compito ${input.ref}` : "di un ramo del caso";
      return out(caseSubject(input, "PR da rivedere"), [
        { p: "Buongiorno," },
        { p: `la pull request #${input.pr} in ${oneLine(input.repo, 140)} ${what}, nel caso d'uso «${oneLine(input.caseTitle, 120)}», è pronta da rivedere.` },
        { p: "La trovi su GitHub; la rivede qualcuno del team che non l'ha scritta. Quando si unisce, il compito è fatto da solo." },
        { link: { href: link, label: "Apri il progetto" } },
        builderFooter(input),
      ]);
    }
    case "compito_proposto": {
      const link = checkEmailLink(input.link, "dashboard");
      return out(caseSubject(input, "proposta di compito"), [
        { p: "Buongiorno," },
        { p: `per il caso d'uso «${oneLine(input.caseTitle, 120)}» è arrivata da GitHub una proposta di compito.` },
        { p: "Da sola non diventa un compito: nei compiti del progetto la accetti (nasce il compito, da prendere) o la scarti." },
        { link: { href: link, label: "Apri il progetto" } },
        builderFooter(input),
      ]);
    }
    case "banco_consiglio": {
      const link = checkEmailLink(input.link, "dashboard");
      const advice = input.model ? `consiglia ${oneLine(input.model, 80)}.` : "consiglia un altro modello: il confronto è nel progetto.";
      return out(caseSubject(input, "un altro modello"), [
        { p: "Buongiorno," },
        { p: `per il ruolo «${oneLine(input.role, 40)}» dell'agente del caso d'uso «${oneLine(input.caseTitle, 120)}», il banco di prova ${advice}` },
        // (Rilascio 10, §3.12) La metà delle parole: il resto sta nel progetto.
        { p: "Il confronto e il comando per la pull request sono nel progetto, in «Evals e banco di prova». Il modello lo cambia una persona del team." },
        { link: { href: link, label: "Apri il progetto" } },
        builderFooter(input),
      ]);
    }
    case "evals_in_calo": {
      const link = checkEmailLink(input.link, "dashboard");
      const caso = `del caso d'uso «${oneLine(input.caseTitle, 120)}»`;
      const down = input.alert === "in_calo" && input.drop !== null;
      const points = down ? `${POINTS_IT.format((input.drop as number) * 100)} punti` : "";
      return out(caseSubject(input, down ? "evals in calo" : "evals sotto soglia"), [
        { p: "Buongiorno," },
        {
          p: down
            ? `le evals di main ${caso} sono scese di ${points} rispetto alle precedenti: ora sono ${atPercent(oneLine(input.quality, 8))}.`
            : `le evals di main ${caso} sono sotto soglia: ${oneLine(input.quality, 8)}.`,
        },
        { p: "Prima di cambiare altro, guarda quali gruppi non passano: sono nel progetto, in «Evals e banco di prova»." },
        { link: { href: link, label: "Apri il progetto" } },
        builderFooter(input),
      ]);
    }
    case "cli_collegata": {
      // Niente etichetta della CLI: la sceglie chi avvia il login, e potrebbe contenere un indirizzo o un invito.
      const link = checkEmailLink(input.link, "dashboard");
      const workspace = oneLine(input.clientName, 80);
      const until = input.expiresAt ? ` Il collegamento vale fino ${onDate(input.expiresAt, "al")}.` : "";
      return out(emailSubject(workspace, "CLI collegata al tuo account"), [
        { p: "Buongiorno," },
        { p: `${onDate(input.connectedAt, "il")} alle ${TIME_IT.format(input.connectedAt)} la CLI è stata collegata al tuo account, nel workspace «${workspace}».${until}` },
        { p: "Se l'hai collegata tu, non serve fare niente." },
        // (Rilascio 10, §3.10) Gli accessi personali stanno in «Il tuo account», dal menu sotto il nome.
        { p: "Se non la riconosci, revocala in «Il tuo account › Claude e terminale»." },
        { link: { href: link, label: "Apri il tuo account" } },
        { small: "Email automatica di Unbundle: arriva a ogni nuovo collegamento della CLI." },
      ]);
    }
    case "team_aggiunto": {
      // Nessun nome e nessun repository: chi aggiunge e i repository li dice Lateral Space, a voce o su GitHub.
      const link = checkEmailLink(input.link, "dashboard");
      const client = oneLine(input.clientName, 80);
      const which = input.cases === null ? "tutti, anche quelli che si apriranno" : input.cases === 1 ? "1 caso d'uso" : `${input.cases} casi d'uso`;
      return out(emailSubject(client, "costruisci i suoi casi d'uso"), [
        { p: "Buongiorno," },
        // (Rilascio 10, §3.12) Il corpo corto: la definizione di «caso d'uso» sta solo nelle email al referente.
        { p: `da oggi costruisci con Lateral Space i casi d'uso di ${client}: ${which}.` },
        { p: "Per cominciare: apri l'Agent Factory, collega Claude Code con «unbundle login» e prendi un compito." },
        { p: "Il progetto di ogni caso lo approva il suo responsabile; l'accesso ai repository su GitHub te lo dà Lateral Space." },
        { link: { href: link, label: "Apri l'Agent Factory" } },
        { small: "Email automatica di Unbundle." },
      ]);
    }
    case "team_tolto": {
      const client = oneLine(input.clientName, 80);
      return out(emailSubject(client, "non costruisci più i suoi casi d'uso"), [
        { p: "Buongiorno," },
        { p: `da adesso non lavori più ai casi d'uso di ${client} dall'Agent Factory. I compiti che avevi in corso sono tornati da prendere.` },
        { p: "L'accesso ai repository su GitHub lo toglie Lateral Space." },
        { small: "Email automatica di Unbundle." },
      ]);
    }
    case "modifica_richiesta": {
      const link = checkEmailLink(input.link, "dashboard");
      return out(caseSubject(input, "modifica chiesta"), [
        { p: "Buongiorno," },
        { p: `l'AI Board del cliente non ha dato l'ok agli strumenti nuovi del progetto dell'agente del caso d'uso «${oneLine(input.caseTitle, 120)}»: chiede una modifica.` },
        { p: "Nella pagina trovi che cosa va cambiato. Riapri il progetto, cambialo con il team e rimandalo in approvazione." },
        { link: { href: link, label: "Apri il progetto" } },
        { small: "Email interna di Lateral Space." },
      ]);
    }
  }
}

// ── (8.2b) Le chiavi della CI ─────────────────────────────────────────
// Un blocco a parte, in fondo al file (RILASCIO-8.2b-SPEC.md §2.6): le e-mail della chiave della CI sono interne di Lateral
// Space e senza caso, a chi gestisce le chiavi del repository (`chiave_ci_creata` tranne chi l'ha creata). Il modello del
// rilascio 10 (§3.12): l'oggetto al massimo di 55 caratteri, «{Cliente}: {cosa} «{nome}»»; il corpo corto; un pulsante
// con un verbo; il testo semplice con l'indirizzo in chiaro. Mai la chiave, il suo prefisso o chi l'ha creata: la chiave è
// del repository, non di una persona.

/** I tre modelli della chiave della CI (gli stessi di `CI_KEY_EMAIL_TEMPLATES` del modulo delle chiavi). */
export const CI_KEY_EMAIL_TEMPLATE_KEYS = ["chiave_ci_creata", "chiave_ci_scade", "chiave_ci_bloccata"] as const;

/** Le e-mail della chiave della CI. `repo`: `owner/nome`, come è registrato; il link porta all'Agent Factory del workspace. */
export type CiKeyEmailInput =
  | { template: "chiave_ci_creata"; clientName: string; repo: string; createdAt: Date; link: string }
  | { template: "chiave_ci_scade"; clientName: string; repo: string; expiresAt: Date; link: string }
  | { template: "chiave_ci_bloccata"; clientName: string; repo: string; link: string };

/** Vero per le e-mail della chiave della CI, che compone `renderCiKeyEmail` (le altre, `renderEmail`). */
export function isCiKeyEmailInput(input: { template: string }): input is CiKeyEmailInput {
  return (CI_KEY_EMAIL_TEMPLATE_KEYS as readonly string[]).includes(input.template);
}

const CI_REPO_TEXT = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

/** Il repository nei testi: intero nel corpo, senza l'organizzazione nell'oggetto. Solo `owner/nome`: mai un testo libero. */
function ciRepoText(repo: string): { full: string; name: string } {
  const full = repo.trim();
  if (!CI_REPO_TEXT.test(full)) throw new Error("Repository dell'email non valido");
  return { full, name: full.slice(full.indexOf("/") + 1) };
}

/** L'e-mail di una chiave della CI, con l'intestazione come le altre (`brand`). */
export function renderCiKeyEmail(input: CiKeyEmailInput, brand?: EmailBrand): RenderedEmail {
  const link = checkEmailLink(input.link, "dashboard");
  const client = oneLine(input.clientName, 80);
  const repo = ciRepoText(input.repo);
  const open: Block = { link: { href: link, label: "Apri l'Agent Factory" } };
  switch (input.template) {
    case "chiave_ci_creata":
      return render(
        emailSubject(client, "nuova chiave della CI", repo.name),
        [
          { p: "Buongiorno," },
          { p: `${onDate(input.createdAt, "il")} alle ${TIME_IT.format(input.createdAt)} è stata creata una chiave con cui la CI di ${repo.full} manda a Unbundle le evals di main.` },
          { p: "Se sai chi l'ha creata, non serve fare niente. Se no, revocala dall'Agent Factory." },
          open,
          { small: "Email automatica di Unbundle: arriva a ogni nuova chiave della CI." },
        ],
        brand,
      );
    case "chiave_ci_scade":
      return render(
        emailSubject(client, "chiave della CI in scadenza", repo.name),
        [
          { p: "Buongiorno," },
          { p: `${onDate(input.expiresAt, "il")} scade la chiave con cui la CI di ${repo.full} manda a Unbundle le evals di main. Da quel giorno il job «unbundle» si ferma con un errore.` },
          { p: "Ruotala dall'Agent Factory e metti la chiave nuova nel segreto UNBUNDLE_CI_TOKEN su GitHub." },
          open,
          { small: "Email interna di Lateral Space." },
        ],
        brand,
      );
    case "chiave_ci_bloccata":
      return render(
        emailSubject(client, "chiave della CI bloccata", repo.name),
        [
          { p: "Buongiorno," },
          { p: `Unbundle ha trovato la chiave della CI di ${repo.full} dentro un indirizzo web e l'ha revocata.` },
          { p: "Crea una chiave nuova dall'Agent Factory e mettila nel segreto UNBUNDLE_CI_TOKEN su GitHub. Fino ad allora le evals di main restano su GitHub." },
          open,
          { small: "Email interna di Lateral Space." },
        ],
        brand,
      );
  }
}
