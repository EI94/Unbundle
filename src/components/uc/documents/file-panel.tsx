"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, FileText, Lock, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TextAction } from "@/components/ui-10/row";
import { AddressSheet } from "@/components/uc/catalog/address-sheet";
import { SELECT_CLASS } from "@/components/uc/catalog/catalog-filters";
import { filePath } from "@/components/uc/catalog/paths";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { ActionMenu, type ActionMenuItem } from "@/components/uc/ui/action-menu";
import { deleteFileAction, reviewQuarantinedFileAction, validateDatasetAction } from "@/lib/actions/uc-files";
import type { UploadPanelData } from "@/lib/db/queries/uc-files";
import { cn } from "@/lib/utils";
import type { CaseFileRow, DatasetCard, DatasetWithoutFileRow, PreviewTable } from "@/lib/uc/views/documents";
import { DOMANDE_TEXT } from "@/lib/uc/views/domande-text";
import { DatasetCreateForm, QuarantineReviews, type DatasetSource } from "./file-management";
import { UploadPanelClient } from "./upload-panel-client";

const T = DOMANDE_TEXT.files;

/** Quanti file si vedono prima di «Vedi tutti (N)» (§1, regola 4). */
const SHOWN = 3;

export interface FilePanelProps {
  workspaceId: string;
  caseId: string;
  /** `/domande`: la pagina di una domanda è `${questionsBase}/<id>`. */
  questionsBase: string;
  files: CaseFileRow[];
  /** Schede dataset il cui file non è in elenco (cancellato): restano visibili qui. */
  datasetsWithoutFile: DatasetWithoutFileRow[];
  /** «Carica un file» (Lateral Space): dove si può caricare. Null = chi guarda non carica. */
  upload: {
    allowed: boolean;
    reason: string | null;
    clientMode: boolean;
    /** Il primo (`id` e `title` null) è il documento della realizzazione, poi i documenti richiesti; `personal` = zona personale. */
    targets: { id: string | null; title: string | null; personal: boolean }[];
  } | null;
  /** Gestione di Lateral Space: PDF da controllare, schede dataset. Null per gli altri. */
  manage: {
    reviews: UploadPanelData["reviews"];
    candidates: UploadPanelData["datasetCandidates"];
    controller: string | null;
    sources: DatasetSource[];
  } | null;
  /** Chi guarda vede i file della zona personale (solo i dati del file): una riga calma lo dice. */
  personalNote: boolean;
  /** «Documenti richiesti (N)»: Domande con il filtro «Documenti». */
  required: { count: number; href: string };
}

/**
 * Il pannello «File» (rilascio 10, §3.5; `?apri=file`): l'archivio della realizzazione che stava in
 * `/domande/documenti`. In cima i PDF da controllare a mano (il passo «Controlla N file» della testata porta qui),
 * poi i file caricati (nome, stato e data; si aprono su anteprima nascosta, controlli e scheda dataset; le azioni di
 * Lateral Space nel «⋯»), le schede senza file e il link ai documenti richiesti, che sono il filtro «Documenti» di
 * Domande. «Carica un file» è il pulsante pieno del pannello e apre il caricamento qui dentro, senza caselle da
 * spuntare: il controllo automatico resta (regola del 04/11).
 */
