/**
 * Le email di «Chiedi al referente» (SPEC §7, parola per parola): richiesta, promemoria (uno o più
 * casi d'uso della stessa persona), conferma dopo l'invio delle risposte.
 *
 * (Rilascio 5.1, decisione del titolare del 04/11/2026) Fuori dalla dashboard si dice «caso d'uso»,
 * mai «use case»: ogni oggetto comincia con il nome dell'azienda, e la richiesta dice nella prima
 * frase che cos'è un caso d'uso.
 *
 * (Rilascio 10, §3.12, D6) Il modello unico: l'oggetto al massimo di 55 caratteri, «Rondine: conferma
 * «Fatture fornitori»», con il titolo e mai il codice (`emailSubject`); il corpo al massimo di 60
 * parole: il saluto, chi e che cosa, quanto ci vuole, il pulsante con un verbo, una riga piccola («Il
 * link è solo tuo e vale fino al …»); il codice resta in piccolo in fondo («Riferimento RD-0004»).
 *
 * Regole: testo semplice più HTML minimo con il motore dei dossier (`email-render.ts`): in cima il
 * marchio «U» di Unbundle (`brand`), nessun tracciamento, il pulsante del link (l'indirizzo in chiaro
 * solo nel testo semplice). Mai il testo delle risposte, i nomi dei file, il dettaglio delle
 * esigenze, punteggi, valori o nomi di altre persone: gli unici nomi sono di chi chiede e
 * dell'azienda. Il link arriva al momento dell'invio e qui si controlla soltanto che sia pulito.
 *
 * Modulo puro.
 */
import { byDayIt, emailSubject, multiLine, oneLine, render, untilDayIt, type Block, type EmailBrand, type RenderedEmail } from "../../uc/notify/email-render.ts";
import type { ReferentReminderKind } from "../../db/use-case-hub-referents-ddl.ts";
import { REFERENT_PUBLIC_TEXT, companyLabel } from "./labels.ts";
import { checkCardLink } from "./links.ts";

type UcRef = { code: string | null; title: string };

export interface ReminderEntry {
  useCase: UcRef;
  requesterName: string;
  kind: ReferentReminderKind;
  openQuestions: number;
  newQuestions: number;
  expiresAt: Date;
  link: string;
  /** (Parte 3) Solo per un referente che è già revisore del workspace: il link alla scheda, al capitolo «Cosa serve». */
  cardLink?: string | null;
  /**
   * (Rilascio 5) Una richiesta al referente con la conferma ancora da inviare: il promemoria parla della
   * conferma, e `openQuestions` conta solo le domande (può essere zero).
   */
  checkPending?: boolean;
  /** (Rilascio 6) Di `newQuestions` («nuove»), quanti sono chiarimenti chiesti dal team. */
  clarifications?: number;
  /** (Rilascio 6) Di `newQuestions` («nuove»), quante sono risposte del team ai dubbi del referente. */
  replies?: number;
  /** (Rilascio 6) I chiarimenti del team che aspettano ancora la sua risposta (per i promemoria): mai tra le domande. */
  openClarifications?: number;
  /** («File da compilare») Per l'email «nuove»: quante domande nuove hanno un file da compilare. */
  fillInQuestions?: number;
}

export type ReferentEmailInput =
  | {
      template: "richiesta";
      company: string;
      useCase: UcRef;
      requesterName: string;
      questions: number;
      message: string | null;
      expiresAt: Date;
      link: string;
      replyToKnown: boolean;
      /** (Parte 3) Solo per un referente che è già revisore del workspace. */
      cardLink?: string | null;
      /** (Referente già iscritto) Membro del workspace che non è revisore: «Hai già un account Unbundle: …». */
      accountNotice?: boolean;
      /**
       * (Rilascio 5) «referente»: la richiesta al referente (conferma, stima e `questions` domande, anche
       * zero); «domande» o assente: i testi del rilascio 4.
       */
      kind?: "referente" | "domande";
      /** («File da compilare») Quante domande hanno un file da compilare: con almeno una, la riga `FILL_IN_LINE`. */
      fillInQuestions?: number;
    }
  /** Da 1 a n voci, nell'ordine di creazione delle richieste. replyName c'è solo se tutte le voci hanno chi chiede uguale e la risposta all'email arriva a quella persona. */
  | { template: "promemoria"; company: string; entries: ReminderEntry[]; replyToKnown: boolean; replyName: string | null; accountNotice?: boolean }
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

