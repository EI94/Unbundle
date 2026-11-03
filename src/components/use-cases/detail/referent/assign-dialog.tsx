"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, ListPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  listReferentPeopleAction,
  prepareReferentQuestionsAction,
  revealReferentContactEmailAction,
  revealReferentMemberEmailAction,
  sendReferentRequestAction,
} from "@/lib/actions/use-case-referents";
import type { ReferentActionResult, UseCaseReferentPanel } from "@/lib/use-cases/referent/contract";
import { teamEstimateDetail, teamEstimateStatement, type TeamEstimate } from "@/lib/use-cases/referent/estimate";
import { REFERENT_ASSIGN_TEXT, REFERENT_ERROR_MESSAGES, REFERENT_UI_TEXT, companyLabel, fillText } from "@/lib/use-cases/referent/labels";
import { orgWordsOf } from "@/lib/use-cases/referent/match";
import { referentRequestPreview, requesterNameOf } from "@/lib/use-cases/referent/preview";
import { cn } from "@/lib/utils";
import { Disclosure } from "../../disclosure";
import { NEW_CONTACT, contactRowLine, memberIdOf } from "./ask-dialog-state";
import { AskPeopleStep, type AskPeopleList } from "./ask-people";
import { EmailPreview } from "./ask-preview";
import { ASK_DIALOG_CLASS, type AskStepsContext } from "./ask-steps";
import { isRepeatActivation, okNoticeOf, personOf, toLine, type AskPerson } from "./ask-steps-state";
import {
  ASSIGN_REFRESH_CODES,
  assignContacts,
  assignDraftErrors,
  assignEntry,
  assignErrorPlace,
  assignKind,
  assignLeadFor,
  assignPayload,
  assignQuestionIds,
  assignQuestionsSummary,
  assignRestLine,
  assignRowSuffix,
  assignSendLabel,
  assignTicks,
  assignTitle,
  carriedNeedIds,
  defaultFileRequired,
  droppedLine,
  lockedPerson,
  referentRequestOf,
  replacesQuestions,
  type AssignDraft,
  type AssignMode,
} from "./assign-dialog-state";
import { Field, describedBy } from "./fields";

const T = REFERENT_ASSIGN_TEXT;
const A = REFERENT_UI_TEXT.askDialog;
const TOUCH = "min-h-11 sm:min-h-8";
const FAILED: ReferentActionResult<never> = { ok: false, code: "riprova", message: REFERENT_ERROR_MESSAGES.riprova };
/** «Scegli il referente» non propone le domande standard di frequenza e tempo: le chiede già la stima (D32). */
const PREPARE_SKIP = ["frequenza", "tempo"] as const;

/** Quello che «Scegli il referente» mostra in «Cosa riceve {Nome}»: la descrizione e la stima come le vede il referente. */
export interface AssignContext {
  description: { text: string | null; dropped: number };
  team: TeamEstimate | null;
}

export interface AssignDialogProps extends Omit<AskStepsContext, "saved">, AssignContext {
  workspaceId: string;
  useCaseId: string;
  panel: UseCaseReferentPanel;
  mode: AssignMode;
  onClose: () => void;
}

const lower = (id: string) => id.toLowerCase();

/**
 * «Scegli il referente» (rilascio 5, §8.2): una schermata. Chi è il referente, poi chiuse «Domande ·
 * 5 di 7» (con «Serve un file»), «Aggiungi un messaggio» e «Cosa riceve {Nome}», l'indirizzo intero
 * della persona scelta sopra il piede, e un solo pulsante pieno, «Invia a {Nome}». Mai spento: senza
 * una persona dice «Scegli il referente.». Con un motivo che blocca l'invio il piede ha «Chiudi».
 */
