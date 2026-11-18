/**
 * I testi della Home (rilascio 10, ondata 2b; docs/ui-10/PROPOSTA-10.md §3.3, prototipo S1, S1b, S1c) e del
 * prossimo passo del workspace (D3), che la Home e la Panoramica di «Use case» dicono con le stesse parole.
 *
 * Regole (§4): «use case» nella dashboard, mai «caso d'uso» né «proposta» per uno use case; un verbo di due o tre
 * parole sul pulsante, il perché nel «?»; «Tocca a …» solo quando non tocca a chi guarda; lo zero non si dice; mai
 * una persona; genere neutro («formate» è delle persone). I testi della pagina «Programma» restano in
 * `src/lib/programma/text.ts` (ondata «lingua»).
 *
 * Modulo puro: import relativi `.ts`.
 */
import { formatEuro, formatInteger } from "../use-cases/format.ts";
import { quarterLabel } from "../use-cases/quarter.ts";
import type { QuarterCode } from "../use-cases/types.ts";

const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

/** «3 novembre», «1° dicembre»: il giorno e il mese, il primo del mese con «°». */
export function dayMonth(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d === 1 ? "1°" : d} ${MONTHS[m - 1]}`;
}

/** «Tocca a Cliente Demo.», «Tocca ad AI Builder.»: chi fa il passo, mai una persona. */
export function turnTo(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim();
  return `${/^[aA]/.test(clean) ? "Tocca ad" : "Tocca a"} ${clean}.`;
}

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${formatInteger(n)} ${many}`);

/** «al 42 %», «all'80 %», «all'11 %»: l'articolo davanti a un numero che si legge con una vocale (uno, otto, undici, ottanta…). */
export function atPct(pct: number): string {
  const n = Math.round(pct);
  const vowel = n === 1 || n === 8 || n === 11 || (n >= 80 && n <= 89);
  return `${vowel ? "all'" : "al "}${formatInteger(n)} %`;
}

/** Gli ordinali dei cinque passi di «Per partire». */
const ORDINALS = ["primo", "secondo", "terzo", "quarto", "quinto"] as const;

