"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice, PRIMARY_CLASS } from "@/components/uc/referente/screen";
import { ActionBar } from "@/components/uc/referente/step-bar";
import { REFERENT_PUBLIC_TEXT } from "@/lib/use-cases/referent/labels";

/**
 * In fondo alle domande (SPEC §4.4 punto 5): «Invia le risposte», fisso in basso al telefono, e la frase
 * «Invii solo le domande a cui hai risposto. Le altre restano qui: …». Gli errori dell'invio stanno sopra,
 * in linea (mai un toast: la pagina vive in `.survey-light`); un errore che non è di una domanda riceve il
 * fuoco, così al telefono non resta nascosto sotto le domande mentre il bottone è fisso in basso.
 */
/** L'errore generale dell'invio: la pagina ci porta il fuoco (e lo scorre in vista), sopra la barra fissa del telefono. */
export const SUBMIT_ERROR_ID = "ucq-invio-errore";

export function SubmitBar({ hint, error, busy, onSubmit }: { hint: string; error: string | null; busy: boolean; onSubmit: () => void }) {
  return (
    <div className="mt-6 space-y-3">
      {error ? (
        <div id={SUBMIT_ERROR_ID} tabIndex={-1} className="scroll-mt-4 outline-none">
          <Notice tone="errore">{error}</Notice>
        </div>
      ) : null}
      <p className="text-sm break-words text-muted-foreground">{hint}</p>
      <ActionBar>
        <Button type="button" className={PRIMARY_CLASS} disabled={busy} aria-busy={busy || undefined} onClick={onSubmit}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {REFERENT_PUBLIC_TEXT.submit}
        </Button>
      </ActionBar>
    </div>
  );
}
