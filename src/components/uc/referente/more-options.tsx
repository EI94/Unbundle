"use client";

import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Issue } from "@/lib/uc/answers/issues";
import type { ReferentItemView } from "@/lib/uc/public-view";
import { fieldIssues, type ReferentForm } from "@/lib/uc/views/referente-form";
import { R_TEXT } from "@/lib/uc/views/referente-text";
import type { SourceBasis } from "@/lib/uc/vocab";
import { AttachmentField, type AttachmentRef } from "./attachment-field";
import { CheckRow, Field, TextAreaControl } from "./inputs/fields";
import { Disclosure, TEXT_BUTTON_CLASS } from "./screen";
import { SourceChips } from "./source-chips";

/**
 * «▸ Altre opzioni» (DESIGN §4.3 R2b), chiuso: nota, allegato, «È una
 * stima», la fonte del dato («Da dove viene?», sui numeri e sulle date: rilascio
 * 10, RD-3, accanto a «È una stima», che «A memoria» spunta da sola), «Ho
 * risposto solo in parte» (apre la nota con il suggerimento), «Chiedi a
 * un'altra persona» (R5) e «Da noi non si applica» (con il perché e «Annulla»
 * per tornare alla risposta). Quello che il referente ha già aperto resta in
 * vista anche fuori dal riquadro.
 */
export interface MoreOptionsState {
  note: boolean;
  attach: boolean;
  na: boolean;
}

export function MoreOptions({
  id,
  item,
  token,
  form,
  attachments,
  issues,
  disabled,
  open,
  delegateHref,
  attachInView,
  source,
  onForm,
  onAttachments,
  onOpen,
}: {
  id: string;
  item: ReferentItemView;
  token: string;
  form: ReferentForm;
  attachments: AttachmentRef[];
  issues: readonly Issue[];
  disabled: boolean;
  open: MoreOptionsState;
  /** R5 per questa domanda, oppure null. */
  delegateHref: string | null;
  /** L'allegato sta già in vista sopra (schema che lo suggerisce, tipo file). */
  attachInView: boolean;
  /** La fonte del dato (numeri e date), oppure null per gli altri tipi. */
  source: { value: SourceBasis | null; onToggle: (basis: SourceBasis) => void } | null;
  onForm: (patch: Partial<ReferentForm>) => void;
  onAttachments: (next: AttachmentRef[]) => void;
  onOpen: (patch: Partial<MoreOptionsState>) => void;
}) {
  const noteIssues = fieldIssues(issues, "note");
  const naIssues = fieldIssues(issues, "reason");
  const showNote = !item.personal && (open.note || form.partial || form.note.trim() !== "");
  return (
    <div className="space-y-4">
      {showNote ? (
        <Field label={R_TEXT.more.note} htmlFor={`${id}-note`} issues={noteIssues} hint={form.partial ? R_TEXT.more.partialHint : undefined}>
          <TextAreaControl id={`${id}-note`} value={form.note} onChange={(v) => onForm({ note: v })} disabled={disabled} invalid={noteIssues.length > 0} rows={2} />
        </Field>
      ) : null}
      {open.attach && !attachInView ? (
        <AttachmentField token={token} itemId={item.id} value={attachments} onChange={onAttachments} hint={item.attachmentHint} personal={item.personal} disabled={disabled} />
      ) : null}
      {open.na ? (
        <div className="space-y-1">
          <Field label={R_TEXT.more.naReason} htmlFor={`${id}-na`} issues={naIssues} hint={R_TEXT.more.naHint}>
            <TextAreaControl id={`${id}-na`} value={form.naReason} onChange={(v) => onForm({ naReason: v })} disabled={disabled} invalid={naIssues.length > 0} rows={3} />
          </Field>
          <Button
            type="button"
            variant="ghost"
            className={TEXT_BUTTON_CLASS}
            disabled={disabled}
            onClick={() => {
              // Si torna alla risposta normale: anche «Non si applica» già deciso esce dalla bozza.
              onOpen({ na: false });
              onForm({ naReason: "", ...(form.intent === "non_si_applica" ? { intent: null } : {}) });
            }}
          >
            {R_TEXT.more.naUndo}
          </Button>
        </div>
      ) : null}
      <Disclosure summary={R_TEXT.more.fold}>
        <div className="space-y-1">
          {!item.personal && !showNote ? (
            <Button type="button" variant="ghost" className={TEXT_BUTTON_CLASS} disabled={disabled} onClick={() => onOpen({ note: true })}>
              {R_TEXT.more.addNote}
            </Button>
          ) : null}
          {!attachInView && !open.attach ? (
            <div>
              <Button type="button" variant="ghost" className={TEXT_BUTTON_CLASS} disabled={disabled} onClick={() => onOpen({ attach: true })}>
                {R_TEXT.more.attach}
              </Button>
            </div>
          ) : null}
          <CheckRow id={`${id}-estimate`} checked={form.estimate} onChange={(v) => onForm({ estimate: v })} disabled={disabled}>
            {R_TEXT.more.estimate}
          </CheckRow>
          {source ? (
            <div className="py-2">
              <SourceChips id={id} value={source.value} disabled={disabled} onToggle={source.onToggle} />
            </div>
          ) : null}
          {item.can.partial && item.clarification === null && form.confirmMode === null ? (
            <CheckRow
              id={`${id}-partial`}
              checked={form.partial}
              onChange={(v) => {
                onForm({ partial: v });
                if (v) onOpen({ note: true });
              }}
              disabled={disabled}
            >
              {R_TEXT.more.partial}
            </CheckRow>
          ) : null}
          {delegateHref ? (
            <div>
              <a href={delegateHref} className="inline-flex min-h-11 items-center gap-1 px-2 text-base text-primary underline-offset-4 hover:underline">
                {R_TEXT.more.delegate}
                <ChevronRight className="size-4" aria-hidden />
              </a>
            </div>
          ) : null}
          {item.can.proposeNa && !open.na ? (
            <div>
              <Button type="button" variant="ghost" className={TEXT_BUTTON_CLASS} disabled={disabled} onClick={() => onOpen({ na: true })}>
                {R_TEXT.more.notApplicable}
              </Button>
            </div>
          ) : null}
        </div>
      </Disclosure>
    </div>
  );
}
