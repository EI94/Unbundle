/**
 * (Rilascio 10, D5) Il kit del referente: le parole che `/rispondi` (la richiesta dello use case) e `/r` (il link
 * della realizzazione) dicono uguali, in un file solo.
 *
 * - **Le parole** (`REFERENT_KIT_TEXT`): il marchio con la riga del cliente, «Non lo so» (mai «Non ce l'ho»),
 *   «Iniziamo», «Avanti» senza freccia, la scheda unica di un link che non vale più e quella di un errore con il
 *   solo «Riprova», un solo numero di avanzamento («2 di 5 · salvato»), «Come usiamo le tue risposte»,
 *   «Riferimento XX-0024». Fuori dalla dashboard: «caso d'uso», mai «use case» (copy guard `esterno`).
 * - **L'informativa** non è qui: ognuna delle due pagine tiene la sua, perché i fatti sono diversi (a `/rispondi`
 *   l'AI legge le risposte, l'impronta dell'IP dura due giorni e tutto si cancella dopo 12 mesi; a `/r` no). Hanno lo
 *   stesso stile calmo del 04/11 e le stesse parole: `ucq-2026-11-3` in `labels.ts`, `uc-2026-11-2` in
 *   `src/lib/uc/public-view.ts`.
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
