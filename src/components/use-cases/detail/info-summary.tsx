import { ClipboardList } from "lucide-react";
import { SEMAFORO_TONE } from "@/components/uc/common/semaforo-tone";
import type { InfoProgressView } from "@/lib/use-cases/info-progress";
import { INFO_PROGRESS_TEXT } from "@/lib/use-cases/info-progress";
import { SCREEN_SEPARATOR, joinPieces, keepTogether } from "@/lib/use-cases/line-breaks";
import { cn } from "@/lib/utils";

/**
 * In cima a «Cosa serve» (rilascio «Pulizia»): una riga sola, «N di M informazioni ricevute», tra
 * parentesi quante di quelle sono da verificare, e che cosa resta, gruppo per gruppo, così i numeri
 * fanno il totale («2 di 5 informazioni ricevute (1 da verificare) · 1 in attesa · 2 da chiedere»). Lo stato a parole sta solo nella testata e qui non si ripete; le date stanno nelle righe
 * delle «Richieste». Conteggi di esigenze della scheda, mai di persone. Niente barra: il conteggio
 * dice già quanto manca.
 */
export function InfoSummary({ view, className }: { view: InfoProgressView | null | undefined; className?: string }) {
  if (!view) return null;
  return (
    <div data-slot="info-summary" data-state={view.state} role="group" aria-label={INFO_PROGRESS_TEXT.summaryHeading} className={cn("min-w-0", className)}>
      <p data-slot="info-count" className="flex min-w-0 items-start gap-1.5 text-sm text-foreground">
        <ClipboardList aria-hidden className={cn("mt-0.5 size-4 shrink-0", SEMAFORO_TONE[view.tone].text)} />
        <span className="min-w-0 break-words tabular-nums">
          <span className="font-medium">{keepTogether(view.count)}</span>
          {/* Quelle da guardare fanno parte delle ricevute: tra parentesi, così i pezzi sommano al totale. */}
          {view.receivedNote ? (
            <span data-slot="info-received-note">
              {" "}
              <span className="whitespace-nowrap">({view.receivedNote})</span>
            </span>
          ) : null}
          {/* Al telefono va a capo tra un gruppo e l'altro, mai dentro («1 in» / «attesa»): ogni gruppo resta intero, e il «·» con il gruppo prima. */}
          {view.next ? <span data-slot="info-next">{`${SCREEN_SEPARATOR}${joinPieces(view.next.split(INFO_PROGRESS_TEXT.next.separator))}`}</span> : null}
        </span>
      </p>
    </div>
  );
}