/**
 * «RD-0004 · Fatture fornitori», o il titolo, al massimo 120 caratteri. (Rilascio 10, D6) Le email del
 * referente non lo usano più: il titolo da solo (`titleOfUseCase`), il codice in fondo (`referenceLine`).
 */
export function labelOfUseCase(uc: UcRef): string {
  const title = uc.title ?? "";
  const code = uc.code?.trim();
  return oneLine(code ? `${code} · ${title}` : title, 120);
}

/** (Rilascio 10, D6) Il titolo del caso d'uso, senza codice, al massimo 120 caratteri. */
export function titleOfUseCase(uc: UcRef): string {
  return oneLine(uc.title ?? "", 120);
}

const name = (s: string) => oneLine(s, 120);
const company = (s: string) => oneLine(companyLabel(s), 80);

/** (Rilascio 10, D6) «Riferimento RD-0004»: il codice resta, in piccolo, in fondo all'email. */
export const REFERENCE_WORD = REFERENT_PUBLIC_TEXT.reference;

function referenceBlocks(uc: UcRef): Block[] {
  const code = uc.code?.trim();
  return code ? [{ small: `${REFERENCE_WORD} ${oneLine(code, 40)}` }] : [];
}

/**
 * (Rilascio 5.1) Che cos'è un caso d'uso, per chi lo legge per la prima volta. (Rilascio 10, §3.12) Sta
 * nella prima frase dell'email: «…, un lavoro che Rondine vuole semplificare con l'AI.».
 */
export function whatIsACaseLine(companyName: string): string {
  return `un lavoro che ${company(companyName)} vuole semplificare con l'AI`;
}

/** (Rilascio 10, §3.12) L'oggetto di ogni email al referente: «{Azienda}: {cosa} «{Titolo}»», al massimo 55 caratteri. */
const subjectFor = (companyName: string, what: string, uc?: UcRef) => emailSubject(company(companyName), what, uc ? titleOfUseCase(uc) : null);

/**
 * (Rilascio 10, §3.12) La riga piccola, una sola: «Il link è solo tuo e vale fino al 26 novembre. Per un
 * dubbio, rispondi qui.»; senza chi risponde all'email, solo la prima frase.
 */
export function linkLine(expiresAt: Date, replyKnown: boolean): string {
  const first = `Il link è solo tuo e vale ${untilDayIt(expiresAt)}.`;
  return replyKnown ? `${first} Per un dubbio, rispondi qui.` : first;
}

/** (Parte 3) La riga per un referente che è già revisore del workspace, e il suo link alla scheda. */
export const TEAM_ACCESS_LINE = "Hai già accesso a Unbundle: puoi rispondere anche dalla scheda.";
export const TEAM_ACCESS_LINE_MANY = "Hai già accesso a Unbundle: puoi rispondere anche dalle schede dei casi d'uso.";
export const TEAM_ACCESS_LINK_LABEL = "Apri la scheda";

/**
 * (Referente già iscritto) Per chi ha già un account nel workspace ma non è revisore (per esempio ha
 * partecipato a una formazione): non serve entrare, basta il link personale. Nessun link alla dashboard.
 */
export const ACCOUNT_NOTICE_LINE = "Hai già un account Unbundle: per rispondere non serve entrare, basta questo link.";
export const ACCOUNT_NOTICE_LINE_MANY = "Hai già un account Unbundle: per rispondere non serve entrare, bastano questi link.";

function teamAccessBlocks(cardLink: string | null | undefined, accountNotice = false): Block[] {
  if (cardLink) return [{ small: TEAM_ACCESS_LINE }, { link: { href: checkCardLink(cardLink), label: TEAM_ACCESS_LINK_LABEL } }];
  return accountNotice ? [{ small: ACCOUNT_NOTICE_LINE }] : [];
}

/**
 * («File da compilare») La riga dell'email quando almeno una domanda ha un file da compilare: mai il nome del file,
 * mai quali domande. Sta prima del pulsante del link.
 */
export const FILL_IN_LINE = "Alcune domande hanno un file da compilare: lo scarichi dal link.";

function fillInBlocks(questions: number | undefined): Block[] {
  return (questions ?? 0) > 0 ? [{ p: FILL_IN_LINE }] : [];
}

const questionsWord = (n: number) => (n === 1 ? "una domanda" : `${n} domande`);
const openWord = (n: number) => (n === 1 ? "una domanda aperta" : `${n} domande aperte`);

