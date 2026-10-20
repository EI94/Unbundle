"use client";

import { AttachmentField, type AttachmentRef } from "../attachment-field";
import { FieldErrors } from "./fields";
import type { Issue } from "@/lib/uc/answers/issues";

/**
 * Risposte fatte di file: `file` (uno o più documenti) e `dataset` (l'export
 * di un sistema). Il caricamento passa da `AttachmentField` (quarantena,
 * controllo delle intestazioni, dichiarazione «nessun dato sanitario»); qui si
 * spiega cosa serve e si mostrano gli errori della risposta.
 */
export function FileAnswerInput({
  token,
  itemId,
  attachments,
  onAttachmentsChange,
  hint,
  personal,
  disabled,
  issues,
  dataset,
}: {
  token: string;
  itemId: string;
  attachments: AttachmentRef[];
  onAttachmentsChange: (next: AttachmentRef[]) => void;
  hint: string | null;
  personal: boolean;
  disabled: boolean;
  issues: readonly Issue[];
  dataset: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm break-words text-muted-foreground">
        {dataset
          ? "Carica l'export dal sistema (Excel o CSV). Lateral Space controlla le colonne e compila con te la scheda del dataset: periodo e data di estrazione."
          : "Allega il documento. Togli prima i dati sanitari e i dati personali che non ti abbiamo chiesto."}
      </p>
      <AttachmentField token={token} itemId={itemId} value={attachments} onChange={onAttachmentsChange} hint={hint} personal={personal} disabled={disabled} />
      <FieldErrors issues={issues} />
    </div>
  );
}
