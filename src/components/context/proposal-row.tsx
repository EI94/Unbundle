"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { discardProposalsAction, editProposalAction } from "@/lib/actions/context";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { CONTEXT_LIMITS, type CommitmentParty } from "@/lib/context/vocab";
import type { ProposalView } from "@/lib/db/queries/context-proposals";
import { cn } from "@/lib/utils";
import { LsLock } from "./fact-row";
import { ChoiceSelect, Field, Mark, UseCasePicker, nameOfUseCase, type UseCaseOption } from "./fields";
import { answersNeedLine, dueText, editableFields, isCheckable, proposalDraft, proposalPatch, sectionLabel, visibilityLabel, type ProposalDraft, type Resolution } from "./view-model";
import { SECTION_ITEMS, VISIBILITY_ITEMS } from "./write-fact-form";

const T = CONTEXT_TEXT;

const PARTY_ITEMS: ReadonlyArray<{ value: CommitmentParty; label: string }> = [
  { value: "nostra", label: T.confirm.partyOurs },
  { value: "cliente", label: T.confirm.partyTheirs },
];

/**
 * Una riga di «Da confermare» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.4): la casella; la frase (per
 * «Cambiano» sopra «Prima: …»; per un conflitto «Prima» e «Ora» con le due scelte); la citazione; «dedotto» e il
 * messaggio di ciò che va corretto; la sezione, chi la vede, gli use case; per un impegno di chi è, il ruolo e la data.
 * «Modifica» apre i campi sul posto; «Scarta» toglie la riga. Una riga da correggere non si spunta finché non è corretta.
 * (9b) Sotto la frase, quando la lettura l'ha visto: «Risponde a «Cosa serve»: {titolo} ({codice})», solo per una
 * proposta «Per tutti»; per una «Solo Lateral Space», che non chiude la richiesta, «Solo un fatto «Per tutti» chiude una
 * richiesta.» (`answersNeedLine`).
 */
