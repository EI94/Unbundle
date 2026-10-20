"use client";

import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Issue } from "@/lib/uc/answers/issues";
import type { ReferentItemView } from "@/lib/uc/public-view";
import { fieldIssues, type ReferentForm } from "@/lib/uc/views/referente-form";
import { AttachmentField, type AttachmentRef } from "./attachment-field";
import { CheckRow, Field, TextAreaControl } from "./inputs/fields";
import { Disclosure, TEXT_BUTTON_CLASS } from "./screen";

/**
 * «▸ Altre opzioni» (DESIGN §4.3 R2b), chiuso: nota, allegato, «È una
 * stima», «Ho risposto solo in parte» (apre la nota con il suggerimento), «Lo
 * sa meglio un collega» (R5) e «Da noi non si applica» (con il perché e
 * «Annulla» per tornare alla risposta). Quello che il referente ha già aperto
 * resta in vista anche fuori dal riquadro.
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
        <Field label="Nota (facoltativa)" htmlFor={`${id}-note`} issues={noteIssues} hint={form.partial ? "Scrivi cosa manca: ci aiuta a chiedere il resto." : undefined}>
          <TextAreaControl id={`${id}-note`} value={form.note} onChange={(v) => onForm({ note: v })} disabled={disabled} invalid={noteIssues.length > 0} rows={2} />
        </Field>
      ) : null}
      {open.attach && !attachInView ? (
        <AttachmentField token={token} itemId={item.id} value={attachments} onChange={onAttachments} hint={item.attachmentHint} personal={item.personal} disabled={disabled} />
      ) : null}
      {open.na ? (
        <div className="space-y-1">
          <Field
            label="Perché da voi non si applica?"
            htmlFor={`${id}-na`}
            issues={naIssues}
            hint="Lateral Space e chi segue il caso nella tua azienda lo controllano prima di chiudere la domanda."
          >
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
            Annulla: rispondo alla domanda
          </Button>
        </div>
      ) : null}
      <Disclosure summary="Altre opzioni">
        <div className="space-y-1">
          {!item.personal && !showNote ? (
            <Button type="button" variant="ghost" className={TEXT_BUTTON_CLASS} disabled={disabled} onClick={() => onOpen({ note: true })}>
              Aggiungi una nota
            </Button>
          ) : null}
          {!attachInView && !open.attach ? (
            <div>
              <Button type="button" variant="ghost" className={TEXT_BUTTON_CLASS} disabled={disabled} onClick={() => onOpen({ attach: true })}>
                Allega un file
              </Button>
            </div>
          ) : null}
          <CheckRow id={`${id}-estimate`} checked={form.estimate} onChange={(v) => onForm({ estimate: v })} disabled={disabled}>
            È una stima
          </CheckRow>
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
              Ho risposto solo in parte
            </CheckRow>
          ) : null}
          {delegateHref ? (
            <div>
              <a href={delegateHref} className="inline-flex min-h-11 items-center gap-1 px-2 text-base text-primary underline-offset-4 hover:underline">
                Lo sa meglio un collega
                <ChevronRight className="size-4" aria-hidden />
              </a>
            </div>
          ) : null}
          {item.can.proposeNa && !open.na ? (
            <div>
              <Button type="button" variant="ghost" className={TEXT_BUTTON_CLASS} disabled={disabled} onClick={() => onOpen({ na: true })}>
                Da noi non si applica
              </Button>
            </div>
          ) : null}
        </div>
      </Disclosure>
    </div>
  );
}
