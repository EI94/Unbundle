/**
 * (Rilascio 10, D5) Il kit del referente: le parole che `/rispondi` (la richiesta dello use case) e `/r` (il link
 * della realizzazione) dicono uguali, in un file solo, e l'informativa calma comune alle due pagine.
 *
 * - **Le parole** (`REFERENT_KIT_TEXT`): il marchio con la riga del cliente, «Non lo so» (mai «Non ce l'ho»),
 *   «Iniziamo», «Avanti» senza freccia, la scheda unica di un link che non vale più e quella di un errore con il
 *   solo «Riprova», un solo numero di avanzamento («2 di 5 · salvato»), «Come usiamo le tue risposte»,
 *   «Riferimento XX-0024». Fuori dalla dashboard: «caso d'uso», mai «use case» (copy guard `esterno`).
 * - **L'informativa** (`REFERENT_KIT_NOTICE`, versione `ref-2026-11-1`): lo stile calmo del 04/11 (la privacy si dice
 *   una volta, niente caselle né parole che spaventano), valida per le due pagine: Lateral Space per conto
 *   dell'azienda, per valutare e realizzare i casi d'uso; chi vede le risposte senza il nome di una persona. Con
 *   «Iniziamo» la pagina manda la versione come prova del testo mostrato (rilascio 9b, `shown`). Testo da far
 *   approvare dal titolare prima del rilascio.
 *
 * Modulo puro, senza import: lo usano le pagine, i componenti client, le email e i test.
 */

/** Riempie `{chiave}` con i valori dati; i segnaposto senza valore restano com'erano. */
function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (whole, key: string) => (Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole));
}

export const REFERENT_KIT_TEXT = Object.freeze({
  /** In alto, non cliccabile: il marchio e, quando il cliente è noto, «Cliente Demo · con Lateral Space». */
  brand: "Unbundle",
  brandMark: "U",
  clientLine: "{Cliente} · con Lateral Space",
  /** La stessa parola per un numero, un testo e un file (D5). */
  dontKnow: "Non lo so",
  start: "Iniziamo",
  next: "Avanti",
  back: "Indietro",
  send: "Invia",
  confirmYes: "Sì, è così",
  confirmFix: "Correggi",
  askOther: "Chiedi a un'altra persona",
  /** In fondo alla pagina: l'informativa intera, a un tocco. */
  privacyFooter: "Come usiamo le tue risposte",
  /** (D6) Il codice del caso d'uso, in piccolo in fondo alla pagina e all'email: «Riferimento XX-0024». */
  reference: "Riferimento",
  /** La scheda unica di un link che non vale più: sbagliato, revocato o scaduto. */
  linkGone: Object.freeze({ title: "Questo link non vale più.", text: "Rispondi all'email che hai ricevuto: arriva a chi ti ha scritto." }),
  /** La scheda unica di un errore: una riga calma e un solo pulsante, «Riprova» (le stesse parole di `/r`). */
  error: Object.freeze({ title: "Questa pagina non si è caricata.", text: "Le risposte che hai già inviato sono salve.", retry: "Riprova" }),
  /** Un solo numero di avanzamento, con lo stato del salvataggio accanto: «2 di 5 · salvato». */
  progress: "{k} di {n}",
  progressSaved: "{k} di {n} · salvato",
  progressSaving: "{k} di {n} · salvataggio…",
  generalDoubt: "Hai un dubbio sul caso d'uso?",
  loading: "Caricamento…",
});

/** «Cliente Demo · con Lateral Space», oppure null senza il nome del cliente. */
export function kitClientLine(client: string | null | undefined): string | null {
  const clean = typeof client === "string" ? client.replace(/\s+/g, " ").trim() : "";
  return clean ? fill(REFERENT_KIT_TEXT.clientLine, { Cliente: clean }) : null;
}

/** «2 di 5 · salvato», «2 di 5 · salvataggio…», o solo «2 di 5» (un errore lo dice la domanda). */
export function kitProgress(done: number, total: number, save: "saved" | "saving" | null): string {
  const template = save === "saved" ? REFERENT_KIT_TEXT.progressSaved : save === "saving" ? REFERENT_KIT_TEXT.progressSaving : REFERENT_KIT_TEXT.progress;
  return fill(template, { k: done, n: total });
}

// ─── L'informativa comune ────────────────────────────────────────────

