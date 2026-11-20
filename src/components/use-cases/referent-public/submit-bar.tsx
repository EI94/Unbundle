"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/uc/referente/screen";
import { ActionBar } from "@/components/uc/referente/step-bar";
import { REFERENT_PUBLIC_TEXT } from "@/lib/use-cases/referent/labels";

/**
 * In fondo alle domande (SPEC §4.4 punto 5; rilascio 5 §7.5): «Invia», fisso in basso al telefono; mai spento: con
 * qualcosa che manca dice quali domande, con «Vai alla domanda {k}». (Rilascio 10, §3.11) Una riga sola, come il
 * prototipo S7: a sinistra il solo numero della pagina con il salvataggio («2 di 5 · salvato»), a destra «Invia», alto
 * 48 px. Gli errori dell'invio stanno sopra, in linea (mai un toast: la pagina vive in `.survey-light`); un errore che non
 * è di una domanda riceve il fuoco, così al telefono non resta nascosto sotto le domande mentre il bottone è fisso in basso.
 */
/** L'errore generale dell'invio: la pagina ci porta il fuoco (e lo scorre in vista), sopra la barra fissa del telefono. */
export const SUBMIT_ERROR_ID = "ucq-invio-errore";

export function SubmitBar({
  status,
  missing,
  error,
  busy,
  onSubmit,
}: {
  /** (Rilascio 10, §3.11) «2 di 5 · salvato». */
  status: string;
  /** (Rilascio 5) Le domande che «Invia» ha trovato aperte, con «Vai alla domanda {k}». */
  missing: { text: string; goLabel: string; onGo: () => void } | null;
  error: string | null;
  busy: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-6 space-y-3">
      {missing ? (
        <div role="alert" className="rounded-xl bg-uc-giallo-bg px-4 py-3 text-base break-words">
          <p>{missing.text}</p>
          <Button type="button" variant="ghost" className="mt-1 min-h-11 h-auto px-0 text-base underline underline-offset-4" onClick={missing.onGo}>
            {missing.goLabel}
          </Button>
        </div>
      ) : null}
      {error ? (
        <div id={SUBMIT_ERROR_ID} tabIndex={-1} className="scroll-mt-4 outline-none">
          <Notice tone="errore">{error}</Notice>
        </div>
      ) : null}
      <ActionBar className="justify-between">
        <p role="status" aria-live="polite" data-slot="referent-progress" className="min-w-0 text-sm break-words text-muted-foreground">
          {status}
        </p>
        <Button type="button" className="h-12 min-w-32 shrink-0 text-base sm:min-w-48" aria-busy={busy || undefined} onClick={onSubmit}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {REFERENT_PUBLIC_TEXT.submit}
        </Button>
      </ActionBar>
    </div>
  );
}
