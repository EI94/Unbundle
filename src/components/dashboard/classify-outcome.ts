/**
 * Che cosa dice il bottone «Classifica attività» (classify-button.tsx) dopo /api/ai/classify, e se aggiorna la pagina.
 * Le decisioni stanno qui; il componente mostra l'avviso e basta. Modulo puro: lo importano anche i test con Node.
 */

/** Le scritte del bottone: a riposo e mentre classifica. */
export const CLASSIFY_BUTTON_LABEL = { idle: "Classifica attività", busy: "Classificazione in corso..." } as const;

/**
 * L'avviso (il tipo di toast di sonner e il testo) e se aggiornare la pagina: con router.refresh(), mai ricaricandola,
 * così l'avviso resta a schermo. Si aggiorna solo quando qualcosa è stato classificato.
 */
export type ClassifyOutcome = { level: "success" | "info" | "warning" | "error"; text: string; refresh: boolean };

/** Una richiesta non riuscita (rete, risposta non 2xx o illeggibile). */
export const CLASSIFY_FAILED: ClassifyOutcome = { level: "error", text: "Errore durante la classificazione", refresh: false };

/** La risposta di /api/ai/classify (runClassificationAction in src/lib/actions/classify.ts). */
type ClassifyResult = { classified: number; skipped: number; skippedText: string; total: number };

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

function isClassifyResult(data: unknown): data is ClassifyResult {
  const result = data as Partial<ClassifyResult> | null;
  return (
    typeof result === "object" &&
    result !== null &&
    isCount(result.classified) &&
    isCount(result.skipped) &&
    isCount(result.total) &&
    typeof result.skippedText === "string"
  );
}

/** «1 attività classificata su 1 totale», «3 attività classificate su 5 totali». */
function classifiedText(classified: number, total: number): string {
  return `${classified} ${classified === 1 ? "attività classificata" : "attività classificate"} su ${total} ${total === 1 ? "totale" : "totali"}`;
}

/**
 * L'esito per il corpo JSON di una risposta riuscita, o `null` quando la richiesta non è riuscita. Le attività che il
 * modello non ha classificato (un rifiuto o un errore) restano da fare: il server dice quante (`skippedText`).
 */
export function classifyOutcome(data: unknown): ClassifyOutcome {
  if (!isClassifyResult(data)) return CLASSIFY_FAILED;
  const { classified, skipped, skippedText, total } = data;
  if (skipped > 0) {
    return classified > 0
      ? { level: "warning", text: `${classifiedText(classified, total)}. ${skippedText} Riprova più tardi.`, refresh: true }
      : { level: "error", text: `${skippedText} Riprova più tardi.`, refresh: false };
  }
  if (classified > 0) return { level: "success", text: classifiedText(classified, total), refresh: true };
  return { level: "info", text: "Tutte le attività sono già classificate", refresh: false };
}
