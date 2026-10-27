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
  | { template: "riepilogo_settimanale"; audience: "owner" | "ls"; clientName: string | null; week: string; cases: readonly WeeklyCaseSummary[] };

// ── Aiuti ─────────────────────────────────────────────────────────────

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)$/;
const REQUEST_PATH = /^\/r\/ucr_[A-Za-z0-9_-]{32}$/;
const DASHBOARD_PATH = /^\/dashboard\/[0-9a-f-]{36}\/casi-duso(\/[0-9a-f-]{36})?$/;

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
  }
}
