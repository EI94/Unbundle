/**
 * (Rilascio 10, ondata 4 «Fuori», docs/ui-10/PROPOSTA-10.md §3.11) I testi del guscio unico delle pagine fuori dalla
 * dashboard (`src/components/public/`): il marchio in alto, il piè di pagina, la scheda del link che non vale più e quella
 * dell'errore. Le stesse parole valgono per `/rispondi` e `/r` (il kit del referente, D5), per il corso, il questionario,
 * l'accesso, l'invito e la condivisione.
 *
 * Fuori dalla dashboard: «caso d'uso», mai «use case»; genere neutro; niente codici, chiavi né inglese (§4.2).
 * Modulo puro, senza import.
 */
export const PUBLIC_TEXT = Object.freeze({
  /** Il marchio in alto, piccolo e non cliccabile, quando il cliente non si sa. */
  brand: "Unbundle",
  /** La riga del marchio quando il cliente si sa: «Cliente Demo · con Lateral Space». */
  clientLine: "{Cliente} · con Lateral Space",
  /** Il link del piè di pagina all'informativa: la pagina dà l'indirizzo. */
  notice: "Come usiamo le tue risposte",
  /** Il contatto del piè di pagina: «Serve aiuto? Scrivi a …». */
  help: "Serve aiuto?",
  writeTo: "Scrivi a",
  /** Una scheda sola per ogni link che non si può usare (scaduto, tolto, sbagliato): una frase e un'azione (§1.2, P3). */
  invalidLink: Object.freeze({
    title: "Questo link non vale più.",
    body: "Rispondi all'email che hai ricevuto: arriva a chi ti ha scritto.",
  }),
  /** Una scheda sola per l'errore, con il solo «Riprova» (`retry` di Next 16: rilegge la pagina dal server). */
  error: Object.freeze({
    title: "Questa pagina non si è caricata.",
    retry: "Riprova",
  }),
  /** Per i lettori di schermo, mentre la pagina si carica. */
  loading: "Caricamento…",
});

/** Riempie «{Nome}» e simili; un segnaposto senza valore resta com'è. */
export function fillPublic(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (Object.hasOwn(values, key) ? String(values[key]) : whole));
}

/** La riga del marchio: «{Cliente} · con Lateral Space» se il cliente si sa, altrimenti «Unbundle». */
export function brandLine(client: string | null | undefined): string {
  const name = client?.replace(/\s+/g, " ").trim();
  return name ? fillPublic(PUBLIC_TEXT.clientLine, { Cliente: name }) : PUBLIC_TEXT.brand;
}
