"use client";

import { useId, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Link2, MessageSquarePlus, Paperclip, Pencil, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  archiveNeedAction,
  createNeedAction,
  linkNeedAction,
  unlinkNeedAction,
  updateNeedAction,
  type NeedActionResult,
} from "@/lib/actions/use-case-needs";
import { ACTION_FAILED_MESSAGE } from "@/lib/use-cases/decision-ui";
import type { InfoProgressView } from "@/lib/use-cases/info-progress";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { cosaServeHref, type NeedReferentView, type UseCaseReferentPanel } from "@/lib/use-cases/referent/contract";
import { REFERENT_UI_TEXT } from "@/lib/use-cases/referent/labels";
import {
  NEED_AVAILABILITY_LABEL,
  NEED_KIND_LABEL,
  NEED_LIMITS,
  NEED_OWNER_SIDE_LABEL,
  NEED_TYPE_LABEL,
  isNeedDone,
  needAlsoForText,
  needDoneSummaryText,
  needRow,
  needStatusChoices,
  validateArchiveReason,
  type NeedType,
  type NeedUseCaseRef,
  type NeedView,
} from "@/lib/use-cases/needs";
import { cn } from "@/lib/utils";
import { Disclosure } from "../disclosure";
import { NeedUseCasesDisclosure } from "../need-use-cases";
import { DecisionChoiceGroup, DecisionDialog } from "../reopen-dialog";
import { InfoSummary } from "./info-summary";
import { askEntry } from "./referent/ask-dialog-state";
import { ReferentDialogs, type ReferentDialog } from "./referent/dialogs";
import { GateNotice } from "./referent/gate-notice";
import { NeedReferentBlock } from "./referent/need-referent-block";
import { PrepareButton } from "./referent/prepare-button";
import { RequestsList } from "./referent/requests-list";
import {
  NEED_FORM_CHOICES,
  NEED_FORM_TEXT as TEXT,
  draftFromNeed,
  emptyNeedDraft,
  needCreatePayload,
  needDraftErrors,
  needErrorsFromService,
  needPatchPayload,
  withNeedType,
  type NeedDraft,
} from "./need-draft";

export interface SectionNeedsProps {
  workspaceId: string;
  /** Lo use case della scheda: le esigenze nuove nascono collegate a lui. */
  useCaseId: string;
  /** Le esigenze collegate, per tipo (`needListsOfUseCase`). */
  requirements: readonly NeedView[];
  steps: readonly NeedView[];
  /** Le altre esigenze del workspace, per «Collega un'esigenza». */
  linkable: readonly NeedView[];
  /** Gli use case nominati dalle esigenze (id in minuscolo): codice e titolo per «Serve anche a…». */
  refs: Readonly<Record<string, NeedUseCaseRef>>;
  today: string;
  /** `canEditNeeds`: tutti i revisori. */
  canEdit: boolean;
  /**
   * «Chiedi al referente» (`loadUseCaseReferentPanel`, solo revisori): referenti, richieste, risposte
   * e file. null o non `available`: il capitolo è quello di prima.
   */
  referents?: UseCaseReferentPanel | null;
  /** «Raccolta informazioni» della scheda (`loadUseCaseInfoProgress`, solo revisori): la riga dei conteggi in cima al capitolo. */
  infoProgress?: InfoProgressView | null;
  id?: string;
  className?: string;
}

type Dialog =
  | { mode: "aggiungi" }
  | { mode: "modifica"; need: NeedView }
  | { mode: "archivia"; need: NeedView }
  | { mode: "collega" }
  | null;

/**
 * Il capitolo «Cosa serve» della scheda, solo per i revisori (spec di Pierpaolo, 25/10/2026): i
 * requisiti e i prossimi passi collegati a questo use case, con stato, chi e scadenza; i requisiti
 * già a posto e i passi fatti sono chiusi di default. «Aggiungi» apre il modulo (l'esigenza nasce
 * collegata a questo use case); «Modifica» lo apre sull'esigenza, con «Scollega da questo use
 * case» e «Archivia» (con il motivo: non si cancella niente); «Collega un'esigenza» sceglie una
 * delle altre del workspace. Ogni modifica porta la versione letta: se qualcuno l'ha appena
 * cambiata, il toast lo dice e la pagina si rilegge.
 */
