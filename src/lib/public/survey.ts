/**
 * (Rilascio 10, ondata 4 «Fuori», docs/ui-10/PROPOSTA-10.md §3.11 «Questionario `/s` e `/a`», audit Fuori §3.8) I testi
 * delle pagine del questionario AI Readiness per chi risponde: il link aperto (`/s/<token>`), il link personale
 * (`/a/<token>`: questionario per tutti, scheda dei referenti, raccolta dei casi d'uso) e l'informativa unica «Come
 * usiamo le tue risposte» (`/privacy/ai-readiness/<token>`, con «I tuoi dati ▸»).
 *
 * Per chi risponde è un «questionario», mai «Survey» né «Assessment»; «caso d'uso», mai «use case»; niente nomi dei
 * pilastri in inglese, niente lessico legale («Controller», «Retention»); genere neutro (§4, §4.2).
 *
 * Quello che si dice della privacy dice quello che fa il codice, fatto per fatto, come l'informativa di prima: le risposte
 * sono pseudonime (un codice al posto del nome), non anonime; la soglia vale per i risultati per area, mentre il profilo
 * dell'azienda usa tutte le risposte (`src/lib/ai-readiness/scoring.ts`); le risposte di una persona si vedono solo se le
 * impostazioni della rilevazione lo permettono (`allowIndividualView`, `src/lib/ai-readiness/export.ts`); il questionario
 * può essere nominativo. Modulo puro, senza import.
 */