/**
 * (Rilascio 6) L'oggetto e i blocchi dell'email «nuove» di un caso d'uso solo: le domande nuove (il testo del
 * rilascio 5.1), un chiarimento, una risposta del team o più novità («Hai 2 novità …»). Li usano l'invio e
 * l'anteprima di «Chiedi al referente» quando le domande entrano nella richiesta attiva: l'anteprima è l'email vera.
 */
export function referentNewsParts(e: ReminderEntry, input: { company: string; replyToKnown: boolean; accountNotice?: boolean }): ReferentRequestParts {
  const uc = titleOfUseCase(e.useCase);
  const link = checkReferentLink(e.link);
  const small = { small: linkLine(e.expiresAt, input.replyToKnown) };
  // (Rilascio 6) Le novità del filo: un chiarimento chiesto dal team, una risposta a un tuo dubbio.
  const clarifications = Math.max(0, e.clarifications ?? 0);
  const replies = Math.max(0, e.replies ?? 0);
  const fresh = Math.max(0, e.newQuestions - clarifications - replies);
  if (clarifications + replies > 0) {
    const only = fresh === 0 && (clarifications === 0 || replies === 0) && clarifications + replies === 1;
    const what = only
      ? clarifications === 1
        ? { subject: "un chiarimento su", line: `Il team ti chiede un chiarimento sul caso d'uso «${uc}»: lo trovi con lo stesso link.`, label: "Rispondi" }
        : { subject: "una risposta su", line: `Il team ha risposto al tuo dubbio sul caso d'uso «${uc}»: trovi la risposta con lo stesso link.`, label: "Leggi la risposta" }
      : { subject: `${e.newQuestions} novità su`, line: `Hai ${e.newQuestions} novità sul caso d'uso «${uc}»: le trovi con lo stesso link.`, label: "Apri le novità" };
    return {
      subject: subjectFor(input.company, what.subject, e.useCase),
      blocks: [
        { p: "Buongiorno," },
        { p: what.line },
        ...fillInBlocks(e.fillInQuestions),
        { link: { href: link, label: what.label } },
        small,
        ...teamAccessBlocks(e.cardLink, input.accountNotice === true),
        ...referenceBlocks(e.useCase),
      ],
    };
  }
  return {
    subject: subjectFor(input.company, "nuove domande su", e.useCase),
    blocks: [
      { p: "Buongiorno," },
      { p: `${name(e.requesterName)} ha aggiunto ${questionsWord(e.newQuestions)} sul caso d'uso «${uc}»: le trovi insieme alle altre, con lo stesso link.` },
      ...fillInBlocks(e.fillInQuestions),
      { link: { href: link, label: "Apri le domande" } },
      small,
      ...teamAccessBlocks(e.cardLink, input.accountNotice === true),
      ...referenceBlocks(e.useCase),
    ],
  };
}

function singleReminder(e: ReminderEntry, input: Extract<ReferentEmailInput, { template: "promemoria" }>, brand?: EmailBrand): RenderedEmail {
  const uc = titleOfUseCase(e.useCase);
  const link = checkReferentLink(e.link);
  if (e.kind === "nuove") {
    const parts = referentNewsParts(e, input);
    return render(parts.subject, parts.blocks, brand);
  }
  const last = e.kind === "ultimo";
  const subject = subjectFor(input.company, last ? "ultimo promemoria su" : "promemoria su", e.useCase);
  // (Rilascio 10, §3.12) Un solo pulsante, «Riprendi»; l'ultimo promemoria ricorda «Non lo so».
  const closing = last ? { p: LAST_REMINDER_LINE } : { p: "Quello che hai già scritto è salvato: riprendi da lì." };
  const tail: Block[] = [
    { link: { href: link, label: "Riprendi" } },
    { small: linkLine(e.expiresAt, input.replyToKnown) },
    ...teamAccessBlocks(e.cardLink, input.accountNotice === true),
    ...referenceBlocks(e.useCase),
  ];
  const clarifications = Math.max(0, e.openClarifications ?? 0);
  if (clarifications > 0 && !e.checkPending) {
    // (Rilascio 6) Un chiarimento del team aspetta ancora la sua risposta: il promemoria parla di quello.
    const q = e.openQuestions;
    const clar = clarifications === 1 ? "un chiarimento" : `${clarifications} chiarimenti`;
    const what =
      q > 0
        ? `le tue risposte sul caso d'uso «${uc}»: ${q === 1 ? "c'è ancora una domanda aperta" : `ci sono ancora ${q} domande aperte`}, e ${clar}`
        : `la tua risposta a ${clar} sul caso d'uso «${uc}»`;
    return render(subject, [{ p: "Buongiorno," }, { p: `ti ricordiamo che ${name(e.requesterName)} aspetta ${what}.` }, closing, ...tail], brand);
  }
  if (e.checkPending) {
    // (Rilascio 5) La conferma del referente non è ancora arrivata: il promemoria parla di quella.
    const q = e.openQuestions;
    const answers = q <= 0 ? "" : q === 1 ? " e una risposta" : ` e le risposte a ${q} domande`;
    return render(subject, [{ p: "Buongiorno," }, { p: `ti ricordiamo che ${name(e.requesterName)} aspetta la tua conferma sul caso d'uso «${uc}»${answers}.` }, closing, ...tail], brand);
  }
  return render(
    subject,
    [
      { p: "Buongiorno," },
      {
        p: `ti ricordiamo che ${name(e.requesterName)} aspetta le tue risposte sul caso d'uso «${uc}»: ${e.openQuestions === 1 ? "c'è ancora una domanda aperta" : `ci sono ancora ${e.openQuestions} domande aperte`}.`,
      },
      closing,
      ...tail,
    ],
    brand,
  );
}