export function SectionNeeds({
  workspaceId,
  useCaseId,
  requirements,
  steps,
  linkable,
  refs,
  today,
  canEdit,
  referents = null,
  infoProgress = null,
  id = "cosa-serve",
  className,
}: SectionNeedsProps) {
  const headingId = `${id}-titolo`;
  const gatesId = `${id}-chiedi-motivi`;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [referentDialog, setReferentDialog] = useState<ReferentDialog | null>(null);
  const refMap = useMemo(() => new Map(Object.entries(refs)), [refs]);
  const detailHrefOf = (id: string) => cosaServeHref(workspaceId, id);
  const empty = !requirements.length && !steps.length;
  // «Chiedi al referente»: solo con la funzione accesa per il workspace e gli archivi pronti.
  const feature = referents?.available ? referents : null;
  const needTitles = useMemo(() => new Map([...requirements, ...steps].map((need) => [need.id.toLowerCase(), need.title])), [requirements, steps]);
  const answerable = useMemo(() => new Set((feature?.answerableNeedIds ?? []).map((needId) => needId.toLowerCase())), [feature]);

  /** Manda una scrittura: toast, rilettura dopo una versione superata; chiude il dialogo se va bene. */
  function send(call: () => Promise<NeedActionResult>, onFieldErrors?: (errors: Record<string, string>) => void): Promise<boolean> {
    return new Promise((resolve) => {
      startTransition(async () => {
        let result: NeedActionResult;
        try {
          result = await call();
        } catch {
          result = { ok: false, error: "riprova", message: ACTION_FAILED_MESSAGE };
        }
        if (result.ok) {
          if (result.message) toast.success(result.message);
          setDialog(null);
          resolve(true);
          return;
        }
        if (result.fieldErrors && onFieldErrors) onFieldErrors(needErrorsFromService(result.fieldErrors));
        else toast.error(result.message);
        if (result.error === "versione_superata" || result.error === "non_trovato" || result.error === "transizione_non_ammessa") {
          setDialog(null);
          router.refresh();
        }
        resolve(false);
      });
    });
  }

  const doneRequirements = requirements.filter((need) => isNeedDone(need.type, need.status));
  const openRequirements = requirements.filter((need) => !isNeedDone(need.type, need.status));
  const doneSteps = steps.filter((need) => isNeedDone(need.type, need.status));
  const openSteps = steps.filter((need) => !isNeedDone(need.type, need.status));
  const list = (needs: readonly NeedView[]) => (
    <NeedList
      needs={needs}
      useCaseId={useCaseId}
      refs={refMap}
      detailHrefOf={detailHrefOf}
      today={today}
      canEdit={canEdit}
      onEdit={(need) => setDialog({ mode: "modifica", need })}
      referent={
        feature
          ? {
              workspaceId,
              views: feature.needs,
              answerable: canEdit && feature.canAsk ? answerable : new Set<string>(),
              canReviewFiles: feature.canReviewFiles,
              onOpen: setReferentDialog,
            }
          : null
      }
    />
  );
  // «Chiedi al referente» si apre anche quando manca solo qualcosa da chiedere e «Prepara le domande»
  // può aggiungerlo: la finestra lo offre. Spento da un altro motivo, «Prepara le domande» resta nel capitolo.
  const entry = feature ? askEntry(feature) : null;
  const askBlocked = !entry?.canOpen;

  return (
    <section id={id} aria-labelledby={headingId} data-slot="section-needs" className={cn("scroll-mt-28 space-y-4", className)}>
      <h2 id={headingId} className="text-base font-semibold">
        {TEXT.title}
      </h2>
      <InfoSummary view={infoProgress} />
      {empty ? <p className="text-sm text-muted-foreground">{TEXT.empty}</p> : null}
      {requirements.length ? (
        <div data-slot="needs-requirements" className="space-y-2">
          <h3 className="text-sm font-medium">{TEXT.requirements}</h3>
          {openRequirements.length ? list(openRequirements) : null}
          {doneRequirements.length ? <Disclosure summary={needDoneSummaryText("requisito", doneRequirements.length)}>{list(doneRequirements)}</Disclosure> : null}
        </div>
      ) : null}
      {steps.length ? (
        <div data-slot="needs-steps" className="space-y-2">
          <h3 className="text-sm font-medium">{TEXT.steps}</h3>
          {openSteps.length ? list(openSteps) : null}
          {doneSteps.length ? <Disclosure summary={needDoneSummaryText("passo", doneSteps.length)}>{list(doneSteps)}</Disclosure> : null}
        </div>
      ) : null}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => setDialog({ mode: "aggiungi" })}>
            <Plus aria-hidden />
            {TEXT.add}
          </Button>
          {linkable.length ? (
            <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => setDialog({ mode: "collega" })}>
              <Link2 aria-hidden />
              {TEXT.link}
            </Button>
          ) : null}
          {/*
            «Prepara le domande» sta nella finestra di «Chiedi al referente»; qui solo quando qualcosa si
            può preparare ma un altro motivo tiene la finestra chiusa (preparare non manda niente).
          */}
          {feature?.canAsk && entry?.showPrepare ? <PrepareButton workspaceId={workspaceId} useCaseId={useCaseId} describedBy={gatesId} /> : null}
          {/*
            L'azione principale del capitolo, ma non della pagina: un solo pulsante pieno per pagina (la
            decisione). «secondary» la distingue da «Aggiungi» e «Prepara le domande».
          */}
          {feature?.canAsk ? (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 sm:min-h-8"
              disabled={askBlocked}
              aria-describedby={askBlocked ? gatesId : undefined}
              onClick={() => setReferentDialog({ kind: "ask" })}
            >
              <Send aria-hidden />
              {REFERENT_UI_TEXT.ask}
            </Button>
          ) : null}
        </div>
      ) : null}
      {canEdit && feature?.canAsk && entry ? <GateNotice id={gatesId} gates={entry.gates} /> : null}
      {feature ? <RequestsList workspaceId={workspaceId} useCaseId={useCaseId} requests={feature.requests} canAsk={canEdit && feature.canAsk} onOpen={setReferentDialog} /> : null}

      {canEdit && (dialog?.mode === "aggiungi" || dialog?.mode === "modifica") ? (
        <NeedFormDialog
          key={dialog.mode === "modifica" ? `${dialog.need.id}-${dialog.need.version}` : "nuova"}
          need={dialog.mode === "modifica" ? dialog.need : null}
          pending={pending}
          onClose={() => setDialog(null)}
          onSubmit={(draft, setErrors) => {
            if (dialog.mode === "aggiungi") return send(() => createNeedAction(workspaceId, useCaseId, needCreatePayload(draft)), setErrors);
            const patch = needPatchPayload(dialog.need, draft);
            if (!Object.keys(patch).length) {
              setDialog(null);
              return Promise.resolve(true);
            }
            return send(() => updateNeedAction(workspaceId, useCaseId, dialog.need.id, dialog.need.version, patch), setErrors);
          }}
          onUnlink={dialog.mode === "modifica" ? () => void send(() => unlinkNeedAction(workspaceId, useCaseId, dialog.need.id, useCaseId)) : undefined}
          onArchive={dialog.mode === "modifica" ? () => setDialog({ mode: "archivia", need: dialog.need }) : undefined}
        />
      ) : null}
      {canEdit && dialog?.mode === "archivia" ? (
        <ArchiveNeedDialog
          need={dialog.need}
          pending={pending}
          onClose={() => setDialog(null)}
          onSubmit={(reason, setError) =>
            send(
              () => archiveNeedAction(workspaceId, useCaseId, dialog.need.id, dialog.need.version, reason),
              (errors) => setError(errors.archiveReason ?? Object.values(errors)[0] ?? null),
            )
          }
        />
      ) : null}
      {canEdit && feature ? (
        <ReferentDialogs dialog={referentDialog} workspaceId={workspaceId} useCaseId={useCaseId} panel={feature} needTitles={needTitles} onClose={() => setReferentDialog(null)} />
      ) : null}
      {canEdit && dialog?.mode === "collega" ? (
        <LinkNeedDialog
          needs={linkable}
          pending={pending}
          onClose={() => setDialog(null)}
          onSubmit={(needId) => send(() => linkNeedAction(workspaceId, useCaseId, needId, useCaseId))}
        />
      ) : null}
    </section>
  );
}

