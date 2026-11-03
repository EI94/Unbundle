"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition, type FormEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  listReferentPeopleAction,
  prepareReferentQuestionsAction,
  revealReferentContactEmailAction,
  revealReferentMemberEmailAction,
  sendReferentRequestAction,
} from "@/lib/actions/use-case-referents";
import type { ReferentActionResult, ReferentMemberOption, ReferentRequestView, UseCaseReferentPanel } from "@/lib/use-cases/referent/contract";
import { REFERENT_ASSIGN_TEXT, REFERENT_ERROR_MESSAGES, REFERENT_UI_TEXT, companyLabel, fillText } from "@/lib/use-cases/referent/labels";
import { orgWordsOf } from "@/lib/use-cases/referent/match";
import { referentRequestPreview, requesterNameOf } from "@/lib/use-cases/referent/preview";
import { cn } from "@/lib/utils";
import {
  ASK_MODE,
  NEW_CONTACT,
  askDialogEntry,
  askDraftErrors,
  askErrorView,
  askOtherRequestsHint,
  askPayload,
  askPrepareOffer,
  askSelfHint,
  chosenMember,
  initialAskDraft,
  memberIdOf,
  type AskDraft,
  type AskMode,
} from "./ask-dialog-state";
import { AskPeopleStep, type AskPeopleList } from "./ask-people";
import { AskPreviewStep } from "./ask-preview";
import { AskQuestionsStep, prepareIsNext } from "./ask-questions";
import {
  againLineOf,
  askErrorStep,
  enterQuestions,
  firstStep,
  initialSession,
  isRepeatActivation,
  mergeTicks,
  okNoticeOf,
  personOf,
  questionsNextLabel,
  questionsOf,
  resumeStep,
  sendLabel,
  stepErrors,
  stepItems,
  toLine,
  type AskNeedInfo,
  type AskSession,
  type AskStep,
} from "./ask-steps-state";
import { useReferentRunner } from "./referent-actions";

const T = REFERENT_UI_TEXT.askDialog;
const FAILED: ReferentActionResult<never> = { ok: false, code: "riprova", message: REFERENT_ERROR_MESSAGES.riprova };
const GATE_CODES = new Set(["sub_responsabili_mancanti", "email_non_configurata", "risposte_non_attive", "email_non_verificata"]);
const TOUCH = "min-h-11 sm:min-h-8";

export interface AskStepsContext {
  /** Di ogni esigenza della scheda (id in minuscolo): titolo, «Chi» come lo mostra la scheda, testo libero «Chi». */
  needInfo: Readonly<Record<string, AskNeedInfo>>;
  /** Lo use case della scheda, per l'oggetto dell'email. */
  card: { code: string | null; title: string };
  /** Il nome del workspace (`access.workspace.name`). */
  companyName: string | null;
  /** Il nome del cliente del connettore («TopJet e Aliserio»), per le parole dell'azienda; null senza. */
  companyDisplayName: string | null;
  /** «Chiedi al referente» chiuso senza inviare: la bozza, ripresa riaprendo (per la vita della pagina). */
  saved: AskSession | null;
  /** Le persone del workspace dell'ultima apertura, mentre arrivano di nuovo. */
  peopleCache: readonly ReferentMemberOption[] | null;
  onPeople: (members: readonly ReferentMemberOption[]) => void;
}

export interface AskStepsProps extends AskStepsContext {
  workspaceId: string;
  useCaseId: string;
  panel: UseCaseReferentPanel;
  /** «Chiedi al referente», oppure «Chiedi di nuovo» su `previous`. */
  mode?: AskMode;
  previous?: ReferentRequestView | null;
  /** Chiusa senza inviare (Annulla, Chiudi, Esc): la bozza da tenere, o null. */
  onDismiss: (keep: AskSession | null) => void;
  /** Inviata: la bozza si cancella. */
  onSent: () => void;
  /**
   * (Rilascio 5, §8.4) «Chiedi a un'altra persona»: la stessa finestra per chi non è il referente; la
   * riga del referente non si sceglie («(è il referente)») e in cima i suoi «Chi potrebbe saperlo?».
   */
  other?: boolean;
}