export function AssignDialog({
  workspaceId,
  useCaseId,
  panel,
  mode,
  needInfo,
  card,
  companyName,
  companyDisplayName,
  peopleCache,
  onPeople,
  description,
  team,
  onClose,
}: AssignDialogProps) {
  const baseId = useId();
  const ids = {
    form: `${baseId}-form`,
    who: `${baseId}-chi`,
    whoError: `${baseId}-chi-errore`,
    name: `${baseId}-nome`,
    email: `${baseId}-email`,
    role: `${baseId}-ruolo`,
    questions: `${baseId}-domande`,
    questionsError: `${baseId}-domande-errore`,
    message: `${baseId}-messaggio`,
    lead: `${baseId}-intro`,
  };
  const router = useRouter();
  const [sending, startSend] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const [preparing, startPrepare] = useTransition();
  const locked = lockedPerson(mode);
  const referent = panel.referent ?? null;
  const previous = mode === "di_nuovo" ? referentRequestOf(panel) : null;
  const kind = assignKind(mode, previous);
  const entry = assignEntry(panel);
  const contacts = useMemo(() => assignContacts(panel), [panel]);

  const [people, setPeople] = useState<AskPeopleList>(() => (locked ? { state: "ready", members: [] } : peopleCache ? { state: "ready", members: peopleCache } : { state: "loading", members: [] }));
  const [peopleRound, setPeopleRound] = useState(0);
  useEffect(() => {
    if (locked) return;
    let live = true;
    listReferentPeopleAction(workspaceId, useCaseId)
      .then((result) => {
        if (!live) return;
        if (result.ok) {
          setPeople({ state: "ready", members: result.data.members });
          onPeople(result.data.members);
        } else setPeople((current) => (current.members.length ? current : { state: "failed", members: [] }));
      })
      .catch(() => {
        if (live) setPeople((current) => (current.members.length ? current : { state: "failed", members: [] }));
      });
    return () => {
      live = false;
    };
  }, [locked, workspaceId, useCaseId, onPeople, peopleRound]);

  const [draft, setDraft] = useState<AssignDraft>(() => ({
    choice: locked && referent ? lower(referent.contact.id) : null,
    name: "",
    email: "",
    role: "",
    needIds: [],
    fileRequired: [],
    message: "",
  }));
  const [touched, setTouched] = useState(false);
  const [ticksKey, setTicksKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string | null>>({});
  const [questionsKey, setQuestionsKey] = useState(0);
  const [sawSubGate, setSawSubGate] = useState(false);
  const [prepared, setPrepared] = useState<string | null>(null);

  const lookup = useMemo(() => ({ contacts, members: people.members, limits: panel.limits }), [contacts, people.members, panel.limits]);
  const person: AskPerson | null = locked
    ? referent
      ? { key: `c:${lower(referent.contact.id)}`, kind: "referente", revealId: lower(referent.contact.id), displayName: referent.contact.name, roleLabel: referent.contact.roleLabel, email: referent.contact.emailMasked }
      : null
    : personOf(draft, lookup);
  const orgWords = useMemo(() => orgWordsOf([companyName, companyDisplayName]), [companyName, companyDisplayName]);
  const carried = carriedNeedIds(panel, mode, draft);
  const order = useMemo(() => Object.keys(needInfo), [needInfo]);
  const questions = assignQuestionIds(panel, mode, carried, order);
  const questionsSig = questions.join(",");

  // Le spunte di partenza per la persona scelta (§3.8); dopo una spunta di chi guarda restano le sue.
  const key = `${person?.key ?? "-"}|${questionsSig}`;
  if (ticksKey !== key) {
    setTicksKey(key);
    if (!touched) {
      const ticks = assignTicks({
        mode,
        questions,
        carried,
        needInfo,
        person: person ? { displayName: person.displayName, roleLabel: person.roleLabel } : null,
        orgWords,
        declined: referent?.declinedNeedIds ?? [],
        previous: previous?.needIds ?? null,
      });
      setDraft((d) => ({ ...d, needIds: ticks, fileRequired: defaultFileRequired(ticks, needInfo) }));
    } else {
      const now = new Set(questions);
      setDraft((d) => ({ ...d, needIds: d.needIds.filter((id) => now.has(id)), fileRequired: d.fileRequired.filter((id) => now.has(id)) }));
    }
  }

  // L'indirizzo intero della persona scelta, una volta per persona, sopra il piede (D56).
  const asking = useRef(new Set<string>());
  const reveal = useCallback(
    (target: { kind: "referente" | "persona"; id: string }) => {
      const k = `${target.kind}:${target.id}`;
      if (asking.current.has(k)) return;
      asking.current.add(k);
      const call = target.kind === "referente" ? revealReferentContactEmailAction(workspaceId, useCaseId, target.id) : revealReferentMemberEmailAction(workspaceId, useCaseId, target.id);
      call.then((result) => setRevealed((now) => ({ ...now, [k]: result.ok ? result.data.email : null }))).catch(() => setRevealed((now) => ({ ...now, [k]: null })));
    },
    [workspaceId, useCaseId],
  );
  const revealKind = person?.revealId ? (person.kind === "persona" ? "persona" : "referente") : null;
  const revealId = person?.revealId ?? null;
  useEffect(() => {
    if (revealKind && revealId) reveal({ kind: revealKind, id: revealId });
  }, [revealKind, revealId, reveal]);
  const revealedEmail = revealKind && revealId ? (revealed[`${revealKind}:${revealId}`] ?? null) : null;

  // L'ok sui fornitori dato in un'altra scheda: tornando qui si rilegge la pagina.
  const subGate = entry.sendGates.some((gate) => gate.code === "sub_responsabili_mancanti");
  if (subGate && !sawSubGate) setSawSubGate(true);
  const refreshingRef = useRef(false);
  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);
  useEffect(() => {
    if (!subGate) return;
    const again = () => {
      if (refreshingRef.current || document.visibilityState === "hidden") return;
      startRefresh(() => router.refresh());
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [subGate, router]);

  const openedAt = useRef<number | null>(null);
  useEffect(() => {
    openedAt.current = performance.now();
  }, []);
  const bodyRef = useRef<HTMLFormElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const update = (next: Partial<AssignDraft>, clear: string[] = []) => {
    setDraft((d) => ({ ...d, ...next }));
    if (clear.length) setErrors((current) => Object.fromEntries(Object.entries(current).filter(([k]) => !clear.includes(k))));
    setFormError(null);
  };

  const focusFirst = (found: Record<string, string>) => {
    requestAnimationFrame(() => {
      const form = bodyRef.current;
      if (!form) return;
      const target =
        found.contact !== undefined
          ? form.querySelector<HTMLElement>('[role="radio"]:not([data-disabled])')
          : found.displayName !== undefined
            ? document.getElementById(ids.name)
            : found.email !== undefined
              ? document.getElementById(ids.email)
              : found.needIds !== undefined
                ? form.querySelector<HTMLElement>(`#${CSS.escape(ids.questions)} [data-slot="checkbox"]`)
                : found.message !== undefined
                  ? document.getElementById(ids.message)
                  : null;
      target?.scrollIntoView({ block: "nearest" });
      target?.focus();
    });
  };

  const blocked = entry.sendGates.length > 0;
  const company = companyLabel(companyName);
  const okNotice = okNoticeOf({ sawSubGate, gatesNow: entry.sendGates, company });
  const name = person?.displayName ?? null;
  const ticked = questions.filter((id) => draft.needIds.includes(id));
  const lead = assignLeadFor(mode, kind, ticked.length, name);
  const dropped = droppedLine(description.dropped);
  const rest = assignRestLine(ticked.length, questions.length);
  const replaceHint = !locked && replacesQuestions(panel, draft) ? T.replaceHint : null;
  const changeHint = mode === "cambia" && referent ? fillText(T.changeHint, { Nome: referent.contact.name }) : null;
  const toLineText = person ? (revealedEmail || person.email ? fillText(T.to, { Nome: person.displayName, email: revealedEmail ?? person.email ?? "" }) : toLine(person, null)) : null;
  const prepareOffer = panel.preparable.filter((k) => !(PREPARE_SKIP as readonly string[]).includes(k));

  function send() {
    const found = assignDraftErrors(draft, { contacts, limits: panel.limits }, mode, people.members);
    if (!locked && draft.choice && !memberIdOf(draft.choice) && draft.choice !== NEW_CONTACT) {
      const option = contacts.find((c) => lower(c.id) === lower(draft.choice!));
      if (option && !option.selectable) found.contact = REFERENT_ERROR_MESSAGES.referente_non_valido;
    }
    if (Object.keys(found).length) {
      setErrors(found);
      if (found.needIds || found.message) setQuestionsKey((n) => n + 1);
      focusFirst(found);
      return;
    }
    startSend(async () => {
      let result: ReferentActionResult<{ requestId: string }>;
      try {
        result = await sendReferentRequestAction(workspaceId, useCaseId, assignPayload(draft, { mode, questions, panel, previous }));
      } catch {
        result = FAILED;
      }
      if (result.ok) {
        toast.success(result.message ?? fillText(T.sent, { Nome: name ?? "" }));
        onClose();
        return;
      }
      const place = assignErrorPlace(result.code, result.fieldErrors);
      if (ASSIGN_REFRESH_CODES.has(result.code)) router.refresh();
      if (result.code === "persona_non_disponibile") setPeopleRound((n) => n + 1);
      if (place === "close" || place === "chosen") {
        toast.error(result.message || REFERENT_ERROR_MESSAGES.riprova);
        onClose();
        return;
      }
      if (place === "gates") {
        setFormError(result.message);
        return;
      }
      if (place === "list") {
        const fields: Record<string, string> = {};
        for (const [k, v] of Object.entries(result.fieldErrors ?? {})) if (k === "displayName" || k === "email") fields[k] = v;
        if (!Object.keys(fields).length || draft.choice !== NEW_CONTACT) fields.contact = result.message;
        setErrors(fields);
        focusFirst(fields);
        return;
      }
      if (place === "questions") {
        const fields: Record<string, string> = result.fieldErrors?.message ? { message: result.fieldErrors.message } : { needIds: result.fieldErrors?.needIds ?? result.message };
        setErrors(fields);
        setQuestionsKey((n) => n + 1);
        focusFirst(fields);
        return;
      }
      setFormError(result.message || REFERENT_ERROR_MESSAGES.riprova);
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || blocked) return;
    send();
  }

  function prepare() {
    if (preparing || sending) return;
    startPrepare(async () => {
      let result: ReferentActionResult<{ added: number }>;
      try {
        result = await prepareReferentQuestionsAction(workspaceId, useCaseId, PREPARE_SKIP);
      } catch {
        result = FAILED;
      }
      if (result.ok) {
        setPrepared(result.message ?? REFERENT_UI_TEXT.toasts.prepareAlready);
        router.refresh();
      } else setFormError(result.message);
    });
  }

  const toggleTick = (id: string, on: boolean) => {
    setTouched(true);
    const needIds = on ? [...draft.needIds.filter((x) => x !== id), id] : draft.needIds.filter((x) => x !== id);
    const fileRequired = on ? (needInfo[id]?.kind === "documento" && !draft.fileRequired.includes(id) ? [...draft.fileRequired, id] : draft.fileRequired) : draft.fileRequired.filter((x) => x !== id);
    update({ needIds, fileRequired }, ["needIds"]);
  };
  const toggleFile = (id: string, on: boolean) => {
    setTouched(true);
    update({ fileRequired: on ? [...draft.fileRequired.filter((x) => x !== id), id] : draft.fileRequired.filter((x) => x !== id) });
  };

  const previewParts = referentRequestPreview({
    kind,
    company: companyName,
    useCase: card,
    requesterName: requesterNameOf(panel.requester.name, companyName),
    questions: ticked.length,
    message: draft.message.trim() || null,
    today: new Date(),
  });
  const sendLabel = assignSendLabel(name);
  const gate = entry.notice;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent showCloseButton={false} data-slot="decision-dialog" initialFocus={headingRef} className={ASK_DIALOG_CLASS}>
        <div data-slot="referent-assign" data-mode={mode} className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-2 px-4 pt-4 sm:px-6 sm:pt-5">
            <DialogTitle ref={headingRef} tabIndex={-1} className="outline-none">
              {assignTitle(mode)}
            </DialogTitle>
            <DialogDescription id={ids.lead} data-slot="assign-lead">
              {lead}
            </DialogDescription>
            {changeHint ? <p className="text-sm break-words text-muted-foreground">{changeHint}</p> : null}
            {dropped && kind === "referente" ? (
              <p data-slot="assign-dropped" className="text-xs break-words text-muted-foreground">
                {dropped}
              </p>
            ) : null}
          </div>
          <form id={ids.form} ref={bodyRef} noValidate onSubmit={onSubmit} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
            {gate ? (
              <div role="status" data-slot="assign-gate" data-gate={gate.code} className="space-y-2 rounded-lg border border-dashed p-3 text-sm">
                <p className="break-words">{gate.message}</p>
                {gate.code === "sub_responsabili_mancanti" && gate.canDeclare ? (
                  <Button render={<a href={gate.settingsHref} target="_blank" rel="noopener noreferrer" />} nativeButton={false} className={TOUCH}>
                    {gate.linkLabel}
                    <ExternalLink aria-hidden />
                    <span className="sr-only">{A.newTab}</span>
                  </Button>
                ) : null}
              </div>
            ) : null}
            {okNotice ? (
              <p role="status" data-slot="assign-ok" className="text-sm break-words">
                {okNotice}
              </p>
            ) : null}
            {locked ? null : (
              <AskPeopleStep
                ids={{ heading: ids.who, error: ids.whoError, name: ids.name, email: ids.email, role: ids.role }}
                notice={null}
                contacts={contacts}
                people={people}
                draft={draft}
                errors={errors}
                limits={panel.limits}
                selfHint={null}
                otherHint={null}
                heading={T.whoLabel}
                lead={replaceHint}
                rowLine={(option) => {
                  const suffix = assignRowSuffix(option, panel);
                  const base = contactRowLine({ ...option, selectable: true, reason: null });
                  return [base, suffix].filter(Boolean).join(" ") || null;
                }}
                onChoice={(value) => update({ choice: value }, ["contact"])}
                onField={(k, value) => update({ [k]: value } as Partial<AssignDraft>, [k === "name" ? "displayName" : k === "role" ? "roleLabel" : "email"])}
              />
            )}
            <Disclosure key={`q-${questionsKey}`} slot="assign-questions" summary={assignQuestionsSummary(ticked.length, questions.length)} defaultOpen={questionsKey > 0}>
              <div id={ids.questions} className="space-y-2">
                {questions.length ? (
                  <ul role="group" aria-label={assignQuestionsSummary(ticked.length, questions.length)} aria-describedby={errors.needIds ? ids.questionsError : undefined} className={cn("space-y-0.5 rounded-lg border p-1", errors.needIds && "border-destructive")}>
                    {questions.map((id) => {
                      const checked = draft.needIds.includes(id);
                      const fileOn = draft.fileRequired.includes(id);
                      return (
                        <li key={id} data-slot="assign-question" data-checked={checked || undefined}>
                          <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-muted/50 sm:min-h-9 sm:py-1.5">
                            <Checkbox className="mt-0.5" checked={checked} onCheckedChange={(next) => toggleTick(id, next === true)} />
                            <span className="min-w-0 break-words">{needInfo[id]?.title ?? id}</span>
                          </label>
                          {checked ? (
                            <label data-slot="assign-file-required" className="ml-8 flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted/50 sm:min-h-8">
                              <Checkbox checked={fileOn} onCheckedChange={(next) => toggleFile(id, next === true)} />
                              {T.fileRequired}
                            </label>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{kind === "referente" ? T.questionsEmpty : A.questionsEmpty}</p>
                )}
                {errors.needIds ? (
                  <p id={ids.questionsError} role="alert" className="text-xs text-destructive">
                    {errors.needIds}
                  </p>
                ) : null}
                {rest ? <p className="text-xs text-muted-foreground">{rest}</p> : null}
                {prepareOffer.length && prepared === null && !locked ? (
                  <Button type="button" variant="outline" className={TOUCH} aria-busy={preparing || undefined} onClick={prepare}>
                    <ListPlus aria-hidden />
                    {REFERENT_UI_TEXT.prepare}
                  </Button>
                ) : null}
                {prepared !== null ? (
                  <p role="status" className="text-xs break-words text-muted-foreground">
                    {prepared}
                  </p>
                ) : null}
              </div>
            </Disclosure>
            <Disclosure key={`m-${questionsKey}`} slot="ask-message" summary={A.messageAdd} defaultOpen={Boolean(draft.message.trim()) || Boolean(errors.message)}>
              <Field id={ids.message} label={A.messageLabel} hint={A.messageHint} error={errors.message}>
                <Textarea
                  id={ids.message}
                  value={draft.message}
                  rows={3}
                  maxLength={panel.limits.messageMax}
                  placeholder={A.messagePlaceholder}
                  aria-invalid={errors.message ? true : undefined}
                  aria-describedby={describedBy(ids.message, A.messageHint, errors.message)}
                  onChange={(event) => update({ message: event.target.value }, ["message"])}
                />
              </Field>
            </Disclosure>
            <Disclosure slot="assign-preview" summary={name ? fillText(T.preview, { Nome: name }) : T.previewSomeone}>
              <div className="space-y-3">
                <EmailPreview to={toLineText ?? (name ?? "")} parts={previewParts} />
                <div data-slot="assign-on-page" className="space-y-1.5 text-sm">
                  <p>{T.onPage}</p>
                  {kind === "referente" ? (
                    <>
                      <blockquote className="rounded-lg bg-muted/50 px-3 py-2 break-words whitespace-pre-line">{description.text ?? card.title}</blockquote>
                      {team ? (
                        <p className="break-words">
                          {teamEstimateStatement(team)} <span className="text-muted-foreground">{teamEstimateDetail(team)}</span>
                        </p>
                      ) : (
                        <p className="break-words text-muted-foreground">{T.noTeamEstimate}</p>
                      )}
                    </>
                  ) : null}
                  {ticked.length ? (
                    <ol className="list-decimal space-y-0.5 pl-5">
                      {ticked.map((id) => (
                        <li key={id} className="break-words">
                          {needInfo[id]?.title ?? id}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>
              </div>
            </Disclosure>
          </form>
          {toLineText ? (
            <p data-slot="assign-to" className="border-t px-4 pt-2 text-xs break-all text-muted-foreground sm:px-6">
              {toLineText}
            </p>
          ) : null}
          {formError ? (
            <p role="alert" data-slot="assign-error" className="px-4 pt-2 text-sm break-words text-destructive sm:px-6">
              {formError}
            </p>
          ) : null}
          <div data-slot="ask-footer" className="mt-2 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
            <Button type="button" variant="outline" className={TOUCH} onClick={(event) => (event.detail > 1 ? undefined : onClose())}>
              {A.cancel}
            </Button>
            {blocked ? (
              <Button type="button" variant="outline" className={TOUCH} onClick={(event) => (event.detail > 1 ? undefined : onClose())}>
                {A.close}
              </Button>
            ) : (
              <Button
                type="submit"
                form={ids.form}
                className={TOUCH}
                data-action="assign-send"
                aria-busy={sending || undefined}
                onClick={(event) => {
                  const since = openedAt.current === null ? Number.POSITIVE_INFINITY : event.timeStamp - openedAt.current;
                  if (sending || isRepeatActivation({ clickCount: event.detail, msSinceStep: since })) event.preventDefault();
                }}
              >
                {sendLabel}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

