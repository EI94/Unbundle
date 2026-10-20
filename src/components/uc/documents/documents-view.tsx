"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, FileText, Lock, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { filePath } from "@/components/uc/catalog/paths";
import { SELECT_CLASS } from "@/components/uc/catalog/catalog-filters";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { ActionMenu, type ActionMenuItem } from "@/components/uc/ui/action-menu";
import { DetailSheetFrame } from "@/components/uc/ui/detail-sheet";
import { EmptyState } from "@/components/uc/ui/empty-state";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { deleteFileAction, validateDatasetAction } from "@/lib/actions/uc-files";
import type { UploadPanelData } from "@/lib/db/queries/uc-files";
import { cn } from "@/lib/utils";
import { reviewsText, type CaseFileRow, type DatasetCard, type DatasetWithoutFileRow, type PreviewTable, type RequiredDocumentRow } from "@/lib/uc/views/documents";
import { WORDS } from "@/lib/uc/views/labels";
import { DatasetCreateForm, QuarantineReviews, type DatasetSource } from "./file-management";
import { UploadPanelClient } from "./upload-panel-client";

export interface DocumentsViewProps {
  workspaceId: string;
  caseId: string;
  /** `/domande`: la pagina di una domanda è `${questionsBase}/<id>`. */
  questionsBase: string;
  required: RequiredDocumentRow[];
  files: CaseFileRow[];
  /** Schede dataset il cui file non è in elenco (cancellato): restano visibili qui. */
  datasetsWithoutFile: DatasetWithoutFileRow[];
  /** «Carica un file» (Lateral Space): dove si può caricare. Null = chi guarda non carica. */
  upload: {
    allowed: boolean;
    reason: string | null;
    clientMode: boolean;
    /** «Documento del caso» e i documenti richiesti; `personal` = zona personale. */
    targets: { id: string | null; title: string; personal: boolean }[];
  } | null;
  /** Gestione di Lateral Space: PDF da controllare, schede dataset. Null per gli altri. */
  manage: {
    reviews: UploadPanelData["reviews"];
    candidates: UploadPanelData["datasetCandidates"];
    controller: string | null;
    sources: DatasetSource[];
  } | null;
  /** Una riga sulla zona personale, per chi ne vede i file. */
  personalNote: string | null;
}

/**
 * Documenti (DESIGN §3.6.6): i documenti richiesti con chi li fornisce e lo
 * stato, i file caricati che si aprono su anteprima mascherata e scheda
 * dataset, le azioni di Lateral Space nel «⋯» di ogni file. «Carica un file»
 * apre un pannello con la dichiarazione, la destinazione (e la sua zona) e la
 * scelta del file.
 */