export const SURVEY_TEXT = Object.freeze({
  /** L'anteprima del link aperto in WhatsApp, Teams o in una mail. */
  preview: Object.freeze({
    title: "Com'è l'AI nel tuo lavoro? · {Cliente}",
    titleNoClient: "Com'è l'AI nel tuo lavoro?",
    description: "Bastano {N} minuti: raccontaci come lavori oggi e dove l'AI potrebbe darti una mano. Nessuna risposta è giusta o sbagliata.",
  }),
  /** L'H1 del link aperto e del questionario per tutti. */
  title: "Com'è l'AI nel tuo lavoro?",
  /** L'H1 della scheda dei referenti (sistemi, dati, persone e processi). */
  internalTitle: "Sistemi, dati e processi dell'azienda",
  internalIntro: "Questa scheda è per chi conosce sistemi, dati o organizzazione: le tue risposte completano il quadro raccolto con il questionario.",
  /** «10 minuti · risposte pseudonime · si salva da solo»: una riga sotto l'H1. */
  facts: "{N} minuti · {modo} · si salva da solo",
  anonymous: "risposte pseudonime",
  named: "nominativo",
  /**
   * La privacy in una riga, nella testata di `/a`: le risposte pseudonime (un codice al posto del nome) e aggregate, o il
   * questionario nominativo; la soglia vale per i risultati per area. Con «Come usiamo le tue risposte ▸» accanto.
   */
  privacyAnonymous: "Le risposte sono salvate con un codice al posto del nome e aggregate: i risultati per area si vedono solo con almeno {N} {risposte}.",
  privacyNamed: "Il questionario è nominativo: i risultati per area si vedono solo con almeno {N} {risposte}.",
  answer: "risposta",
  answers: "risposte",
  /** In fondo al link personale. */
  personalLink: "Questo link è solo tuo: non inoltrarlo. Per invitare altre persone, condividi il link generale del questionario.",

  // ─── /s, il link aperto ───────────────────────────────────────────
  start: Object.freeze({
    firstName: "Nome",
    lastName: "Cognome",
    area: "La tua area",
    areaChoose: "Scegli",
    /** Dopo le aree che la rilevazione conosce già: un'area nuova, da scrivere. */
    areaOther: "Un'altra area",
    areaOtherLabel: "Quale area?",
    areaHint: "Serve solo per leggere i risultati per area.",
    start: "Inizia",
    starting: "Preparo il questionario…",
    resume: "Hai già iniziato da questo dispositivo.",
    resumeButton: "Riprendi da dove eri",
    restart: "Inizia da capo",
  }),

  // ─── /a, il questionario ──────────────────────────────────────────
  form: Object.freeze({
    /** La barra fissa in alto: un solo numero e lo stato del salvataggio. */
    progressStart: "{N} domande · si salva da solo",
    progress: "{n} di {N}",
    saved: "salvato {ora}",
    saving: "salvo…",
    unsaved: "non salvato, riprova tra poco",
    resumedAt: "Abbiamo ripreso le risposte salvate alle {ora}.",
    resumed: "Abbiamo ripreso le risposte salvate.",
    resumedDevice: "Abbiamo ripreso le risposte salvate su questo dispositivo.",
    identityTitle: "Chi sei?",
    identityText: "Questo questionario è nominativo: bastano nome e cognome, senza creare nessun account.",
    firstName: "Nome",
    lastName: "Cognome",
    missing: "Mancano alcune risposte: le trovi evidenziate.",
    missingUnsure: "Dove c'è, puoi scegliere «Non so».",
    unsure: "Non so / non applicabile",
    scaleMin: "per niente",
    scaleMax: "completamente",
    freeText: "Risposta libera, facoltativa",
    required: "obbligatoria",
    /** I consensi facoltativi, solo quando la rilevazione li chiede. */
    benchmark: "Acconsento all'uso anonimo e aggregato delle mie risposte per confronti futuri con altre aziende.",
    marketing: "Acconsento a ricevere comunicazioni facoltative sul percorso AI.",
    /** La presa visione si registra all'invio: una riga e un link, niente casella. */
    acknowledge: "Inviando le risposte confermi di aver letto",
    submit: "Invia le risposte",
    submitting: "Invio le risposte…",
    doneTitle: "Risposte inviate",
  }),
  /** Il modulo facoltativo dei casi d'uso, per il questionario per tutti (mai nella scheda dei referenti). */
  useCase: Object.freeze({
    title: "Hai un caso d'uso da proporre?",
    summary: "facoltativo",
    intro: "Un lavoro che l'AI potrebbe semplificare. Non servono competenze tecniche: bastano il problema, il risultato che vorresti e chi controlla.",
    fields: Object.freeze({
      useCaseTitle: "Come lo chiameresti?",
      useCaseFrequency: "Ogni quanto capita?",
      useCaseCurrentProcess: "Come si fa oggi",
      useCasePainPoint: "Che cosa non funziona",
      useCaseDesiredOutcome: "Che risultato vorresti",
      useCaseAiHypothesis: "Come potrebbe aiutare l'AI",
      useCaseBeneficiaries: "Quante persone ne avrebbero un vantaggio",
      useCaseRiskLevel: "Rischio: basso, medio o alto",
      useCaseDataNeeded: "Quali dati servono",
      useCaseHumanInLoop: "Che cosa deve controllare una persona",
      useCaseRiskReasoning: "Perché potrebbe essere rischioso",
      useCaseImpactEstimate: "Che effetto avrebbe",
      useCaseToolsUsed: "Strumenti usati oggi",
    }),
  }),
  /** La raccolta dei casi d'uso (il link di chi conosce un processo o il business). */
  expert: Object.freeze({
    title: "Raccontaci un caso concreto",
    intro: "Descrivi una o più situazioni di lavoro reali dove l'AI potrebbe fare la differenza. Non servono competenze tecniche: bastano la tua esperienza e qualche esempio.",
    countOne: "1 caso d'uso inviato",
    countMany: "{n} casi d'uso inviati",
    saved: "Caso d'uso salvato: aggiungine un altro, oppure tocca «Ho finito».",
    finish: "Ho finito",
    finishing: "Chiudo…",
    acknowledge: "Inviando un caso d'uso confermi di aver letto",
    missing: "Completa i campi evidenziati prima di salvare il caso d'uso.",
    choose: "Scegli",
    send: "Invia questo caso d'uso",
    add: "Aggiungi un altro caso d'uso",
    sending: "Salvo il caso d'uso…",
    oneAtATime: "Puoi inviarne quanti vuoi, uno alla volta.",
    doneTitle: "Grazie",
    doneOne: "Hai inviato 1 caso d'uso. Il team lo esaminerà per capire dove l'AI può aiutare davvero.",
    doneMany: "Hai inviato {n} casi d'uso. Il team li esaminerà per capire dove l'AI può aiutare davvero.",
  }),

  // ─── Gli stati di /s e /a ─────────────────────────────────────────
  /** Un link che non vale più: la scheda unica, con il testo per chi l'ha avuto in chat. */
  gone: "Chiedi un link nuovo a chi te l'ha mandato.",
  closed: Object.freeze({ title: "Il questionario non è aperto", body: "La raccolta non è ancora aperta, o è già chiusa." }),
  completed: Object.freeze({ title: "Hai già inviato le risposte", body: "Le risposte si inviano una volta sola: così ogni persona conta una volta." }),
  wrong: "Se pensi che sia un errore, scrivi a {contatto}.",
  /** L'errore di `/a`: le risposte salvate restano. */
  error: "Le risposte salvate restano: riprova e le ritrovi.",

  // ─── L'informativa unica ──────────────────────────────────────────
  notice: Object.freeze({
    title: "Come usiamo le tue risposte",
    who: "Chi le raccoglie",
    whoValue: "{Titolare}, con l'aiuto di {Fornitore}",
    controllerFallback: "La tua azienda",
    processorFallback: "Unbundle / Lateral Space",
    why: "Perché",
    whyValue: "Per misurare, in forma aggregata, quanto l'azienda è pronta a usare l'AI.",
    stored: "Come sono salvate",
    storedAnonymous: "Con un codice al posto del nome (pseudonimo).",
    storedNamed: "Con nome e cognome: il questionario è nominativo.",
    sees: "Chi le vede",
    /** Il profilo dell'azienda usa tutte le risposte; la soglia vale per i risultati per area. */
    seesValue: "Chi gestisce la rilevazione vede il profilo dell'azienda, fatto con tutte le risposte, e i risultati per area solo con almeno {N} {risposte}.",
    /** La vista delle risposte di una persona (`allowIndividualView`): spenta, si dice che si può accendere; accesa, lo si dice. */
    seesIndividualOff: "Le risposte di una singola persona non le vede, salvo che le impostazioni della privacy lo permettano.",
    seesIndividualOn: "Con le impostazioni di questa rilevazione può vedere anche le risposte di ogni persona.",
    basis: "Su quale base",
    basisFallback: "La indica l'azienda.",
    howLong: "Per quanto tempo",
    howLongValue: "{N} {giorni}.",
    day: "giorno",
    days: "giorni",
    questions: "Domande",
    questionsFallback: "Chiedi al referente interno.",
    full: "Leggi l'informativa completa",
    /** Un indirizzo dell'informativa completa che non è una pagina web: si mostra com'è, senza link. */
    fullText: "Informativa completa:",
    back: "Torna al questionario",
  }),
  /** «I tuoi dati ▸», sotto l'informativa del link personale. */
  data: Object.freeze({
    title: "I tuoi dati",
    sent: "Le tue risposte: inviate il {data}.",
    notSent: "Le tue risposte: non ancora inviate.",
    cases: "Casi d'uso proposti: {n}.",
    benchmarkGiven: "Hai dato il consenso al confronto con altre aziende.",
    /** Le azioni restano registrate (prima: «tracciate in audit log»). */
    tracked: "Ogni azione qui resta registrata.",
    download: "Scarica una copia",
    withdraw: "Ritira il consenso al confronto",
    /** Che cosa cambia ritirandolo. */
    withdrawNote: "Le risposte restano per la rilevazione interna, ma non servono più ai confronti futuri con altre aziende.",
    withdrawn: "Consenso al confronto ritirato.",
    erase: "Cancella le mie risposte",
    eraseAsk: "Cancelliamo i dati che ti identificano, le risposte e i testi collegati a questo link. Non si può annullare.",
    eraseConfirm: "Sì, cancella le risposte",
    cancel: "Annulla",
    eraseFailed: "Non abbiamo cancellato niente: riprova.",
    erasedTitle: "Risposte cancellate",
    erased: "I dati che ti identificavano, le risposte e i testi collegati a questo link non ci sono più: il link non mostra più dati personali.",
    /** Il link dopo una cancellazione (o sbagliato): la scheda unica, che dice anche questo. */
    gone: "Oppure le risposte sono già state cancellate. Per un aiuto, chiedi al referente interno.",
  }),
});