/** (Rilascio 10, §3.12) La chiusura dell'ultimo promemoria. */
export const LAST_REMINDER_LINE = "È l'ultimo promemoria: se non sai qualcosa, scegli «Non lo so».";

function multiReminder(input: Extract<ReferentEmailInput, { template: "promemoria" }>, brand?: EmailBrand): RenderedEmail {
  const n = input.entries.length;
  const blocks: Block[] = [
    { p: "Buongiorno," },
    { p: `ti ricordiamo che aspettiamo la tua risposta su ${n} casi d'uso di ${company(input.company)}. Quello che hai già scritto è salvato.` },
  ];
  if (input.entries.some((e) => e.cardLink)) blocks.push({ small: TEAM_ACCESS_LINE_MANY });
  else if (input.accountNotice === true) blocks.push({ small: ACCOUNT_NOTICE_LINE_MANY });
  for (const e of input.entries) {
    const uc = titleOfUseCase(e.useCase);
    // (Rilascio 5) Con la conferma ancora da inviare: «la tua conferma e {n} domande aperte», e «Riprendi»
    // come nel promemoria di un caso d'uso solo (rilascio 5.1: mai «Apri le domande» senza domande).
    // (Rilascio 6) I chiarimenti ancora da rispondere e le novità del filo: mai «0 domande aperte».
    const clar = Math.max(0, e.openClarifications ?? 0);
    const parts = [
      ...(e.checkPending ? ["la tua conferma"] : []),
      ...(e.openQuestions > 0 || (!e.checkPending && clar === 0 && e.kind !== "nuove") ? [openWord(e.openQuestions)] : []),
      ...(clar > 0 ? [clar === 1 ? "un chiarimento" : `${clar} chiarimenti`] : []),
    ];
    const thread = (e.clarifications ?? 0) + (e.replies ?? 0) > 0;
    const tail = e.kind === "nuove" ? (thread ? ", con novità per te" : ", con domande nuove") : "";
    // (Rilascio 10, §3.12) Una riga per caso d'uso, con la sua scadenza, e un pulsante solo: «Riprendi».
    const until = byDayIt(e.expiresAt);
    blocks.push(
      {
        p: parts.length || !thread ? `«${uc}», chiede ${name(e.requesterName)}: ${parts.length ? parts.join(" e ") : openWord(e.openQuestions)}${tail}, ${until}.` : `«${uc}», da ${name(e.requesterName)}: novità per te, ${until}.`,
      },
      ...(e.kind === "ultimo" ? [{ small: "È l'ultimo promemoria per questo caso d'uso." }] : []),
      { link: { href: checkReferentLink(e.link), label: "Riprendi" } },
    );
    if (e.cardLink) blocks.push({ link: { href: checkCardLink(e.cardLink), label: TEAM_ACCESS_LINK_LABEL } });
  }
  blocks.push({ small: input.replyToKnown && input.replyName ? "I link sono solo tuoi. Per un dubbio, rispondi qui." : "I link sono solo tuoi." });
  return render(subjectFor(input.company, `promemoria su ${n} casi d'uso`), blocks, brand);
}

/** L'email «richiesta» (§7) prima del rendering: l'oggetto e i blocchi, nell'ordine dell'email. */
export interface ReferentRequestParts {
  subject: string;
  blocks: Block[];
}

