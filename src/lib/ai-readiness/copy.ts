/**
 * I testi d'apertura e di chiusura del questionario AI Readiness (`brandConfig.introCopy`, `brandConfig.completionCopy`)
 * e (Ondata 0) gli accenti dei testi già salvati: le rilevazioni e il modello di sistema (`ai-readiness-core-4`) di prima
 * hanno salvato alcune frasi senza accenti. Si correggono quando si leggono, senza toccare il database: un testo scritto
 * da chi ha creato la rilevazione resta com'è, e cambia solo una frase identica a quelle proposte allora. Modulo puro:
 * lo usano anche i componenti client.
 */
export const AI_READINESS_DEFAULT_COPY = Object.freeze({
  intro: "Questa diagnosi misura la readiness AI dell'organizzazione. Non è un esame: serve a capire dove aiutare meglio team, processi e tecnologia.",
  completion: "Grazie. Le risposte saranno aggregate e usate per costruire una roadmap AI più concreta e sicura.",
});

/** Le frasi proposte fino all'ondata 0 e salvate senza accenti, con la loro forma giusta. */
const SAVED_WITHOUT_ACCENTS: Readonly<Record<string, string>> = Object.freeze({
  "Questa diagnosi misura la readiness AI dell'organizzazione. Non e un esame: serve a capire dove aiutare meglio team, processi e tecnologia.":
    AI_READINESS_DEFAULT_COPY.intro,
  "Grazie. Le risposte saranno aggregate e usate per costruire una roadmap AI piu concreta e sicura.": AI_READINESS_DEFAULT_COPY.completion,
  // Il modello di sistema `ai-readiness-core-4`, salvato nel database alla prima rilevazione.
  "Chi decide, chi esegue, chi controlla: e definito da qualche parte o si va a consuetudine?":
    "Chi decide, chi esegue, chi controlla: è definito da qualche parte o si va a consuetudine?",
  "C'è qualcosa su ruoli, competenze o processi che e importante sapere?": "C'è qualcosa su ruoli, competenze o processi che è importante sapere?",
  "Con costanza: e un tema che seguo davvero": "Con costanza: è un tema che seguo davvero",
  "Se ne e parlato, ma nulla di fatto": "Se ne è parlato, ma nulla di fatto",
});

function accented(text: string): string {
  return Object.hasOwn(SAVED_WITHOUT_ACCENTS, text) ? SAVED_WITHOUT_ACCENTS[text] : text;
}

/** Un testo di `brandConfig` (o `fallback` se manca): le frasi proposte di prima tornano con gli accenti. */
export function brandCopy(config: Record<string, unknown> | null | undefined, key: string, fallback = ""): string {
  const value = config?.[key];
  return typeof value === "string" ? accented(value) : fallback;
}

/** Un valore letto dal database (il modello di una rilevazione), con le frasi salvate senza accenti corrette ovunque. */
export function withSavedAccents<T>(value: T): T {
  if (typeof value === "string") return accented(value) as T;
  if (Array.isArray(value)) return value.map((v) => withSavedAccents(v)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, withSavedAccents(v)])) as T;
  }
  return value;
}