/** Riempie «{N}» e simili; un segnaposto senza valore resta com'è. */
function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (Object.hasOwn(values, key) ? String(values[key]) : whole));
}

/** Quanti minuti servono: mezzo minuto per domanda con le risposte pronte, almeno 2 (come la stima di oggi). */
export function surveyMinutes(scoredQuestions: number): number {
  return Math.max(2, Math.round(scoredQuestions * 0.5));
}

/** «10 minuti · risposte pseudonime · si salva da solo». */
export function surveyFacts(minutes: number, named: boolean): string {
  return fill(SURVEY_TEXT.facts, { N: minutes, modo: named ? SURVEY_TEXT.named : SURVEY_TEXT.anonymous });
}

/** «1 risposta», «5 risposte». */
function answersWord(n: number): string {
  return n === 1 ? SURVEY_TEXT.answer : SURVEY_TEXT.answers;
}

/** La privacy in una riga, nella testata del questionario: pseudonime o nominativo, e la soglia delle aree. */
export function surveyPrivacyLine(named: boolean, threshold: number): string {
  return fill(named ? SURVEY_TEXT.privacyNamed : SURVEY_TEXT.privacyAnonymous, { N: threshold, risposte: answersWord(threshold) });
}

export type SurveySaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

/** «7 di 19 · salvato 10:42»: un solo numero, e accanto lo stato del salvataggio. Prima della prima risposta il totale. */
export function surveyProgressLabel(i: { answered: number; total: number; status: SurveySaveStatus; savedTime: string | null }): string {
  const F = SURVEY_TEXT.form;
  if (i.answered === 0 && (i.status === "idle" || i.status === "saved")) return fill(F.progressStart, { N: i.total });
  const count = fill(F.progress, { n: i.answered, N: i.total });
  if (i.status === "dirty" || i.status === "saving") return `${count} · ${F.saving}`;
  if (i.status === "error") return `${count} · ${F.unsaved}`;
  return i.savedTime ? `${count} · ${fill(F.saved, { ora: i.savedTime })}` : count;
}

