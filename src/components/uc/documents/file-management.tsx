"use client";

import { useState } from "react";
import { CheckCircle2, Eye, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SELECT_CLASS } from "@/components/uc/catalog/catalog-filters";
import { CHECKBOX_CLASS } from "@/components/uc/catalog/checkbox";
import { filePath } from "@/components/uc/catalog/paths";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { createDatasetAction, reviewQuarantinedFileAction } from "@/lib/actions/uc-files";
import type { PanelFile, UploadPanelData } from "@/lib/db/queries/uc-files";
import { DOMANDE_TEXT } from "@/lib/uc/views/domande-text";
import { formatDateIt } from "@/lib/uc/views/format";
import { formatSize } from "./upload-transport";

/**
 * Due pezzi della gestione dei file di Lateral Space (PIANO §6.3, §6.5), usati dal pannello «File» (rilascio 10,
 * §3.5; `file-panel.tsx`), l'unico posto dove si gestiscono i file:
 * - **Da controllare**: PDF con testo scarso in quarantena. Li apre e li segna una persona di Lateral Space diversa da
 *   chi li ha caricati.
 * - **La scheda dataset** di un CSV o XLSX pronto (periodo, data di estrazione, metodo, fuso, titolare dei dati); poi
 *   un'altra persona la valida o la rifiuta, dal «⋯» del file.
 * Cancellare un file sta nel «⋯» del file, con la sua finestra di conferma. Solo metadati: nomi, dimensioni, date.
 */

function fileMeta(f: PanelFile): string {
  return [f.itemKey, formatSize(f.size), formatDateIt(f.createdAt), f.fromReferent ? "dal referente" : f.uploadedByMe ? "caricato da te" : null]
    .filter(Boolean)
    .join(" · ");
}

/**
 * PDF da controllare a mano: li apre e li segna una persona di Lateral Space diversa da chi li ha caricati. «È pulito»
 * vale subito; «Rifiuta» cancella il file e chiede conferma nella finestra del pannello (`onReject`), come «Cancella».
 */
export function QuarantineReviews({
  workspaceId,
  caseId,
  reviews,
  heading = true,
  onReject,
}: {
  workspaceId: string;
  caseId: string;
  reviews: UploadPanelData["reviews"];
  heading?: boolean;
  onReject: (file: { id: string; name: string }) => void;
}) {
  const { pending, run } = useUcAction();
  if (reviews.length === 0) return null;
  return (
    <div className="space-y-2">
      {heading && <h3 className="text-base font-semibold">{DOMANDE_TEXT.files.toCheck(reviews.length)}</h3>}
      <p className="text-xs text-muted-foreground">{DOMANDE_TEXT.files.toCheckNote}</p>
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
                <Button size="sm" variant="outline" className="min-h-11 sm:min-h-7" render={<a href={filePath(workspaceId, caseId, f.id)} />} nativeButton={false}>
                  <Eye aria-hidden />
                  {DOMANDE_TEXT.files.open}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11 sm:min-h-7"
                  disabled={pending}
                  onClick={() => run(() => reviewQuarantinedFileAction(workspaceId, caseId, { fileId: f.id, outcome: "pulito" }), { success: DOMANDE_TEXT.files.cleaned })}
                >
                  <CheckCircle2 aria-hidden />
                  {DOMANDE_TEXT.files.clean}
                </Button>
                <Button size="sm" variant="outline" className="min-h-11 text-uc-rosso sm:min-h-7" disabled={pending} onClick={() => onReject({ id: f.id, name: f.name })}>
                  <XCircle aria-hidden />
                  {DOMANDE_TEXT.files.reject}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
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
      className="space-y-3"
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
            <option value="Europe/Rome">Ora italiana</option>
            <option value="UTC">Ora universale</option>
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
        <Button type="submit" className="min-h-11 sm:min-h-8" disabled={pending || f.dataControllerLabel.trim().length < 2 || f.sourceKey === ""}>
          Crea la scheda
        </Button>
        <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" onClick={onDone}>
          {DOMANDE_TEXT.actions.cancel}
        </Button>
      </div>
    </form>
  );
}