/** «Chiedi al referente» nelle righe: la riga della richiesta, risposte e file, «Aggiungi una risposta» e «Allega un file». */
interface NeedListReferent {
  workspaceId: string;
  views: Readonly<Record<string, NeedReferentView>>;
  /** Le esigenze che accettano una risposta o un file del team (id in minuscolo); vuoto per chi non modifica. */
  answerable: ReadonlySet<string>;
  canReviewFiles: boolean;
  onOpen: (dialog: ReferentDialog) => void;
}

function NeedList({
  needs,
  useCaseId,
  refs,
  detailHrefOf,
  today,
  canEdit,
  onEdit,
  referent = null,
}: {
  needs: readonly NeedView[];
  useCaseId: string;
  refs: ReadonlyMap<string, NeedUseCaseRef>;
  /** id dello use case → il suo capitolo «Cosa serve» (`cosaServeHref`). */
  detailHrefOf: (id: string) => string;
  today: string;
  canEdit: boolean;
  onEdit: (need: NeedView) => void;
  referent?: NeedListReferent | null;
}) {
  const self = useCaseId.toLowerCase();
  return (
    <ul className="divide-y rounded-lg border">
      {needs.map((need) => {
        const row = needRow(need, refs, today);
        const others = row.useCases.filter((ref) => ref.id.toLowerCase() !== self);
        const meta = [need.type === "requisito" ? NEED_KIND_LABEL[need.kind] : null, row.owner, row.due].filter(Boolean).join(" · ");
        return (
          <li key={need.id} data-need={need.id} className="flex items-start gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium break-words">{keepTogether(row.title)}</p>
              {row.detail ? <p className="line-clamp-2 text-xs text-muted-foreground break-words">{keepTogether(row.detail)}</p> : null}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <StatusDot tone={row.status.tone} label={row.status.label} />
                {meta ? <span>{keepTogether(meta)}</span> : null}
                {others.length ? <NeedUseCasesDisclosure summary={needAlsoForText(others.length)} context={row.title} useCases={others} hrefOf={detailHrefOf} /> : null}
              </div>
              {referent ? (
                <NeedReferentBlock
                  workspaceId={referent.workspaceId}
                  useCaseId={useCaseId}
                  view={referent.views[need.id.toLowerCase()]}
                  canEdit={canEdit}
                  canReviewFiles={referent.canReviewFiles}
                  onOpen={referent.onOpen}
                />
              ) : null}
            </div>
            {canEdit ? (
              <div className="flex shrink-0 flex-col items-center sm:flex-row">
                {referent?.answerable.has(need.id.toLowerCase()) ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0 sm:size-8"
                      aria-label={`${REFERENT_UI_TEXT.rowAddAnswer}: ${row.title}`}
                      title={REFERENT_UI_TEXT.rowAddAnswer}
                      onClick={() => referent.onOpen({ kind: "answer", need: { id: need.id, title: row.title } })}
                    >
                      <MessageSquarePlus aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0 sm:size-8"
                      aria-label={`${REFERENT_UI_TEXT.rowAttachFile}: ${row.title}`}
                      title={REFERENT_UI_TEXT.rowAttachFile}
                      onClick={() => referent.onOpen({ kind: "file", need: { id: need.id, title: row.title } })}
                    >
                      <Paperclip aria-hidden />
                    </Button>
                  </>
                ) : null}
                <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 sm:size-8" aria-label={`${TEXT.edit}: ${row.title}`} onClick={() => onEdit(need)}>
                  <Pencil aria-hidden />
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Field({ id, label, error, children, className }: { id: string; label: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-errore`} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ChoiceSelect<T extends string>({
  id,
  value,
  options,
  onChange,
  invalid,
}: {
  id: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  invalid?: boolean;
}) {
  return (
    <Select
      items={options.map((option) => ({ value: option.value, label: option.label }))}
      value={value}
      onValueChange={(next) => {
        const match = options.find((option) => option.value === next);
        if (match) onChange(match.value);
      }}
    >
      <SelectTrigger id={id} aria-invalid={invalid || undefined} className="min-h-11 w-full sm:min-h-8">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** «Aggiungi» e «Modifica»: un modulo per tutti i campi; i meno usati sotto «Altro». */
function NeedFormDialog({
  need,
  pending,
  onClose,
  onSubmit,
  onUnlink,
  onArchive,
}: {
  need: NeedView | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (draft: NeedDraft, setErrors: (errors: Record<string, string>) => void) => Promise<boolean>;
  onUnlink?: () => void;
  onArchive?: () => void;
}) {
  const baseId = useId();
  const typeLabelId = `${baseId}-tipo`;
  const [draft, setDraft] = useState<NeedDraft>(() => (need ? draftFromNeed(need) : emptyNeedDraft()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof NeedDraft>(key: K, value: NeedDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: "" } : current));
  };

  function confirm() {
    const local = needDraftErrors(draft);
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    void onSubmit(draft, setErrors);
  }

  const requirement = draft.type === "requisito";
  const formError = errors.form || null;
  return (
    <DecisionDialog
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={need ? TEXT.editTitle : TEXT.addTitle}
      confirmLabel={need ? TEXT.save : TEXT.add}
      pending={pending}
      error={formError}
      onConfirm={confirm}
      className="sm:max-w-lg"
    >
      <div data-slot="need-form" className="grid gap-3">
        <div className="space-y-1.5">
          <p id={typeLabelId} className="text-sm font-medium">
            {TEXT.type}
          </p>
          <DecisionChoiceGroup<NeedType>
            labelledBy={typeLabelId}
            options={(["requisito", "passo"] as const).map((type) => ({ value: type, label: NEED_TYPE_LABEL[type] }))}
            value={draft.type}
            onChange={(type) => setDraft((current) => withNeedType(current, type))}
            className="grid-cols-2"
          />
        </div>
        <Field id={`${baseId}-titolo`} label={TEXT.what} error={errors.title}>
          <Input
            id={`${baseId}-titolo`}
            value={draft.title}
            maxLength={NEED_LIMITS.title}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? `${baseId}-titolo-errore` : undefined}
            className="min-h-11 sm:min-h-8"
            onChange={(event) => set("title", event.target.value)}
          />
        </Field>
        <Field id={`${baseId}-dettagli`} label={TEXT.detail} error={errors.detail}>
          <Textarea id={`${baseId}-dettagli`} value={draft.detail} maxLength={NEED_LIMITS.detail} rows={2} onChange={(event) => set("detail", event.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          {requirement ? (
            <Field id={`${baseId}-tipo-esigenza`} label={TEXT.kind} error={errors.kind}>
              <ChoiceSelect
                id={`${baseId}-tipo-esigenza`}
                value={draft.kind}
                options={NEED_FORM_CHOICES.kinds.map((kind) => ({ value: kind, label: NEED_KIND_LABEL[kind] }))}
                onChange={(kind) => set("kind", kind)}
              />
            </Field>
          ) : null}
          <Field id={`${baseId}-stato`} label={TEXT.status} error={errors.status}>
            <ChoiceSelect id={`${baseId}-stato`} value={draft.status} options={needStatusChoices(draft.type)} onChange={(status) => set("status", status)} invalid={Boolean(errors.status)} />
          </Field>
          <Field id={`${baseId}-chi`} label={TEXT.owner} error={errors.ownerLabel}>
            <Input
              id={`${baseId}-chi`}
              value={draft.ownerLabel}
              maxLength={NEED_LIMITS.ownerLabel}
              className="min-h-11 sm:min-h-8"
              onChange={(event) => set("ownerLabel", event.target.value)}
            />
          </Field>
          <Field id={`${baseId}-parte`} label={TEXT.ownerSide} error={errors.ownerSide}>
            <ChoiceSelect<string>
              id={`${baseId}-parte`}
              value={draft.ownerSide || "nessuna"}
              options={[{ value: "nessuna", label: TEXT.noSide }, ...NEED_FORM_CHOICES.ownerSides.map((side) => ({ value: side, label: NEED_OWNER_SIDE_LABEL[side] }))]}
              onChange={(side) => set("ownerSide", side === "nessuna" ? "" : (side as NeedDraft["ownerSide"]))}
            />
          </Field>
          {requirement ? (
            <Field id={`${baseId}-quando`} label={TEXT.availability} error={errors.availability}>
              <ChoiceSelect<string>
                id={`${baseId}-quando`}
                value={draft.availability || "non_detto"}
                options={[
                  { value: "non_detto", label: TEXT.noAvailability },
                  ...NEED_FORM_CHOICES.availabilities.map((value) => ({ value, label: NEED_AVAILABILITY_LABEL[value] })),
                ]}
                onChange={(value) => set("availability", value === "non_detto" ? "" : (value as NeedDraft["availability"]))}
              />
            </Field>
          ) : null}
          <Field id={`${baseId}-entro`} label={TEXT.dueOn} error={errors.dueOn}>
            <Input
              id={`${baseId}-entro`}
              type="date"
              value={draft.dueOn}
              aria-invalid={errors.dueOn ? true : undefined}
              className="min-h-11 sm:min-h-8"
              onChange={(event) => set("dueOn", event.target.value)}
            />
          </Field>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
          <Checkbox checked={draft.dueIsProposal} onCheckedChange={(checked) => set("dueIsProposal", checked === true)} />
          {TEXT.dueIsProposal}
        </label>
        <Disclosure summary={TEXT.more}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`${baseId}-entro-testo`} label={TEXT.dueLabel} error={errors.dueLabel}>
              <Input
                id={`${baseId}-entro-testo`}
                value={draft.dueLabel}
                maxLength={NEED_LIMITS.dueLabel}
                className="min-h-11 sm:min-h-8"
                onChange={(event) => set("dueLabel", event.target.value)}
              />
            </Field>
            <Field id={`${baseId}-per`} label={TEXT.forLabel} error={errors.forLabel}>
              <Input id={`${baseId}-per`} value={draft.forLabel} maxLength={NEED_LIMITS.forLabel} className="min-h-11 sm:min-h-8" onChange={(event) => set("forLabel", event.target.value)} />
            </Field>
          </div>
        </Disclosure>
        {onUnlink || onArchive ? (
          <div className="flex flex-wrap gap-x-3 border-t pt-3">
            {onUnlink ? (
              <Button type="button" variant="ghost" className="min-h-11 px-1 sm:min-h-8" onClick={onUnlink}>
                {TEXT.unlink}
              </Button>
            ) : null}
            {onArchive ? (
              <Button type="button" variant="ghost" className="min-h-11 px-1 text-destructive sm:min-h-8" onClick={onArchive}>
                {TEXT.archive}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </DecisionDialog>
  );
}

/** «Archivia», con il motivo obbligatorio. */
function ArchiveNeedDialog({
  need,
  pending,
  onClose,
  onSubmit,
}: {
  need: NeedView;
  pending: boolean;
  onClose: () => void;
  onSubmit: (reason: string, setError: (error: string | null) => void) => Promise<boolean>;
}) {
  const fieldId = useId();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  function confirm() {
    const parsed = validateArchiveReason(reason);
    if (!parsed.ok) {
      setError(parsed.fieldErrors.archiveReason ?? null);
      return;
    }
    void onSubmit(parsed.value, setError);
  }
  return (
    <DecisionDialog
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={TEXT.archiveTitle}
      description={`${need.title}. ${TEXT.archiveDescription}`}
      confirmLabel={TEXT.archive}
      pending={pending}
      error={error}
      onConfirm={confirm}
    >
      <Field id={fieldId} label={TEXT.archiveReason}>
        <Textarea
          id={fieldId}
          value={reason}
          maxLength={NEED_LIMITS.archiveReason}
          rows={2}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setReason(event.target.value);
            setError(null);
          }}
        />
      </Field>
    </DecisionDialog>
  );
}

/** «Collega un'esigenza»: una delle altre del workspace. */
function LinkNeedDialog({ needs, pending, onClose, onSubmit }: { needs: readonly NeedView[]; pending: boolean; onClose: () => void; onSubmit: (needId: string) => Promise<boolean> }) {
  const fieldId = useId();
  const [choice, setChoice] = useState<string>(needs[0]?.id ?? "");
  return (
    <DecisionDialog
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={TEXT.linkTitle}
      description={TEXT.linkDescription}
      confirmLabel={TEXT.linkConfirm}
      pending={pending}
      onConfirm={() => {
        if (choice) void onSubmit(choice);
      }}
    >
      <Field id={fieldId} label={TEXT.linkChoice}>
        <ChoiceSelect<string>
          id={fieldId}
          value={choice}
          options={needs.map((need) => ({ value: need.id, label: `${need.title} · ${NEED_TYPE_LABEL[need.type]}` }))}
          onChange={setChoice}
        />
      </Field>
    </DecisionDialog>
  );
}
