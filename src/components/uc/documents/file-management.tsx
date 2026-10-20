"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Database, Eye, FileSearch, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SELECT_CLASS } from "@/components/uc/catalog/catalog-filters";
import { CHECKBOX_CLASS } from "@/components/uc/catalog/checkbox";
import { filePath } from "@/components/uc/catalog/paths";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { createDatasetAction, deleteFileAction, reviewQuarantinedFileAction, validateDatasetAction } from "@/lib/actions/uc-files";
import type { PanelFile, UploadPanelData } from "@/lib/db/queries/uc-files";
import { formatSize } from "./upload-transport";
import { formatCountIt, formatDateIt } from "@/lib/uc/views/format";

/**
 * Gestione dei file del caso per Lateral Space (PIANO §6.3, §6.5):
 * - **Da controllare**: PDF con testo scarso in quarantena. Li apre e li
 *   segna una persona di Lateral Space diversa da chi li ha caricati.
 * - **Schede dataset**: da un CSV o XLSX pronto si crea la scheda (periodo,
 *   data di estrazione, metodo, fuso, titolare dei dati); un'altra persona la
 *   valida o la rifiuta.
 * - **Cancella un file** (Responsabile del caso): le prove usate dal caso non
 *   si cancellano.
 * Solo metadati: nomi dei file, chiavi delle voci, dimensioni.
 */

function fileMeta(f: PanelFile): string {
  return [f.itemKey, formatSize(f.size), formatDateIt(f.createdAt), f.fromReferent ? "dal referente" : f.uploadedByMe ? "caricato da te" : null]
    .filter(Boolean)
    .join(" · ");
}