/**
 * (Rilascio 10, D5) L'informativa calma comune a `/rispondi` e `/r`, versione `ref-2026-11-1`. Due livelli: sopra una
 * riga e due punti, il testo intero a un tocco. È quella di `/rispondi` (`ucq-2026-11-3`, rilascio 9b) resa valida per le
 * due pagine: «per valutare e realizzare i casi d'uso» (prima «preparare»), chi vede le risposte senza il nome di una
 * persona («le persone di {Azienda} che lavorano ai casi d'uso»: prima «chi valuta i casi d'uso» e il nome di chi ha
 * chiesto). Il resto è parola per parola, compresa la frase dell'AI (`REFERENT_AI_NOTICE_LINE`) che fa leggere le
 * risposte all'aiuto dell'AI e a «Contesto».
 *
 * Segnaposto: `{Azienda}` (il nome del workspace), `{data}` (la scadenza del link, «18 dicembre 2026»), `{contatto}`
 * (l'indirizzo per i diritti). Nessun segnaposto di una persona.
 */
export const REFERENT_KIT_NOTICE = Object.freeze({
  version: "ref-2026-11-1",
  title: "Prima di iniziare",
  lead: "Ti chiediamo del tuo lavoro, non di te.",
  summary: Object.freeze(["Le risposte e i file li vedono solo Lateral Space e le persone di {Azienda} che lavorano ai casi d'uso.", "Il link è solo tuo e vale fino al {data}."]),
  fullTextLabel: "Leggi l'informativa completa",
  paragraphs: Object.freeze([
    "Lateral Space raccoglie queste informazioni per conto di {Azienda}, per valutare e realizzare i casi d'uso. Le usiamo solo per questo.",
    "Ti chiediamo informazioni sul lavoro, non su di te. Se scrivi il nome di un collega o alleghi un file con nomi, email o telefoni, li usiamo solo per questo caso d'uso. Non servono dati sanitari, codici fiscali, date di nascita o preferenze su genere, età, origine o religione: se ne troviamo, ti chiediamo di toglierli.",
    "Ogni file passa da un controllo automatico prima di essere usato.",
    "Un sistema di intelligenza artificiale può leggere le tue risposte per suggerire al team una domanda in più e per tenere aggiornato quello che sappiamo del lavoro di {Azienda}, senza il tuo nome. Non decide niente e non scrive a nessuno: ogni proposta la controlla una persona del team.",
    "Salviamo le tue risposte, i file che alleghi, il tuo nome, l'email con cui ti abbiamo scritto e quando hai premuto «Iniziamo». Dell'indirizzo IP teniamo solo un'impronta cifrata, mai il numero, per due giorni.",
    "Le persone di {Azienda} che lavorano ai casi d'uso vedono le tue risposte e quando sono arrivate. Non misuriamo i tuoi tempi e non facciamo classifiche tra persone.",
    "Teniamo risposte, messaggi e file per 12 mesi dopo la chiusura della richiesta o l'ultimo messaggio, poi li cancelliamo. Restano solo le informazioni sul lavoro, senza il tuo nome.",
    "Puoi chiedere di vedere, correggere o cancellare i tuoi dati scrivendo a {contatto}. Puoi anche fare reclamo al Garante per la protezione dei dati personali.",
    "Il link è personale e scade 30 giorni dopo l'ultima novità. Non inoltrarlo.",
  ]),
  footerLabel: "Come usiamo le tue risposte",
  button: "Iniziamo",
  error: "Non riesco a registrarlo. Riprova tra poco.",
});

/** I valori dei segnaposto dell'informativa comune. */
export interface KitNoticeValues {
  /** Il nome dell'azienda come lo leggono i testi (il workspace, oppure «la tua azienda»). */
  company: string;
  /** La scadenza del link già scritta («18 dicembre 2026»). */
  expires: string;
  /** L'indirizzo per vedere, correggere o cancellare i dati. */
  contact: string;
}

/** L'informativa comune con i segnaposto riempiti, intera: la stessa forma per le due pagine. */
export function kitNoticeTexts(v: KitNoticeValues): {
  version: string;
  title: string;
  lead: string;
  summary: string[];
  fullTextLabel: string;
  paragraphs: string[];
  footerLabel: string;
  button: string;
  error: string;
} {
  const n = REFERENT_KIT_NOTICE;
  const values = { Azienda: v.company, data: v.expires, contatto: v.contact };
  return {
    version: n.version,
    title: n.title,
    lead: n.lead,
    summary: n.summary.map((t) => fill(t, values)),
    fullTextLabel: n.fullTextLabel,
    paragraphs: n.paragraphs.map((t) => fill(t, values)),
    footerLabel: n.footerLabel,
    button: n.button,
    error: n.error,
  };
}