export function FilePanel({ workspaceId, caseId, questionsBase, files, datasetsWithoutFile, upload, manage, personalNote, required }: FilePanelProps) {
  const { pending, run } = useUcAction();
  const [uploading, setUploading] = useState(false);
  const [all, setAll] = useState(false);
  const [datasetFor, setDatasetFor] = useState<string | null>(null);
  /** «Cancella» un file o «Rifiuta» un PDF da controllare: la stessa finestra di conferma. */
  const [confirming, setConfirming] = useState<{ kind: "delete" | "reject"; id: string; name: string } | null>(null);
  const [targetId, setTargetId] = useState("");
  const target = upload?.targets.find((t) => (t.id ?? "") === targetId) ?? upload?.targets[0] ?? null;
  const candidate = manage?.candidates.find((c) => c.id === datasetFor) ?? null;
  const reviews = manage?.reviews ?? [];
  const shown = all ? files : files.slice(0, SHOWN);
  // Il fuoco va dove compare il contenuto nuovo: il caricamento in cima, il primo file in più dopo «Vedi tutti».
  const uploadHeading = useRef<HTMLHeadingElement | null>(null);
  const firstMore = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (uploading) uploadHeading.current?.focus();
  }, [uploading]);
  useEffect(() => {
    if (all) firstMore.current?.focus();
  }, [all]);

  const decideItems = (actions: { decide: { datasetId: string } | null; decideBlocked: boolean }): ActionMenuItem[] => {
    if (actions.decide) {
      const datasetId = actions.decide.datasetId;
      return [
        { label: T.validateDataset, disabled: pending, onSelect: () => run(() => validateDatasetAction(workspaceId, caseId, { datasetId, outcome: "validato" }), { success: T.datasetValidated }) },
        { label: T.rejectDataset, disabled: pending, onSelect: () => run(() => validateDatasetAction(workspaceId, caseId, { datasetId, outcome: "rifiutato" }), { success: T.datasetRejected }) },
      ];
    }
    return actions.decideBlocked ? [{ label: T.validateDataset, disabled: true, hint: T.decideBlocked }] : [];
  };
  const menuFor = (f: CaseFileRow): ActionMenuItem[] => {
    const items: ActionMenuItem[] = [];
    if (f.actions.download) items.push({ label: T.download, href: filePath(workspaceId, caseId, f.id) });
    if (f.actions.createDataset) items.push({ label: T.createDataset, onSelect: () => setDatasetFor(f.id) });
    items.push(...decideItems(f.actions));
    if (f.actions.delete) items.push({ label: T.delete, destructive: true, onSelect: () => setConfirming({ kind: "delete", id: f.id, name: f.name }) });
    return items;
  };
  const confirm = () => {
    if (!confirming) return;
    const done = { onSuccess: () => setConfirming(null) };
    if (confirming.kind === "delete") run(() => deleteFileAction(workspaceId, caseId, { fileId: confirming.id }), { success: T.deleted, ...done });
    else run(() => reviewQuarantinedFileAction(workspaceId, caseId, { fileId: confirming.id, outcome: "rifiutato" }), { success: T.rejected, ...done });
  };

  return (
    <AddressSheet
      title={T.title}
      footer={
        upload && !uploading ? (
          <Button className="min-h-11 w-full sm:min-h-9" onClick={() => setUploading(true)}>
            <Upload aria-hidden data-icon="inline-start" />
            {T.upload}
          </Button>
        ) : undefined
      }
    >
      <div data-slot="file-panel" className="min-w-0 space-y-6">
        {upload && uploading && target && (
          <section aria-label={T.upload} className="min-w-0 space-y-3 rounded-xl p-3 ring-1 ring-foreground/10">
            <h3 ref={uploadHeading} tabIndex={-1} className="rounded-sm text-base font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              {T.upload}
            </h3>
            {upload.allowed ? (
              <>
                <label className="block space-y-1.5 text-sm">
                  <span className="text-muted-foreground">{T.uploadFor}</span>
                  <select className={SELECT_CLASS} value={target.id ?? ""} onChange={(e) => setTargetId(e.target.value)}>
                    {upload.targets.map((t) => (
                      <option key={t.id ?? "realizzazione"} value={t.id ?? ""}>
                        {t.title ?? T.caseDocument}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  {target.personal ? <Lock className="mt-0.5 size-4 shrink-0 text-uc-lucchetto" aria-hidden /> : <FileText className="mt-0.5 size-4 shrink-0" aria-hidden />}
                  {target.personal ? T.zonePersonal : T.zoneStandard}
                </p>
                <UploadPanelClient key={target.id ?? "realizzazione"} workspaceId={workspaceId} caseId={caseId} itemId={target.id} personal={target.personal} clientMode={upload.clientMode && !target.personal} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{upload.reason ?? T.uploadUnavailable}</p>
            )}
            <Button variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => setUploading(false)}>
              {DOMANDE_TEXT.actions.cancel}
            </Button>
          </section>
        )}

        {manage && reviews.length > 0 && (
          <section aria-labelledby="uc-file-da-controllare" className="min-w-0 space-y-2">
            <h3 id="uc-file-da-controllare" className="text-base font-semibold">
              {T.toCheck(reviews.length)}
            </h3>
            <QuarantineReviews workspaceId={workspaceId} caseId={caseId} reviews={reviews} heading={false} onReject={(f) => setConfirming({ kind: "reject", ...f })} />
          </section>
        )}

        <section aria-labelledby="uc-file-caricati" className="min-w-0 space-y-2">
          <h3 id="uc-file-caricati" className="text-base font-semibold">
            {T.uploaded}
          </h3>
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">{T.none}</p>
          ) : (
            <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
              {shown.map((f, i) => (
                <li key={f.id} className="flex min-w-0 items-start gap-2 px-3 py-1.5">
                  <details className="group min-w-0 flex-1">
                    <summary
                      ref={i === SHOWN ? firstMore : undefined}
                      className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"
                    >
                      {f.zone === "personale" ? <Lock className="size-4 shrink-0 text-uc-lucchetto" aria-hidden /> : <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{f.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{f.meta}</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
                    </summary>
                    <FileDetails file={f} questionsBase={questionsBase} />
                  </details>
                  <ActionMenu items={menuFor(f)} label={T.menu(f.name)} className="mt-1" />
                </li>
              ))}
            </ul>
          )}
          {!all && files.length > SHOWN && <TextAction onClick={() => setAll(true)}>{T.seeAll(files.length)}</TextAction>}
        </section>

        {datasetsWithoutFile.length > 0 && (
          <section aria-labelledby="uc-file-schede" className="min-w-0 space-y-2">
            <h3 id="uc-file-schede" className="text-base font-semibold">
              {T.withoutFile}
            </h3>
            <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
              {datasetsWithoutFile.map((d) => (
                <li key={d.id} className="flex min-w-0 items-start gap-2 px-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">{d.title}</p>
                    <DatasetLine card={d} />
                  </div>
                  {/* Una scheda che aspetta la verifica si decide anche senza il suo file (F-074). */}
                  <ActionMenu items={decideItems(d.actions)} label={T.datasetMenu(d.title)} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {personalNote && <p className="text-xs text-muted-foreground">{T.personalNote}</p>}
        {required.count > 0 && <TextAction href={required.href}>{T.required(required.count)}</TextAction>}
      </div>

      {manage && candidate && (
        <Dialog open onOpenChange={(o) => !o && setDatasetFor(null)}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{T.createDataset}</DialogTitle>
              <DialogDescription className="break-all">{candidate.name}</DialogDescription>
            </DialogHeader>
            <DatasetCreateForm workspaceId={workspaceId} caseId={caseId} file={candidate} controller={manage.controller} sources={manage.sources} onDone={() => setDatasetFor(null)} />
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={confirming !== null} onOpenChange={(o) => !o && !pending && setConfirming(null)}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="break-words">{confirming ? (confirming.kind === "delete" ? T.deleteTitle(confirming.name) : T.rejectTitle(confirming.name)) : T.delete}</DialogTitle>
            <DialogDescription>{confirming?.kind === "reject" ? T.rejectBody : T.deleteBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => setConfirming(null)} disabled={pending}>
              {DOMANDE_TEXT.actions.cancel}
            </Button>
            <Button variant="destructive" className="min-h-11 sm:min-h-8" disabled={pending || confirming === null} onClick={confirm}>
              {confirming?.kind === "reject" ? T.reject : T.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AddressSheet>
  );
}

/** Si apre sotto la riga: la domanda del file, la misura, i controlli, l'anteprima nascosta e la scheda dataset. */
function FileDetails({ file: f, questionsBase }: { file: CaseFileRow; questionsBase: string }) {
  return (
    <div className="min-w-0 space-y-3 pt-1 pb-3 pl-6 text-sm">
      {f.item && (
        <p className="text-muted-foreground">
          {T.forQuestion}{" "}
          <Link href={`${questionsBase}/${f.item.id}`} className="text-foreground underline-offset-4 hover:underline">
            {f.item.title}
          </Link>
        </p>
      )}
      {f.size && <p className="text-xs text-muted-foreground">{f.size}</p>}
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
      {f.dataset && (
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{T.dataset}</p>
          <DatasetLine card={f.dataset} />
        </div>
      )}
    </div>
  );
}

/** La scheda dataset in una riga grigia: stato, periodo, righe, titolare, conservazione; sotto, in rosso, un errore di qualità. */
function DatasetLine({ card }: { card: DatasetCard }) {
  return (
    <>
      <p className="text-xs break-words text-muted-foreground">
        {[card.status, card.period ? T.datasetPeriod(card.period) : null, card.rows ? T.datasetRows(card.rows) : null, T.datasetController(card.controller), card.retention ? T.datasetRetention(card.retention) : null]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {card.dqError && <p className="text-xs text-uc-rosso">{T.datasetError}</p>}
    </>
  );
}

function PreviewGrid({ preview }: { preview: PreviewTable }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs text-muted-foreground">{[T.previewIntro, preview.totalRows !== null ? T.previewRows(preview.totalRows) : null].filter(Boolean).join(" ")}</p>
      <div className="max-w-full overflow-x-auto rounded-lg ring-1 ring-foreground/10">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/40">
              {preview.columns.map((c, i) => (
                <th key={i} className={cn("px-2 py-1.5 text-left font-medium whitespace-nowrap", preview.maskedColumns.includes(i) && "text-uc-lucchetto")}>
                  {c || T.previewColumn(i + 1)}
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
      {preview.truncated && <p className="text-xs text-muted-foreground">{T.previewPartial}</p>}
    </div>
  );
}
