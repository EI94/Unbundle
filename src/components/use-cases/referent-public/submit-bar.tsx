"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice, PRIMARY_CLASS } from "@/components/uc/referente/screen";
import { ActionBar } from "@/components/uc/referente/step-bar";
import { REFERENT_PUBLIC_TEXT } from "@/lib/use-cases/referent/labels";

/**
 * In fondo alle domande (SPEC §4.4 punto 5): «Invia le risposte», fisso in basso al telefono, e la frase
 * «Invii solo le domande a cui hai risposto. Le altre restano qui: …». Gli errori dell'invio stanno sopra,
 * in linea (mai un toast: la pagina vive in `.survey-light`).
 */
export function SubmitBar({ hint, error, busy, onSubmit }: { hint: string; error: string | null; busy: boolean; onSubmit: () => void }) {
  return (
    <div className="mt-6 space-y-3">
      {error ? <Notice tone="errore">{error}</Notice> : null}
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