export function ProposalRow({
  workspaceId,
  today,
  proposal,
  sourceLabel,
  checked,
  resolution,
  error,
  useCaseOptions,
  disabled,
  onCheck,
  onResolve,
  onDiscarded,
}: {
  workspaceId: string;
  today: string;
  proposal: ProposalView;
  /** «Call 14 nov»: la fonte di «Ora», per un conflitto. */
  sourceLabel: string;
  checked: boolean;
  resolution: Resolution | null;
  /** Il messaggio di una conferma non riuscita, per questa riga. */
  error: string | null;
  useCaseOptions: readonly UseCaseOption[];
  disabled: boolean;
  onCheck: (checked: boolean) => void;
  onResolve: (resolution: Resolution) => void;
  /** La proposta è stata scartata: la pagina la toglie subito, prima che arrivi la pagina aggiornata. */
  onDiscarded: () => void;
}) {
  const statementId = useId();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const conflict = proposal.kind === "conflitto";
  const checkable = isCheckable(proposal);
  const needLine = answersNeedLine(proposal);

  const discard = () =>
    startTransition(async () => {
      const result = await discardProposalsAction(workspaceId, [proposal.id]);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      onDiscarded();
      toast.success(T.confirm.discarded);
    });

  const busy = disabled || pending;
  return (
    <li className={cn("space-y-3 rounded-xl border p-3", error && "border-destructive/50")}>
      <div className="flex gap-3">
        {conflict ? null : (
          // Sul telefono la casella si tocca in un'area di 44 × 44 px: tutta l'area la spunta.
          <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-start justify-center pt-1 sm:min-h-0 sm:min-w-0 sm:justify-start">
            <Checkbox checked={checkable && checked} disabled={busy || !checkable} onCheckedChange={(next) => onCheck(next === true)} aria-labelledby={statementId} />
          </label>
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          {proposal.before && proposal.kind === "cambia" ? <p className="text-xs leading-relaxed text-muted-foreground">{T.confirm.before(proposal.before.statement, proposal.before.sourceLabel, proposal.before.date)}</p> : null}
          {conflict && proposal.before ? (
            <div className="space-y-1">
              <p className="text-sm leading-relaxed">{T.confirm.before(proposal.before.statement, proposal.before.sourceLabel, proposal.before.date)}</p>
              <p id={statementId} className="text-sm leading-relaxed font-medium">
                {T.confirm.now(proposal.statement, sourceLabel)}
              </p>
            </div>
          ) : (
            <p id={statementId} className="text-sm leading-relaxed break-words">
              {proposal.statement}
            </p>
          )}
          {needLine ? <p className="text-xs leading-relaxed break-words">{needLine}</p> : null}
          {proposal.quote ? (
            <p className="text-xs leading-relaxed break-words text-muted-foreground">
              <q>{proposal.quote}</q>
            </p>
          ) : null}
          <ProposalMeta proposal={proposal} today={today} />
          {proposal.issueMessage ? (
            <p role="alert" className="text-sm text-foreground">
              {proposal.issueMessage}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      {conflict ? (
        <div className="space-y-2">
          <div role="radiogroup" aria-label={T.confirm.conflictChoice} className="flex flex-col gap-2 sm:flex-row">
            {(
              [
                ["prima", T.confirm.keepBefore],
                ["ora", T.confirm.switchToNow],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                role="radio"
                aria-checked={resolution === value}
                variant={resolution === value ? "secondary" : "outline"}
                className={cn("min-h-11 sm:min-h-8", resolution === value && "ring-1 ring-foreground/30")}
                disabled={busy || proposal.issue !== null}
                onClick={() => onResolve(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          {resolution ? null : <p className="text-xs text-muted-foreground">{T.confirm.conflictChoice}</p>}
        </div>
      ) : null}

      {editing ? (
        <ProposalEdit workspaceId={workspaceId} proposal={proposal} useCaseOptions={useCaseOptions} onClose={() => setEditing(false)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" disabled={busy} onClick={() => setEditing(true)}>
            {T.confirm.edit}
          </Button>
          <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" disabled={busy} onClick={discard}>
            {T.confirm.discard}
          </Button>
        </div>
      )}
    </li>
  );
}

/** La riga piccola sotto la frase: dedotto, risponde a una domanda, sezione, chi la vede, use case, impegno. */
function ProposalMeta({ proposal, today }: { proposal: ProposalView; today: string }) {
  const parts: string[] = [];
  if (proposal.section) parts.push(sectionLabel(proposal.section));
  if (proposal.kind === "impegno") {
    if (proposal.party) parts.push(proposal.party === "nostra" ? T.confirm.partyOurs : T.confirm.partyTheirs);
    if (proposal.roleLabel) parts.push(proposal.roleLabel);
    const due = dueText({ dueOn: proposal.dueOn, overdue: proposal.dueOn !== null && proposal.dueOn < today }, today);
    if (due) parts.push(due);
  }
  if (proposal.kind === "domanda" && proposal.roleLabel) parts.push(T.questions.askWhom(proposal.roleLabel));
  for (const useCase of proposal.useCases) parts.push(nameOfUseCase(useCase));
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {proposal.basis === "dedotto" ? <Mark>{T.fact.inferred}</Mark> : null}
      {proposal.closesQuestion ? <span>{T.confirm.closesQuestion(proposal.closesQuestion.question)}</span> : null}
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>{part}</span>
      ))}
      <span className="inline-flex items-center gap-1">
        {proposal.visibility === "ls" ? <LsLock /> : null}
        <span aria-hidden={proposal.visibility === "ls" ? true : undefined}>{visibilityLabel(proposal.visibility)}</span>
      </span>
    </div>
  );
}

/** «Modifica» sul posto: testo, sezione, chi la vede, use case; per un impegno di chi è, ruolo e data; per una domanda a chi chiederla. */
function ProposalEdit({ workspaceId, proposal, useCaseOptions, onClose }: { workspaceId: string; proposal: ProposalView; useCaseOptions: readonly UseCaseOption[]; onClose: () => void }) {
  const fields = editableFields(proposal.kind);
  const [draft, setDraft] = useState<ProposalDraft>(() => proposalDraft(proposal));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const id = useId();
  const tooLong = draft.statement.replace(/\s+/g, " ").trim().length > CONTEXT_LIMITS.statementMax;

  const save = () => {
    const patch = proposalPatch(proposal, draft);
    if (Object.keys(patch).length === 0) return onClose();
    startTransition(async () => {
      const result = await editProposalAction(workspaceId, proposal.id, proposal.version, patch);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        if (!result.fieldErrors || Object.keys(result.fieldErrors).length === 0) toast.error(result.message);
        return;
      }
      toast.success(T.fact.saved);
      onClose();
    });
  };

  return (
    <form
      className="space-y-3 border-t pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Field id={`${id}-frase`} label={T.writeFact.statementLabel} hint={tooLong ? T.confirm.tooLong : T.writeFact.hint} error={errors.statement}>
        <Textarea
          id={`${id}-frase`}
          value={draft.statement}
          onChange={(event) => setDraft((d) => ({ ...d, statement: event.target.value }))}
          maxLength={CONTEXT_LIMITS.proposalStatementMax}
          rows={2}
          disabled={pending}
          aria-invalid={errors.statement || tooLong ? true : undefined}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.section ? (
          <Field id={`${id}-sezione`} label={T.writeFact.section} error={errors.section}>
            <ChoiceSelect id={`${id}-sezione`} value={draft.section} items={SECTION_ITEMS} disabled={pending} onChange={(section) => setDraft((d) => ({ ...d, section }))} />
          </Field>
        ) : null}
        <Field id={`${id}-visibilita`} label={T.writeFact.visibility} error={errors.visibility}>
          <ChoiceSelect id={`${id}-visibilita`} value={draft.visibility} items={VISIBILITY_ITEMS} disabled={pending} onChange={(visibility) => setDraft((d) => ({ ...d, visibility }))} />
        </Field>
        {fields.party ? (
          <Field id={`${id}-parte`} label={T.confirm.party} error={errors.party}>
            <ChoiceSelect id={`${id}-parte`} value={draft.party} items={PARTY_ITEMS} disabled={pending} onChange={(party) => setDraft((d) => ({ ...d, party }))} />
          </Field>
        ) : null}
        {fields.role ? (
          <Field id={`${id}-ruolo`} label={proposal.kind === "domanda" ? T.confirm.askWhom : T.confirm.role} error={errors.roleLabel}>
            <Input
              id={`${id}-ruolo`}
              value={draft.roleLabel}
              onChange={(event) => setDraft((d) => ({ ...d, roleLabel: event.target.value }))}
              maxLength={CONTEXT_LIMITS.roleLabelMax}
              disabled={pending}
              className="min-h-11 sm:min-h-8"
            />
          </Field>
        ) : null}
        {fields.due ? (
          <Field id={`${id}-entro`} label={T.confirm.due} error={errors.dueOn}>
            <Input id={`${id}-entro`} type="date" value={draft.dueOn} onChange={(event) => setDraft((d) => ({ ...d, dueOn: event.target.value }))} disabled={pending} className="min-h-11 sm:min-h-8" />
          </Field>
        ) : null}
      </div>
      {useCaseOptions.length > 0 || draft.useCaseIds.length > 0 ? (
        <Field id={`${id}-use-case`} label={T.fact.useCases} error={errors.useCaseIds} optional>
          <UseCasePicker id={`${id}-use-case`} value={draft.useCaseIds} options={useCaseOptions} disabled={pending} onChange={(useCaseIds) => setDraft((d) => ({ ...d, useCaseIds }))} />
        </Field>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" disabled={pending} onClick={onClose}>
          {T.confirm.cancelEdit}
        </Button>
        <Button type="submit" variant="outline" className="min-h-11 sm:min-h-8" disabled={pending}>
          {T.confirm.saveEdit}
        </Button>
      </div>
    </form>
  );
}
