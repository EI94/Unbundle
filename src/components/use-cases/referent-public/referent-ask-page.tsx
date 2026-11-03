"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SECONDARY_CLASS } from "@/components/uc/referente/screen";
import type { CheckBody, ReferentAskView, ReferentCheckView, SubmitResult } from "@/lib/use-cases/referent/contract";
import { REFERENT_ERROR_MESSAGES, REFERENT_PRIVACY_NOTICE, REFERENT_PUBLIC_TEXT } from "@/lib/use-cases/referent/labels";
import { acceptPrivacy, fetchAskView, saveCheck, submitAnswers } from "./api";
import { PrivacyCard, PrivacyFooter } from "./privacy-card";
import { QuestionCard, questionTitleId, type FlushDraft } from "./question-card";
import { finalCardText, headerTexts, issuesByQuestion, privacyTexts, questionSections, screenOf, submitHint, thanksTexts } from "./public-view-render";
import { ConfirmStep, EstimateStep, ReferentStepBar, stepTitleId, type StepActions } from "./referent-steps";
import { MessageCard, PublicShell } from "./state-card";
import { hasSteps, isRepeatActivation, parseStep, resolveStep, stepSearch, stepStates, stepsOf, type CheckStep } from "./steps-state";
import { SUBMIT_ERROR_ID, SubmitBar } from "./submit-bar";

/**
 * La pagina del referente `/rispondi/<token>` (SPEC §4.4): pubblica, senza account, pensata per il
 * telefono. In ordine: l'intestazione (azienda, use case, chi chiede e il suo messaggio), l'informativa
 * («Prima di iniziare») finché non è letta, poi le domande con salvataggio automatico e file, e «Invia
 * le risposte». Dopo l'invio il ringraziamento; quando non resta niente, la scheda finale e le domande in
 * sola lettura.
 *
 * Non legge mai la sessione e non porta mai alla dashboard: vale uguale per chiunque abbia il link. Il
 * token serve solo per l'indirizzo delle chiamate: mai salvato sul dispositivo.
 */

const THANKS_TITLE_ID = "ucq-grazie";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
const FINAL_TITLE_ID = "ucq-fine";

function focusById(id: string, scroll = true) {
  const el = document.getElementById(id);
  if (!el) return;
  // Niente scorrimento animato con «riduci il movimento».
  if (scroll) el.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  el.focus({ preventScroll: true });
}

