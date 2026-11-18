"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice, SECONDARY_CLASS } from "@/components/uc/referente/screen";
import type { CheckBody, ReferentAskView, ReferentBenefitView, ReferentCheckView, SubmitResult } from "@/lib/use-cases/referent/contract";
import { REFERENT_ERROR_MESSAGES, REFERENT_PRIVACY_NOTICE, REFERENT_PUBLIC_TEXT, fillText } from "@/lib/use-cases/referent/labels";
import { waitsForPrivacy } from "@/lib/use-cases/referent/state";
import { acceptPrivacy, fetchAskView, markSeen, postReply, saveCheck, submitAnswers } from "./api";
import { PRIVACY_TITLE_ID, PrivacyCard, PrivacyFooter } from "./privacy-card";
import { QuestionCard, questionTitleId, type FlushDraft } from "./question-card";
import {
  doneCountText,
  doubtOf,
  editableText,
  finalCardText,
  freshReplyIds,
  headerTexts,
  issuesByQuestion,
  messagesOf,
  missingText,
  newsEntries,
  newsLead,
  newsMissingText,
  noticeOf,
  privacyTexts,
  questionSections,
  questionsHeading,
  savesItselfText,
  screenOf,
  screenUnderNotice,
  sentCheckLines,
  thanksTexts,
  threadActionsOf,
  threadKeyOf,
  type QuestionSection,
  type ThreadAction,
} from "./public-view-render";
import { ConfirmStep, EstimateStep, ImpactStep, ReferentStepBar, benefitCommentId, benefitTitleId, stepTitleId, type StepActions } from "./referent-steps";
import { MessageCard, PublicShell } from "./state-card";
import { hasSteps, isRepeatActivation, parseStep, resolveStep, stepOfSubmitRefusal, stepOneWarning, stepSearch, stepStates, stepTwoWarning, stepsOf, type CheckStep, type StepRefusal } from "./steps-state";
import { SUBMIT_ERROR_ID, SubmitBar } from "./submit-bar";
import { ClarificationCard, SentDisclosure, TeamReplyCard, ThreadItem, newsTitleId } from "./thread";

/**
 * La pagina del referente `/rispondi/<token>` (SPEC §4.4): pubblica, senza account, pensata per il
 * telefono. In ordine: l'intestazione (azienda, use case, chi chiede e il suo messaggio), l'informativa
 * («Prima di iniziare») finché non è letta, poi le domande con salvataggio automatico e file, e «Invia
 * le risposte». Dopo l'invio il ringraziamento; quando non resta niente, la scheda finale e le domande in
 * sola lettura.
 *
 * Non legge mai la sessione e non porta mai alla dashboard: vale uguale per chiunque abbia il link. Il
 * token serve solo per l'indirizzo delle chiamate: mai salvato sul dispositivo.
 *
 * (Rilascio 9b) L'informativa mostrata è quella della vista (`noticeOf`), e «Iniziamo» manda la sua versione come prova
 * (`shown`). Se una scrittura aspetta l'informativa (cambiata con un rilascio mentre la pagina è aperta, o non letta),
 * niente di scritto si perde: le domande, i passi e i campi restano montati e nascosti sotto l'informativa, che torna con
 * il testo del server (senza quel testo, «Ricarica la pagina»); dopo «Iniziamo» le bozze in attesa partono da sole e si
 * riprende da dove si era.
 */

const THANKS_TITLE_ID = "ucq-grazie";
/** (Rilascio 9b) Il fuoco va al campo aperto sotto una risposta (un solo campo alla volta). */
const COMPOSER_FOCUS = "ucq-campo-aperto";
const QUESTIONS_TITLE_ID = "ucq-domande";
/** (Rilascio 6) «Da completare» e «Già inviato». */
const NEWS_TITLE_ID = "ucq-novita";
const TT = REFERENT_PUBLIC_TEXT.thread;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
const FINAL_TITLE_ID = "ucq-fine";

function focusById(id: string, scroll = true) {
  if (id === COMPOSER_FOCUS) {
    document.querySelector<HTMLTextAreaElement>('[data-slot="referent-thread-composer"] textarea')?.focus();
    return;
  }
  const el = document.getElementById(id);
  if (!el) return;
  // Niente scorrimento animato con «riduci il movimento».
  if (scroll) el.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  el.focus({ preventScroll: true });
}

/** (Rilascio 9b) La chiave di una bozza dei passi: il passo 1, la stima del tempo, oppure una riga dell'impatto. */
function checkKeyOf(body: CheckBody): string {
  if (body.step === 1) return "1";
  return "benefit" in body ? `2:${body.benefit.key}` : "2";
}