/**
 * (Rilascio 4) L'oggetto e i blocchi dell'email «richiesta»: li usano l'invio (`renderReferentEmail`)
 * e l'anteprima di «Controlla e invia» (`preview.ts`), così l'anteprima è l'email vera.
 */
export function referentRequestParts(input: Extract<ReferentEmailInput, { template: "richiesta" }>): ReferentRequestParts {
  const uc = titleOfUseCase(input.useCase);
  const link = checkReferentLink(input.link);
  const tail: Block[] = [
    { small: linkLine(input.expiresAt, input.replyToKnown) },
    ...teamAccessBlocks(input.cardLink, input.accountNotice === true),
    ...referenceBlocks(input.useCase),
  ];
  if (input.kind === "referente") {
    // (Rilascio 5, §5.3; rilascio 10, §9.9) La richiesta al referente: confermare il caso d'uso, le stime, le domande.
    const n = input.questions;
    const what = n <= 0 ? "la descrizione e alcune stime" : `la descrizione, alcune stime e ${n === 1 ? "una domanda" : `${n} domande`}`;
    const blocks: Block[] = [
      { p: "Buongiorno," },
      { p: `${name(input.requesterName)} ti ha indicato come referente del caso d'uso «${uc}», ${whatIsACaseLine(input.company)}.` },
    ];
    if (input.message && input.message.trim()) blocks.push({ quote: multiLine(input.message, 1000) });
    blocks.push(
      { p: `Bastano pochi minuti: confermi ${what}. Se non sai, scegli «Non lo so».` },
      ...fillInBlocks(input.fillInQuestions),
      { link: { href: link, label: "Inizia" } },
      ...tail,
    );
    return { subject: subjectFor(input.company, "conferma", input.useCase), blocks };
  }
  // (Rilascio 5, §8.4) Solo domande («Chiedi a un'altra persona», «Chiedi al referente»): l'email non
  // dice più «sei il referente», che vale solo per la richiesta al referente.
  const n = Math.max(0, input.questions);
  const blocks: Block[] = [
    { p: "Buongiorno," },
    { p: `${name(input.requesterName)} ti fa ${n === 1 ? "una domanda" : `${n} domande`} sul caso d'uso «${uc}», ${whatIsACaseLine(input.company)}.` },
  ];
  if (input.message && input.message.trim()) blocks.push({ quote: multiLine(input.message, 1000) });
  blocks.push(
    { p: "Bastano pochi minuti. Se non sai, scegli «Non lo so». Se hai un documento utile, allegalo." },
    ...fillInBlocks(input.fillInQuestions),
    { link: { href: link, label: "Apri le domande" } },
    ...tail,
  );
  return { subject: subjectFor(input.company, n === 1 ? "una domanda su" : `${n} domande su`, input.useCase), blocks };
}

/** I testi di §7. (Rilascio 5.1) Con `brand` (`emailBrand` dell'origine pubblica) l'HTML ha in cima il marchio. */
export function renderReferentEmail(input: ReferentEmailInput, brand?: EmailBrand): RenderedEmail {
  switch (input.template) {
    case "richiesta": {
      const parts = referentRequestParts(input);
      return render(parts.subject, parts.blocks, brand);
    }
    case "promemoria": {
      if (input.entries.length === 0) throw new Error("Promemoria senza voci");
      return input.entries.length === 1 ? singleReminder(input.entries[0], input, brand) : multiReminder(input, brand);
    }
    case "conferma": {
      const uc = titleOfUseCase(input.useCase);
      const one = input.submitted === 1;
      const blocks: Block[] = [
        { p: "Buongiorno," },
        { p: `grazie: abbiamo ricevuto ${one ? "la tua risposta" : "le tue risposte"} sul caso d'uso «${uc}» e ${one ? "l'abbiamo passata" : "le abbiamo passate"} a ${name(input.requesterName)}.` },
      ];
      if (input.openQuestions > 0) {
        blocks.push({
          p: `${input.openQuestions === 1 ? "Resta una domanda" : `Restano ${input.openQuestions} domande`}: puoi rispondere con lo stesso link ${byDayIt(input.expiresAt)}.`,
        });
      }
      // (Rilascio 10, §3.12) Niente frase difensiva («In questa email non ci sono le tue risposte.»).
      blocks.push(...referenceBlocks(input.useCase));
      return render(subjectFor(input.company, "grazie per", input.useCase), blocks, brand);
    }
  }
}
