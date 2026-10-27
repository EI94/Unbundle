"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SECONDARY_CLASS } from "@/components/uc/referente/screen";
import type { ReferentAskView, SubmitResult } from "@/lib/use-cases/referent/contract";
import { REFERENT_ERROR_MESSAGES, REFERENT_PRIVACY_NOTICE } from "@/lib/use-cases/referent/labels";
import { acceptPrivacy, fetchAskView, submitAnswers } from "./api";
import { PrivacyCard, PrivacyFooter } from "./privacy-card";
import { QuestionCard, questionTitleId, type FlushDraft } from "./question-card";
import { finalCardText, headerTexts, issuesByQuestion, privacyTexts, questionSections, screenOf, submitHint, thanksTexts } from "./public-view-render";
import { MessageCard, PublicShell } from "./state-card";
import { SubmitBar } from "./submit-bar";

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
const FINAL_TITLE_ID = "ucq-fine";

function focusById(id: string, scroll = true) {
  const el = document.getElementById(id);
  if (!el) return;
  if (scroll) el.scrollIntoView({ block: "start", behavior: "smooth" });
  el.focus({ preventScroll: true });
}

export function ReferentAskPage({ token, initialView, today }: { token: string; initialView: ReferentAskView; today: string }) {
  const [view, setView] = useState(initialView);
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

  async function onAccept() {
    setPrivacyBusy(true);
    setPrivacyError(null);
    const r = await acceptPrivacy(token, view.privacy.version);
    setPrivacyBusy(false);
    if (r.ok) {
      setView((v) => ({ ...v, privacy: { ...v.privacy, accepted: true } }));
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
    setSubmitBusy(true);
    setSubmitError(null);
    setIssues(new Map());
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
    const mapped = issuesByQuestion(r.issues, order);
    setIssues(mapped.byNeed);
    setSubmitError(r.message);
    if (mapped.first) setFocusTarget(questionTitleId(mapped.first));
  }

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

  return (
    <PublicShell footer={footer}>
      {intro}
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
      {screen === "questions" ? <SubmitBar hint={submitHint(view)} error={submitError} busy={submitBusy} onSubmit={() => void onSubmit()} /> : null}
    </PublicShell>
  );
}
