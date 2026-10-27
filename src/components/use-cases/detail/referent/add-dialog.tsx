"use client";

import { useId, useState } from "react";
import { addToReferentRequestAction } from "@/lib/actions/use-case-referents";
import type { ReferentRequestView, UseCaseReferentPanel } from "@/lib/use-cases/referent/contract";
import { REFERENT_UI_TEXT } from "@/lib/use-cases/referent/labels";
import { DecisionDialog } from "../../reopen-dialog";
import { addPayload, addRoom, addSelectionError, addableNeedIds, initialAddSelection } from "./add-dialog-state";
import { NeedChecklist } from "./fields";
import { useReferentRunner } from "./referent-actions";

/**
 * «Aggiungi domande» a una richiesta viva (SPEC §5.2): le domande aperte della scheda che la
 * richiesta non ha, fino a 20 per richiesta. Il referente le trova nello stesso link; se serve, gli
 * scriviamo.
 */
export function AddDialog({
  workspaceId,
  useCaseId,
  panel,
  request,
  needTitles,
  onClose,
}: {
  workspaceId: string;
  useCaseId: string;
  panel: UseCaseReferentPanel;
  request: ReferentRequestView;
  needTitles: ReadonlyMap<string, string>;
  onClose: () => void;
}) {
  const labelId = useId();
  const { pending, run } = useReferentRunner();
  const [selected, setSelected] = useState<string[]>(() => initialAddSelection(panel, request));
  const [error, setError] = useState<string | null>(null);
  const room = addRoom(panel, request);
  const items = addableNeedIds(panel, request).map((id) => ({ id, title: needTitles.get(id) ?? id }));
  const full = new Set(selected.length >= room ? items.map((item) => item.id) : []);

  async function confirm() {
    const local = addSelectionError(selected, room);
    if (local) {
      setError(local);
      return;
    }
    const { outcome } = await run(() => addToReferentRequestAction(workspaceId, useCaseId, request.id, request.version, addPayload(panel, selected)), { inDialog: true });
    if (outcome.close) onClose();
    else setError(outcome.error);
  }

  return (
    <DecisionDialog
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={REFERENT_UI_TEXT.add}
      description={request.contact.name}
      confirmLabel={REFERENT_UI_TEXT.addConfirm}
      pending={pending}
      error={error}
      onConfirm={() => void confirm()}
      className="sm:max-w-lg"
    >
      <div className="space-y-1.5">
        <p id={labelId} className="text-sm font-medium">
          {REFERENT_UI_TEXT.askDialog.questionsLabel}
        </p>
        {items.length ? (
          <NeedChecklist
            labelledBy={labelId}
            items={items}
            selected={selected}
            disabledIds={full}
            invalid={Boolean(error)}
            onChange={(next) => {
              setSelected(next);
              setError(null);
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{REFERENT_UI_TEXT.addReasons.nothing}</p>
        )}
        <p className="text-xs text-muted-foreground">{REFERENT_UI_TEXT.askDialog.questionsHint}</p>
      </div>
    </DecisionDialog>
  );
}