export const HOME_TEXT = Object.freeze({
  title: "Home",
  /** Una lista oltre le tre righe in vista (§1, regola 4). */
  showAll: (n: number) => `Vedi tutti (${formatInteger(n)})`,
  /** Il menu «⋯» della testata. */
  menu: Object.freeze({
    label: "Altre azioni",
    exportSal: "Esporta il SAL (PDF)",
    closeSal: "Chiudi il SAL",
    settings: "Impostazioni del programma",
  }),
  exportSalFailed: "Non riesco a preparare il PDF. Riprova tra poco.",

  /** Il numero grande. */
  value: Object.freeze({
    label: "Valore all'anno",
    /** «su 20 use case · in uso 38.000 €»; senza use case in uso la sola prima parte. */
    note: (useCases: number, inUseEur: number | null) =>
      [`su ${count(useCases, "use case", "use case")}`, inUseEur && inUseEur > 0 ? `in uso ${formatEuro(inUseEur)}` : null].filter(Boolean).join(" · "),
    allNumbers: "Tutti i numeri",
  }),

  /** Le quattro righe che aprono un pannello. */
  rows: Object.freeze({
    initiatives: "Iniziative",
    people: "Persone",
    goals: "Obiettivi",
    sal: "SAL (stato di avanzamento)",
  }),
  /** Il fatto grigio di ogni riga. */
  facts: Object.freeze({
    /** «24 use case · 3 in realizzazione · 1 in uso»: le parti a zero non si dicono. */
    initiatives: (total: number, inProgress: number, inUse: number) =>
      [count(total, "use case", "use case"), inProgress > 0 ? `${formatInteger(inProgress)} in realizzazione` : null, inUse > 0 ? `${formatInteger(inUse)} in uso` : null]
        .filter(Boolean)
        .join(" · "),
    /** «38 formate su 120»; senza dipendenti «38 formate». */
    trained: (trained: number, employees: number | null) =>
      employees ? `${formatInteger(trained)} ${trained === 1 ? "formata" : "formate"} su ${formatInteger(employees)}` : `${formatInteger(trained)} ${trained === 1 ? "formata" : "formate"}`,
    /** Senza formazione, i livelli dell'AI Readiness: «46 risposte all'AI Readiness». */
    readiness: (answers: number) => `${count(answers, "risposta", "risposte")} all'AI Readiness`,
    /** «5 risultati chiave · in media al 42 %»: l'avanzamento medio di quelli con base, valore e traguardo. */
    keyResults: (total: number, averagePct: number | null) =>
      [count(total, "risultato chiave", "risultati chiave"), averagePct === null ? null : total === 1 ? atPct(averagePct) : `in media ${atPct(averagePct)}`]
        .filter(Boolean)
        .join(" · "),
    kpis: (n: number) => count(n, "KPI", "KPI"),
    /** Nessun obiettivo né KPI, a chi può sceglierli: la riga è l'azione. */
    chooseKpis: "Scegli i KPI da seguire",
    /** «ultimo il 3 novembre · prossimo dal 1° dicembre». */
    sal: (lastOn: string, nextFrom: string) => `ultimo il ${dayMonth(lastOn)} · prossimo dal ${dayMonth(nextFrom)}`,
    salFirst: "il primo da chiudere",
  }),

  /** I pannelli nuovi della Home (gli altri sono quelli del Programma). */
  panels: Object.freeze({
    numbers: "Tutti i numeri",
    initiatives: "Iniziative",
    settings: "Impostazioni del programma",
    /** Nel pannello «Obiettivi»: la pagina degli obiettivi (`/strategy`). */
    openGoals: "Apri gli obiettivi",
    /** Nel pannello del SAL, a chi non lo può chiudere. */
    salTurn: "Il SAL lo chiude chi gestisce il workspace.",
    /** Nel pannello del SAL, senza prossimi passi per la leadership. */
    salNothing: "Niente da fare adesso.",
    /** Nel pannello «Impostazioni del programma»: le altre impostazioni, dove stanno. */
    settingsCaseDev: "Lo sviluppo di un singolo use case si cambia nel pannello della sua iniziativa.",
  }),

  /** Il programma non è pronto (senza la 0029): una riga. */
  notReady: "I numeri del programma si stanno preparando. Riprova tra qualche minuto.",

  /** Il prossimo passo del workspace (D3), lo stesso per la Home e la Panoramica. */
  steps: Object.freeze({
    fornitori: Object.freeze({
      cta: "Autorizza i fornitori",
      status: "Manca l'ok sui fornitori",
      why: (waiting: number) => `Senza l'ok le domande al referente non partono: ${waiting === 1 ? "1 informazione aspetta" : `${formatInteger(waiting)} informazioni aspettano`}.`,
      then: "l'ok sui fornitori",
    }),
    decidere: Object.freeze({
      cta: (n: number) => `Decidi ${formatInteger(n)} use case`,
      why: (n: number, days: number) => {
        const since = days <= 0 ? null : days === 1 ? "da 1 giorno" : `da ${formatInteger(days)} giorni`;
        if (n === 1) return since ? `Aspetta ${since}.` : "È arrivato oggi.";
        return since ? `Il più vecchio aspetta ${since}.` : "Il più vecchio è arrivato oggi.";
      },
      then: (n: number) => `${count(n, "use case", "use case")} da decidere`,
    }),
    chiedere: Object.freeze({
      cta: (n: number) => (n === 1 ? "Chiedi 1 informazione" : `Chiedi ${formatInteger(n)} informazioni`),
      why: (quarter: QuarterCode) => `Servono agli use case del ${quarterLabel(quarter)} per partire.`,
      then: (n: number, quarter: QuarterCode) => `${count(n, "informazione", "informazioni")} da chiedere per il ${quarterLabel(quarter)}`,
    }),
    verificare: Object.freeze({
      cta: (n: number) => (n === 1 ? "Verifica 1 risposta" : `Verifica ${formatInteger(n)} risposte`),
      why: (n: number) => (n === 1 ? "Il referente ha risposto: controlla la risposta prima di usarla." : "I referenti hanno risposto: controlla le risposte prima di usarle."),
      then: (n: number) => `${count(n, "risposta", "risposte")} da verificare`,
    }),
    sal: Object.freeze({
      cta: "Chiudi il SAL",
      status: "SAL da chiudere",
      whyFirst: "Il primo SAL fotografa i numeri di oggi: dal prossimo si vede che cosa è cambiato.",
      why: (lastOn: string, days: number) => `L'ultimo è del ${dayMonth(lastOn)}, ${formatInteger(days)} giorni fa.`,
      then: "il SAL da chiudere",
      turn: "Tocca a chi gestisce il workspace.",
    }),
    /** Il «?» con il passo dopo: «… Poi: 12 informazioni da chiedere per il T4 2026.» */
    withThen: (why: string, then: string | null) => (then ? `${why} Poi: ${then}.` : why),
  }),

  /** «Per partire» (§3.3): la lista dei revisori in un workspace nuovo, al posto del numero grande. */
  start: Object.freeze({
    title: "Per partire",
    progress: (done: number, total: number) => `${formatInteger(done)} di ${formatInteger(total)}`,
    /** Per i lettori di schermo, dopo una riga fatta. */
    done: "fatto",
    rows: Object.freeze({
      racconta: "Racconta l'azienda",
      appunti: "Aggiungi gli appunti delle prime call",
      /** Con la parola di oggi per le unità («funzione»); con un'altra parola la riga non la nomina. */
      processi: "Mappa i processi di una funzione",
      processiOther: "Mappa i processi",
      obiettivi: "Scrivi gli obiettivi",
      decidi: "Decidi i primi use case",
    }),
    /** Il pulsante del passo, quando la riga è il prossimo passo. */
    cta: Object.freeze({
      racconta: "Racconta l'azienda",
      appunti: "Aggiungi gli appunti",
      processi: "Mappa i processi",
      obiettivi: "Scrivi gli obiettivi",
      decidi: "Decidi i primi use case",
      decidiCount: (n: number) => `Decidi ${formatInteger(n)} use case`,
    }),
    why: (position: number) => `È il ${ORDINALS[position] ?? `${position + 1}°`} passo di «Per partire».`,
    lateralSpaceTurn: turnTo("Lateral Space"),
  }),

  /** La Home dei contributori (S1c). */
  contributor: Object.freeze({
    propose: "Proponi un use case",
    mine: (n: number) => `I tuoi use case (${formatInteger(n)})`,
    empty: "Le tue idee arrivano qui: proponi il primo use case.",
    byArea: "Chi propone, per area",
    /** Dopo il numero di una riga, per i lettori di schermo. */
    areaCount: " use case",
    toSpread: (n: number) => `di cui ${formatInteger(n)} da diffondere`,
    companies: (parts: string) => `Per società: ${parts}`,
    noneYet: "Ancora nessuno use case dai colleghi.",
    course: "Il tuo corso",
  }),
});

/** L'ordinale di un passo di «Per partire» (0 = «primo»), per i test. */
export function startOrdinal(position: number): string {
  return ORDINALS[position] ?? `${position + 1}°`;
}