/**
 * «Chiedi al referente» e «Chiedi di nuovo» in tre passi (rilascio 4, §4): «A chi», «Cosa chiedi»,
 * «Controlla e invia». Un solo pulsante pieno per passo, il passo dopo; mai spento: premuto con
 * qualcosa che manca, dice cosa. Esc chiude da ogni passo. Ogni passo comincia con il suo titolo, che
 * prende il fuoco. Niente parte senza l'ok sui fornitori: con un motivo che blocca, «Invia a …» non c'è.
 */
export function AskSteps({
  workspaceId,
  useCaseId,
  panel: panelIn,
  other = false,
  mode = ASK_MODE,
  previous = null,
  needInfo,
  card,
  companyName,
  companyDisplayName,
  saved,
  peopleCache,
  onPeople,
  onDismiss,
  onSent,
}: AskStepsProps) {
  const panel = useMemo(() => (other ? otherPanelOf(panelIn) : panelIn), [other, panelIn]);
  const otherHints = other && panelIn.referent?.hints.length ? { lead: fillText(REFERENT_ASSIGN_TEXT.hintsLead, { Nome: panelIn.referent.contact.name }), items: panelIn.referent.hints } : null;
  const baseId = useId();
  const formId = `${baseId}-passo`;
  const ids = {
    who: `${baseId}-chi`,
    whoError: `${baseId}-chi-errore`,
    name: `${baseId}-nome`,
    email: `${baseId}-email`,
    role: `${baseId}-ruolo`,
    what: `${baseId}-cosa`,
    whatList: `${baseId}-cosa-elenco`,
    whatError: `${baseId}-cosa-errore`,
    prepare: `${baseId}-prepara`,
    message: `${baseId}-messaggio`,
    check: `${baseId}-controlla`,
  };
  const router = useRouter();
  const prep = useReferentRunner();
  const [sending, startSend] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const ask = mode.kind === "ask";
  const limit = panel.limits.questionsPerRequest;

  const [people, setPeople] = useState<AskPeopleList>(() =>
    !ask ? { state: "ready", members: [] } : peopleCache ? { state: "ready", members: peopleCache } : { state: "loading", members: [] },
  );
  const lookup = useMemo(() => ({ contacts: panel.contacts, members: people.members, limits: panel.limits }), [panel.contacts, people.members, panel.limits]);

  const [session, setSession] = useState<AskSession>(() => {
    if (ask && saved) return { ...saved, step: resumeStep(saved, { ...lookup, askableNeedIds: panel.askableNeedIds }, mode) };
    const draft = initialAskDraft(panel, mode, previous);
    // Senza referenti né persone da scegliere (pronte, nessuna): «Una persona nuova» già scelta.
    if (ask && panel.contacts.length === 0 && people.state === "ready" && people.members.length === 0) draft.choice = NEW_CONTACT;
    return initialSession(draft, panel, mode);
  });
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const draft = session.draft;
  const step = session.step;

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string | null>>({});
  const [prepared, setPrepared] = useState<string | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [sawSubGate, setSawSubGate] = useState(false);

  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const bodyRef = useRef<HTMLFormElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);

  const entry = askDialogEntry(panel);
  const orgWords = useMemo(() => orgWordsOf([companyName, companyDisplayName]), [companyName, companyDisplayName]);
  const person = personOf(draft, lookup, mode, previous);
  const asked = person
    ? questionsOf({ askableNeedIds: panel.askableNeedIds, needInfo, person, orgWords, previous: ask ? null : (previous?.needIds ?? []) })
    : null;
  const company = companyLabel(companyName);

  // Le persone del workspace, lette quando la finestra si apre (mai nel pannello della scheda), e di
  // nuovo quando il server dice che la persona scelta non si può più scegliere.
  const [peopleRound, setPeopleRound] = useState(0);
  useEffect(() => {
    if (!ask) return;
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
  }, [ask, workspaceId, useCaseId, onPeople, peopleRound]);

  // Le persone sono arrivate: senza referenti e senza persone, «Una persona nuova» già scelta; una
  // persona scelta prima e non più nell'elenco riporta ad «A chi». Si allinea durante il disegno.
  const [peopleSeen, setPeopleSeen] = useState(people);
  if (peopleSeen !== people) {
    setPeopleSeen(people);
    if (ask && people.state !== "loading") {
      if (draft.choice === null && panel.contacts.length === 0 && people.members.length === 0) setSession((s) => ({ ...s, draft: { ...s.draft, choice: NEW_CONTACT } }));
      else if (memberIdOf(draft.choice) && people.state === "ready" && !chosenMember(people, draft) && step > 1) setSession((s) => ({ ...s, step: 1 }));
    }
  }

  // Le domande che si possono chiedere sono cambiate a finestra aperta (dopo «Prepara le domande», o una
  // risposta dalla scheda): le spunte si allineano, le nuove proposte arrivano spuntate.
  const askableKey = panel.askableNeedIds.map((id) => id.toLowerCase()).join(" ");
  if (session.seen.join(" ") !== askableKey) {
    const now = panel.askableNeedIds.map((id) => id.toLowerCase());
    setSession((s) => ({ ...s, seen: now, draft: { ...s.draft, needIds: mergeTicks(s.draft.needIds, s.seen, now, asked?.fresh ?? [], mode) } }));
    setErrors((current) => (current.needIds ? { ...current, needIds: "" } : current));
  }

  // L'indirizzo intero della persona scelta, solo per «A» di «Controlla e invia»; fino ad allora quello
  // coperto. Una persona alla volta, una volta sola: non blocca niente.
  const asking = useRef(new Set<string>());
  const reveal = useCallback(
    (target: { kind: "referente" | "persona"; id: string }) => {
      const key = `${target.kind}:${target.id}`;
      if (asking.current.has(key)) return;
      asking.current.add(key);
      const call = target.kind === "referente" ? revealReferentContactEmailAction(workspaceId, useCaseId, target.id) : revealReferentMemberEmailAction(workspaceId, useCaseId, target.id);
      call
        .then((result) => setRevealed((now) => ({ ...now, [key]: result.ok ? result.data.email : null })))
        .catch(() => setRevealed((now) => ({ ...now, [key]: null })));
    },
    [workspaceId, useCaseId],
  );
  // Dopo «A chi» (anche riaprendo la finestra su «Cosa chiedi» o «Controlla e invia», e in «Chiedi di
  // nuovo» da subito) si chiede l'indirizzo intero della persona scelta, una volta.
  const revealTarget = session.step > 1 && person?.revealId ? { kind: person.kind === "persona" ? ("persona" as const) : ("referente" as const), id: person.revealId } : null;
  const revealKind = revealTarget?.kind ?? null;
  const revealId = revealTarget?.id ?? null;
  useEffect(() => {
    if (revealKind && revealId) reveal({ kind: revealKind, id: revealId });
  }, [revealKind, revealId, reveal]);

  // Quando è cambiato il passo (lo segna l'effetto qui sotto): il piede non conta un clic che arriva subito
  // dopo, né il secondo di un doppio clic (`isRepeatActivation`). `at` è il `timeStamp` dell'evento.
  const stepAt = useRef<number | null>(null);
  const tooSoon = (clickCount: number, at: number) =>
    isRepeatActivation({ clickCount, msSinceStep: stepAt.current === null ? Number.POSITIVE_INFINITY : at - stepAt.current });

  // Un passo nuovo: il corpo torna in cima e il titolo del passo prende il fuoco (niente tastiera sul telefono).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    stepAt.current = performance.now();
    bodyRef.current?.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  // «Prepara le domande»: l'esito prende il fuoco al posto del pulsante.
  useEffect(() => {
    if (prepared !== null) statusRef.current?.focus();
  }, [prepared]);

  // In «Controlla e invia» con l'ok sui fornitori da dare (in un'altra scheda): tornando qui si rilegge
  // la pagina, una volta alla volta; quando l'ok c'è la riga «Ok di … dato.» e, senza altri motivi, «Invia».
  const subGate = step === 3 && entry.sendGates.some((gate) => gate.code === "sub_responsabili_mancanti");
  if (subGate && !sawSubGate) setSawSubGate(true);
  const refreshingRef = useRef(false);
  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);
  useEffect(() => {
    if (!subGate) return;
    const again = () => {
      if (refreshingRef.current) return;
      if (document.visibilityState === "hidden") return;
      startRefresh(() => router.refresh());
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [subGate, router]);

  const update = (next: Partial<AskDraft>, errorKeys: string[] = []) => {
    setSession((s) => ({ ...s, draft: { ...s.draft, ...next } }));
    if (errorKeys.length) setErrors((current) => (errorKeys.some((key) => current[key]) ? Object.fromEntries(Object.entries(current).filter(([key]) => !errorKeys.includes(key))) : current));
    setFormError(null);
  };

  const focusFirstError = (found: Record<string, string>) => {
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
                ? form.querySelector<HTMLElement>('[data-slot="checkbox"]')
                : found.message !== undefined
                  ? document.getElementById(ids.message)
                  : null;
      target?.focus();
    });
  };

  const goTo = (target: AskStep) => {
    setErrors({});
    setFormError(null);
    setSession((s) => ({ ...s, step: target }));
  };

  function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || prep.pending || tooSoon(0, event.timeStamp)) return;
    if (step === 1) {
      const found = stepErrors(1, draft, lookup, mode);
      if (Object.keys(found).length) {
        setErrors(found);
        focusFirstError(found);
        return;
      }
      if (!person || !asked) return;
      setErrors({});
      setFormError(null);
      setSession((s) => enterQuestions(s, person, asked.proposed, limit));
      return;
    }
    if (step === 2) {
      const found = stepErrors(2, draft, lookup, mode);
      if (Object.keys(found).length) {
        setErrors(found);
        focusFirstError(found);
        return;
      }
      goTo(3);
      return;
    }
    if (entry.sendGates.length === 0) send();
  }

  function send() {
    const all = askDraftErrors(draft, lookup, mode);
    if (Object.keys(all).length) {
      const target: AskStep = all.contact || all.displayName || all.email ? (ask ? 1 : 3) : 2;
      setErrors(all);
      if (target === 3) setFormError(Object.values(all)[0] ?? null);
      setSession((s) => ({ ...s, step: target }));
      return;
    }
    startSend(async () => {
      let result: ReferentActionResult<{ requestId: string }>;
      try {
        result = await sendReferentRequestAction(workspaceId, useCaseId, askPayload(draft, panel, mode));
      } catch {
        result = FAILED;
      }
      if (result.ok) {
        if (result.message) toast.success(result.message);
        onSent();
        return;
      }
      const target = askErrorStep(result, mode);
      if (target.refresh) router.refresh();
      if (result.code === "persona_non_disponibile" && ask) setPeopleRound((n) => n + 1);
      if (target.close) {
        toast.error(result.message || REFERENT_ERROR_MESSAGES.riprova);
        onDismiss(ask ? sessionRef.current : null);
        return;
      }
      const view = askErrorView(result, draft);
      const fields = { ...view.fieldErrors };
      let lineError: string | null = null;
      if (target.step === 1 && view.formError) fields.contact = view.formError;
      else if (target.step === 2 && view.formError && !fields.needIds && !fields.message) fields.needIds = view.formError;
      else if (target.step === 3 && !GATE_CODES.has(result.code)) lineError = view.formError ?? result.message;
      setErrors(fields);
      setFormError(lineError);
      setSession((s) => ({ ...s, step: target.step }));
      if (target.step !== 3) focusFirstError(fields);
    });
  }

  async function prepareQuestions() {
    if (prep.pending || sending) return;
    setPrepareError(null);
    const { result, outcome } = await prep.run(() => prepareReferentQuestionsAction(workspaceId, useCaseId), { inDialog: true, successToast: false });
    if (result.ok) {
      setPrepared(result.message ?? REFERENT_UI_TEXT.toasts.prepareAlready);
      return;
    }
    if (outcome.close) {
      dismiss();
      return;
    }
    setPrepareError(outcome.error);
  }

  const busy = sending || prep.pending;
  const prepareOffer = askPrepareOffer(panel, mode);
  const name = person?.displayName ?? "";
  const tickedIds = (() => {
    const chosen = new Set(draft.needIds.map((id) => id.toLowerCase()));
    return panel.askableNeedIds.map((id) => id.toLowerCase()).filter((id) => chosen.has(id));
  })();
  const revealKey = person?.revealId ? `${person.kind === "persona" ? "persona" : "referente"}:${person.revealId}` : null;
  const revealedEmail = revealKey ? (revealed[revealKey] ?? null) : null;
  const blocked = entry.sendGates.length > 0;
  const okNotice = okNoticeOf({ sawSubGate, gatesNow: entry.sendGates, company });
  const back = step > firstStep(mode);

  const primary: AskPrimary =
    step === 1
      ? { kind: "submit", label: T.next }
      : step === 2
        ? { kind: "submit", label: questionsNextLabel(tickedIds.length), quiet: Boolean(asked && prepareIsNext(asked.questions, { offer: prepareOffer, done: prepared })) }
        : blocked || !person
          ? { kind: "close", label: T.close }
          : { kind: "submit", label: sendLabel(person) };
  const dismiss = () => onDismiss(ask ? sessionRef.current : null);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : dismiss())}>
      {/*
        Il portale porta lo slot delle finestre delle decisioni: i token dell'area «Use case» (il grigio
        dei testi secondari, i bordi dei campi, il fuoco) valgono anche qui, nei due temi, senza toccare
        globals.css. La finestra si riconosce da `referent-ask`, sul contenuto.
      */}
      <DialogContent
        showCloseButton={false}
        data-slot="decision-dialog"
        initialFocus={headingRef}
        className={ASK_DIALOG_CLASS}
      >
        <div data-slot="referent-ask" data-step={step} className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-3 px-4 pt-4 sm:px-6 sm:pt-5">
            <DialogTitle>{other ? REFERENT_ASSIGN_TEXT.other : ask ? T.title : T.titleAgain}</DialogTitle>
            {!ask && mode.liveHint ? <DialogDescription>{REFERENT_UI_TEXT.askAgainLiveHint}</DialogDescription> : null}
            <AskStepBar step={step} />
          </div>
          <form id={formId} ref={bodyRef} noValidate onSubmit={next} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
            {step === 1 ? (
              <AskPeopleStep
                ids={{ heading: ids.who, error: ids.whoError, name: ids.name, email: ids.email, role: ids.role }}
                headingRef={headingRef}
                notice={entry.notice}
                contacts={panel.contacts}
                people={people}
                draft={draft}
                errors={errors}
                limits={panel.limits}
                selfHint={askSelfHint(panel)}
                otherHint={askOtherRequestsHint(panel, draft)}
                hints={otherHints}
                onChoice={(value) => update({ choice: value }, ["contact"])}
                onField={(key, value) => update({ [key]: value } as Partial<AskDraft>, [key === "name" ? "displayName" : key === "role" ? "roleLabel" : "email"])}
              />
            ) : step === 2 && asked ? (
              <AskQuestionsStep
                ids={{ heading: ids.what, list: ids.whatList, error: ids.whatError, prepare: ids.prepare, message: ids.message }}
                headingRef={headingRef}
                name={name}
                againLine={!ask && person ? againLineOf(person.displayName, revealedEmail ?? person.email) : null}
                questions={asked.questions}
                selected={draft.needIds}
                errors={errors}
                prepare={{ offer: prepareOffer, pending: prep.pending, done: prepared, error: prepareError, onPrepare: () => void prepareQuestions() }}
                prepareStatusRef={statusRef}
                message={draft.message}
                limits={panel.limits}
                onChange={(nextIds) => update({ needIds: nextIds }, ["needIds"])}
                onMessage={(value) => update({ message: value }, ["message"])}
              />
            ) : step === 3 && person ? (
              <AskPreviewStep
                headingId={ids.check}
                headingRef={headingRef}
                name={name}
                to={toLine(person, revealedEmail)}
                parts={referentRequestPreview({
                  company: companyName,
                  useCase: card,
                  requesterName: requesterNameOf(panel.requester.name, companyName),
                  questions: tickedIds.length,
                  message: draft.message.trim() || null,
                  today: new Date(),
                })}
                questions={tickedIds.map((id) => needInfo[id]?.title ?? id)}
                replyTo={panel.requester.email}
                gates={entry.sendGates}
                okNotice={okNotice}
                error={formError}
              />
            ) : null}
          </form>
          <AskFooter formId={formId} back={back} busy={busy} primary={primary} tooSoon={tooSoon} onBack={() => goTo((step - 1) as AskStep)} onCancel={dismiss} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** (Rilascio 5) «Chiedi a un'altra persona»: il referente resta nell'elenco ma non si sceglie. */