/** PDF da controllare a mano: li apre e li segna una persona di Lateral Space diversa da chi li ha caricati. */
export function QuarantineReviews({ workspaceId, caseId, reviews, heading = true }: { workspaceId: string; caseId: string; reviews: UploadPanelData["reviews"]; heading?: boolean }) {
  const { pending, run } = useUcAction();
  if (reviews.length === 0) return null;
  return (
    <section className="space-y-2">
      {heading && (
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <FileSearch className="size-4 text-muted-foreground" aria-hidden />
          Da controllare · {reviews.length}
        </h4>
      )}
      <p className="text-xs text-muted-foreground">PDF che non riusciamo a leggere bene. Aprili e controlla che non ci siano dati sanitari o personali non richiesti.</p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {reviews.map((f) => (
          <li key={f.id} className="flex min-w-0 flex-col gap-2 p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium break-all">{f.name}</p>
              <p className="text-xs break-words text-muted-foreground">{fileMeta(f)}</p>
              {!f.canReview && f.reviewReason ? <p className="text-xs break-words text-muted-foreground">{f.reviewReason}</p> : null}
            </div>
            {f.canReview ? (
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button size="sm" variant="outline" render={<a href={filePath(workspaceId, caseId, f.id)} />} nativeButton={false}>
                  <Eye aria-hidden />
                  Apri
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => run(() => reviewQuarantinedFileAction(workspaceId, caseId, { fileId: f.id, outcome: "pulito" }), { success: "File segnato come pulito: ora si può usare." })}
                >
                  <CheckCircle2 aria-hidden />
                  È pulito
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-uc-rosso"
                  disabled={pending}
                  onClick={() => run(() => reviewQuarantinedFileAction(workspaceId, caseId, { fileId: f.id, outcome: "rifiutato" }), { success: "File rifiutato e cancellato." })}
                >
                  <XCircle aria-hidden />
                  Rifiuta
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface DatasetForm {
  periodFrom: string;
  periodTo: string;
  extractedAt: string;
  extractionMethod: string;
  timezone: string;
  dataControllerLabel: string;
  pseudonymized: boolean;
  sourceKey: string;
}

const FIELD = "h-11 text-base sm:h-9 sm:text-sm";

/** Una fonte del catalogo, per titolo: la scheda dataset dice da quale fonte viene il file. */
export interface DatasetSource {
  key: string;
  title: string;
}

/**
 * La scheda dataset di un CSV o XLSX pronto: fonte (per titolo, non più una
 * chiave da scrivere, §3.6.6), periodo, data di estrazione, metodo, fuso e
 * titolare dei dati. Poi la verifica un'altra persona di Lateral Space.
 */
export function DatasetCreateForm({
  workspaceId,
  caseId,
  file,
  controller,
  sources,
  onDone,
}: {
  workspaceId: string;
  caseId: string;
  file: UploadPanelData["datasetCandidates"][number];
  controller: string | null;
  sources: readonly DatasetSource[];
  onDone: () => void;
}) {
  const { pending, run } = useUcAction();
  const [f, setF] = useState<DatasetForm>({
    periodFrom: "",
    periodTo: "",
    extractedAt: "",
    extractionMethod: "",
    timezone: "Europe/Rome",
    dataControllerLabel: controller ?? "",
    pseudonymized: false,
    sourceKey: file.suggestedSourceKey ?? "",
  });
  const set = (patch: Partial<DatasetForm>) => setF({ ...f, ...patch });
  const id = `uc-ds-${file.id}`;
  // La fonte proposta (la voce del file) resta tra le scelte anche se non è tra le fonti del catalogo.
  const sourceOptions = file.suggestedSourceKey && !sources.some((o) => o.key === file.suggestedSourceKey) ? [{ key: file.suggestedSourceKey, title: file.itemTitle ?? file.suggestedSourceKey }, ...sources] : sources;
  return (
    <form
      className="mt-2 space-y-3 rounded-lg border border-border bg-muted/20 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            createDatasetAction(workspaceId, caseId, {
              fileId: file.id,
              sourceKey: f.sourceKey.trim() || null,
              periodFrom: f.periodFrom || null,
              periodTo: f.periodTo || null,
              extractedAt: f.extractedAt || null,
              extractionMethod: f.extractionMethod,
              timezone: f.timezone || null,
              dataControllerLabel: f.dataControllerLabel,
              pseudonymized: f.pseudonymized,
            }),
          { success: "Scheda dataset creata. Ora la verifica un'altra persona di Lateral Space.", onSuccess: onDone },
        );
      }}
    >
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${id}-src`}>Fonte</Label>
          <select id={`${id}-src`} className={SELECT_CLASS} value={f.sourceKey} onChange={(e) => set({ sourceKey: e.target.value })} required>
            <option value="">Scegli la fonte</option>
            {sourceOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.title}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-from`}>Periodo dal</Label>
          <Input id={`${id}-from`} type="date" value={f.periodFrom} onChange={(e) => set({ periodFrom: e.target.value })} className={FIELD} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-to`}>al</Label>
          <Input id={`${id}-to`} type="date" value={f.periodTo} onChange={(e) => set({ periodTo: e.target.value })} className={FIELD} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-ext`}>Estratto il</Label>
          <Input id={`${id}-ext`} type="date" value={f.extractedAt} onChange={(e) => set({ extractedAt: e.target.value })} className={FIELD} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-tz`}>Fuso orario delle date</Label>
          <select id={`${id}-tz`} className={SELECT_CLASS} value={f.timezone} onChange={(e) => set({ timezone: e.target.value })}>
            <option value="Europe/Rome">Ora italiana (Europe/Rome)</option>
            <option value="UTC">UTC</option>
            <option value="">Non lo so</option>
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${id}-method`}>Come è stato estratto</Label>
          <Input id={`${id}-method`} value={f.extractionMethod} maxLength={500} onChange={(e) => set({ extractionMethod: e.target.value })} placeholder="Es. export dal sistema, filtro sugli ultimi 12 mesi" className={FIELD} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${id}-ctrl`}>Titolare dei dati</Label>
          <Input id={`${id}-ctrl`} value={f.dataControllerLabel} maxLength={255} onChange={(e) => set({ dataControllerLabel: e.target.value })} placeholder="Es. la società del cliente" className={FIELD} required />
        </div>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm sm:min-h-9">
        <input type="checkbox" className={CHECKBOX_CLASS} checked={f.pseudonymized} onChange={(e) => set({ pseudonymized: e.target.checked })} />
        <span>Le colonne personali sono già pseudonimizzate (codici al posto dei nomi)</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={pending || f.dataControllerLabel.trim().length < 2 || f.sourceKey === ""}>
          Crea la scheda
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Annulla
        </Button>
      </div>
    </form>
  );
}

function Datasets({ workspaceId, caseId, data }: { workspaceId: string; caseId: string; data: UploadPanelData }) {
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState<string | null>(null);
  if (data.datasetCandidates.length === 0 && data.datasets.length === 0) return null;
  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <Database className="size-4 text-muted-foreground" aria-hidden />
        Schede dataset
      </h4>
      {data.datasetCandidates.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {data.datasetCandidates.map((f) => (
            <li key={f.id} className="min-w-0 p-3">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium break-all">{f.name}</p>
                  <p className="text-xs break-words text-muted-foreground">{fileMeta(f)}</p>
                </div>
                {open !== f.id ? (
                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => setOpen(f.id)}>
                    Crea la scheda
                  </Button>
                ) : null}
              </div>
              {open === f.id ? <DatasetCreateForm workspaceId={workspaceId} caseId={caseId} file={f} controller={data.dataControllerLabel} sources={sourcesOf(data)} onDone={() => setOpen(null)} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {data.datasets.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {data.datasets.map((d) => (
            <li key={d.id} className="flex min-w-0 flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm font-medium break-all">
                  <code className="font-mono">{d.sourceKey}</code> · v{d.version}
                </p>
                <p className="text-xs break-words text-muted-foreground">
                  {[d.fileName, d.rows !== null ? `${formatCountIt(d.rows)} righe` : null].filter(Boolean).join(" · ")}
                </p>
                {d.dqError ? (
                  <p className="flex items-center gap-1.5 text-xs text-uc-rosso">
                    <AlertTriangle className="size-3.5" aria-hidden />
                    Un controllo di qualità ha trovato un errore.
                  </p>
                ) : null}
              </div>
              {d.canDecide ? (
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => validateDatasetAction(workspaceId, caseId, { datasetId: d.id, outcome: "validato" }), { success: "Scheda dataset validata." })}>
                    <CheckCircle2 aria-hidden />
                    Valida
                  </Button>
                  <Button size="sm" variant="outline" className="text-uc-rosso" disabled={pending} onClick={() => run(() => validateDatasetAction(workspaceId, caseId, { datasetId: d.id, outcome: "rifiutato" }), { success: "Scheda dataset rifiutata." })}>
                    <XCircle aria-hidden />
                    Rifiuta
                  </Button>
                </div>
              ) : (
                <p className="shrink-0 text-xs text-muted-foreground">La verifica un&apos;altra persona di Lateral Space.</p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function DeleteFile({ workspaceId, caseId, files }: { workspaceId: string; caseId: string; files: PanelFile[] }) {
  const { pending, run } = useUcAction();
  const [fileId, setFileId] = useState("");
  const [confirming, setConfirming] = useState(false);
  if (files.length === 0) return null;
  return (
    <details className="group rounded-lg border border-border px-3 py-1 text-sm">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 select-none sm:min-h-9">
        <Trash2 className="size-4 text-muted-foreground" aria-hidden />
        Cancella un file
      </summary>
      <div className="space-y-3 pb-3">
        <p className="text-xs text-muted-foreground">Il file sparisce dall&apos;archivio; nel registro resta che è stato cancellato. Le prove usate dal caso non si cancellano.</p>
        <select
          className={SELECT_CLASS}
          value={fileId}
          aria-label="File da cancellare"
          onChange={(e) => {
            setFileId(e.target.value);
            setConfirming(false);
          }}
        >
          <option value="">Scegli il file</option>
          {files.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.itemKey ? ` · ${f.itemKey}` : ""}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2">
          {!confirming ? (
            <Button size="sm" variant="outline" disabled={!fileId || pending} onClick={() => setConfirming(true)}>
              Cancella
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  run(() => deleteFileAction(workspaceId, caseId, { fileId }), {
                    success: "File cancellato.",
                    onSuccess: () => {
                      setFileId("");
                      setConfirming(false);
                    },
                  })
                }
              >
                Sì, cancella il file
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Annulla
              </Button>
            </>
          )}
        </div>
      </div>
    </details>
  );
}

/** Fuori dalla pagina Documenti la fonte proposta è la voce stessa (una fonte o un documento). */
function sourcesOf(data: UploadPanelData): DatasetSource[] {
  return data.target.itemKey ? [{ key: data.target.itemKey, title: data.target.itemTitle ?? data.target.itemKey }] : [];
}

export function FileManagement({ workspaceId, caseId, data }: { workspaceId: string; caseId: string; data: UploadPanelData }) {
  const empty = data.reviews.length === 0 && data.datasetCandidates.length === 0 && data.datasets.length === 0 && data.deletable.length === 0;
  if (empty) return null;
  return (
    <div className="min-w-0 space-y-4 border-t border-border pt-4">
      <QuarantineReviews workspaceId={workspaceId} caseId={caseId} reviews={data.reviews} />
      <Datasets workspaceId={workspaceId} caseId={caseId} data={data} />
      <DeleteFile workspaceId={workspaceId} caseId={caseId} files={data.deletable} />
    </div>
  );
}
