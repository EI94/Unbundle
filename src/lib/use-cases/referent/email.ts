/**
 * Le email di «Chiedi al referente» (SPEC §7, parola per parola): richiesta, promemoria (uno o più
 * use case della stessa persona), conferma dopo l'invio delle risposte.
 *
 * Regole: testo semplice più HTML minimo con il motore dei dossier (`email-render.ts`): nessuna
 * immagine, nessun tracciamento, il pulsante del link più l'indirizzo in chiaro, il piè di pagina
 * «Lateral Space via Unbundle.». Mai il testo delle risposte, i nomi dei file, il dettaglio delle
 * esigenze, punteggi, valori o nomi di altre persone: gli unici nomi sono di chi chiede e
 * dell'azienda. Il link arriva al momento dell'invio e qui si controlla soltanto che sia pulito.
 *
 * Modulo puro.
 */
import { formatDateIt, multiLine, oneLine, render, type Block, type RenderedEmail } from "../../uc/notify/email-render.ts";
import type { ReferentReminderKind } from "../../db/use-case-hub-referents-ddl.ts";
import { companyLabel } from "./labels.ts";

type UcRef = { code: string | null; title: string };

export interface ReminderEntry {
  useCase: UcRef;
  requesterName: string;
  kind: ReferentReminderKind;
  openQuestions: number;
  newQuestions: number;
  expiresAt: Date;
  link: string;
}

export type ReferentEmailInput =
  | { template: "richiesta"; company: string; useCase: UcRef; requesterName: string; questions: number; message: string | null; expiresAt: Date; link: string; replyToKnown: boolean }
  /** Da 1 a n voci, nell'ordine di creazione delle richieste. replyName c'è solo se tutte le voci hanno chi chiede uguale e la risposta all'email arriva a quella persona. */
  | { template: "promemoria"; company: string; entries: ReminderEntry[]; replyToKnown: boolean; replyName: string | null }
  | { template: "conferma"; company: string; useCase: UcRef; requesterName: string; submitted: number; openQuestions: number; expiresAt: Date };

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)$/;
const LINK_PATH = /^\/rispondi\/ucq_[A-Za-z0-9_-]{32}$/;

/** Il link è pulito? https (http solo in locale), nessuna credenziale, parametro o frammento, percorso `/rispondi/ucq_…`. */
export function checkReferentLink(link: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error("Link dell'email non valido");
  }
  const local = LOCAL_HOSTS.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("Il link dell'email deve essere https");
  if (url.username || url.password || url.search || url.hash) throw new Error("Il link dell'email non può avere parametri");
  if (!LINK_PATH.test(url.pathname)) throw new Error("Percorso del link dell'email non ammesso");
  return url.toString();
}

/** «TJ-0004 · Fatture fornitori», o il titolo, al massimo 120 caratteri. */
export function labelOfUseCase(uc: UcRef): string {
  const title = uc.title ?? "";
  const code = uc.code?.trim();
  return oneLine(code ? `${code} · ${title}` : title, 120);
}

const name = (s: string) => oneLine(s, 120);
const company = (s: string) => oneLine(companyLabel(s), 80);
const subjectOf = (s: string) => oneLine(s, 200);
const expiry = (d: Date) => `Il link scade il ${formatDateIt(d)}.`;

function replyLine(known: boolean, requesterName: string): string {
  return known ? `Il link è personale: non inoltrarlo. Per un dubbio rispondi a questa email: arriva a ${name(requesterName)}.` : "Il link è personale: non inoltrarlo.";
}

const questionsWord = (n: number) => (n === 1 ? "una domanda" : `${n} domande`);
const openWord = (n: number) => (n === 1 ? "una domanda aperta" : `${n} domande aperte`);