export function otherPanelOf(panel: UseCaseReferentPanel): UseCaseReferentPanel {
  const referentId = panel.referent?.contact.id.toLowerCase() ?? null;
  if (!referentId) return panel;
  return { ...panel, contacts: panel.contacts.map((c) => (c.id.toLowerCase() === referentId ? { ...c, selectable: false, reason: "referente" as const } : c)) };
}

/**
 * La finestra ha la stessa altezza nei tre passi (lo schermo meno 2rem, al massimo 52rem) e scorre
 * dentro il corpo: centrata e alta quanto il passo, saltava a ogni passo, e il secondo clic dove era
 * «Avanti» cadeva fuori e la chiudeva. Piede e intestazione restano fermi.
 */
export const ASK_DIALOG_CLASS = "flex h-[min(calc(100dvh-2rem),52rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg";

/**
 * Il pulsante pieno del piede: il passo dopo (un `submit` del modulo del passo), oppure «Chiudi» quando
 * un motivo blocca l'invio. `quiet`: il passo dopo è un altro pulsante del corpo («Prepara le domande»
 * senza domande da fare), e questo resta non pieno.
 */
export type AskPrimary = { kind: "submit"; label: string; quiet?: boolean } | { kind: "close"; label: string };

/**
 * La barra dei passi: tre voci con il loro cerchio (fatto: la spunta; adesso: il bordo pieno; dopo:
 * il bordo sottile) e il nome, che va a capo; lo stato si legge anche senza colore. Non si clicca:
 * si torna indietro con «Indietro».
 */
