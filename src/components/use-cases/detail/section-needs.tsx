"use client";

import { useId, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Link2, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { ActionMenu, type ActionMenuItem } from "@/components/uc/ui/action-menu";
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
import { formatInteger } from "@/lib/use-cases/format";
import type { InfoProgressView } from "@/lib/use-cases/info-progress";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { cosaServeHref, type NeedReferentView, type UseCaseReferentPanel } from "@/lib/use-cases/referent/contract";
import { REFERENT_ASSIGN_TEXT, REFERENT_UI_TEXT, fillText } from "@/lib/use-cases/referent/labels";
import {
  NEED_AVAILABILITY_LABEL,
  NEED_KIND_LABEL,
  NEED_LIMITS,
  NEED_OWNER_SIDE_LABEL,
  NEED_ROWS_SHOWN,
  NEED_TYPE_LABEL,
  compareStepsByDate,
  isNeedDone,
  needAlsoForText,
  needDoneSummaryText,
  needRow,
  needStatusChoices,
  needsActionFirst,
  validateArchiveReason,
  type NeedType,
  type NeedUseCaseRef,
  type NeedView,
} from "@/lib/use-cases/needs";
import { cn } from "@/lib/utils";
import { Disclosure } from "../disclosure";
import { NeedUseCasesDisclosure } from "../need-use-cases";
import { DecisionChoiceGroup, DecisionDialog } from "../reopen-dialog";
import { useLanding } from "./arrival";
import { InfoSummary } from "./info-summary";
import { askDialogEntry } from "./referent/ask-dialog-state";
import { requestsShown } from "./referent/assign-dialog-state";
import { ReferentBlock } from "./referent/referent-block";
import { useReferentDialog } from "./referent/dialog-host";
import type { ReferentDialog } from "./referent/dialogs";
import { NeedReferentBlock } from "./referent/need-referent-block";
import { RequestsList } from "./referent/requests-list";
import {
  NEED_FORM_CHOICES,
  NEED_FORM_TEXT as TEXT,
  draftFromNeed,
  moreRowsText,
  stepsSummaryText,
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
  /**
   * Il riquadro «Prossimo passo» parla già di «Chiedi al referente» (rilascio 3): `ask` quando ha il
   * pulsante (G5), e allora qui non si ripete; `gate` quando la sua riga è il motivo che lo blocca
   * (G4, G6). (Rilascio 4) Il motivo resta solo nel riquadro; il pulsante della riga c'è quando chi
   * guarda può arrivare in fondo ai passi (`askDialogEntry`).
   */
  boxAsk?: "ask" | "gate" | null;
  /** (Rilascio 5) Il riquadro «Prossimo passo» ha il pulsante pieno «Scegli il referente». */
  boxOwnsChoose?: boolean;
  /** (Rilascio 5) `canEditValuation`: le azioni del team sulla stima del referente. */
  canEditValuation?: boolean;
  className?: string;
}

type Dialog =
  | { mode: "aggiungi" }
  | { mode: "modifica"; need: NeedView }
  | { mode: "archivia"; need: NeedView }
  | { mode: "collega" }
  | null;

/**
 * Il capitolo «Cosa serve» della scheda, solo per i revisori (spec di Pierpaolo, 25/10/2026;
 * rilascio 3, compatto): la riga dei conteggi, poi i requisiti aperti collegati a questo use case,
 * prima quelli da verificare e poi l'ordine del team (`needsActionFirst`), i primi cinque in vista
 * (`NEED_ROWS_SHOWN`, gli stessi di ogni gruppo della vista «Cosa serve») e gli altri sotto «Mostra
 * le altre N»; poi, chiusi, «Prossimi passi · N» (dalla scadenza più vicina), «Già a posto · N» e
 * «Richieste inviate · N». Ogni riga dice il gruppo dello stato («Da chiedere», «In attesa», «Da
 * verificare», «Ferma», «A posto») con tipo, chi, scadenza e il dettaglio dello stato, e ha un solo
 * menu «⋯» con «Aggiungi una risposta», «Allega un file» e «Modifica». «Aggiungi» apre il modulo
 * (l'esigenza nasce collegata a questo use case); «Modifica» lo apre sull'esigenza, con
 * «Scollega da questo use case» e «Archivia» (con il motivo: non si cancella niente); «Collega
 * un'esigenza» sceglie una delle altre del workspace. Ogni modifica porta la versione letta: se
 * qualcuno l'ha appena cambiata, il toast lo dice e la pagina si rilegge.
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
  boxAsk = null,
  boxOwnsChoose = false,
  canEditValuation = false,
  className,
}: SectionNeedsProps) {
  const id = "cosa-serve";
  const headingId = `${id}-titolo`;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Dialog>(null);
  // Le finestre di «Chiedi al referente» sono della pagina (`ReferentDialogHost`): una alla volta.
  const openReferent = useReferentDialog();
  const setReferentDialog = (next: ReferentDialog) => openReferent?.(next);
  const refMap = useMemo(() => new Map(Object.entries(refs)), [refs]);
  const detailHrefOf = (id: string) => cosaServeHref(workspaceId, id);
  const empty = !requirements.length && !steps.length;
  // «Chiedi al referente»: solo con la funzione accesa per il workspace e gli archivi pronti.
  const feature = referents?.available ? referents : null;
  const answerable = useMemo(() => new Set((feature?.answerableNeedIds ?? []).map((needId) => needId.toLowerCase())), [feature]);
  // «Richieste inviate» aperta quando la pagina arriva con `?capitolo=richieste` («Nessuna risposta»
  // della campanella e delle email a chi ha chiesto), dove si chiede di nuovo: l'arrivo della
  // navigazione (`Arrival`), non quello che lo stesso indirizzo darebbe dopo una rilettura.
  const requestsOpen = useLanding() === "richieste";

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
  // Prima quello che chiede di agire (le risposte da verificare), poi l'ordine del team: le prime
  // tre righe sono quelle del pannello (`panelNeeds`).
  const openRequirements = requirements.filter((need) => !isNeedDone(need.type, need.status)).sort(needsActionFirst);
  const shownRequirements = openRequirements.slice(0, NEED_ROWS_SHOWN);
  const moreRequirements = openRequirements.slice(NEED_ROWS_SHOWN);
  // I prossimi passi dalla scadenza più vicina, quelli senza data in fondo (`compareStepsByDate`):
  // lo stesso ordine del pannello e della linea del tempo di «Cosa serve» (rilascio 4).
  const doneSteps = steps.filter((need) => isNeedDone(need.type, need.status)).sort(compareStepsByDate);
  const openSteps = steps.filter((need) => !isNeedDone(need.type, need.status)).sort(compareStepsByDate);
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
  // (Rilascio 4, §3) «Chiedi al referente» c'è solo quando chi guarda può arrivare in fondo ai passi:
  // nessun motivo, l'ok sui fornitori che può dare lui, o le email spente (la finestra lo dice). Mai
  // spento: chi non può finire legge il motivo nel riquadro «Prossimo passo». «Prepara le domande» sta
  // nella finestra, in «Cosa chiedi».
  const entry = feature ? askDialogEntry(feature) : null;
  // (Rilascio 5, D34) Le richieste al referente le dice il suo blocco: qui le altre.
  const requests = feature ? requestsShown(feature) : [];
  const eligible = Boolean(feature?.eligible);
  const hasReferent = Boolean(feature?.referent);

  return (
    <section id={id} aria-labelledby={headingId} data-slot="section-needs" className={cn("scroll-mt-20 space-y-4", className)}>
      <h2 id={headingId} tabIndex={-1} className="text-base font-semibold outline-none">
        {TEXT.title}
      </h2>
      {feature && eligible ? (
        <ReferentBlock
          workspaceId={workspaceId}
          useCaseId={useCaseId}
          panel={feature}
          canEdit={canEdit}
          boxOwnsChoose={boxOwnsChoose}
          canEditValuation={canEditValuation}
          today={today}
          onOpen={setReferentDialog}
        />
      ) : null}
      <InfoSummary view={infoProgress} />
      {empty ? <p className="text-sm text-muted-foreground">{TEXT.empty}</p> : null}
      {requirements.length ? (
        <div data-slot="needs-requirements" className="space-y-2">
          <h3 className="text-sm font-medium">{TEXT.requirements}</h3>
          {shownRequirements.length ? list(shownRequirements) : null}
          {moreRequirements.length ? (
            <Disclosure summary={moreRowsText(moreRequirements.length)} slot="needs-more">
              {list(moreRequirements)}
            </Disclosure>
          ) : null}
        </div>
      ) : null}
      {steps.length || doneRequirements.length || requests.length ? (
        <div className="space-y-1">
          {steps.length ? (
            <Disclosure summary={stepsSummaryText(openSteps.length)} slot="needs-steps">
              <div className="space-y-2">
                {openSteps.length ? list(openSteps) : null}
                {doneSteps.length ? <Disclosure summary={needDoneSummaryText("passo", doneSteps.length)}>{list(doneSteps)}</Disclosure> : null}
              </div>
            </Disclosure>
          ) : null}
          {doneRequirements.length ? (
            <Disclosure summary={needDoneSummaryText("requisito", doneRequirements.length)} slot="needs-done">
              {list(doneRequirements)}
            </Disclosure>
          ) : null}
          {/* Le richieste ai referenti, chiuse: l'ancora di «Vedi le richieste» del riquadro «Prossimo passo»; aperte con `?capitolo=richieste` (`useLanding`). */}
          {feature && requests.length ? (
            <Disclosure id="richieste" defaultOpen={requestsOpen} summary={fillText(REFERENT_UI_TEXT.requestsSentSummary, { n: formatInteger(requests.length) })} slot="needs-requests" className="scroll-mt-20">
              <RequestsList
                bare
                workspaceId={workspaceId}
                useCaseId={useCaseId}
                requests={requests}
                canAsk={canEdit && feature.canAsk}
                canAskAgain={Boolean(entry?.canAskAgain)}
                onOpen={setReferentDialog}
              />
            </Disclosure>
          ) : null}
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
            L'azione principale del capitolo, ma non della pagina: un solo pulsante pieno per pagina (la
            decisione). «secondary» la distingue da «Aggiungi»; con G5 il riquadro ha già quello pieno.
          */}
          {/*
            (Rilascio 5, §8.4) Su uno use case con il referente da scegliere il referente si sceglie nel
            suo blocco; qui, quando c'è, «Chiedi a un'altra persona» per chi non è il referente.
          */}
          {feature?.canAsk && entry?.canOpen && (eligible ? hasReferent : boxAsk !== "ask") ? (
            <Button type="button" variant="secondary" className="min-h-11 sm:min-h-8" onClick={() => setReferentDialog(eligible ? { kind: "other" } : { kind: "ask" })}>
              <Send aria-hidden />
              {eligible ? REFERENT_ASSIGN_TEXT.other : REFERENT_UI_TEXT.ask}
            </Button>
          ) : null}
        </div>
      ) : null}

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