function singleReminder(e: ReminderEntry, input: Extract<ReferentEmailInput, { template: "promemoria" }>): RenderedEmail {
  const uc = labelOfUseCase(e.useCase);
  const link = checkReferentLink(e.link);
  const reply = { small: replyLine(input.replyToKnown, e.requesterName) };
  if (e.kind === "nuove") {
    return render(subjectOf(`Nuove domande su «${uc}»`), [
      { p: "Buongiorno," },
      { p: `${name(e.requesterName)} ha aggiunto ${questionsWord(e.newQuestions)} sullo use case «${uc}»: le trovi insieme alle altre, con lo stesso link.` },
      { link: { href: link, label: "Apri le domande" } },
      { small: expiry(e.expiresAt) },
      reply,
    ]);
  }
  const last = e.kind === "ultimo";
  return render(subjectOf(`${last ? "Ultimo promemoria" : "Promemoria"}: ${openWord(e.openQuestions)} su «${uc}»`), [
    { p: "Buongiorno," },
    {
      p: `ti ricordiamo che ${name(e.requesterName)} aspetta le tue risposte sullo use case «${uc}»: ${e.openQuestions === 1 ? "c'è ancora una domanda aperta" : `ci sono ancora ${e.openQuestions} domande aperte`}.`,
    },
    last
      ? { p: "È l'ultimo promemoria che ti mandiamo. Se non hai le informazioni, scegli «Non lo so»: anche questa è una risposta utile." }
      : { p: "Quello che hai già scritto è salvato: riparti da dove eri rimasto." },
    { link: { href: link, label: "Riprendi le domande" } },
    { small: expiry(e.expiresAt) },
    reply,
  ]);
}

function multiReminder(input: Extract<ReferentEmailInput, { template: "promemoria" }>): RenderedEmail {
  const n = input.entries.length;
  const blocks: Block[] = [
    { p: "Buongiorno," },
    { p: `ti ricordiamo che ci sono ancora domande aperte su ${n} use case di ${company(input.company)}. Quello che hai già scritto è salvato.` },
  ];
  for (const e of input.entries) {
    const uc = labelOfUseCase(e.useCase);
    blocks.push(
      { p: `«${uc}», chiede ${name(e.requesterName)}: ${openWord(e.openQuestions)}${e.kind === "nuove" ? ", con domande nuove" : ""}.` },
      { small: `${expiry(e.expiresAt)}${e.kind === "ultimo" ? " È l'ultimo promemoria per questo use case." : ""}` },
      { link: { href: checkReferentLink(e.link), label: "Apri le domande" } },
    );
  }
  blocks.push({
    small:
      input.replyToKnown && input.replyName
        ? `I link sono personali: non inoltrarli. Per un dubbio rispondi a questa email: arriva a ${name(input.replyName)}.`
        : "I link sono personali: non inoltrarli.",
  });
  return render(subjectOf(`Promemoria: domande aperte su ${n} use case di ${company(input.company)}`), blocks);
}

/** I testi di §7. */
export function renderReferentEmail(input: ReferentEmailInput): RenderedEmail {
  switch (input.template) {
    case "richiesta": {
      const uc = labelOfUseCase(input.useCase);
      const link = checkReferentLink(input.link);
      const blocks: Block[] = [
        { p: "Buongiorno," },
        { p: `${name(input.requesterName)} ti chiede alcune informazioni sullo use case «${uc}» di ${company(input.company)}: ${questionsWord(input.questions)}.` },
      ];
      if (input.message && input.message.trim()) blocks.push({ quote: multiLine(input.message, 1000) });
      blocks.push(
        { p: "Bastano pochi minuti e puoi rispondere anche dal telefono. Se non sai una risposta, scegli «Non lo so». Se hai un documento utile, allegalo: prima togli nomi e dati personali." },
        { link: { href: link, label: "Apri le domande" } },
        { small: expiry(input.expiresAt) },
        { small: replyLine(input.replyToKnown, input.requesterName) },
      );
      return render(subjectOf(`${company(input.company)}: ${name(input.requesterName)} ti chiede alcune informazioni su «${uc}»`), blocks);
    }
    case "promemoria": {
      if (input.entries.length === 0) throw new Error("Promemoria senza voci");
      return input.entries.length === 1 ? singleReminder(input.entries[0], input) : multiReminder(input);
    }
    case "conferma": {
      const uc = labelOfUseCase(input.useCase);
      const one = input.submitted === 1;
      const blocks: Block[] = [
        { p: "Buongiorno," },
        { p: `grazie: abbiamo ricevuto ${one ? "la tua risposta" : "le tue risposte"} sullo use case «${uc}» e ${one ? "l'abbiamo passata" : "le abbiamo passate"} a ${name(input.requesterName)}.` },
      ];
      if (input.openQuestions > 0) {
        blocks.push({
          p: `${input.openQuestions === 1 ? "Resta una domanda" : `Restano ${input.openQuestions} domande`}: puoi rispondere con lo stesso link entro il ${formatDateIt(input.expiresAt)}.`,
        });
      }
      blocks.push({ small: "In questa email non ci sono le tue risposte." });
      return render(subjectOf(`Grazie: risposte ricevute su «${uc}»`), blocks);
    }
  }
}
