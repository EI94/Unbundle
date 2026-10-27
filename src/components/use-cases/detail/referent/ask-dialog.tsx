"use client";

import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { revealReferentContactEmailAction, sendReferentRequestAction } from "@/lib/actions/use-case-referents";
import type { ReferentRequestView, UseCaseReferentPanel } from "@/lib/use-cases/referent/contract";
import { REFERENT_UI_TEXT } from "@/lib/use-cases/referent/labels";
import { DecisionDialog } from "../../reopen-dialog";
import {
  ASK_MODE,
  NEW_CONTACT,
  askDraftErrors,
  askErrorView,
  askOtherRequestsHint,
  askPayload,
  askSelfHint,
  askSummary,
  contactChoices,
  initialAskDraft,
  type AskDraft,
  type AskMode,
} from "./ask-dialog-state";
import { Field, NeedChecklist, describedBy } from "./fields";
import { useReferentRunner } from "./referent-actions";

const T = REFERENT_UI_TEXT.askDialog;

export interface AskDialogProps {
  workspaceId: string;
  useCaseId: string;
  panel: UseCaseReferentPanel;
  /** «Chiedi al referente», oppure «Chiedi di nuovo» su `previous`. */
  mode?: AskMode;
  previous?: ReferentRequestView | null;
  /** Il titolo di ogni esigenza della scheda (id in minuscolo). */
  needTitles: ReadonlyMap<string, string>;
  onClose: () => void;
}

/**
 * La finestra «Chiedi al referente» (SPEC §5.2, §P3.7): a chi chiedi (un referente del workspace o
 * uno nuovo), che cosa chiedi (le domande aperte della scheda, tutte spuntate), un messaggio
 * facoltativo e il riepilogo di dove arriva l'email e dove arrivano le risposte. Con «Chiedi di
 * nuovo» il referente resta quello della richiesta. L'email parte dopo la risposta del server.
 */
