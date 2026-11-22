"use client";

import { Download } from "lucide-react";
import { LEARNING_TEXT } from "@/lib/learning/text";
import { Button } from "@/components/ui/button";
import { SideSheet, useSheetParam } from "@/components/ui-10/side-sheet";
import { LearningExportButton } from "./export-button";
import { ResultsLocked } from "./results-access";

const R = LEARNING_TEXT.results;
const COLUMNS = ["Partecipante", "Email", "Turno", "Attività", "Prova", "Stato", "Esito", "Risposte giuste", "Domande", "Risposte importanti sbagliate", "Consegnato il"];

/** Il pannello di «Scarica»: `?apri=scarica` (anche il vecchio `?vista=scarica`, che la pagina gli passa). */
export const DOWNLOAD_SHEET = "scarica";
function acceptDownload(raw: string | null): typeof DOWNLOAD_SHEET | null {
  return raw === DOWNLOAD_SHEET ? DOWNLOAD_SHEET : null;
}

/**
 * «Scarica» (rilascio 10, ondata 7a, §3.9, FO-26): un pulsante bordato in testata, non più una scheda. Apre il suo
 * pannello, con l'indirizzo (`?apri=scarica`): una frase su che cosa c'è nel file, le colonne in una piega, «Scarica
 * l'elenco» (il pieno del pannello) e la riga sui nomi e lo storico. Chi gestisce il corso senza il permesso trova lì
 * «Attiva per me». Il download e la sua riga nello storico non cambiano.
 */
export function ResultsDownload({ workspaceId, programId, canExport, canGrant, viewerId, initialOpen }: {
  workspaceId: string; programId: string; canExport: boolean; canGrant: boolean; viewerId: string; initialOpen: string | null;
}) {
  const [open, show] = useSheetParam({ initial: initialOpen, accept: acceptDownload });
  return <>
    <Button type="button" variant="outline" className="min-h-11 flex-1 sm:min-h-9 sm:flex-none" aria-haspopup="dialog" onClick={() => show(DOWNLOAD_SHEET)} data-testid="results-download">
      <Download aria-hidden data-icon="inline-start" />{R.download}
    </Button>
    <SideSheet open={open === DOWNLOAD_SHEET} onClose={() => show(null)} title={R.downloadTitle}>
      {canExport ? <ResultsExportBody workspaceId={workspaceId} programId={programId} /> : <ResultsLocked capability="export" canManage={canGrant} viewerId={viewerId} workspaceId={workspaceId} programId={programId} />}
    </SideSheet>
  </>;
}

/**
 * Che cosa c'è nel file e il pulsante per scaricarlo: nel pannello «Scarica», oppure nella pagina per chi ha soltanto
 * il permesso di scaricare (non vede né «In aula» né «Persone»).
 */
export function ResultsExportBody({ workspaceId, programId }: { workspaceId: string; programId: string }) {
  return <div className="space-y-4" data-testid="results-export">
    <p className="text-sm">{R.downloadText}</p>
    <details className="text-sm">
      <summary className="min-h-11 cursor-pointer py-2 font-medium sm:min-h-9">{R.downloadColumns}</summary>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted-foreground">{COLUMNS.map((column) => <li key={column}>{column}</li>)}</ul>
    </details>
    <LearningExportButton workspaceId={workspaceId} programId={programId} />
    <p className="border-t pt-3 text-sm text-muted-foreground">{R.downloadCare}</p>
  </div>;
}
