/**
 * Date del registro, sempre nel fuso di Roma: la stessa resa nella pagina,
 * nel PDF e nell'Excel, qualunque sia il fuso del server o del browser.
 */
const zone = "Europe/Rome";
const fmtDateTime = new Intl.DateTimeFormat("it-IT", { timeZone: zone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtDate = new Intl.DateTimeFormat("it-IT", { timeZone: zone, day: "numeric", month: "long", year: "numeric" });
const fmtTime = new Intl.DateTimeFormat("it-IT", { timeZone: zone, hour: "2-digit", minute: "2-digit" });
const fmtDay = new Intl.DateTimeFormat("sv-SE", { timeZone: zone });

export const dateTime = (value: string | null) => (value ? fmtDateTime.format(new Date(value)).replace(",", "") : "");
export const longDate = (value: string) => fmtDate.format(new Date(value));
export const clock = (value: string) => fmtTime.format(new Date(value));
export const isoDay = (value: string) => fmtDay.format(new Date(value));
export const sessionLabel = (s: { startsAt: string; endsAt: string }) => `${longDate(s.startsAt)}, ${clock(s.startsAt)}–${clock(s.endsAt)}`;

export const sessionStateLabel = {
  svolta: "Svolta",
  in_programma: "In programma",
  senza_partecipanti: "Conclusa, nessun partecipante registrato",
} as const;
