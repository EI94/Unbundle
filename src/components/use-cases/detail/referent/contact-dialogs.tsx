"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { correctReferentEmailAction, eraseReferentDataAction } from "@/lib/actions/use-case-referents";
import type { ReferentActionResult } from "@/lib/use-cases/referent/contract";
import { REFERENT_ERROR_MESSAGES, REFERENT_UI_TEXT, fillText } from "@/lib/use-cases/referent/labels";
import { DecisionDialog } from "../../reopen-dialog";
import { Field, describedBy } from "./fields";
import { useReferentRunner } from "./referent-actions";

/**
 * Una conferma semplice («Revocare il link?», «Eliminare la risposta?», «Eliminare il file?»,
 * «Rifiutare il file?»): titolo, testo, «Annulla» e il pulsante dell'azione. Un errore resta nella
 * finestra; se i dati a schermo non sono più veri la finestra si chiude e la pagina si rilegge.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  action,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  action: () => Promise<ReferentActionResult<unknown>>;
  onClose: () => void;
}) {
  const { pending, run } = useReferentRunner();
  const [error, setError] = useState<string | null>(null);
  return (
    <DecisionDialog
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      pending={pending}
      error={error}
      onConfirm={() =>
        void run(action, { inDialog: true }).then(({ outcome }) => {
          if (outcome.close) onClose();
          else setError(outcome.error);
        })
      }
    />
  );
}

/** «Correggi l'email» di un referente usato solo dagli use case (SPEC §5.2, §3.10). */
export function CorrectEmailDialog({
  workspaceId,
  useCaseId,
  contact,
  onClose,
}: {
  workspaceId: string;
  useCaseId: string;
  contact: { id: string; name: string };
  onClose: () => void;
}) {
  const fieldId = useId();
  const T = REFERENT_UI_TEXT.correctDialog;
  const { pending, run } = useReferentRunner();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    const value = email.trim();
    if (!value) {
      setError(REFERENT_ERROR_MESSAGES.email_mancante);
      return;
    }
    const { result, outcome } = await run(() => correctReferentEmailAction(workspaceId, useCaseId, contact.id, { email: value }), { inDialog: true });
    if (outcome.close) onClose();
    else if (!result.ok) setError(result.fieldErrors?.email ?? outcome.error);
  }

  return (
    <DecisionDialog
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={T.title}
      description={contact.name}
      confirmLabel={T.confirm}
      pending={pending}
      error={error}
      onConfirm={() => void confirm()}
    >
      <Field id={fieldId} label={T.field} hint={T.hint}>
        <Input
          id={fieldId}
          type="email"
          inputMode="email"
          autoComplete="off"
          value={email}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fieldId, T.hint)}
          className="min-h-11 sm:min-h-8"
          onChange={(event) => {
            setEmail(event.target.value);
            setError(null);
          }}
        />
      </Field>
    </DecisionDialog>
  );
}

/** «Cancella i dati di questa persona» (SPEC §5.2, §3.10): risposte, file e link su tutti gli use case del workspace. */
export function EraseContactDialog({
  workspaceId,
  useCaseId,
  contact,
  onClose,
}: {
  workspaceId: string;
  useCaseId: string;
  contact: { id: string; name: string };
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      title={fillText(REFERENT_UI_TEXT.eraseConfirmTitle, { Nome: contact.name })}
      description={REFERENT_UI_TEXT.eraseConfirmText}
      confirmLabel={REFERENT_UI_TEXT.eraseConfirm}
      action={() => eraseReferentDataAction(workspaceId, useCaseId, contact.id)}
      onClose={onClose}
    />
  );
}
