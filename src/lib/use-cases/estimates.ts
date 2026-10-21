/**
 * «Stime non ufficiali» (docs/use-case/DESIGN.md §6.3, §7.5, D7; H4p): un solo riquadro con la
 * stima di Claude (ore × volte × persone), la stima di chi ha proposto e, nella scheda, il
 * suggerimento dell'AI, sotto una frase sola: conta la valutazione del team. Nessuna di queste
 * stime entra nel Valore, nel costo, nelle zone o nei totali.
 *
 * Parole semplici, anche per i clienti: niente «semaforo» né «sforzo» come gergo. Il segnale di
 * chi propone (verde, giallo, rosso) si legge come rischio; l'impegno al posto dello sforzo.
 *
 * Modulo puro: solo import relativi `.ts`.
 */
import { RUNS_PER_YEAR, claudeHoursPerYear } from "./views.ts";

/** I testi del riquadro (§14.3). */
export const ESTIMATES_TEXT = Object.freeze({
  title: "Stime non ufficiali",
  /** Una frase sola, sopra le stime. */
  note: "Conta la valutazione del team.",
});

/** Il segnale di chi propone, in parole (era «semaforo verde/giallo/rosso»). */
export const PROPOSER_RISK_WORDS: Readonly<Record<string, string>> = Object.freeze({
  verde: "nessun rischio particolare",
  giallo: "qualche rischio da verificare",
  rosso: "serve una decisione dell'AI Board",
});

const INTEGER = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });

/** «1.250»: le migliaia col punto anche sotto 10.000 (it-IT da solo non le raggruppa). */
function grouped(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function count(n: number, one: string, many: string): string {
  return `${INTEGER.format(n)} ${n === 1 ? one : many}`;
}

function score(value: unknown): number | null {
  const n = record(value)?.score;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Le righe della stima di Claude e di chi ha proposto, dai soli dati raccolti dal connettore
 * (`intake`):
 * - «Circa 180 ore all'anno (15 minuti × 240 volte × 3 persone).», alle decine;
 * - «Circa 7.200 € all'anno, secondo chi ha proposto.», dagli euro per volta;
 * - «Secondo chi ha proposto: efficienza 4 su 5, impegno 2 su 5, nessun rischio particolare.».
 * Vuoto senza dati.
 */
export function unofficialEstimateLines(intake: unknown): string[] {
  const data = record(intake);
  if (!data) return [];
  const lines: string[] = [];
  const hours = claudeHoursPerYear(data);
  const runs = typeof data.frequency === "string" && Object.prototype.hasOwnProperty.call(RUNS_PER_YEAR, data.frequency) ? RUNS_PER_YEAR[data.frequency] : null;
  const minutes = typeof data.timeSavedMinutesPerRun === "number" ? data.timeSavedMinutesPerRun : null;
  const people = typeof data.beneficiaries === "number" ? data.beneficiaries : null;
  if (hours !== null && runs !== null && minutes !== null && people !== null) {
    lines.push(`Circa ${grouped(hours)} ore all'anno (${count(minutes, "minuto", "minuti")} × ${count(runs, "volta", "volte")} × ${count(people, "persona", "persone")}).`);
  }
  const perRun = data.valuePerRunEur;
  if (typeof perRun === "number" && Number.isFinite(perRun) && perRun > 0 && runs !== null) {
    const persons = typeof people === "number" && Number.isFinite(people) && people > 0 ? people : 1;
    const yearly = Math.max(10, Math.round((perRun * runs * persons) / 10) * 10);
    lines.push(`Circa ${grouped(yearly)} € all'anno, secondo chi ha proposto.`);
  }
  const estimate = record(data.proposerEstimate);
  if (estimate) {
    const parts: string[] = [];
    const efficiency = score(estimate.efficiency);
    const effort = score(estimate.effort);
    const flag = record(estimate.impactFlag)?.value;
    if (efficiency !== null) parts.push(`efficienza ${INTEGER.format(efficiency)} su 5`);
    if (effort !== null) parts.push(`impegno ${INTEGER.format(effort)} su 5`);
    if (typeof flag === "string" && Object.prototype.hasOwnProperty.call(PROPOSER_RISK_WORDS, flag)) parts.push(PROPOSER_RISK_WORDS[flag]);
    if (parts.length) lines.push(`Secondo chi ha proposto: ${parts.join(", ")}.`);
  }
  return lines;
}
