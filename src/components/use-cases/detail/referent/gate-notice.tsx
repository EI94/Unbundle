import Link from "next/link";
import type { ReferentGate } from "@/lib/use-cases/referent/contract";
import { cn } from "@/lib/utils";

/**
 * Perché «Chiedi al referente» è spento (SPEC §5.2): un paragrafo per ogni controllo che blocca,
 * nell'ordine del server; per l'autorizzazione dei fornitori anche il link a Impostazioni ›
 * Sub-responsabili. Niente quando si può chiedere. `noQuestionsNote`, accanto a «Non ci sono domande
 * da fare», dice perché «Prepara le domande» non aiuterebbe.
 */
export function GateNotice({
  id,
  gates,
  noQuestionsNote = null,
  className,
}: {
  id?: string;
  gates: readonly ReferentGate[];
  noQuestionsNote?: string | null;
  className?: string;
}) {
  if (gates.length === 0) return null;
  return (
    <div id={id} role="status" data-slot="referent-gates" className={cn("space-y-1.5 rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground", className)}>
      {gates.map((gate) => (
        <p key={gate.code} data-gate={gate.code} className="break-words">
          {gate.message}
          {gate.code === "nessuna_domanda" && noQuestionsNote ? (
            <>
              {" "}
              {noQuestionsNote}
            </>
          ) : null}
          {gate.code === "sub_responsabili_mancanti" ? (
            <>
              {" "}
              <Link href={gate.settingsHref} className="font-medium text-primary underline underline-offset-4 outline-none hover:decoration-2 focus-visible:decoration-2">
                {gate.linkLabel}
              </Link>
            </>
          ) : null}
        </p>
      ))}
    </div>
  );
}