/** «1 caso d'uso inviato», «2 casi d'uso inviati». */
export function expertCount(n: number): string {
  return n === 1 ? SURVEY_TEXT.expert.countOne : fill(SURVEY_TEXT.expert.countMany, { n });
}

/** Il grazie della raccolta: «Hai inviato 2 casi d'uso. Il team li esaminerà…». */
export function expertDone(n: number): string {
  return n === 1 ? SURVEY_TEXT.expert.doneOne : fill(SURVEY_TEXT.expert.doneMany, { n });
}

/** Il valore di un testo di configurazione, oppure null. */
function configText(config: Readonly<Record<string, unknown>> | null | undefined, key: string): string | null {
  const value = config?.[key];
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : null;
}

/** Evita il doppio punto quando il valore finisce già con un punto (S.p.A.). */
function withStop(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

export interface SurveyNoticeRow {
  label: string;
  value: string;
}

/**
 * L'informativa unica «Come usiamo le tue risposte», con i valori della rilevazione e fatto per fatto come quella di
 * prima: chi le raccoglie (titolare e fornitore), perché (misurare in forma aggregata), come sono salvate (pseudonime, o
 * nominative), chi le vede (il profilo dell'azienda con tutte le risposte, le aree solo dalla soglia, le risposte di una
 * persona solo se le impostazioni lo permettono, e lo dice quando lo permettono), su quale base, per quanto tempo. Il
 * contatto lo mette la pagina come link.
 */
export function surveyNotice(i: { privacyConfig: Readonly<Record<string, unknown>> | null | undefined; threshold: number; named: boolean }): SurveyNoticeRow[] {
  const N = SURVEY_TEXT.notice;
  const controller = configText(i.privacyConfig, "controllerName") ?? N.controllerFallback;
  const processor = configText(i.privacyConfig, "processorName") ?? N.processorFallback;
  const basis = configText(i.privacyConfig, "legalBasis");
  const rawDays = Number(i.privacyConfig?.dataRetentionDays);
  const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.round(rawDays) : 365;
  const individual = i.privacyConfig?.allowIndividualView === true;
  return [
    { label: N.who, value: withStop(fill(N.whoValue, { Titolare: controller, Fornitore: processor })) },
    { label: N.why, value: N.whyValue },
    { label: N.stored, value: i.named ? N.storedNamed : N.storedAnonymous },
    {
      label: N.sees,
      value: `${fill(N.seesValue, { N: i.threshold, risposte: answersWord(i.threshold) })} ${individual ? N.seesIndividualOn : N.seesIndividualOff}`,
    },
    { label: N.basis, value: basis ? withStop(basis) : N.basisFallback },
    { label: N.howLong, value: fill(N.howLongValue, { N: days, giorni: days === 1 ? N.day : N.days }) },
  ];
}

/**
 * L'indirizzo dell'informativa completa del cliente (`privacyNoticeUrl`), come si mostra: una pagina web resta un link;
 * un indirizzo scritto senza «https://» («www.cliente.it/privacy») diventa un link con «https://» davanti (prima il
 * browser lo leggeva come un indirizzo di Unbundle, e non si apriva); un indirizzo email resta un link email; il resto
 * si mostra com'è, come testo. Mai un link con un altro schema («javascript:», «data:»): il browser lo eseguirebbe.
 */
export function noticeUrlOf(raw: unknown): { href: string } | { text: string } | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return { href: value };
  if (/^mailto:[^\s]+@[^\s]+$/i.test(value)) return { href: value };
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(value)) return { href: `mailto:${value}` };
  if (/^[^\s:/?#]+\.[a-z]{2,}(?:[/?#][^\s]*)?$/i.test(value)) return { href: `https://${value}` };
  if (/^[a-z][a-z0-9+.-]*:(?!\s)/i.test(value)) return null;
  return { text: value };
}

/** Il segno che la cancellazione lascia al posto dell'area (`anonymizeAiReadinessRespondentByTokenHash`): non è un'area. */
const ERASED_AREA = "Privacy deleted";

/**
 * «La tua area» sul link aperto: le aree che la rilevazione conosce già (quelle delle persone invitate o già iscritte),
 * scritte come sono, così chi sceglie finisce nella stessa area e nessuna si divide in due (i risultati per area
 * raggruppano per il testo esatto, senza spazi in testa e in coda: `src/lib/ai-readiness/scoring.ts`). Senza aree, il
 * campo da scrivere di prima. Niente vuoti, niente doppioni, niente aree che il server rifiuterebbe (meno di 2 caratteri),
 * niente segno della cancellazione. In ordine alfabetico.
 */
export function surveyAreas(units: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const unit of units) {
    const area = typeof unit === "string" ? unit.trim() : "";
    if (area.length < 2 || area === ERASED_AREA) continue;
    seen.add(area);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "it"));
}

/** La data di invio delle risposte: «12 novembre 2026», a Roma. */
export function surveyDay(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long", year: "numeric" }).format(d);
}

/** Riempie i testi del questionario. */
export const fillSurvey = fill;