export function ReferentAskPage({ token, initialView, today, initialStep = null }: { token: string; initialView: ReferentAskView; today: string; initialStep?: string | null }) {
  const [view, setView] = useState(initialView);
  // (Rilascio 5) I passi di una richiesta al referente: il passo di adesso, nell'indirizzo come `?passo=`.
  const [step, setStep] = useState<CheckStep>(() => resolveStep(initialView, parseStep(initialStep)));
  const stepChangedAt = useRef(0);
  const [checkSave, setCheckSave] = useState<"saving" | "saved" | "error" | null>(null);
  const [stepError, setStepError] = useState<{ step: CheckStep; message: string } | null>(null);
  const [staleNotice, setStaleNotice] = useState(false);
  const checkInFlight = useRef<Promise<boolean> | null>(null);
  const [declared, setDeclared] = useState(false);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Map<string, string[]>>(() => new Map());
  const [thanks, setThanks] = useState<SubmitResult | null>(null);
  /** Cambia a ogni vista nuova del server: le domande ripartono dal loro stato salvato. */
  const [generation, setGeneration] = useState(0);
  /** Dove va il focus dopo il prossimo render (titolo della domanda, ringraziamento…). */
  const pendingFocus = useRef<string | null>(null);
  const flushers = useRef(new Map<string, FlushDraft>());

  const header = headerTexts(view);
  const privacy = useMemo(() => privacyTexts(view), [view]);
  const screen = screenOf(view);
  const sections = useMemo(() => questionSections(view), [view]);
  const stepped = hasSteps(view);
  const steps = stepsOf(view);
  const lastStep = steps[steps.length - 1] ?? null;

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    focusById(target);
  });
  const setFocusTarget = (id: string) => {
    pendingFocus.current = id;
  };

  const registerFlush = useCallback((needId: string, flush: FlushDraft | null) => {
    if (flush) flushers.current.set(needId, flush);
    else flushers.current.delete(needId);
  }, []);

  /** Rilegge la vista dal server; un link che non vale più ricarica la pagina, che mostra la scheda giusta. */
  const reload = useCallback(async (): Promise<boolean> => {
    const r = await fetchAskView(token);
    if (!r.ok) {
      if (r.code === "link_non_valido") window.location.reload();
      return false;
    }
    setView(r.data);
    setGeneration((g) => g + 1);
    return true;
  }, [token]);

  const onStale = useCallback(
    (code: string) => {
      if (code === "link_non_valido") {
        window.location.reload();
        return;
      }
      void reload();
    },
    [reload],
  );

  const clearIssues = useCallback((needId: string) => {
    const key = needId.toLowerCase();
    setIssues((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }, []);

  // ── I passi (rilascio 5) ──
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  /** Va al passo `next`, con una voce nuova della cronologia: Indietro del browser torna al passo di prima. */
  const goTo = useCallback((next: CheckStep, mode: "push" | "replace" = "push") => {
    setStep(next);
    stepChangedAt.current = Date.now();
    const search = stepSearch(next);
    if (window.location.search !== search) {
      if (mode === "push") window.history.pushState(null, "", search);
      else window.history.replaceState(null, "", search);
    }
    if (next === 3) {
      const first = questionSections(viewRef.current).find((q) => q.kind === "aperta");
      pendingFocus.current = first ? questionTitleId(first.needId) : null;
    } else pendingFocus.current = stepTitleId(next);
  }, []);

  // L'indirizzo porta sempre il passo (anche al primo arrivo): Indietro e Avanti del browser lo ritrovano.
  useEffect(() => {
    if (!stepped) return;
    const search = stepSearch(step);
    if (window.location.search !== search) window.history.replaceState(null, "", search);
    // Solo all'arrivo: dopo, i passi cambiano con goTo e con la cronologia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Indietro e Avanti del browser: il passo dell'indirizzo, mai uno dopo il primo non fatto.
  useEffect(() => {
    const onPop = () => {
      const current = viewRef.current;
      if (!hasSteps(current)) return;
      const wanted = parseStep(new URLSearchParams(window.location.search).get("passo"));
      const resolved = resolveStep(current, wanted);
      setStep(resolved);
      stepChangedAt.current = Date.now();
      if (wanted !== resolved) window.history.replaceState(null, "", stepSearch(resolved));
      pendingFocus.current = resolved === 3 ? null : stepTitleId(resolved);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setDraft = useCallback((patch: Partial<ReferentCheckView["draft"]>) => {
    setView((v) => (v.check ? { ...v, check: { ...v.check, draft: { ...v.check.draft, ...patch } } } : v));
  }, []);

  /** Una bozza del passo 1 o 2; `stima_cambiata` rilegge la vista con la stima nuova. */
  const saveStep = useCallback(
    async (body: CheckBody): Promise<boolean> => {
      setCheckSave("saving");
      setStepError(null);
      const run = (async () => {
        const r = await saveCheck(token, body);
        if (r.ok) {
          setCheckSave("saved");
          return true;
        }
        setCheckSave("error");
        if (r.code === "link_non_valido") {
          window.location.reload();
          return false;
        }
        if (r.code === "stima_cambiata") {
          setStaleNotice(true);
          await reload();
          setStep(2);
          stepChangedAt.current = Date.now();
          if (window.location.search !== stepSearch(2)) window.history.replaceState(null, "", stepSearch(2));
          return false;
        }
        if (r.code === "gia_inviata" || r.code === "domanda_non_disponibile" || r.code === "informativa_da_leggere") void reload();
        setStepError({ step: body.step, message: r.message });
        return false;
      })();
      checkInFlight.current = run;
      void run.finally(() => {
        if (checkInFlight.current === run) checkInFlight.current = null;
      });
      return run;
    },
    [token, reload],
  );

  const tooSoon = useCallback((e: React.MouseEvent<HTMLButtonElement>) => isRepeatActivation({ clickCount: e.detail, msSinceStep: Date.now() - stepChangedAt.current }), []);

  // L'invio dall'ultimo passo: la funzione di adesso, letta solo dentro gli eventi.
  const submitRef = useRef<() => Promise<void>>(async () => {});
  const confirmActions = useMemo<StepActions>(() => ({ save: saveStep, setDraft, tooSoon, next: () => goTo(2) }), [saveStep, setDraft, tooSoon, goTo]);
  const estimateActions = useMemo<StepActions>(
    () => ({
      save: saveStep,
      setDraft,
      tooSoon,
      next: () => {
        if (lastStep === 2) void submitRef.current();
        else goTo(3);
      },
    }),
    [saveStep, setDraft, tooSoon, goTo, lastStep],
  );

  async function onAccept() {
    setPrivacyBusy(true);
    setPrivacyError(null);
    const r = await acceptPrivacy(token, view.privacy.version);
    setPrivacyBusy(false);
    if (r.ok) {
      setView((v) => ({ ...v, privacy: { ...v.privacy, accepted: true } }));
      if (stepped && step !== 3) {
        goTo(step, "replace");
        return;
      }
      const first = sections.find((s) => s.kind === "aperta") ?? sections[0];
      if (first) setFocusTarget(questionTitleId(first.needId));
      return;
    }
    if (r.code === "link_non_valido") {
      window.location.reload();
      return;
    }
    setPrivacyError(r.code === "informativa_cambiata" || r.code === "troppe_richieste" ? r.message : REFERENT_PRIVACY_NOTICE.error);
  }

  async function onSubmit() {
    if (submitBusy) return;
    setSubmitBusy(true);
    setSubmitError(null);
    setIssues(new Map());
    // (Rilascio 5) Prima finisce il salvataggio della conferma o della stima in corso.
    if (checkInFlight.current && !(await checkInFlight.current)) {
      setSubmitBusy(false);
      return;
    }
    // Prima ogni domanda salva quello che manca: si invia solo quello che il server ha.
    const order = sections.map((s) => s.needId);
    const flushed = await Promise.all(order.map(async (needId) => [needId, (await flushers.current.get(needId)?.()) ?? true] as const));
    const unsaved = flushed.filter(([, ok]) => !ok).map(([needId]) => needId);
    if (unsaved.length > 0) {
      setSubmitBusy(false);
      setSubmitError(REFERENT_ERROR_MESSAGES.risposte_da_correggere);
      setFocusTarget(questionTitleId(unsaved[0]));
      return;
    }
    const r = await submitAnswers(token);
    if (r.ok) {
      await reload();
      setSubmitBusy(false);
      setThanks(r.data);
      setFocusTarget(THANKS_TITLE_ID);
      return;
    }
    setSubmitBusy(false);
    if (r.code === "link_non_valido") {
      window.location.reload();
      return;
    }
    if (r.code === "domanda_non_disponibile" || r.code === "informativa_da_leggere") void reload();
    // (Rilascio 5) La conferma o la stima mancano: si torna al loro passo, con il messaggio lì.
    if (stepped && (r.code === "conferma_mancante" || r.code === "stima_mancante")) {
      const target: CheckStep = r.code === "conferma_mancante" ? 1 : 2;
      goTo(target);
      setStepError({ step: target, message: r.message });
      return;
    }
    const mapped = issuesByQuestion(r.issues, order);
    setIssues(mapped.byNeed);
    setSubmitError(r.message);
    if (mapped.first) setFocusTarget(questionTitleId(mapped.first));
    else setFocusTarget(SUBMIT_ERROR_ID);
  }

  useEffect(() => {
    submitRef.current = onSubmit;
  });

  const footer = <PrivacyFooter texts={privacy} />;
  const intro = (
    <header className="mt-4 space-y-2">
      <p className="text-sm break-words text-muted-foreground">{header.company}</p>
      <h1 className="text-2xl leading-[1.875rem] font-semibold tracking-tight break-words">{header.title}</h1>
      <p className="text-base break-words">{header.requestedBy}</p>
      {header.message ? (
        <figure className="mt-3 rounded-xl bg-muted/50 px-4 py-3">
          <figcaption className="text-sm font-medium break-words">{header.message.title}</figcaption>
          <blockquote className="mt-1 text-base leading-6 break-words whitespace-pre-line">{header.message.text}</blockquote>
        </figure>
      ) : null}
    </header>
  );

  if (thanks) {
    const t = thanksTexts(thanks, view);
    return (
      <PublicShell footer={footer}>
        {intro}
        <MessageCard
          as="h2"
          titleId={THANKS_TITLE_ID}
          title={t.title}
          text={
            <>
              <p>{t.seen}</p>
              {t.remaining ? <p>{t.remaining}</p> : null}
            </>
          }
        >
          {t.back ? (
            <div className="mt-5">
              <Button
                type="button"
                variant="outline"
                className={SECONDARY_CLASS}
                onClick={() => {
                  setThanks(null);
                  const first = questionSections(view).find((s) => s.kind === "aperta");
                  if (first) setFocusTarget(questionTitleId(first.needId));
                }}
              >
                {t.back}
              </Button>
            </div>
          ) : null}
        </MessageCard>
      </PublicShell>
    );
  }

  const readOnly = screen === "completed" || screen === "empty";

  if (stepped && screen === "questions" && step !== 3) {
    // (Rilascio 5) I passi «Lo use case» e «Il tempo».
    const check = view.check;
    return (
      <PublicShell footer={footer}>
        {intro}
        <ReferentStepBar items={stepStates(view, step)} />
        <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-muted-foreground">
          {checkSave ? REFERENT_PUBLIC_TEXT.autosave[checkSave] : ""}
        </p>
        {step === 1 ? (
          <ConfirmStep key={`1:${generation}`} check={check} title={view.useCase.title} actions={confirmActions} errorFromServer={stepError?.step === 1 ? stepError.message : null} />
        ) : (
          <EstimateStep
            key={`2:${generation}:${check.team?.key ?? "nessuna"}`}
            check={check}
            last={lastStep === 2}
            sending={submitBusy}
            staleNotice={staleNotice}
            actions={estimateActions}
            onBack={() => goTo(1)}
            errorFromServer={stepError?.step === 2 ? stepError.message : submitError}
          />
        )}
      </PublicShell>
    );
  }

  return (
    <PublicShell footer={footer}>
      {intro}
      {stepped && screen === "questions" ? (
        <>
          <ReferentStepBar items={stepStates(view, step)} />
        </>
      ) : null}
      {screen === "privacy" ? <PrivacyCard texts={privacy} busy={privacyBusy} error={privacyError} onAccept={() => void onAccept()} /> : null}
      {readOnly ? <MessageCard as="h2" titleId={FINAL_TITLE_ID} title={finalCardText(screen)} /> : null}
      {screen === "questions" || (readOnly && sections.length > 0) ? (
        <div className="mt-6 space-y-4" aria-labelledby={readOnly ? FINAL_TITLE_ID : undefined}>
          {sections.map((section) => (
            <QuestionCard
              key={`${section.needId}:${section.kind}:${generation}`}
              token={token}
              section={section}
              today={today}
              clientMode={view.upload.clientMode}
              declared={declared}
              onDeclared={setDeclared}
              issues={issues.get(section.needId.toLowerCase()) ?? []}
              disabled={submitBusy}
              registerFlush={registerFlush}
              onStale={onStale}
              onEdit={clearIssues}
            />
          ))}
        </div>
      ) : null}
      {screen === "questions" ? (
        <SubmitBar hint={submitHint(view)} error={submitError} busy={submitBusy} onSubmit={() => void onSubmit()} onBack={stepped ? () => goTo(2) : undefined} />
      ) : null}
    </PublicShell>
  );
}