export function ReferentAskPage({ token, initialView, today, initialStep = null }: { token: string; initialView: ReferentAskView; today: string; initialStep?: string | null }) {
  const [view, setView] = useState(initialView);
  // (Rilascio 5) I passi di una richiesta al referente: il passo di adesso, nell'indirizzo come `?passo=`.
  const [step, setStep] = useState<CheckStep>(() => resolveStep(initialView, parseStep(initialStep)));
  /**
   * (Rilascio 5) Le domande, una volta aperto il passo 3, restano montate (nascoste) sui passi 1 e 2:
   * chi torna indietro e poi avanti, con «Indietro» o con il browser, ritrova ogni scelta, il testo
   * scritto (anche quello non ancora salvato) e i file, mai «0 di n fatte» con le bozze sul server.
   */
  const [questionsOpened, setQuestionsOpened] = useState(() => step === 3);
  const stepChangedAt = useRef(0);
  const [checkSave, setCheckSave] = useState<"saving" | "saved" | "error" | null>(null);
  const [stepError, setStepError] = useState<StepRefusal | null>(null);
  /** (Rilascio 5) L'avviso dell'ultima bozza della nota di «Correggi» (rilascio 5.1: un codice fiscale o una data di nascita). */
  const [noteWarning, setNoteWarning] = useState<string | null>(null);
  /** (Rilascio 5.1) L'avviso dell'ultima bozza di ogni riga dell'impatto (un codice fiscale nel commento), per chiave. */
  const [benefitWarnings, setBenefitWarnings] = useState<Readonly<Record<string, string>>>({});
  const [staleNotice, setStaleNotice] = useState(false);
  const checkInFlight = useRef<Promise<boolean> | null>(null);
  // (Rilascio 5) Le domande chiuse (per «{k} di {n} fatte») e quelle che «Invia» ha trovato aperte.
  const [closedMap, setClosedMap] = useState<Map<string, boolean>>(() => new Map());
  const [missing, setMissing] = useState<string[]>([]);
  const [newQuestions, setNewQuestions] = useState(false);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  /**
   * (Rilascio 9b) Il testo dell'informativa sulla pagina non è più quello da accettare («Iniziamo» rifiutato con
   * `informativa_cambiata`, o una vista che la dice letta mentre le scritture l'aspettano): il riquadro chiede di
   * ricaricare la pagina.
   */
  const [noticeStale, setNoticeStale] = useState(false);
  /** (Rilascio 9b) L'informativa è tornata perché una scrittura l'aspettava: il riquadro dice che quello che è scritto resta. */
  const [noticeAgain, setNoticeAgain] = useState(false);
  /** (Rilascio 9b) Una scrittura aspetta l'informativa: da qui a «Iniziamo» niente parte da solo. */
  const waiting = useRef(false);
  const waitRun = useRef<Promise<void> | null>(null);
  /** (Rilascio 9b) Dove torna il fuoco dopo «Iniziamo», quando l'informativa è tornata a metà visita. */
  const resumeFocus = useRef<string | null>(null);
  /** (Rilascio 9b) Le bozze dei passi 1 e 2 che aspettano l'informativa, per chiave: partono dopo «Iniziamo». */
  const heldChecks = useRef(new Map<string, CheckBody>());
  /** (Rilascio 9b) Riprese da sole senza «Iniziamo» (la vista diceva «letta»): alla seconda si chiede di ricaricare. */
  const autoResumes = useRef(0);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Map<string, string[]>>(() => new Map());
  const [thanks, setThanks] = useState<SubmitResult | null>(null);
  /** Cambia a ogni vista nuova del server: le domande ripartono dal loro stato salvato. */
  const [generation, setGeneration] = useState(0);
  /** Dove va il focus dopo il prossimo render (titolo della domanda, ringraziamento…). */
  const pendingFocus = useRef<string | null>(null);
  const flushers = useRef(new Map<string, FlushDraft>());
  // (Rilascio 6) Il filo: il campo aperto (uno alla volta), l'ultimo invio riuscito, le risposte ai chiarimenti
  // di «Da completare» (restano anche se la vista si rilegge), quello che manca, le risposte del team già segnate viste.
  const [composer, setComposer] = useState<{ key: string; mode: ThreadAction } | null>(null);
  // Il campo aperto sotto una risposta ha un testo non ancora inviato al team.
  const composerDirty = useRef(false);
  const onComposerDirty = useCallback((dirty: boolean) => {
    composerDirty.current = dirty;
  }, []);
  /** «Invia» non perde mai quello che il referente ha scritto per il team: si ferma e porta al campo. */
  const composerBlocks = () => {
    if (!composer || !composerDirty.current) return false;
    setSubmitError(TT.composerOpen);
    document.querySelector<HTMLTextAreaElement>('[data-slot="referent-thread-composer"] textarea')?.focus();
    return true;
  };
  const [sentKey, setSentKey] = useState<string | null>(null);
  const [replyTexts, setReplyTexts] = useState<Readonly<Record<string, string>>>({});
  const [replyErrors, setReplyErrors] = useState<Readonly<Record<string, string>>>({});
  const [newsMissing, setNewsMissing] = useState<string[]>([]);
  const seenSent = useRef(new Set<string>());

  const header = headerTexts(view);
  // (Rilascio 9b) Il testo da accettare è quello della vista; nel piè di pagina, senza, quello di questa pagina.
  const notice = useMemo(() => (noticeStale ? null : noticeOf(view)), [view, noticeStale]);
  const privacy = useMemo(() => noticeOf(view) ?? privacyTexts(view), [view]);
  const screen = screenOf(view);
  // (Rilascio 9b) Con l'informativa da leggere, la schermata che c'è sotto: se la visita l'ha già mostrata, resta montata
  // e nascosta, così domande, passi e campi tengono quello che il referente ha scritto.
  const onNotice = screen === "privacy";
  const under = onNotice ? screenUnderNotice(view) : screen;
  const [contentShown, setContentShown] = useState(!onNotice);
  if (!onNotice && !contentShown) setContentShown(true);
  const keep = onNotice && contentShown;
  const sections = useMemo(() => questionSections(view), [view]);
  const stepped = hasSteps(view);
  const steps = stepsOf(view);
  const lastStep = steps[steps.length - 1] ?? null;
  const entries = useMemo(() => newsEntries(view), [view]);

  // (Rilascio 6) Le risposte del team che la pagina mostra: «viste», così la volta dopo stanno sotto la loro domanda.
  useEffect(() => {
    if (screen === "privacy") return;
    const ids = freshReplyIds(view).filter((id) => !seenSent.current.has(id));
    if (ids.length === 0) return;
    for (const id of ids) seenSent.current.add(id);
    void markSeen(token, { ids });
  }, [view, screen, token]);

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

  /** (Rilascio 9b) La ripresa dopo l'informativa (`resume`): la funzione di adesso, letta solo dentro gli eventi. */
  const resumeRef = useRef<() => void>(() => {});
  /**
   * (Rilascio 9b) Una scrittura aspetta l'informativa: subito il riquadro al posto di quello che c'era (che resta montato,
   * nascosto), senza «Iniziamo» finché non arriva il testo di adesso dalla vista. Della vista nuova si prende solo
   * l'informativa: bozze, passi e file restano quelli sulla pagina. Se la vista la dice già letta (un'altra finestra),
   * quello che aspetta riparte da solo, una volta; poi si chiede di ricaricare.
   */
  const privacyWait = useCallback(
    (returnTo?: string) => {
      waiting.current = true;
      if (returnTo && !resumeFocus.current) resumeFocus.current = returnTo;
      setNoticeAgain(true);
      setPrivacyError(null);
      setPrivacyBusy(true);
      setView((v) => (v.privacy.accepted ? { ...v, privacy: { ...v.privacy, accepted: false } } : v));
      pendingFocus.current = PRIVACY_TITLE_ID;
      if (waitRun.current) return;
      const run = (async () => {
        const r = await fetchAskView(token);
        if (!r.ok) {
          if (r.code === "link_non_valido") {
            window.location.reload();
            return;
          }
          // Senza rete resta il testo che la pagina ha: «Iniziamo» lo accetta solo se è ancora quello di adesso
          // (il server lo controlla), altrimenti il riquadro chiede di ricaricare.
        } else if (r.data.privacy.accepted && autoResumes.current < 1) {
          autoResumes.current += 1;
          setView((v) => ({ ...v, privacy: r.data.privacy }));
          pendingFocus.current = resumeFocus.current;
          resumeFocus.current = null;
          resumeRef.current();
        } else {
          setView((v) => ({ ...v, privacy: { ...r.data.privacy, accepted: false } }));
          if (r.data.privacy.accepted) setNoticeStale(true);
        }
        setPrivacyBusy(false);
      })();
      waitRun.current = run;
      void run.finally(() => {
        if (waitRun.current === run) waitRun.current = null;
      });
    },
    [token],
  );

  const onClosure = useCallback((needId: string, closed: boolean) => {
    const key = needId.toLowerCase();
    setClosedMap((current) => {
      if (current.get(key) === closed) return current;
      const next = new Map(current);
      next.set(key, closed);
      return next;
    });
    if (closed) setMissing((current) => (current.includes(key) ? current.filter((id) => id !== key) : current));
  }, []);

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
  // (Rilascio 9b) Il passo sullo schermo, per tornarci dopo «Iniziamo» (una bozza del passo 1 arriva anche dal passo 2).
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  /** Va al passo `next`, con una voce nuova della cronologia: Indietro del browser torna al passo di prima. */
  const goTo = useCallback((next: CheckStep, mode: "push" | "replace" = "push") => {
    setStep(next);
    if (next === 3) setQuestionsOpened(true);
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
      if (resolved === 3) setQuestionsOpened(true);
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
  /** (Rilascio 5.1) La bozza mostrata di una riga dell'impatto: la barra dei passi la conta subito. */
  const setBenefit = useCallback((key: string, draft: NonNullable<ReferentBenefitView["draft"]>) => {
    setView((v) =>
      v.check?.benefits ? { ...v, check: { ...v.check, benefits: v.check.benefits.map((row) => (row.key === key ? { ...row, draft } : row)) } } : v,
    );
  }, []);

  /**
   * Una bozza del passo 1 o 2; `stima_cambiata` rilegge la vista con la stima nuova. (Rilascio 9b) Una bozza che aspetta
   * l'informativa si tiene (`heldChecks`, una per passo o per riga) e parte dopo «Iniziamo».
   */
  const saveStep = useCallback(
    async (body: CheckBody, keepalive = false): Promise<boolean> => {
      if (waiting.current) {
        heldChecks.current.set(checkKeyOf(body), body);
        return false;
      }
      setCheckSave("saving");
      setStepError(null);
      const run = (async () => {
        const r = await saveCheck(token, body, keepalive);
        if (r.ok) {
          heldChecks.current.delete(checkKeyOf(body));
          setCheckSave("saved");
          // Una nota con un codice fiscale o una data di nascita si salva con un avviso (all'invio la
          // ferma; nomi, email e telefoni passano, rilascio 5.1): lo si dice subito sotto «Cosa
          // cambieresti?», come fanno le domande; l'ultima bozza decide.
          if (body.step === 1) setNoteWarning(stepOneWarning(body, r.data.warnings));
          // (Rilascio 5.1) Lo stesso per il commento di una riga dell'impatto, sotto quel commento.
          const row = stepTwoWarning(body, r.data.warnings);
          if (row)
            setBenefitWarnings((current) => {
              if ((current[row.key] ?? null) === row.message) return current;
              const next = { ...current };
              if (row.message) next[row.key] = row.message;
              else delete next[row.key];
              return next;
            });
          return true;
        }
        if (waitsForPrivacy(r.code)) {
          setCheckSave(null);
          heldChecks.current.set(checkKeyOf(body), body);
          privacyWait(stepRef.current === 3 ? undefined : stepTitleId(stepRef.current));
          return false;
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
        if (r.code === "gia_inviata" || r.code === "domanda_non_disponibile") void reload();
        setStepError({ step: body.step, message: r.message });
        return false;
      })();
      checkInFlight.current = run;
      void run.finally(() => {
        if (checkInFlight.current === run) checkInFlight.current = null;
      });
      return run;
    },
    [token, reload, privacyWait],
  );

  /**
   * (Rilascio 9b) Dopo «Iniziamo»: partono le bozze che aspettavano l'informativa, quelle delle domande (ognuna salva
   * quello che ha nel campo) e quelle dei passi, nell'ordine in cui sono arrivate.
   */
  const resume = useCallback(async () => {
    waiting.current = false;
    for (const flush of [...flushers.current.values()]) void flush();
    const held = [...heldChecks.current.values()];
    heldChecks.current.clear();
    for (const body of held) await saveStep(body);
  }, [saveStep]);
  useEffect(() => {
    resumeRef.current = () => void resume();
  }, [resume]);

  const tooSoon = useCallback((e: React.MouseEvent<HTMLButtonElement>) => isRepeatActivation({ clickCount: e.detail, msSinceStep: Date.now() - stepChangedAt.current }), []);

  // L'invio dall'ultimo passo: la funzione di adesso, letta solo dentro gli eventi.
  const submitRef = useRef<() => Promise<void>>(async () => {});
  const confirmActions = useMemo<StepActions>(() => ({ save: saveStep, setDraft, tooSoon, next: () => goTo(2) }), [saveStep, setDraft, tooSoon, goTo]);
  const estimateActions = useMemo<StepActions>(
    () => ({
      save: saveStep,
      setDraft,
      setBenefit,
      tooSoon,
      next: () => {
        if (lastStep === 2) void submitRef.current();
        else goTo(3);
      },
    }),
    [saveStep, setDraft, setBenefit, tooSoon, goTo, lastStep],
  );

  async function onAccept() {
    // (Rilascio 9b) Si accetta solo il testo sullo schermo, e la sua versione va al server come prova (`shown`).
    const shown = notice;
    if (!shown || privacyBusy) return;
    setPrivacyBusy(true);
    setPrivacyError(null);
    const r = await acceptPrivacy(token, { version: shown.version, shown: shown.version });
    setPrivacyBusy(false);
    if (r.ok) {
      autoResumes.current = 0;
      setNoticeAgain(false);
      setView((v) => ({ ...v, privacy: { ...v.privacy, accepted: true } }));
      // (Rilascio 9b) Quello che aspettava l'informativa riparte; il fuoco torna dove il referente era.
      void resume();
      const back = resumeFocus.current;
      resumeFocus.current = null;
      if (back && (back === COMPOSER_FOCUS ? composer !== null : document.getElementById(back) !== null)) {
        setFocusTarget(back);
        return;
      }
      // (Rilascio 6) Il campo che il referente ha aperto prende il fuoco; «Da completare» va al suo titolo.
      if (composer) {
        setFocusTarget(COMPOSER_FOCUS);
        return;
      }
      if (screenUnderNotice(view) === "news") {
        setFocusTarget(NEWS_TITLE_ID);
        return;
      }
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
    // (Rilascio 9b) Il server ha un'altra versione: il testo sullo schermo non è più quello, si ricarica la pagina.
    if (r.code === "informativa_cambiata") {
      setNoticeStale(true);
      return;
    }
    setPrivacyError(r.code === "troppe_richieste" ? r.message : REFERENT_PRIVACY_NOTICE.error);
  }

  async function onSubmit() {
    if (submitBusy) return;
    if (composerBlocks()) return;
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
    // (Rilascio 9b) Una bozza aspetta l'informativa: è sullo schermo, niente da correggere. Dopo «Iniziamo» si invia di nuovo.
    if (waiting.current) {
      setSubmitBusy(false);
      return;
    }
    if (unsaved.length > 0) {
      setSubmitBusy(false);
      setSubmitError(REFERENT_ERROR_MESSAGES.risposte_da_correggere);
      setFocusTarget(questionTitleId(unsaved[0]));
      return;
    }
    // (Rilascio 5) «Invia» solo con ogni domanda chiusa: dice quali mancano, senza chiamare il server.
    const openNow = sections.filter((q) => q.kind === "aperta").map((q) => q.needId.toLowerCase());
    const stillOpen = openNow.filter((id) => closedMap.get(id) !== true);
    if (stillOpen.length > 0) {
      setSubmitBusy(false);
      setMissing(stillOpen);
      setFocusTarget(questionTitleId(stillOpen[0]));
      return;
    }
    setMissing([]);
    setNewQuestions(false);
    const r = await submitAnswers(token, { shown: openNow });
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
    // (Rilascio 9b) L'invio aspetta l'informativa: tutto resta com'è, l'informativa torna sullo schermo.
    if (waitsForPrivacy(r.code)) {
      privacyWait();
      return;
    }
    if (r.code === "domanda_non_disponibile") void reload();
    // (Rilascio 5) La conferma o la stima mancano, o la nota di «Correggi» va corretta: si torna al loro
    // passo, con il messaggio lì (mai «le trovi evidenziate» senza niente di evidenziato).
    const back = stepped ? stepOfSubmitRefusal(r) : null;
    if (back) {
      // (Rilascio 5.1) Una voce aggiunta o cambiata dal team mentre la pagina era aperta: prima si rilegge,
      // così la riga che manca c'è ed è evidenziata (senza, «Invia» tornava qui all'infinito).
      if (back.reload) await reload();
      goTo(back.step);
      setStepError(back);
      if (back.missing?.length) setFocusTarget(benefitTitleId(back.missing[0]));
      // (Rilascio 5.1) Il commento di una riga da correggere: il fuoco nel campo, il messaggio sotto.
      if (back.benefit) setFocusTarget(benefitCommentId(back.benefit));
      return;
    }
    // (Rilascio 5) Domande nuove del team mentre la pagina era aperta: si rilegge e lo si dice.
    if (r.code === "domande_nuove") {
      await reload();
      setNewQuestions(true);
      const fresh = r.issues.map((i) => i.field?.toLowerCase()).filter((id): id is string => Boolean(id));
      setMissing(fresh);
      if (fresh[0]) setFocusTarget(questionTitleId(fresh[0]));
      return;
    }
    if (r.code === "domande_aperte") {
      const open = r.issues.map((i) => i.field?.toLowerCase()).filter((id): id is string => Boolean(id));
      setMissing(open);
      if (open[0]) setFocusTarget(questionTitleId(open[0]));
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

  /**
   * (Rilascio 6) «Invia» di «Da completare»: prima ogni domanda nuova salva quello che manca; poi, se tutto è
   * fatto (ogni chiarimento ha la sua risposta, ogni domanda nuova è chiusa), le risposte ai chiarimenti una per
   * una e l'invio delle domande nuove. Altrimenti dice quali punti mancano, senza chiamare il server.
   */
  async function onSubmitNews() {
    if (submitBusy) return;
    if (composerBlocks()) return;
    setSubmitBusy(true);
    setSubmitError(null);
    setIssues(new Map());
    setReplyErrors({});
    const openNow = sections.filter((q) => q.kind === "aperta").map((q) => q.needId.toLowerCase());
    const flushed = await Promise.all(openNow.map(async (needId) => [needId, (await flushers.current.get(needId)?.()) ?? true] as const));
    const unsaved = flushed.filter(([, ok]) => !ok).map(([needId]) => needId);
    if (waiting.current) {
      setSubmitBusy(false);
      return;
    }
    if (unsaved.length > 0) {
      setSubmitBusy(false);
      setSubmitError(REFERENT_ERROR_MESSAGES.risposte_da_correggere);
      setFocusTarget(questionTitleId(unsaved[0]));
      return;
    }
    const missingNow = entries
      .filter((e) => (e.kind === "chiarimento" && !(replyTexts[e.id] ?? "").trim()) || (e.kind === "domanda" && closedMap.get(e.id.toLowerCase()) !== true))
      .map((e) => e.id);
    if (missingNow.length > 0) {
      setSubmitBusy(false);
      setNewsMissing(missingNow);
      const first = entries.find((e) => e.id === missingNow[0]);
      setFocusTarget(first?.kind === "domanda" ? questionTitleId(first.id) : newsTitleId(missingNow[0]));
      return;
    }
    setNewsMissing([]);
    let replied = 0;
    for (const e of entries.filter((x) => x.kind === "chiarimento")) {
      const r = await postReply(token, { messageId: e.id, text: (replyTexts[e.id] ?? "").trim() });
      if (r.ok) {
        replied++;
        setReplyTexts((current) => {
          const next = { ...current };
          delete next[e.id];
          return next;
        });
        continue;
      }
      if (r.code === "link_non_valido") {
        window.location.reload();
        return;
      }
      // Già risposto da un'altra finestra: niente da fare qui.
      if (r.code === "domanda_non_disponibile") continue;
      setSubmitBusy(false);
      // (Rilascio 9b) Aspetta l'informativa: le risposte scritte restano nei loro campi, l'informativa torna sullo schermo.
      if (waitsForPrivacy(r.code)) {
        if (replied > 0) await reload();
        privacyWait(newsTitleId(e.id));
        return;
      }
      setReplyErrors({ [e.id]: r.issues[0]?.message ?? r.message });
      setFocusTarget(newsTitleId(e.id));
      if (replied > 0) await reload();
      return;
    }
    let result: SubmitResult = { submitted: replied, open: 0, state: "completata" };
    if (openNow.length > 0) {
      const r = await submitAnswers(token, { shown: openNow });
      if (!r.ok) {
        setSubmitBusy(false);
        if (r.code === "link_non_valido") {
          window.location.reload();
          return;
        }
        if (waitsForPrivacy(r.code)) {
          if (replied > 0) await reload();
          privacyWait();
          return;
        }
        if (replied > 0 || r.code === "domanda_non_disponibile" || r.code === "domande_nuove") await reload();
        if (r.code === "domande_nuove" || r.code === "domande_aperte") {
          const open = r.issues.map((i) => i.field?.toLowerCase()).filter((id): id is string => Boolean(id));
          if (r.code === "domande_nuove") setNewQuestions(true);
          setNewsMissing(open);
          if (open[0]) setFocusTarget(questionTitleId(open[0]));
          return;
        }
        const mapped = issuesByQuestion(r.issues, openNow);
        setIssues(mapped.byNeed);
        setSubmitError(r.message);
        setFocusTarget(mapped.first ? questionTitleId(mapped.first) : SUBMIT_ERROR_ID);
        return;
      }
      result = { ...r.data, submitted: r.data.submitted + replied };
    }
    await reload();
    setSubmitBusy(false);
    setThanks(result);
    setFocusTarget(THANKS_TITLE_ID);
  }

  /**
   * «Prima di iniziare» con il testo della vista (rilascio 9b: senza, «Ricarica la pagina»). (Rilascio 6) Anche al posto
   * del campo, per scrivere al team con una versione nuova da leggere; non quando è già in cima alla pagina.
   */
  const noticeCard = <PrivacyCard texts={notice} again={noticeAgain} busy={privacyBusy} error={privacyError} onAccept={() => void onAccept()} />;
  const privacyGate = view.privacy.accepted || onNotice ? null : noticeCard;

  /** (Rilascio 6) Il filo di un'ancora, con «Modifica», «Aggiungi qualcosa» e «Ho un dubbio». */
  const threadItem = (key: string, subject: string, actions: ThreadAction[], o: { primary: boolean; editText?: string }) => (
    <ThreadItem
      token={token}
      targetKey={key}
      subject={subject}
      messages={messagesOf(view, key, { withFresh: under !== "news" })}
      actions={actions}
      today={today}
      editText={o.editText}
      composer={composer?.key === key ? composer.mode : null}
      onComposer={(mode) => {
        setComposer(mode ? { key, mode } : null);
        setSentKey(null);
        if (!mode) setSubmitError((e) => (e === TT.composerOpen ? null : e));
      }}
      primary={o.primary}
      privacyGate={privacyGate}
      sent={sentKey === key}
      onSent={() => {
        setComposer(null);
        setSubmitError((e) => (e === TT.composerOpen ? null : e));
        void reload().then(() => setSentKey(key));
      }}
      onStale={() => void reload()}
      onDirty={onComposerDirty}
      onPrivacyWait={() => privacyWait(COMPOSER_FOCUS)}
    />
  );
  const questionThread = (section: QuestionSection, primary: boolean) =>
    threadItem(threadKeyOf({ anchor: "domanda", needId: section.needId }), section.title, threadActionsOf(view, { kind: "domanda", question: section.question }), {
      primary,
      editText: editableText(section.question),
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

  /**
   * (Rilascio 9b) La pagina: in cima l'informativa, se c'è da leggerla; sotto quello che c'è da fare, che resta montato
   * e nascosto mentre l'informativa è sullo schermo, se la visita l'ha già mostrato (`keep`). Alla prima apertura, solo
   * l'informativa: niente domande, bozze o caricamenti prima di «Iniziamo».
   */
  const shell = (content: React.ReactNode) => (
    <PublicShell footer={footer}>
      {intro}
      {onNotice ? noticeCard : null}
      {!onNotice || keep ? (
        <div hidden={onNotice || undefined} data-slot="referent-content">
          {content}
        </div>
      ) : null}
    </PublicShell>
  );

  const readOnly = under === "completed" || under === "empty";
  const newsScreen = under === "news";
  const sentCheck = readOnly || newsScreen ? sentCheckLines(view) : null;
  const doneCount = sections.filter((q) => q.kind !== "aperta" || closedMap.get(q.needId.toLowerCase()) === true).length;
  const missingPositions = sections.map((q, i) => (missing.includes(q.needId.toLowerCase()) ? i + 1 : 0)).filter((n) => n > 0);

  // (Rilascio 5) I passi «Lo use case» e «Il tempo»; le domande del passo 3 dopo, nascoste qui una volta aperte.
  const onCheckStep = stepped && under === "questions" && step !== 3;
  const check = stepped ? view.check : null;
  const questionsBlock = under === "questions" || (readOnly && sections.length > 0);
  const renderQuestions = questionsBlock && (!onCheckStep || questionsOpened);

  // (Rilascio 6) La conferma e l'impatto già inviati, ognuno con il suo filo («Aggiungi qualcosa», «Ho un dubbio»).
  const benefitLabel = (key: string) => view.check?.benefits?.find((b) => b.key === key)?.label ?? view.useCase.title;
  const sentCheckBlock = (primary: boolean) =>
    sentCheck ? (
      <div className="space-y-3 text-base leading-7 break-words" data-slot="referent-sent-check">
        <div className="space-y-2">
          <p>{sentCheck.useCase}</p>
          {sentCheck.note ? <blockquote className="rounded-xl bg-muted/50 px-4 py-3 whitespace-pre-line">{sentCheck.note}</blockquote> : null}
          {threadItem("g", view.useCase.title, threadActionsOf(view, { kind: "generale" }), { primary })}
        </div>
        {sentCheck.time ? (
          <p>
            {sentCheck.time}
            {sentCheck.numbers ? ` ${sentCheck.numbers}` : ""}
          </p>
        ) : null}
        {sentCheck.benefits.length ? (
          <ul data-slot="referent-sent-benefits" className="space-y-3">
            {sentCheck.benefits.map((b) => (
              <li key={b.key} className="space-y-1 break-words">
                <p>{b.line}</p>
                {b.comment ? <p className="text-muted-foreground">{b.comment}</p> : null}
                {threadItem(threadKeyOf({ anchor: "beneficio", componentKey: b.key }), benefitLabel(b.key), threadActionsOf(view, { kind: "beneficio" }), { primary })}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    ) : null;
  /** (Rilascio 6) «Hai un dubbio sul caso d'uso?» quando non c'è la conferma inviata a cui attaccarlo. */
  const generalBlock = (primary: boolean) => {
    if (sentCheck) return null;
    const actions = threadActionsOf(view, { kind: "generale" });
    if (actions.length === 0 && messagesOf(view, "g").length === 0) return null;
    return (
      <div className="mt-6 space-y-1" data-slot="referent-general">
        {actions.length ? <p className="text-base break-words text-muted-foreground">{TT.generalDoubt}</p> : null}
        {threadItem("g", view.useCase.title, actions, { primary })}
      </div>
    );
  };

  // (Rilascio 6) «Da completare»: le cose fatte, quelle che «Invia» ha trovato da fare.
  const newsDone = entries.filter((e) => e.kind === "risposta" || (e.kind === "chiarimento" && (replyTexts[e.id] ?? "").trim().length > 0) || (e.kind === "domanda" && closedMap.get(e.id.toLowerCase()) === true)).length;
  const newsActionable = entries.some((e) => e.kind !== "risposta");
  const newsMissingPositions = entries.filter((e) => newsMissing.includes(e.id) || newsMissing.includes(e.id.toLowerCase())).map((e) => e.position);
  const questionCard = (section: QuestionSection, o: { primary: boolean; label?: string; missing?: boolean }) => (
    <QuestionCard
      key={`${section.needId}:${section.kind}:${generation}`}
      token={token}
      section={o.label ? { ...section, label: o.label } : section}
      downloads={view.privacy.accepted}
      today={today}
      clientMode={view.upload.clientMode}
      issues={issues.get(section.needId.toLowerCase()) ?? []}
      disabled={submitBusy}
      registerFlush={registerFlush}
      onStale={onStale}
      onEdit={clearIssues}
      missing={o.missing ?? missing.includes(section.needId.toLowerCase())}
      onClosure={onClosure}
      tooSoon={stepped ? tooSoon : undefined}
      extra={questionThread(section, o.primary)}
      paused={onNotice}
      onPrivacyWait={() => privacyWait(questionTitleId(section.needId))}
    />
  );

  if (newsScreen) {
    const sentSections = sections.filter((q) => q.kind !== "aperta");
    return shell(
      <>
        <section aria-labelledby={NEWS_TITLE_ID} className="mt-6" data-slot="referent-news">
          <h2 id={NEWS_TITLE_ID} tabIndex={-1} className="text-xl font-semibold outline-none">
            {TT.newsTitle}
          </h2>
          <p className="mt-1 text-base break-words text-muted-foreground">{newsLead(entries.length)}</p>
          {newQuestions ? <Notice tone="info">{REFERENT_ERROR_MESSAGES.domande_nuove}</Notice> : null}
          <div className="mt-4 space-y-4">
            {entries.map((entry) => {
              if (entry.kind === "domanda") {
                const section = sections.find((q) => q.needId === entry.id);
                return section ? questionCard(section, { primary: false, label: entry.label, missing: newsMissing.includes(entry.id.toLowerCase()) }) : null;
              }
              const message = view.thread.messages.find((m) => m.id === entry.id);
              if (!message) return null;
              if (entry.kind === "risposta") return <TeamReplyCard key={entry.id} entry={entry} reply={message} doubt={doubtOf(view, message)} />;
              return (
                <ClarificationCard
                  key={entry.id}
                  entry={entry}
                  message={message}
                  value={replyTexts[entry.id] ?? ""}
                  onChange={(value) => {
                    setReplyTexts((current) => ({ ...current, [entry.id]: value }));
                    if (replyErrors[entry.id]) setReplyErrors((current) => ({ ...current, [entry.id]: "" }));
                  }}
                  missing={newsMissing.includes(entry.id)}
                  error={replyErrors[entry.id] || null}
                  disabled={submitBusy}
                />
              );
            })}
          </div>
        </section>
        {/* (Rilascio 6, B.1.5) Quello che ha già inviato: un tocco più in là, con il conteggio; «Invia» in fondo. */}
        <SentDisclosure summary={fillText(TT.sentCount, { n: (sentCheck ? 1 : 0) + sentSections.length })}>
          {sentCheck ? <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">{sentCheckBlock(false)}</div> : null}
          {sentSections.map((section) => questionCard(section, { primary: false }))}
          {generalBlock(false)}
        </SentDisclosure>
        {newsActionable ? (
          <SubmitBar
            status={doneCountText(newsDone, entries.length)}
            missing={
              newsMissingPositions.length
                ? {
                    text: newsMissingText(newsMissingPositions),
                    goLabel: fillText(TT.goTo, { k: newsMissingPositions[0] }),
                    onGo: () => {
                      const first = entries.find((e) => e.position === newsMissingPositions[0]);
                      if (first) focusById(first.kind === "domanda" ? questionTitleId(first.id) : newsTitleId(first.id));
                    },
                  }
                : null
            }
            error={submitError}
            busy={submitBusy}
            onSubmit={() => void onSubmitNews()}
          />
        ) : null}
      </>,
    );
  }

  return shell(
    <>
      {stepped && under === "questions" ? <ReferentStepBar items={stepStates(view, step)} /> : null}
      {onCheckStep && check ? (
        <>
          <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-muted-foreground">
            {checkSave ? REFERENT_PUBLIC_TEXT.autosave[checkSave] : ""}
          </p>
          {step === 1 ? (
            <ConfirmStep
              key={`1:${generation}`}
              check={check}
              title={view.useCase.title}
              actions={confirmActions}
              errorFromServer={stepError?.step === 1 ? stepError.message : null}
              warningFromServer={noteWarning}
            />
          ) : check.benefits ? (
            <ImpactStep
              key={`2:${generation}:benefici`}
              check={check}
              last={lastStep === 2}
              sending={submitBusy}
              staleNotice={staleNotice}
              actions={estimateActions}
              onBack={() => goTo(1)}
              errorFromServer={stepError?.step === 2 && !stepError.missing?.length && !stepError.benefit ? stepError.message : submitError}
              missingFromServer={stepError?.step === 2 ? stepError.missing : undefined}
              rowError={stepError?.step === 2 && stepError.benefit ? { key: stepError.benefit, message: stepError.message } : null}
              rowWarnings={benefitWarnings}
            />
          ) : (
            <EstimateStep
              key={`2:${generation}:tempo`}
              check={check}
              last={lastStep === 2}
              sending={submitBusy}
              staleNotice={staleNotice}
              actions={estimateActions}
              onBack={() => goTo(1)}
              errorFromServer={stepError?.step === 2 ? stepError.message : submitError}
            />
          )}
        </>
      ) : null}
      {readOnly ? (
        <MessageCard as="h2" titleId={FINAL_TITLE_ID} title={finalCardText(under === "completed" ? "completed" : "empty", view, today)}>
          {sentCheck ? <div className="mt-3">{sentCheckBlock(true)}</div> : null}
        </MessageCard>
      ) : null}
      {renderQuestions ? (
        <div hidden={onCheckStep} data-slot="referent-questions">
          {under === "questions" && sections.length > 0 ? (
            <div className="mt-6 space-y-2">
              <h2 id={QUESTIONS_TITLE_ID} tabIndex={-1} className="text-xl font-semibold outline-none">
                {questionsHeading(sections.length)}
              </h2>
              <p className="text-base break-words text-muted-foreground">{REFERENT_PUBLIC_TEXT.questionsLead}</p>
              {newQuestions ? <Notice tone="info">{REFERENT_ERROR_MESSAGES.domande_nuove}</Notice> : null}
            </div>
          ) : null}
          {questionsBlock ? (
            <div className="mt-6 space-y-4" aria-labelledby={readOnly ? FINAL_TITLE_ID : QUESTIONS_TITLE_ID}>
              {sections.map((section) => questionCard(section, { primary: readOnly }))}
              {under === "questions" ? <p className="text-sm break-words text-muted-foreground">{savesItselfText(view)}</p> : null}
            </div>
          ) : null}
          {under === "questions" ? generalBlock(false) : null}
          {under === "questions" ? (
            <SubmitBar
              status={doneCountText(doneCount, sections.length)}
              missing={missingPositions.length ? { text: missingText(missingPositions), goLabel: fillText(REFERENT_PUBLIC_TEXT.goToQuestion, { k: missingPositions[0] }), onGo: () => focusById(questionTitleId(missing[0])) } : null}
              error={submitError}
              busy={submitBusy}
              onSubmit={() => void onSubmit()}
              onBack={
                stepped
                  ? (e) => {
                      // Il secondo clic di un doppio clic su «Indietro» arriva sul passo 2: lo si ignora.
                      if (!tooSoon(e)) goTo(2);
                    }
                  : undefined
              }
            />
          ) : null}
        </div>
      ) : null}
      {readOnly ? generalBlock(true) : null}
    </>,
  );
}
