import { FileSpreadsheet, ShieldAlert } from "lucide-react";
import { LearningExportButton } from "./export-button";

const COLUMNS = ["Partecipante", "Email", "Turno", "Attività", "Prova", "Stato", "Esito", "Risposte giuste", "Domande", "Risposte importanti sbagliate", "Consegnato il"];

/** Scarica: che cosa c'è nel file, dove si apre, e che il download resta registrato. */
export function ResultsExport({ workspaceId, programId }: { workspaceId: string; programId: string }) {
  return <div className="space-y-5 rounded-2xl border bg-card p-5 sm:p-8">
    <div className="flex items-start gap-4">
      <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
        <FileSpreadsheet aria-hidden className="size-6" />
      </span>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold">Scarica i risultati individuali</h2>
        <p className="max-w-prose text-muted-foreground">
          Un file con una riga per ogni persona e per ogni volta che ha fatto un esercizio. Comprende tutti i turni che puoi vedere.
        </p>
      </div>
    </div>
    <div className="space-y-2">
      <p className="text-sm font-medium">Le colonne del file</p>
      <ul className="flex flex-wrap gap-2">
        {COLUMNS.map((column) => <li key={column} className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">{column}</li>)}
      </ul>
    </div>
    <p className="text-sm text-muted-foreground">Si apre direttamente in Excel: le colonne sono separate dal punto e virgola.</p>
    <LearningExportButton workspaceId={workspaceId} programId={programId} />
    <p className="flex items-start gap-2 border-t pt-4 text-sm text-muted-foreground">
      <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-300" />
      Il file contiene nomi ed email. Ogni download viene registrato nel registro del corso: conserva il file con cura.
    </p>
  </div>;
}
