/**
 * Piccoli aiuti di formato per la pagina Risultati: numeri all'italiana,
 * date dei turni nell'ora italiana, titoli brevi e colori degli esiti.
 * Niente stato e niente accesso ai dati: si usano sia sul server sia nel
 * browser e devono dare lo stesso testo in entrambi.
 */

const ROME = "Europe/Rome";

const decimal = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
const turnFormat = new Intl.DateTimeFormat("it-IT", {
  timeZone: ROME, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const clockFormat = new Intl.DateTimeFormat("it-IT", { timeZone: ROME, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const dayFormat = new Intl.DateTimeFormat("it-IT", { timeZone: ROME, day: "numeric", month: "long", year: "numeric" });
const hourFormat = new Intl.DateTimeFormat("it-IT", { timeZone: ROME, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** 2.4 → "2,4"; 3 → "3". */
export function formatDecimal(value: number) {
  return decimal.format(value);
}

/** Percentuale intera; 0 quando non c'è ancora nessuna risposta. */
export function percent(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

/** "Lun 5 ott · 14:30", nell'ora italiana. */
export function turnLabel(startsAt: string) {
  const parts = Object.fromEntries(turnFormat.formatToParts(new Date(startsAt)).map((part) => [part.type, part.value]));
  const weekday = (parts.weekday ?? "").replace(".", "");
  const month = (parts.month ?? "").replace(".", "");
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${parts.day ?? ""} ${month} · ${parts.hour ?? ""}:${parts.minute ?? ""}`;
}

/** "14:32:10", nell'ora italiana. */
export function clockLabel(instant: number | string) {
  return clockFormat.format(new Date(instant));
}

/** "5 ottobre 2026 alle 14:52", nell'ora italiana. */
export function dateTimeLabel(instant: string) {
  const date = new Date(instant);
  return `${dayFormat.format(date)} alle ${hourFormat.format(date)}`;
}

/** Il titolo breve di un'attività per le colonne: "Esercizio 1 · Caso" → "Esercizio 1". */
export function shortActivityTitle(title: string) {
  const cut = [" · ", ":", " – ", " - "].map((separator) => title.indexOf(separator)).filter((index) => index > 0);
  return (cut.length ? title.slice(0, Math.min(...cut)) : title).trim();
}

/** Colori degli esiti, pensati per lo sfondo scuro dell'app. */
export function outcomeTone(status: string | null | undefined) {
  if (status === "consolidated") return "border-emerald-500/40 bg-emerald-500/15 text-emerald-300";
  if (status === "needs_practice") return "border-amber-500/40 bg-amber-500/15 text-amber-200";
  return "border-border bg-muted text-foreground";
}

/** Come ha lavorato la persona nel caso guidato. */
export function modeLabel(mode: string | undefined) {
  if (mode === "execute_authorized_assistant") return "Ha usato Claude Cowork";
  if (mode === "review_reference_output") return "Ha letto l’esempio preparato";
  return null;
}