export function AskStepBar({ step }: { step: AskStep }) {
  return (
    <ol aria-label={T.steps.label} data-slot="ask-steps" className="grid grid-cols-3 gap-2">
      {stepItems(step).map((item) => (
        <li key={item.step} data-state={item.state} aria-current={item.state === "adesso" ? "step" : undefined} className="flex min-w-0 items-start gap-2">
          <span
            aria-hidden
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums",
              item.state === "fatto" && "bg-foreground text-background",
              item.state === "adesso" && "border-2 border-foreground font-medium",
              item.state === "dopo" && "border border-input text-muted-foreground",
            )}
          >
            {item.state === "fatto" ? <Check className="size-3.5" /> : item.step}
          </span>
          <span className={cn("min-w-0 pt-1 text-xs break-words", item.state === "adesso" ? "font-medium" : "text-muted-foreground")}>
            {item.label}
            <span className="sr-only">{item.state === "fatto" ? T.steps.done : item.state === "adesso" ? T.steps.now : ""}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Il piede della finestra, fuori dalla parte che scorre: «Annulla» o «Indietro», poi il passo dopo,
 * pieno; con un motivo che blocca l'invio, «Chiudi» non pieno. Sul telefono il pulsante del passo sta
 * sopra. Mai spento: mentre qualcosa parte, un secondo tocco non fa niente (`aria-busy`).
 */
export function AskFooter({
  formId,
  back,
  busy,
  primary,
  tooSoon,
  onBack,
  onCancel,
}: {
  formId: string;
  back: boolean;
  busy: boolean;
  primary: AskPrimary;
  /** Per il pulsante del passo: il secondo clic di un doppio clic, o un clic subito dopo il cambio di passo, non conta. */
  tooSoon: (clickCount: number, at: number) => boolean;
  onBack: () => void;
  onCancel: () => void;
}) {
  // «Indietro», «Annulla» e «Chiudi» non contano solo il secondo clic di un doppio clic (che sul passo
  // dopo cadrebbe su di loro): un clic deciso subito dopo il cambio di passo resta valido.
  const guarded = (run: () => void) => (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail > 1) return;
    run();
  };
  return (
    <div data-slot="ask-footer" className="flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
      {back ? (
        <Button type="button" variant="outline" className={TOUCH} onClick={guarded(onBack)}>
          {T.back}
        </Button>
      ) : (
        <Button type="button" variant="outline" className={TOUCH} onClick={guarded(onCancel)}>
          {T.cancel}
        </Button>
      )}
      {primary.kind === "submit" ? (
        <Button
          type="submit"
          form={formId}
          variant={primary.quiet ? "outline" : "default"}
          className={TOUCH}
          aria-busy={busy || undefined}
          onClick={(event) => {
            if (tooSoon(event.detail, event.timeStamp)) event.preventDefault();
          }}
        >
          {primary.label}
        </Button>
      ) : (
        <Button type="button" variant="outline" className={TOUCH} onClick={guarded(onCancel)}>
          {primary.label}
        </Button>
      )}
    </div>
  );
}
