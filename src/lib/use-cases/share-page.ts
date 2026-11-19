/**
 * (Rilascio 10, §3.4) I testi della pagina pubblica del link di condivisione (`/share/portfolio/<ws>/<id>`, D14): la
 * apre chi ha proposto da Slack senza essere membro del workspace. È una pagina fuori dalla dashboard: «caso d'uso»,
 * mai «use case», e niente nome del team (D14). Tema chiaro (`.survey-light`), il marchio piccolo in alto.
 *
 * Modulo puro, senza import.
 */
export const SHARE_PAGE_TEXT = Object.freeze({
  /** Il marchio in alto, piccolo, non cliccabile. */
  brand: "Unbundle",
  /** Il titolo della scheda del browser e l'H1 di una scheda nascosta alla ricerca, che non mostra il suo titolo. */
  title: "Caso d'uso",
  /** Per i lettori di schermo, davanti alla pillola. */
  phase: "Fase",
  when: "Quando",
  /** Il pulsante principale, a tutta larghezza. */
  login: "Accedi per aprire la scheda",
  /** Sotto il pulsante: quanto vale il link e fino a quando. */
  validity: (days: number, until: string) => `Il link vale ${days} giorni: fino al ${until}.`,
  /**
   * Il link che non vale (disattivato, copiato in parte, scaduto): una scheda sola e la stessa frase, così chi ha il
   * link non sa se è scaduto o se il team l'ha tolto.
   */
  invalidTitle: "Questo link non vale più.",
  invalidBody: "Accedi per aprire la scheda, o chiedi un link nuovo al team.",
  invalidLogin: "Accedi a Unbundle",
});

/** «19 dicembre»: il giorno di scadenza del link, a Roma. */
export function shareExpiryDay(expiresAt: Date): string {
  return new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long" }).format(expiresAt);
}
