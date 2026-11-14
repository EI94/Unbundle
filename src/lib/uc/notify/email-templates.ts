/**
 * Testi delle email della sezione «Casi d'uso» (PIANO §7.1), in italiano semplice.
 *
 * - Testo semplice più HTML minimo: **nessuna immagine, nessun pixel, nessuna
 *   risorsa esterna**. Il tracciamento di aperture e clic va spento sul dominio
 *   Resend (nota in `AMBIENTE.md`): riscriverebbe i link `/r/`.
 * - Nessun valore delle risposte, nessun dato riservato, nessun nome di persona:
 *   cliente, caso, conteggi, minuti stimati, scadenza, etichette di ruolo,
 *   chiavi e titoli delle voci (solo per l'Owner).
 * - Il link arriva al momento dell'invio (`dispatch`), mai dalla coda: qui si
 *   controlla solo che sia un link pulito, senza parametri. L'unico frammento
 *   ammesso è `#/chiarimento/<id>`, che apre il chiarimento (DESIGN §4.3 R8).
 * - Le email ai referenti passano il controllo dei testi (`copy-guard`): niente
 *   chiavi, codici o gergo.
 *
 * Modulo puro.
 */
import type { ItemStatus } from "../vocab.ts";
import { STATUS_LABELS } from "../export/format.ts";
import { UUID } from "../ids.ts";
import { formatDateIt, multiLine, oneLine, render, type Block, type RenderedEmail } from "./email-render.ts";

// Il motore di composizione (testo semplice più HTML minimo, piè di pagina) sta in `email-render.ts`:
// lo usano anche le email di «Chiedi al referente». Qui restano esportati come prima.
export { UC_EMAIL_SENDER_NAME, escapeHtml, formatDateIt, type RenderedEmail } from "./email-render.ts";

interface CaseRef {
  /** Nome del cliente (workspace o organizzazione). */
  clientName: string;
  caseTitle: string;
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
  | { template: "riepilogo_settimanale"; audience: "owner" | "ls"; clientName: string | null; week: string; cases: readonly WeeklyCaseSummary[] }
  | (CaseRef & { template: "progetto_da_approvare" | "strumento_da_approvare" | "pacchetto_aggiornato" | "modifica_richiesta" | "domanda_proposta"; version: number | null; link: string; tools?: number })
  // (8.0b) Alla persona: una CLI di Unbundle è collegata al suo account nel workspace. Il link porta a Impostazioni.
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
  | (CaseRef & { template: "evals_in_calo"; alert: "sotto_soglia" | "in_calo"; quality: string; drop: number | null; link: string });

// ── Aiuti ─────────────────────────────────────────────────────────────

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)$/;
const REQUEST_PATH = /^\/r\/ucr_[A-Za-z0-9_-]{32}$/;
const DASHBOARD_PATH = /^\/dashboard\/[0-9a-f-]{36}\/(casi-duso(\/[0-9a-f-]{36}(\/progetto)?)?|use-cases\/[0-9a-f-]{36}\/(proposte|progetto)|settings)$/;

