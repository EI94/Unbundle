import { Lightbulb, TriangleAlert } from "lucide-react";
import type { EvalRunOrigin } from "@/lib/db/queries/use-case-eval-origins";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { cn } from "@/lib/utils";
import { EVAL_TEXT, originOf, type QualitySummary } from "./eval-format";
import { RunSource } from "./eval-section";

/**
 * (Rilascio 10, docs/ui-10/PROPOSTA-10.md §3.5) La «Qualità» della Costruzione in vista: una riga con qualità e soglie
 * («96,4% · soglie rispettate» sotto il titolo, il puntino verde o rosso con la parola, grigio in costruzione; «· modelli
 * finti» per chi costruisce, quando le evals sono girate con quelli) e, per chi costruisce, la data con la
 * fonte («dalla CI», che porta all'esecuzione su GitHub, 8.2b), l'avviso se le evals calano e, per ogni ruolo, la sola
 * raccomandazione del banco. Tutto il resto (andamento, gruppi, modelli, grafici, tabelle, comandi) sta nella piega
 * «Dettagli per chi costruisce», con `EvalSection` com'era. Ai ruoli del cliente la sola riga (`qualitySummary`).
 *
 * Solo presentazione, senza stato: si rende anche sul server.
 */
export function EvalSummary({
  summary,
  origins = null,
  ciLinks = false,
  unavailable = false,
}: {
  summary: QualitySummary | null;
  origins?: ReadonlyMap<string, EvalRunOrigin> | null;
  ciLinks?: boolean;
  /** La lettura delle misure non è riuscita: si dice al posto della riga. */
  unavailable?: boolean;
}) {
  if (!summary) {
    return unavailable ? (
      <p role="status" className="text-sm text-muted-foreground">
        {EVAL_TEXT.unavailable}
      </p>
    ) : null;
  }
  const origin = summary.runId ? originOf(origins, summary.runId) : null;
  return (
    <div data-slot="eval-summary" className="min-w-0 space-y-2">
      {summary.line ? (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <p data-slot="eval-quality" className="min-w-0">
            <StatusDot tone={summary.tone ?? "grigio"} label={summary.line} size="md" />
          </p>
          {summary.meta ? (
            <p className="text-xs text-muted-foreground">
              {summary.meta}
              <RunSource origin={origin} ciLinks={ciLinks} />
            </p>
          ) : null}
        </div>
      ) : null}
      {summary.alert ? (
        <p data-slot="eval-alert" className="flex items-start gap-2 text-sm">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-uc-giallo" />
          <span className="min-w-0">{summary.alert}</span>
        </p>
      ) : null}
      {summary.advice.length ? (
        <ul data-slot="eval-advice" className="space-y-1.5">
          {summary.advice.map((a) => (
            <li key={a.role} data-tone={a.tone} className={cn("flex min-w-0 items-start gap-2 text-sm", a.tone === "neutro" && "text-muted-foreground")}>
              {a.tone === "cambia" ? <Lightbulb aria-hidden className="mt-0.5 size-4 shrink-0 text-uc-blu" /> : a.tone === "attenzione" ? <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-uc-giallo" /> : null}
              <span className="min-w-0 break-words">{a.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
