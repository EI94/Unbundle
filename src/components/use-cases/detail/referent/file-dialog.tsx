"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { ReferentUploadResult } from "@/lib/use-cases/referent/contract";
import { REFERENT_ERROR_MESSAGES, REFERENT_UI_TEXT } from "@/lib/use-cases/referent/labels";
import { uploadReferentFile } from "@/lib/use-cases/referent/upload-transport";
import { DecisionDialog } from "../../reopen-dialog";
import { Field, describedBy } from "./fields";

const T = REFERENT_UI_TEXT.fileDialog;
const TOASTS = REFERENT_UI_TEXT.toasts;

/** Il toast dopo un file caricato: allegato, in controllo da Lateral Space, con «L'ho già verificata» o con l'avviso sui dati personali. */
export function fileToast(file: Pick<ReferentUploadResult, "status" | "warning">, validate: boolean): { kind: "success" | "warning"; text: string } {
  if (file.warning) return { kind: "warning", text: T.personalWarning };
  if (file.status === "in_revisione") return { kind: "success", text: validate ? TOASTS.fileAttachedReviewValidate : TOASTS.fileAttachedReview };
  return { kind: "success", text: validate ? TOASTS.fileAttachedValidated : TOASTS.fileAttached };
}

/**
 * «Allega un file» del team a un'esigenza (SPEC §5.2, §P2.10.7): gli stessi controlli dei file del
 * referente (tipi, dimensioni, contenuto, niente foto), con la dichiarazione obbligatoria. Fino a
 * 4 MB passa dal server, oltre direttamente nell'archivio privato quando è attivo. Un file non
 * accettato lascia la finestra aperta con il motivo.
 */
export function FileDialog({
  workspaceId,
  useCaseId,
  need,
  clientMode,
  accept,
  onClose,
}: {
  workspaceId: string;
  useCaseId: string;
  need: { id: string; title: string };
  clientMode: boolean;
  accept: string;
  onClose: () => void;
}) {
  const baseId = useId();
  const fileId = `${baseId}-file`;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [declaration, setDeclaration] = useState(false);
  const [validate, setValidate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const help = clientMode ? T.help : T.helpServerOnly;

  async function confirm() {
    if (busy) return;
    if (!file) {
      setError(T.chooseFile);
      return;
    }
    if (!declaration) {
      setError(T.declaration);
      return;
    }
    setBusy(true);
    setError(null);
    const outcome = await uploadReferentFile({ kind: "revisore", workspaceId, useCaseId, needId: need.id }, file, { declaration, clientMode, validate });
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
    const message = fileToast(outcome.file, validate);
    if (message.kind === "warning") toast.warning(message.text);
    else toast.success(message.text);
    onClose();
    startTransition(() => router.refresh());
  }

  return (
    <DecisionDialog
      open
      onOpenChange={(next) => (next || busy ? undefined : onClose())}
      title={T.title}
      description={need.title}
      confirmLabel={T.confirm}
      pending={busy || pending}
      error={error}
      onConfirm={() => void confirm()}
      className="sm:max-w-lg"
    >
      <div className="grid gap-3">
        <Field id={fileId} label={T.title} hint={help}>
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
        <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm sm:min-h-8">
          <Checkbox
            className="mt-0.5"
            checked={declaration}
            aria-required
            onCheckedChange={(next) => {
              setDeclaration(next === true);
              setError(null);
            }}
          />
          <span>{T.declaration}</span>
        </label>
        <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm sm:min-h-8">
          <Checkbox className="mt-0.5" checked={validate} onCheckedChange={(next) => setValidate(next === true)} />
          <span>{T.validate}</span>
        </label>
      </div>
    </DecisionDialog>
  );
}