/**
 * Il link è pulito? https (http solo in locale), nessuna credenziale, nessun
 * parametro né frammento, e il percorso atteso: `/r/<token>` per i referenti,
 * la pagina del caso per Lateral Space.
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

function subjectOf(parts: string): string {
  return oneLine(parts, 200);
}

function caseLabel(c: CaseRef): string {
  return `${oneLine(c.clientName, 80)} · ${oneLine(c.caseTitle, 80)}`;
}

const PRIVACY_NOTE = "Il link è personale: non inoltrarlo. Se le domande sono per un'altra persona, dalla pagina puoi chiedere a un collega.";

function expiryNote(expiresAt: Date): string {
  return `Il link scade il ${formatDateIt(expiresAt)}.`;
}

const SEMAFORO_ORDER: readonly ItemStatus[] = ["validata", "non_applicabile", "in_verifica", "parziale", "chiesta", "mancante", "bloccata", "da_chiedere"];

function barText(c: WeeklyCaseSummary): string {
  const parts = SEMAFORO_ORDER.map((s) => `${STATUS_LABELS[s]} ${c.counts[s] ?? 0}`);
  return `${Math.round(c.greenPct)}% verde su ${c.total} voci (${parts.join(" · ")})`;
}

// ── Testi ─────────────────────────────────────────────────────────────

export function renderEmail(input: EmailInput): RenderedEmail {
  switch (input.template) {
    case "richiesta_inviata": {
      const link = checkEmailLink(input.link, "referente");
      const mins = minutesText(input.minutes);
      const subject = subjectOf(`${caseLabel(input)}: ${plural(input.questions, "domanda", "domande")} per te${mins ? `, ${mins}` : ""}`);
      const blocks: Block[] = [
        { p: "Buongiorno," },
        {
          p: `per il caso d'uso «${oneLine(input.caseTitle, 120)}» di ${oneLine(input.clientName, 80)} ci servono alcune informazioni da te: ${plural(input.questions, "domanda", "domande")}${mins ? `, ${mins}` : ""}.`,
        },
        { p: "Puoi rispondere anche dal telefono. Le risposte si salvano da sole. Se non sai una risposta, dillo pure: «Non lo so» è una risposta valida." },
      ];
      if (input.message && input.message.trim()) blocks.push({ quote: multiLine(input.message, 1000) });
      blocks.push({ link: { href: link, label: "Apri le domande" } }, { small: expiryNote(input.expiresAt) }, { small: PRIVACY_NOTE });
      return render(subject, blocks);
    }
    case "promemoria_1":
    case "promemoria_2": {
      const link = checkEmailLink(input.link, "referente");
      const second = input.template === "promemoria_2";
      const mins = minutesText(input.minutes);
      const subject = subjectOf(`${second ? "Ultimo promemoria" : "Promemoria"} · ${caseLabel(input)}: ${plural(input.questions, "domanda aperta", "domande aperte")}`);
      return render(subject, [
        { p: "Buongiorno," },
        {
          p: `ti ricordiamo ${input.questions === 1 ? "una domanda ancora aperta" : `${input.questions} domande ancora aperte`} per il caso d'uso «${oneLine(input.caseTitle, 120)}»${mins ? ` (${mins})` : ""}.`,
        },
        second
          ? { p: "È l'ultimo promemoria che ti mandiamo. Se non hai le informazioni, puoi rispondere «Non lo so» o chiedere a un collega." }
          : { p: "Ripartirai da dove eri rimasto: le risposte già scritte sono salvate." },
        { link: { href: link, label: "Riprendi le domande" } },
        { small: expiryNote(input.expiresAt) },
        { small: PRIVACY_NOTE },
      ]);
    }
    case "segnalazione_owner": {
      const role = input.roleLabel ? `«${oneLine(input.roleLabel, 80)}»` : "indicato";
      const shown = input.items.slice(0, 30);
      const subject = subjectOf(`${caseLabel(input)}: domande in attesa per il ruolo ${input.roleLabel ? oneLine(input.roleLabel, 60) : "indicato"}`);
      const blocks: Block[] = [
        { p: "Buongiorno," },
        {
          p: `per il caso d'uso «${oneLine(input.caseTitle, 120)}» ${plural(input.items.length, "domanda per il ruolo " + role + " aspetta", "domande per il ruolo " + role + " aspettano")} ancora una risposta, dopo due promemoria.`,
        },
        { p: "Puoi aiutarci a capire chi può rispondere, oppure dirci se qualche domanda non serve. Lateral Space ti contatterà per decidere insieme." },
      ];
      if (shown.length > 0) blocks.push({ list: shown.map((i) => `${oneLine(i.key, 160)} · ${oneLine(i.title, 200)}`) });
      if (input.items.length > shown.length) blocks.push({ small: `E altre ${input.items.length - shown.length}.` });
      blocks.push({ small: "In questa email ci sono solo le domande, nessuna risposta." });
      return render(subject, blocks);
    }
    case "chiarimento": {
      const link = clarificationLink(input.link, input.itemId);
      const subject = subjectOf(`${caseLabel(input)}: ti chiediamo un chiarimento`);
      return render(subject, [
        { p: "Buongiorno," },
        {
          p: input.itemTitle
            ? `su una tua risposta (${oneLine(input.itemTitle, 160)}) ci serve un chiarimento. Trovi la nostra domanda nella pagina.`
            : "su una tua risposta ci serve un chiarimento. Trovi la nostra domanda nella pagina.",
        },
        { link: { href: link, label: "Leggi la domanda e rispondi" } },
        { small: expiryNote(input.expiresAt) },
        { small: PRIVACY_NOTE },
      ]);
    }
    case "delega": {
      if (input.audience === "delegante") {
        const subject = subjectOf(`${caseLabel(input)}: abbiamo girato le domande al collega`);
        return render(subject, [
          { p: "Buongiorno," },
          { p: `abbiamo mandato al collega che hai indicato ${plural(input.questions, "domanda", "domande")} del caso d'uso «${oneLine(input.caseTitle, 120)}». Grazie.` },
          { small: "Le altre domande restano nella tua pagina." },
        ]);
      }
      const link = checkEmailLink(input.link, "referente");
      const mins = minutesText(input.minutes);
      const from = input.fromRoleLabel ? ` (${oneLine(input.fromRoleLabel, 60)})` : "";
      const subject = subjectOf(`${caseLabel(input)}: ${plural(input.questions, "domanda", "domande")} per te da un collega`);
      const blocks: Block[] = [
        { p: "Buongiorno," },
        {
          p: `un collega${from} ti chiede di rispondere a ${plural(input.questions, "domanda", "domande")} per il caso d'uso «${oneLine(input.caseTitle, 120)}» di ${oneLine(input.clientName, 80)}${mins ? `, ${mins}` : ""}.`,
        },
      ];
      if (input.message && input.message.trim()) blocks.push({ quote: multiLine(input.message, 1000) });
      blocks.push(
        { p: "Se non sai una risposta, dillo pure: «Non lo so» è una risposta valida." },
        { link: { href: link, label: "Apri le domande" } },
        { small: expiryNote(input.expiresAt) },
        { small: PRIVACY_NOTE },
      );
      return render(subject, blocks);
    }
    case "richiesta_approvazione": {
      const link = checkEmailLink(input.link, "referente");
      const who = input.designation === "privacy" ? "come responsabile dell'approvazione privacy" : "come responsabile del cliente";
      const subject = subjectOf(`${caseLabel(input)}: ${plural(input.pending, "approvazione", "approvazioni")} da dare`);
      return render(subject, [
        { p: "Buongiorno," },
        {
          p: `ti scriviamo ${who} per il caso d'uso «${oneLine(input.caseTitle, 120)}»: ${plural(input.pending, "decisione aspetta", "decisioni aspettano")} la tua approvazione.`,
        },
        { p: "Nella pagina trovi il testo esatto da approvare. Puoi approvare o non approvare, con un motivo." },
        { link: { href: link, label: "Leggi e decidi" } },
        { small: expiryNote(input.expiresAt) },
        { small: "Questo link è solo per te: non inoltrarlo." },
      ]);
    }
    case "riepilogo_settimanale": {
      const owner = input.audience === "owner";
      const week = oneLine(input.week, 10);
      const subject = subjectOf(
        owner && input.clientName ? `Riepilogo settimanale · ${oneLine(input.clientName, 80)}: casi d'uso` : `Riepilogo settimanale dei casi d'uso · ${week}`,
      );
      const blocks: Block[] = [{ p: "Buongiorno," }, { p: `ecco a che punto sono i casi d'uso (settimana ${week}).` }];
      if (input.cases.length === 0) blocks.push({ p: "Nessun caso attivo questa settimana." });
      for (const c of [...input.cases].sort((a, b) => a.code.localeCompare(b.code))) {
        const lines = [barText(c)];
        if (c.g1) lines.push(`Per avviare lo sviluppo: ${c.g1.ok} di ${c.g1.required} voci obbligatorie a posto.`);
        if (c.nextMilestone) {
          const tag = c.nextMilestone.isProposal ? " (proposta)" : c.nextMilestone.toConfirm ? " (da confermare)" : "";
          lines.push(`Prossima tappa: ${oneLine(c.nextMilestone.title, 120)}${c.nextMilestone.label ? `, ${oneLine(c.nextMilestone.label, 120)}` : ""}${tag}.`);
        }
        blocks.push({ p: `${oneLine(c.code, 40)} · ${oneLine(c.title, 120)}` }, { list: lines });
        if (owner && c.redItems && c.redItems.length > 0) {
          blocks.push({ p: "Voci mancanti:" }, { list: c.redItems.slice(0, 10).map((i) => `${oneLine(i.key, 160)} · ${oneLine(i.title, 200)}`) });
        }
        if (!owner && c.link) blocks.push({ link: { href: checkEmailLink(c.link, "dashboard"), label: `Apri ${oneLine(c.code, 40)}` } });
      }
      blocks.push({ small: owner ? "Per non ricevere più questo riepilogo, scrivi a Lateral Space." : "Riepilogo interno di Lateral Space." });
      return render(subject, blocks);
    }
    case "progetto_da_approvare": {
      const link = checkEmailLink(input.link, "dashboard");
      const v = input.version ? ` (versione ${input.version})` : "";
      return render(subjectOf(`${caseLabel(input)}: progetto dell'agente da approvare`), [
        { p: "Buongiorno," },
        { p: `l'impostazione del caso d'uso «${oneLine(input.caseTitle, 120)}» è pronta: il progetto dell'agente${v} aspetta la tua approvazione.` },
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
      return render(subjectOf(`${caseLabel(input)}: strumento nuovo da far approvare`), [
        { p: "Buongiorno," },
        { p: `il progetto dell'agente del caso d'uso «${oneLine(input.caseTitle, 120)}» usa uno strumento nuovo per il cliente: prima dell'approvazione serve l'ok dell'AI Board.` },
        { p: "Se l'ok è già arrivato, registralo nella pagina con chi l'ha dato e quando." },
        { link: { href: link, label: "Apri il progetto" } },
        { small: "Email interna di Lateral Space." },
      ]);
    }
    case "pacchetto_aggiornato": {
      const link = checkEmailLink(input.link, "dashboard");
      const k = input.version ? `k${input.version}` : "una versione nuova";
      return render(subjectOf(`${caseLabel(input)}: pacchetto ${input.version ? `k${input.version}` : "aggiornato"}`), [
        { p: "Buongiorno," },
        { p: `c'è ${k} del pacchetto del caso d'uso «${oneLine(input.caseTitle, 120)}»: la scheda è cambiata.` },
        { p: "Nel repository del caso lo porta «unbundle start». Fino ad allora il coding agent legge il pacchetto di prima." },
        { link: { href: link, label: "Leggi il pacchetto" } },
        { small: "Email interna di Lateral Space." },
      ]);
    }
    case "domanda_proposta": {
      const link = checkEmailLink(input.link, "dashboard");
      return render(subjectOf(`${caseLabel(input)}: un coding agent propone una domanda`), [
        { p: "Buongiorno," },
        { p: `mentre costruisce l'agente del caso d'uso «${oneLine(input.caseTitle, 120)}», un coding agent ha proposto una domanda per il referente.` },
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
          subject: `qualcuno del team chiede il compito ${ref}`,
          lines: [`qualcuno del team vorrebbe prendere il compito ${ref} ${caso}, che oggi hai tu.`, "Se va bene, passaglielo con «unbundle passa», con la nota di passaggio. Finché non lo passi, resta tuo."],
        },
        compito_passato: {
          subject: `ti hanno passato il compito ${ref}`,
          lines: [`il compito ${ref} ${caso} adesso è tuo.`, "La nota di passaggio (fatto, da fare, dubbi, come riprendere) la vedi con «unbundle compiti»."],
        },
        compito_fermo: input.responsabile
          ? {
              subject: `il compito ${ref} è fermo da giorni`,
              lines: [
                `da almeno quattro giorni lavorativi il compito ${ref} ${caso} non ha segnali; chi lo ha ha già ricevuto un promemoria.`,
                "Parlane con chi lo ha («unbundle compiti» dice di chi è). Se serve, lascialo tu con una nota («unbundle lascia») o passalo («unbundle passa»). Nessuno lo riassegna da solo.",
              ],
            }
          : {
              subject: `il compito ${ref} è fermo`,
              lines: [
                `da almeno due giorni lavorativi il compito ${ref} ${caso} non ha segnali.`,
                "Se ci stai lavorando, riprendilo con «unbundle take»: basta questo. Se no, lascialo con una nota, così qualcun altro del team può prenderlo. Nessuno lo riassegna da solo.",
              ],
            },
        compiti_pronti: {
          subject: "ci sono compiti da prendere",
          lines: [`il progetto ${caso} è approvato e ci sono compiti da prendere.`, "«unbundle compiti» li elenca; «unbundle take» ne prende uno e prepara il ramo."],
        },
      };
      const t = text[input.template];
      return render(subjectOf(`${caseLabel(input)}: ${t.subject}`), [
        { p: "Buongiorno," },
        ...t.lines.map((p) => ({ p })),
        { link: { href: link, label: "Apri il progetto" } },
        { small: "Email interna di Lateral Space." },
      ]);
    }
    case "pr_da_rivedere": {
      const link = checkEmailLink(input.link, "dashboard");
      const what = input.ref ? `del compito ${input.ref}` : "di un ramo del caso";
      return render(subjectOf(`${caseLabel(input)}: una pull request da rivedere`), [
        { p: "Buongiorno," },
        { p: `la pull request #${input.pr} in ${oneLine(input.repo, 140)} ${what}, nel caso d'uso «${oneLine(input.caseTitle, 120)}», è pronta da rivedere.` },
        { p: "La trovi su GitHub; la rivede qualcuno del team che non l'ha scritta. Quando si unisce, il compito è fatto da solo." },
        { link: { href: link, label: "Apri il progetto" } },
        { small: "Email interna di Lateral Space." },
      ]);
    }
    case "compito_proposto": {
      const link = checkEmailLink(input.link, "dashboard");
      return render(subjectOf(`${caseLabel(input)}: una proposta di compito`), [
        { p: "Buongiorno," },
        { p: `per il caso d'uso «${oneLine(input.caseTitle, 120)}» è arrivata da GitHub una proposta di compito.` },
        { p: "Da sola non diventa un compito: nei compiti del progetto la accetti (nasce il compito, da prendere) o la scarti." },
        { link: { href: link, label: "Apri il progetto" } },
        { small: "Email interna di Lateral Space." },
      ]);
    }
    case "banco_consiglio": {
      const link = checkEmailLink(input.link, "dashboard");
      const advice = input.model ? `consiglia ${oneLine(input.model, 80)}.` : "consiglia un altro modello: il confronto è nel progetto.";
      return render(subjectOf(`${caseLabel(input)}: il banco di prova consiglia un altro modello`), [
        { p: "Buongiorno," },
        { p: `per il ruolo «${oneLine(input.role, 40)}» dell'agente del caso d'uso «${oneLine(input.caseTitle, 120)}», il banco di prova ${advice}` },
        { p: "Nel progetto, in «Evals e banco di prova», trovi il confronto (qualità, costo per 1.000 esecuzioni, tempi) e il comando per la pull request di una riga. Il modello lo cambia una persona del team, con la PR." },
        { link: { href: link, label: "Apri il progetto" } },
        { small: "Email interna di Lateral Space." },
      ]);
    }
    case "evals_in_calo": {
      const link = checkEmailLink(input.link, "dashboard");
      const caso = `del caso d'uso «${oneLine(input.caseTitle, 120)}»`;
      const down = input.alert === "in_calo" && input.drop !== null;
      const points = down ? `${POINTS_IT.format((input.drop as number) * 100)} punti` : "";
      return render(subjectOf(`${caseLabel(input)}: ${down ? "le evals di main sono scese" : "le evals di main sono sotto soglia"}`), [
        { p: "Buongiorno," },
        {
          p: down
            ? `le evals di main ${caso} sono scese di ${points} rispetto alle precedenti: ora sono ${atPercent(oneLine(input.quality, 8))}.`
            : `le evals di main ${caso} sono sotto soglia: ${oneLine(input.quality, 8)}.`,
        },
        {
          p: "Prima di cambiare altro, guarda quali gruppi non passano: nel progetto, in «Evals e banco di prova», ci sono i gruppi e l'andamento; prova per prova con «npm run eval» nel repository del caso.",
        },
        { link: { href: link, label: "Apri il progetto" } },
        { small: "Email interna di Lateral Space." },
      ]);
    }
    case "cli_collegata": {
      // Niente etichetta della CLI: la sceglie chi avvia il login, e potrebbe contenere un indirizzo o un invito.
      const link = checkEmailLink(input.link, "dashboard");
      const workspace = oneLine(input.clientName, 80);
      const until = input.expiresAt ? ` Il collegamento vale fino ${onDate(input.expiresAt, "al")}.` : "";
      return render(subjectOf(`${workspace}: la CLI di Unbundle è collegata al tuo account`), [
        { p: "Buongiorno," },
        { p: `${onDate(input.connectedAt, "il")} alle ${TIME_IT.format(input.connectedAt)} la CLI di Unbundle è stata collegata al tuo account, nel workspace «${workspace}».${until}` },
        { p: "Se l'hai collegata tu, non serve fare niente." },
        { p: "Se non la riconosci, revocala in Impostazioni › CLI di Unbundle: lì trovi tutti i collegamenti della CLI al tuo account in questo workspace." },
        { link: { href: link, label: "Apri Impostazioni" } },
        { small: "Email automatica di Unbundle: arriva a ogni nuovo collegamento della CLI." },
      ]);
    }
    case "modifica_richiesta": {
      const link = checkEmailLink(input.link, "dashboard");
      const v = input.version ? ` (versione ${input.version})` : "";
      return render(subjectOf(`${caseLabel(input)}: l'AI Board chiede una modifica`), [
        { p: "Buongiorno," },
        { p: `l'AI Board del cliente non ha dato l'ok agli strumenti nuovi del progetto dell'agente${v} del caso d'uso «${oneLine(input.caseTitle, 120)}»: chiede una modifica.` },
        { p: "Nella pagina trovi che cosa va cambiato. Riapri il progetto, cambialo con il team e rimandalo in approvazione." },
        { link: { href: link, label: "Apri il progetto" } },
        { small: "Email interna di Lateral Space." },
      ]);
    }
  }
}
