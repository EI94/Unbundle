"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TEMPLATE_LIMITS, type ReferentUploadResult } from "@/lib/use-cases/referent/contract";
import { REFERENT_ERROR_MESSAGES, REFERENT_UI_TEXT } from "@/lib/use-cases/referent/labels";
import { uploadReferentFile } from "@/lib/use-cases/referent/upload-transport";
import { DecisionDialog } from "../../reopen-dialog";
import { Field, NeedChecklist, describedBy } from "./fields";

const T = REFERENT_UI_TEXT.templateDialog;
const F = REFERENT_UI_TEXT.fileDialog;
const TOASTS = REFERENT_UI_TEXT.toasts;

/** «Aggiungi un file da compilare» partendo da un'esigenza, oppure «Sostituisci» un file da compilare. */
export type TemplateDialogMode = { kind: "aggiungi"; needId: string } | { kind: "sostituisci"; fileId: string; fileName: string };

/** Il toast dopo il file: aggiunto o sostituito; un PDF con poco testo aspetta il controllo di un'altra persona. Mai «risposta». */
export function templateToast(file: Pick<ReferentUploadResult, "status">, replacing: boolean): string {
  if (replacing) return file.status === "in_revisione" ? TOASTS.templateReplacedReview : TOASTS.templateReplaced;
  return file.status === "in_revisione" ? TOASTS.templateAddedReview : TOASTS.templateAdded;
}

/** Le esigenze spuntate all'apertura: quella da cui si parte, se accetta un file da compilare. */
export function initialTemplateNeeds(needId: string, eligible: readonly { id: string }[]): string[] {
  const id = needId.toLowerCase();
  return eligible.some((n) => n.id === id) ? [id] : [];
}

/**
 * («File da compilare») Il file che il referente scarica, compila e ricarica: gli stessi tipi, limiti e controlli di
 * «Allega un file», ma non è una risposta (l'esigenza non cambia, niente avvisi). Si lega a una o più esigenze dello
 * stesso use case («Le esigenze a cui legarlo», quella da cui si parte già spuntata); «Sostituisci» carica una versione
 * nuova che prende i legami della vecchia. Un file non accettato lascia la finestra aperta con il motivo.
 */
export function TemplateDialog({
  workspaceId,
  useCaseId,
  mode,
  needs,
  clientMode,
  accept,
  onClose,
}: {
  workspaceId: string;
  useCaseId: string;
  mode: TemplateDialogMode;
  /** Le esigenze che accettano un file da compilare, nell'ordine della scheda (`templateNeedIds` con i titoli). */
  needs: readonly { id: string; title: string }[];
  clientMode: boolean;
  accept: string;
  onClose: () => void;
}) {
  const baseId = useId();
  const fileId = `${baseId}-file`;
  const needsId = `${baseId}-informazioni`;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<string[]>(() => (mode.kind === "aggiungi" ? initialTemplateNeeds(mode.needId, needs) : []));
  const [error, setError] = useState<string | null>(null);
  const replacing = mode.kind === "sostituisci";
  const help = clientMode ? F.help : F.helpServerOnly;

  async function confirm() {
    if (busy) return;
    if (!file) {
      setError(F.chooseFile);
      return;
    }
    // Nell'ordine della scheda, al massimo `needsPerFile`: il server ricontrolla ogni esigenza.
    const needIds = needs.map((n) => n.id).filter((id) => selected.includes(id)).slice(0, TEMPLATE_LIMITS.needsPerFile);
    if (!replacing && needIds.length === 0) {
      setError(REFERENT_ERROR_MESSAGES.domanda_non_disponibile);
      return;
    }
    setBusy(true);
    setError(null);
    const outcome = await uploadReferentFile(
      { kind: "da_compilare", workspaceId, useCaseId, needIds: replacing ? [] : needIds, replacesId: replacing ? mode.fileId : null },
      file,
      { clientMode },
    );
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    if (outcome.file.status === "rifiutato" || !outcome.file.usable) {
      setError(outcome.file.message ?? REFERENT_ERROR_MESSAGES.riprova);
      startTransition(() => router.refresh());
      return;
    }
    toast.success(templateToast(outcome.file, replacing));
    onClose();
    startTransition(() => router.refresh());
  }

  return (
    <DecisionDialog
      open
      onOpenChange={(next) => (next || busy ? undefined : onClose())}
      title={replacing ? T.replaceTitle : T.title}
      description={replacing ? mode.fileName : null}
      confirmLabel={replacing ? T.replaceConfirm : T.confirm}
      pending={busy || pending}
      error={error}
      onConfirm={() => void confirm()}
      className="sm:max-w-lg"
    >
      <div className="grid gap-3">
        <Field id={fileId} label={replacing ? T.replaceTitle : T.title} hint={help}>
          <Input
            id={fileId}
            type="file"
            accept={accept}
            aria-describedby={describedBy(fileId, help)}
            className="min-h-11 sm:min-h-8"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setError(null);
            }}
          />
        </Field>
        {replacing ? null : (
          <div className="min-w-0 space-y-1.5">
            <Label id={needsId}>{T.needs}</Label>
            <NeedChecklist labelledBy={needsId} items={needs} selected={selected} onChange={setSelected} />
          </div>
        )}
      </div>
    </DecisionDialog>
  );
}