export function DocumentsView({ workspaceId, caseId, questionsBase, required, files, datasetsWithoutFile, upload, manage, personalNote }: DocumentsViewProps) {
  const { pending, run } = useUcAction();
  const [uploading, setUploading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [datasetFor, setDatasetFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CaseFileRow | null>(null);
  const [targetId, setTargetId] = useState("");
  const target = upload?.targets.find((t) => (t.id ?? "") === targetId) ?? upload?.targets[0] ?? null;
  const candidate = manage?.candidates.find((c) => c.id === datasetFor) ?? null;
  const uploadButton = upload ? (
    <Button variant="outline" className="min-h-11 sm:min-h-8" onClick={() => setUploading(true)}>
      <Upload aria-hidden />
      Carica un file
    </Button>
  ) : null;

  const menuFor = (f: CaseFileRow): ActionMenuItem[] => {
    const items: ActionMenuItem[] = [];
    if (f.actions.download) items.push({ label: "Scarica", href: filePath(workspaceId, caseId, f.id) });
    if (f.actions.createDataset) items.push({ label: "Crea scheda dataset", onSelect: () => setDatasetFor(f.id) });
    if (f.actions.decide) {
      const datasetId = f.actions.decide.datasetId;
      items.push({ label: "Valida la scheda", disabled: pending, onSelect: () => run(() => validateDatasetAction(workspaceId, caseId, { datasetId, outcome: "validato" }), { success: "Scheda dataset validata." }) });
      items.push({ label: "Rifiuta", disabled: pending, onSelect: () => run(() => validateDatasetAction(workspaceId, caseId, { datasetId, outcome: "rifiutato" }), { success: "Scheda dataset rifiutata." }) });
    } else if (f.actions.decideBlocked) {
      items.push({ label: "Valida la scheda", disabled: true, hint: "La verifica un'altra persona di Lateral Space." });
    }
    if (f.actions.delete) items.push({ label: "Cancella", destructive: true, onSelect: () => setDeleting(f) });
    return items;
  };
  const reviewCount = manage?.reviews.length ?? 0;
  const reviewLine = reviewsText(reviewCount);

  return (
    <div className="min-w-0 space-y-8">
      <section className="min-w-0 space-y-3" aria-labelledby="uc-doc-richiesti">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h2 id="uc-doc-richiesti" className="text-base font-semibold">
            Documenti richiesti
          </h2>
          {uploadButton}
        </div>
        {required.length === 0 ? (
          <EmptyState title="Nessun documento richiesto." />
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
            {required.map((d) => {
              const body = (
                <>
                  <span className="mt-1.5 shrink-0">
                    <StatusDot tone={d.tone} label={d.label} hideLabel />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium break-words">{d.title}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground sm:hidden">
                      <span className={cn(d.missing && "text-uc-giallo")}>{d.who}</span>
                      <span aria-hidden>·</span>
                      <span className="text-foreground">{d.label}</span>
                    </span>
                  </span>
                  {d.personal && (
                    <span title={WORDS.datoPersonale} className="mt-0.5 shrink-0 text-uc-lucchetto">
                      <Lock className="size-3.5" aria-hidden />
                      <span className="sr-only">{WORDS.datoPersonale}</span>
                    </span>
                  )}
                  <span className={cn("hidden w-40 shrink-0 truncate text-sm sm:block", d.missing ? "text-uc-giallo" : "text-muted-foreground")}>{d.who}</span>
                  <span className="hidden w-28 shrink-0 text-sm sm:block">{d.label}</span>
                  {d.canOpen && <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
                </>
              );
              return (
                <li key={d.id}>
                  {d.canOpen ? (
                    <Link href={`${questionsBase}/${d.id}`} className="flex min-h-14 min-w-0 items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none sm:px-4">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex min-h-14 min-w-0 items-start gap-3 px-3 py-2.5 sm:px-4">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="min-w-0 space-y-3" aria-labelledby="uc-doc-file">
        <h2 id="uc-doc-file" className="text-base font-semibold">
          File caricati{files.length > 0 && <span className="font-normal text-muted-foreground"> · {files.length}</span>}
        </h2>
        {files.length === 0 ? (
          <EmptyState title="Nessun file caricato." action={uploadButton} />
        ) : (
          <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
            {files.map((f) => (
              <li key={f.id} className="flex min-w-0 items-start gap-2 px-3 py-1.5 sm:px-4">
                <details className="group min-w-0 flex-1">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-1 [&::-webkit-details-marker]:hidden">
                    {f.zone === "personale" ? <Lock className="size-4 shrink-0 text-uc-lucchetto" aria-hidden /> : <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{f.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{f.meta}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                  </summary>
                  <FileDetails file={f} questionsBase={questionsBase} />
                </details>
                <ActionMenu items={menuFor(f)} label={`Azioni sul file ${f.name}`} className="mt-1" />
              </li>
            ))}
          </ul>
        )}
        {personalNote && <p className="text-xs text-muted-foreground">{personalNote}</p>}
      </section>

      {datasetsWithoutFile.length > 0 && (
        <section className="min-w-0 space-y-3" aria-labelledby="uc-doc-schede">
          <h2 id="uc-doc-schede" className="text-base font-semibold">
            Schede senza file<span className="font-normal text-muted-foreground"> · {datasetsWithoutFile.length}</span>
          </h2>
          <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
            {datasetsWithoutFile.map((d) => (
              <li key={d.id} className="min-w-0 px-3 py-2.5 text-sm sm:px-4">
                <p className="font-medium break-words">{d.title}</p>
                <DatasetLine card={d} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {reviewLine && (
        <p className="text-sm text-muted-foreground">
          {reviewLine} ·{" "}
          <button type="button" className="inline-flex min-h-11 items-center font-medium text-foreground underline-offset-4 hover:underline sm:min-h-0" onClick={() => setReviewing(true)}>
            Controlla ›
          </button>
        </p>
      )}

      {upload && target && (
        <DetailSheetFrame open={uploading} onOpenChange={setUploading} title="Carica un file" size="xl">
          {upload.allowed ? (
            <div className="min-w-0 space-y-4">
              <label className="block space-y-1.5 text-sm">
                <span className="text-muted-foreground">Per</span>
                <select className={cn(SELECT_CLASS, "min-h-11 sm:min-h-8")} value={target.id ?? ""} onChange={(e) => setTargetId(e.target.value)}>
                  {upload.targets.map((t) => (
                    <option key={t.id ?? "caso"} value={t.id ?? ""}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                {target.personal ? <Lock className="mt-0.5 size-4 shrink-0 text-uc-lucchetto" aria-hidden /> : <FileText className="mt-0.5 size-4 shrink-0" aria-hidden />}
                {target.personal ? "Zona personale: il file resta cifrato e si apre solo dopo la scheda privacy." : "Zona standard: il file si controlla e si mostra con le colonne personali mascherate."}
              </p>
              <UploadPanelClient key={target.id ?? "caso"} workspaceId={workspaceId} caseId={caseId} itemId={target.id} personal={target.personal} clientMode={upload.clientMode && !target.personal} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{upload.reason ?? "Qui non puoi caricare file."}</p>
          )}
        </DetailSheetFrame>
      )}

      {manage && reviewCount > 0 && (
        <DetailSheetFrame open={reviewing} onOpenChange={setReviewing} title="File da controllare a mano" description="PDF che non riusciamo a leggere bene. Aprili e controlla che non ci siano dati sanitari o personali non richiesti." size="xl">
          <QuarantineReviews workspaceId={workspaceId} caseId={caseId} reviews={manage.reviews} heading={false} />
        </DetailSheetFrame>
      )}

      {manage && candidate && (
        <DetailSheetFrame open onOpenChange={(o) => !o && setDatasetFor(null)} title="Crea la scheda dataset" description={candidate.name} size="xl">
          <DatasetCreateForm workspaceId={workspaceId} caseId={caseId} file={candidate} controller={manage.controller} sources={manage.sources} onDone={() => setDatasetFor(null)} />
        </DetailSheetFrame>
      )}

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && !pending && setDeleting(null)}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancellare «{deleting?.name}»?</DialogTitle>
            <DialogDescription>Il file sparisce dall&apos;archivio; nell&apos;attività resta che è stato cancellato. Le prove usate dal caso non si cancellano.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => setDeleting(null)} disabled={pending}>
              Annulla
            </Button>
            <Button
              variant="destructive"
              className="min-h-11 sm:min-h-8"
              disabled={pending || deleting === null}
              onClick={() => deleting && run(() => deleteFileAction(workspaceId, caseId, { fileId: deleting.id }), { success: "File cancellato.", onSuccess: () => setDeleting(null) })}
            >
              Cancella
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Si apre sotto la riga: esito dei controlli, la domanda, anteprima mascherata e scheda dataset. */
function FileDetails({ file: f, questionsBase }: { file: CaseFileRow; questionsBase: string }) {
  return (
    <div className="min-w-0 space-y-3 pt-1 pb-3 pl-6 text-sm">
      {f.item && (
        <p className="text-muted-foreground">
          Per la domanda{" "}
          <Link href={`${questionsBase}/${f.item.id}`} className="text-foreground underline-offset-4 hover:underline">
            {f.item.title}
          </Link>
        </p>
      )}
      {f.findings.length > 0 && (
        <ul className="text-xs text-muted-foreground">
          {f.findings.map((x) => (
            <li key={x} className="break-words">
              {x}
            </li>
          ))}
        </ul>
      )}
      {f.preview && <PreviewGrid preview={f.preview} />}
      {f.zone === "personale" && <p className="text-xs text-muted-foreground">Zona personale: solo i dati del file, mai il contenuto.</p>}
      {f.dataset && (
        <div className="min-w-0 space-y-1">
          <p className="font-medium">Scheda dataset</p>
          <DatasetLine card={f.dataset} />
        </div>
      )}
    </div>
  );
}

/** La scheda dataset in una riga grigia: stato, periodo, righe, titolare, conservazione. */
function DatasetLine({ card }: { card: DatasetCard }) {
  return (
    <p className="text-xs break-words text-muted-foreground">
      {[card.status, card.period ? `Periodo ${card.period}` : null, card.rows ? `${card.rows} righe` : null, `Titolare: ${card.controller}`, card.retention ? `Si conserva fino al ${card.retention}` : null].filter(Boolean).join(" · ")}
    </p>
  );
}

function PreviewGrid({ preview }: { preview: PreviewTable }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs text-muted-foreground">Prime righe, con le colonne personali mascherate (•••).{preview.totalRows !== null ? ` Righe nel file: ${preview.totalRows}.` : ""}</p>
      <div className="max-w-full overflow-x-auto rounded-lg ring-1 ring-foreground/10">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/40">
              {preview.columns.map((c, i) => (
                <th key={i} className={cn("px-2 py-1.5 text-left font-medium whitespace-nowrap", preview.maskedColumns.includes(i) && "text-uc-lucchetto")}>
                  {c || `Colonna ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((r, ri) => (
              <tr key={ri} className="border-b last:border-0">
                {r.map((cell, ci) => (
                  <td key={ci} className="max-w-48 truncate px-2 py-1" title={cell}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.truncated && <p className="text-xs text-muted-foreground">L&apos;anteprima mostra solo una parte del file.</p>}
    </div>
  );
}