/**
 * Le voci del «⋯» di una riga (un solo menu per riga, rilascio 3): «Aggiungi una risposta» e «Allega
 * un file» quando l'esigenza accetta una risposta del team, poi «Modifica». Vuoto per chi non
 * modifica: allora il menu non c'è.
 */
export function needRowActions({
  need,
  canEdit,
  answerable,
  onOpen,
  onEdit,
}: {
  need: { id: string; title: string };
  canEdit: boolean;
  answerable: boolean;
  onOpen: ((dialog: ReferentDialog) => void) | null;
  onEdit: () => void;
}): ActionMenuItem[] {
  if (!canEdit) return [];
  const reply: ActionMenuItem[] =
    answerable && onOpen
      ? [
          { label: REFERENT_UI_TEXT.rowAddAnswer, onSelect: () => onOpen({ kind: "answer", need }) },
          { label: REFERENT_UI_TEXT.rowAttachFile, onSelect: () => onOpen({ kind: "file", need }) },
        ]
      : [];
  return [...reply, { label: TEXT.edit, onSelect: onEdit }];
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
        // Tipo · chi · scadenza · il dettaglio dello stato («manca il dato»), dopo il gruppo.
        const meta = [need.type === "requisito" ? NEED_KIND_LABEL[need.kind] : null, row.owner, row.due, row.statusNote].filter(Boolean).join(" · ");
        const actions = needRowActions({
          need: { id: need.id, title: row.title },
          canEdit,
          answerable: Boolean(referent?.answerable.has(need.id.toLowerCase())),
          onOpen: referent?.onOpen ?? null,
          onEdit: () => onEdit(need),
        });
        return (
          <li key={need.id} data-need={need.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-3 py-2.5">
            <div className="min-w-0 space-y-1">
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
            {actions.length ? <ActionMenu items={actions} label={`${TEXT.rowActions}: ${row.title}`} className="shrink-0" /> : null}
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
