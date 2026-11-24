/**
 * (Rilascio 10, docs/ui-10/PROPOSTA-10.md §3.5, F-019…F-024) I testi del dialogo «Avvia la realizzazione» della scheda
 * dello use case: al più 25 parole, un clic. Modulo puro. La scelta dello schema, qui e nella pagina di ripiego
 * `/casi-duso/nuovo`, usa i testi di `start-templates.ts` (la riga «per ogni use case · 6 domande» di ogni schema).
 */
import { formatCountIt } from "./format.ts";

export const START_DIALOG_TEXT = Object.freeze({
  /** «Parte la realizzazione di XX-0012»; senza codice, il titolo dello use case. */
  title: (code: string | null, useCaseTitle: string) => `Parte la realizzazione di ${code ?? `«${useCaseTitle}»`}`,
  /** «Con lo schema «Smistamento richieste», 245 domande.» */
  template: (t: { name: string; questions: number }) => `Con lo schema «${t.name}», ${questionsText(t.questions)}.`,
  change: "Cambia schema",
  chooseLabel: "Schema di partenza",
  cancel: "Annulla",
  start: "Avvia",
  starting: "Un momento…",
  settings: "Apri le Impostazioni",
});

function questionsText(n: number): string {
  return n === 1 ? "1 domanda" : `${formatCountIt(n)} domande`;
}