export function AskDialog({ workspaceId, useCaseId, panel, mode = ASK_MODE, previous = null, needTitles, onClose }: AskDialogProps) {
  const baseId = useId();
  const ids = { who: `${baseId}-chi`, name: `${baseId}-nome`, email: `${baseId}-email`, role: `${baseId}-ruolo`, questions: `${baseId}-domande`, message: `${baseId}-messaggio` };
  const { pending, run } = useReferentRunner();
  const [draft, setDraft] = useState<AskDraft>(() => initialAskDraft(panel, mode, previous));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string | null>>({});

  const choices = contactChoices(panel, mode);
  const isNew = draft.choice === NEW_CONTACT;
  const existingId = draft.choice && !isNew ? draft.choice : null;

  // L'indirizzo intero del referente scelto, solo per il riepilogo; fino ad allora quello coperto.
  useEffect(() => {
    if (!existingId || Object.hasOwn(revealed, existingId)) return;
    let live = true;
    revealReferentContactEmailAction(workspaceId, useCaseId, existingId)
      .then((result) => {
        if (live) setRevealed((current) => ({ ...current, [existingId]: result.ok ? result.data.email : null }));
      })
      .catch(() => {
        if (live) setRevealed((current) => ({ ...current, [existingId]: null }));
      });
    return () => {
      live = false;
    };
  }, [existingId, revealed, workspaceId, useCaseId]);

  const set = <K extends keyof AskDraft>(key: K, value: AskDraft[K], errorKey: string = key) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[errorKey] ? { ...current, [errorKey]: "" } : current));
    setFormError(null);
  };

  const askable = panel.askableNeedIds.map((id) => ({ id: id.toLowerCase(), title: needTitles.get(id.toLowerCase()) ?? id }));
  const summary = askSummary(panel, draft, existingId ? (revealed[existingId] ?? null) : null);
  const selfHint = mode.kind === "ask" ? askSelfHint(panel) : null;
  const otherHint = askOtherRequestsHint(panel, draft);
  const whoHint = otherHint;

  async function confirm() {
    const local = askDraftErrors(draft, panel, mode);
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    const { result, outcome } = await run(() => sendReferentRequestAction(workspaceId, useCaseId, askPayload(draft, panel, mode)), { inDialog: true });
    if (outcome.close) {
      onClose();
      return;
    }
    if (!result.ok) {
      const view = askErrorView(result, draft);
      setErrors(view.fieldErrors);
      setFormError(view.formError);
    }
  }

  return (
    <DecisionDialog
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={mode.kind === "again" ? T.titleAgain : T.title}
      description={mode.kind === "again" && mode.liveHint ? REFERENT_UI_TEXT.askAgainLiveHint : null}
      confirmLabel={T.confirm}
      pending={pending}
      error={formError || errors.contact || null}
      onConfirm={() => void confirm()}
      className="sm:max-w-lg"
    >
      <div data-slot="referent-ask" className="grid gap-4">
        <Field id={ids.who} label={T.whoLabel} hint={whoHint}>
          <Select
            items={choices.map((choice) => ({ value: choice.value, label: choice.label }))}
            value={draft.choice}
            disabled={mode.lockedContactId !== null}
            onValueChange={(next) => {
              const match = choices.find((choice) => choice.value === next && !choice.disabled);
              if (match) set("choice", match.value, "contact");
            }}
          >
            <SelectTrigger id={ids.who} aria-describedby={describedBy(ids.who, whoHint)} aria-invalid={errors.contact ? true : undefined} className="min-h-11 w-full sm:min-h-8">
              <SelectValue placeholder={T.whoPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice.value} value={choice.value} disabled={choice.disabled}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selfHint ? (
            <p role="note" className="text-xs text-muted-foreground">
              {selfHint}
            </p>
          ) : null}
        </Field>

        {isNew ? (
          <div className="grid gap-3 rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{T.newHint}</p>
            <Field id={ids.name} label={T.newName} error={errors.displayName}>
              <Input
                id={ids.name}
                value={draft.name}
                autoComplete="off"
                maxLength={panel.limits.contactNameMax}
                aria-invalid={errors.displayName ? true : undefined}
                aria-describedby={describedBy(ids.name, null, errors.displayName)}
                className="min-h-11 sm:min-h-8"
                onChange={(event) => set("name", event.target.value, "displayName")}
              />
            </Field>
            <Field id={ids.email} label={T.newEmail} error={errors.email}>
              <Input
                id={ids.email}
                type="email"
                inputMode="email"
                autoComplete="off"
                value={draft.email}
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={describedBy(ids.email, null, errors.email)}
                className="min-h-11 sm:min-h-8"
                onChange={(event) => set("email", event.target.value)}
              />
            </Field>
            <Field id={ids.role} label={T.newRole} error={errors.roleLabel}>
              <Input
                id={ids.role}
                value={draft.role}
                autoComplete="off"
                maxLength={panel.limits.roleLabelMax}
                className="min-h-11 sm:min-h-8"
                onChange={(event) => set("role", event.target.value, "roleLabel")}
              />
            </Field>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <p id={ids.questions} className="text-sm font-medium">
            {T.questionsLabel}
          </p>
          {askable.length ? (
            <>
              <NeedChecklist
                labelledBy={ids.questions}
                items={askable}
                selected={draft.needIds}
                invalid={Boolean(errors.needIds)}
                onChange={(next) => set("needIds", next)}
              />
              <p className="text-xs text-muted-foreground">{T.questionsHint}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{T.questionsEmpty}</p>
          )}
          {errors.needIds ? <p className="text-xs text-destructive">{errors.needIds}</p> : null}
        </div>

        <Field id={ids.message} label={T.messageLabel} hint={T.messageHint} error={errors.message}>
          <Textarea
            id={ids.message}
            value={draft.message}
            rows={3}
            maxLength={panel.limits.messageMax}
            placeholder={T.messagePlaceholder}
            aria-invalid={errors.message ? true : undefined}
            aria-describedby={describedBy(ids.message, T.messageHint, errors.message)}
            onChange={(event) => set("message", event.target.value)}
          />
        </Field>

        {summary ? (
          <p data-slot="referent-ask-summary" className="rounded-lg bg-muted/50 px-3 py-2 text-xs break-words text-muted-foreground">
            {summary}
          </p>
        ) : null}
      </div>
    </DecisionDialog>
  );
}
