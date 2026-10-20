"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Issue } from "@/lib/uc/answers/issues";
import type { BatchAnswersResult, ReferentItemView, ReferentModuleView, ReferentView } from "@/lib/uc/public-view";
import {
  answerBody,
  answerSummary,
  batchEntry,
  checkSubmit,
  chunkBatch,
  delegateBody,
  initialForm,
  intentAction,
  isBlankForm,
  isReadyToSend,
  sendsInBatch,
  type DelegateForm,
  type ReferentForm,
  type ReferentIntent,
} from "@/lib/uc/views/referente-form";
import {
  QUICK,
  nextTopic,
  planReferentHome,
  quickRound,
  referentHash,
  stepDocumentTitle,
  topicEntryHash,
  topicId,
  topicSteps,
  type ReferentRoute,
} from "@/lib/uc/views/referente-plan";
import { getView, postAnswers, postJson } from "./api";
import { ApprovalsView, type ApprovalOutcome } from "./approvals-view";
import { FileDeclarationContext, type AttachmentRef } from "./attachment-field";
import { ClarificationScreen } from "./clarification-screen";
import { DelegateScreen, type DelegateResult } from "./delegate-screen";
import { InvalidLinkCard, ReferentShell } from "./link-card";
import { ModuleIntro } from "./module-intro";
import { ModuleReview, type ReviewRow } from "./module-review";
import { PrivacyGate } from "./privacy-gate";
import { ReferenteHome } from "./referente-home";
import { ClientLine, Notice, SCREEN_TITLE_ID, ScreenTitle } from "./screen";
import { SentScreen } from "./sent-screen";
import { StepRunner } from "./step-runner";
import { useAutosave, type AutosaveBlock } from "./use-autosave";
import { useDeviceMemory, useHashRoute, useNarrow, useReducedMotion } from "./use-device";

/**
 * Pagina del referente `/r/[token]` (DESIGN §4): una domanda per schermata al
 * telefono, «È così» con un tocco, «Non lo so» senza sentirsi in difetto, e
 * l'invio per argomento dopo un riepilogo.
 *
 * - Prima di tutto l'informativa (R0); poi la Home (R1) con una sola scheda
 *   primaria; i passi stanno nell'hash (`#/a/<argomento>/<n>`, `#/veloci/<n>`,
 *   `#/collega/<id>`, `#/chiarimento/<id>`…), così il tasto indietro torna
 *   alla domanda di prima e l'hash non arriva mai al server.
 * - Ogni decisione (valore, «È così», correzione, «Non lo so», «Non si
 *   applica») si salva in bozza mentre il referente avanza; in fondo
 *   all'argomento un riepilogo le invia tutte (`POST …/answers`, al massimo 50
 *   per chiamata). Partono da sole: dati personali (mai in bozza), risposte a
 *   un chiarimento, deleghe e aggiornamenti di una risposta già a posto.
 * - A ogni cambio di passo: `document.title`, focus sul titolo, annunci in una
 *   regione `aria-live` («Confermato.», «Inviate.», gli errori; «Salvato» solo
 *   la prima volta).
 *
 * Avvisi in linea, niente toast né portali: il `Toaster` di radice è fuori da
 * `.survey-light`. Dopo ogni invio la vista si rilegge dal server.
 */

export interface ReferentePageProps {
  token: string;
  initialView: ReferentView;
  /** Istante del server: le date della Home combaciano tra server e browser. */
  nowIso: string;
  /** Anteprima per Lateral Space: niente scritture, niente apertura registrata. */
  readOnly?: boolean;
}

interface SubmittedAnswer {
  itemId: string;
  status: string;
  label: string;
}

interface DelegationResult {
  status: "inviata" | "da_approvare";
  items: number;
  link: string | null;
}

interface HomeNotice {
  tone: "ok" | "info" | "errore";
  text: string;
}

interface ReviewState {
  scope: string;
  failures: Record<string, string>;
  partial: { sent: number; failed: number } | null;
  offline: boolean;
}

function itemsOf(view: ReferentView): ReferentItemView[] {
  return view.modules.flatMap((m) => m.items);
}

function attachmentsOf(item: ReferentItemView): AttachmentRef[] {
  // «pulito» vuol dire utilizzabile: pulito e scansionato, oppure revisionato da Lateral Space.
  return item.files.map((f) => ({ fileId: f.id, fileName: f.name, sizeBytes: f.sizeBytes, status: f.usable ? "pulito" : f.status === "rifiutato" ? "rifiutato" : "in_quarantena" }));
}

function usableIds(refs: readonly AttachmentRef[] | undefined): string[] {
  return (refs ?? []).filter((r) => r.status === "pulito").map((r) => r.fileId);
}

/** Il modulo di una domanda, per il nome dell'argomento. */
function moduleOf(view: ReferentView, itemId: string): ReferentModuleView | undefined {
  return view.modules.find((m) => m.items.some((i) => i.id === itemId));
}

export function ReferentePage({ token, initialView, nowIso, readOnly = false }: ReferentePageProps) {
  const [view, setView] = useState(initialView);
  const [invalid, setInvalid] = useState(false);
  const [privacyAck, setPrivacyAck] = useState(initialView.privacy.acknowledged);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const items = useMemo(() => itemsOf(view), [view]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [forms, setForms] = useState<Record<string, ReferentForm>>(() => Object.fromEntries(itemsOf(initialView).map((i) => [i.id, initialForm(i)])));
  const formsRef = useRef(forms);
  const [attachments, setAttachments] = useState<Record<string, AttachmentRef[]>>(() => Object.fromEntries(itemsOf(initialView).map((i) => [i.id, attachmentsOf(i)])));
  const attachmentsRef = useRef(attachments);
  const [issues, setIssues] = useState<Record<string, Issue[]>>({});
  const [blocks, setBlocks] = useState<Record<string, AutosaveBlock | null>>({});
  const [changed, setChanged] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [notice, setNotice] = useState<HomeNotice | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  // La dichiarazione sui file si chiede una volta per visita (DESIGN §9.1 punto 16).
  const [fileDeclared, setFileDeclared] = useState(false);
  const fileDeclaration = useMemo(() => ({ declared: fileDeclared, declare: setFileDeclared }), [fileDeclared]);
  const savedAnnounced = useRef(false);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const narrow = useNarrow();
  const reduced = useReducedMotion();
  const memory = useDeviceMemory(token);
  const [route, go] = useHashRoute();

  const live = !readOnly && !invalid && view.access === "scrivibile";
  const writable = live && privacyAck;

  const lastSaid = useRef(0);
  const say = useCallback((text: string) => {
    lastSaid.current = Date.now();
    // Lo stesso testo due volte di fila si annuncia comunque.
    setAnnounce((prev) => (prev === text ? `${text} ` : text));
  }, []);
  const onBlocked = useCallback((itemId: string, block: AutosaveBlock | null) => {
    setBlocks((b) => (b[itemId] === block ? b : { ...b, [itemId]: block }));
  }, []);
  const onInvalidLink = useCallback(() => setInvalid(true), []);
  const onSaved = useCallback(() => {
    if (savedAnnounced.current) return;
    savedAnnounced.current = true;
    // «Salvato» solo la prima volta, e mai sopra un annuncio appena fatto («Confermato.»).
    if (Date.now() - lastSaid.current > 2000) say("Salvato.");
  }, [say]);
  const autosave = useAutosave({ token, enabled: writable, onBlocked, onInvalidLink, onSaved });
  const { schedule, forget, flush, readDevice } = autosave;

  // Apertura del link: una volta dopo l'idratazione (mai su GET, così prefetch e scanner non contano).
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || readOnly || initialView.access !== "scrivibile") return;
    opened.current = true;
    void postJson(token, "opened", {});
  }, [initialView.access, readOnly, token]);

  // Bozze rimaste sul dispositivo (non arrivate al server l'ultima volta): si riprendono e si salvano.
  const restored = useRef(false);
  useEffect(() => {
    if (!writable || restored.current) return;
    restored.current = true;
    const found: [ReferentItemView, ReferentForm][] = [];
    for (const item of itemsOf(view)) {
      if (!item.can.answer || !item.can.draft) continue;
      const form = readDevice(item);
      if (form) found.push([item, form]);
    }
    if (found.length === 0) return;
    const next = { ...formsRef.current };
    for (const [item, form] of found) next[item.id] = form;
    formsRef.current = next;
    // Ripristino una tantum da `localStorage`, che esiste solo nel browser.
    setForms(next);
    for (const [item, form] of found) schedule({ item, form, fileIds: usableIds(attachmentsRef.current[item.id]) });
  }, [readDevice, schedule, view, writable]);

  const applyView = useCallback(
    (next: ReferentView, reset: readonly string[]) => {
      const nextItems = itemsOf(next);
      const ids = new Set(nextItems.map((i) => i.id));
      const nextForms: Record<string, ReferentForm> = {};
      const files: Record<string, AttachmentRef[]> = {};
      for (const item of nextItems) {
        const keep = !reset.includes(item.id) && formsRef.current[item.id];
        nextForms[item.id] = keep ? formsRef.current[item.id] : initialForm(item);
        files[item.id] = !reset.includes(item.id) && attachmentsRef.current[item.id] ? attachmentsRef.current[item.id] : attachmentsOf(item);
      }
      for (const id of Object.keys(formsRef.current)) if (!ids.has(id)) forget(id);
      formsRef.current = nextForms;
      attachmentsRef.current = files;
      setForms(nextForms);
      setAttachments(files);
      setView(next);
      if (next.privacy.acknowledged) setPrivacyAck(true);
    },
    [forget],
  );

  const refresh = useCallback(
    async (reset: readonly string[] = []) => {
      const r = await getView<ReferentView>(token);
      if (!r.ok) {
        if (r.code === "link_non_valido") setInvalid(true);
        else setNotice({ tone: "errore", text: "Non riesco ad aggiornare la pagina. Ricaricala tra poco: le risposte inviate sono salve." });
        return false;
      }
      applyView(r.data, reset);
      return true;
    },
    [applyView, token],
  );

  // ── Stato derivato ──────────────────────────────────────────────────

  const ready = useMemo(() => {
    const at = new Date();
    return new Set(items.filter((i) => forms[i.id] && isReadyToSend(i, forms[i.id], usableIds(attachments[i.id]), at)).map((i) => i.id));
  }, [attachments, forms, items]);
  // Iniziata: una decisione presa, una bozza sul server o una modifica di questa visita (i valori precompilati non contano).
  const touched = useMemo(
    () => new Set(items.filter((i) => forms[i.id]?.intent || i.draft !== null || (changed.has(i.id) && !isBlankForm(i, forms[i.id], usableIds(attachments[i.id])))).map((i) => i.id)),
    [attachments, changed, forms, items],
  );
  const plan = useMemo(
    () => planReferentHome(view, { narrow, ready, touched, skipped: memory.skipped, last: memory.last, introSeen: memory.introSeen }),
    [memory.introSeen, memory.last, memory.skipped, narrow, ready, touched, view],
  );
  const round = useMemo(() => quickRound(view), [view]);

  const topicById = (id: string) => plan.topics.find((t) => t.id === id) ?? null;
  const moduleById = (id: string) => view.modules.find((m) => topicId(m) === id) ?? null;
  const contextFor = (item: ReferentItemView) => moduleOf(view, item.id)?.title ?? "Domande";
  const delegateHrefFor = (item: ReferentItemView) => (view.delegation.allowed && item.can.delegate ? referentHash({ screen: "collega", itemId: item.id }) : null);
  /** Il passo di una domanda nel suo argomento, oppure la domanda da sola. */
  const stepHashFor = (item: ReferentItemView): string => {
    const mod = moduleOf(view, item.id);
    const at = mod ? topicSteps(mod).findIndex((i) => i.id === item.id) + 1 : 0;
    return mod && at > 0 ? referentHash({ screen: "passo", topic: topicId(mod), n: at }) : referentHash({ screen: "voce", itemId: item.id });
  };
  const issuesFor = (itemId: string): Issue[] => issues[itemId] ?? (blocks[itemId] ? [{ code: blocks[itemId]!.code, message: `Bozza non salvata: ${blocks[itemId]!.message}` }] : []);

  // ── Passi: titolo della scheda, focus sul titolo, ultima posizione ──

  const stepInfo = (() => {
    if (route.screen === "passo") {
      const mod = moduleById(route.topic);
      const steps = mod ? topicSteps(mod) : [];
      const n = Math.min(route.n, steps.length);
      return steps.length > 0 ? { steps, n, title: mod!.title } : null;
    }
    if (route.screen === "veloci") {
      const n = Math.min(route.n, round.length);
      return round.length > 0 ? { steps: round, n, title: contextFor(round[n - 1]) } : null;
    }
    return null;
  })();
  const currentItemId = stepInfo ? stepInfo.steps[stepInfo.n - 1]?.id : route.screen === "voce" || route.screen === "chiarimento" || route.screen === "collega" ? route.itemId : null;
  const screenKey = `${route.screen}:${"topic" in route ? route.topic : ""}:${currentItemId ?? ""}:${privacyAck}:${invalid}`;
  const firstScreen = useRef(screenKey);

  useEffect(() => {
    if (stepInfo && currentItemId) document.title = stepDocumentTitle(stepInfo.n, stepInfo.steps.length, stepInfo.title);
    else if (route.screen === "invia") document.title = "Controlla e invia · Unbundle";
    else if (route.screen === "collega") document.title = "Chiedi a un collega · Unbundle";
    else document.title = "Unbundle";
    if (route.screen === "passo" && stepInfo) memory.remember({ topic: route.topic, n: stepInfo.n });
    // Il focus va al titolo a ogni cambio di passo, non al primo caricamento.
    if (screenKey === firstScreen.current) return;
    firstScreen.current = "";
    window.scrollTo({ top: 0 });
    document.getElementById(SCREEN_TITLE_ID)?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambio di schermata
  }, [screenKey]);

  // ── Modifiche e salvataggio ─────────────────────────────────────────

  function changeForm(item: ReferentItemView, next: ReferentForm) {
    formsRef.current = { ...formsRef.current, [item.id]: next };
    setForms(formsRef.current);
    setChanged((c) => (c.has(item.id) ? c : new Set([...c, item.id])));
    setIssues((f) => (f[item.id] ? { ...f, [item.id]: [] } : f));
    if (writable) schedule({ item, form: next, fileIds: usableIds(attachmentsRef.current[item.id]) });
  }

  function changeAttachments(item: ReferentItemView, next: AttachmentRef[]) {
    attachmentsRef.current = { ...attachmentsRef.current, [item.id]: next };
    setAttachments(attachmentsRef.current);
    const form = formsRef.current[item.id];
    if (form && writable) schedule({ item, form, fileIds: usableIds(next) });
  }

  /** Dove si va dopo la domanda: la successiva del giro, oppure il riepilogo. */
  function advance() {
    if (route.screen === "passo" && stepInfo) {
      if (stepInfo.n < stepInfo.steps.length) go({ screen: "passo", topic: route.topic, n: stepInfo.n + 1 });
      else go({ screen: "invia", topic: route.topic });
    } else if (route.screen === "veloci" && stepInfo) {
      if (stepInfo.n < stepInfo.steps.length) go({ screen: "veloci", n: stepInfo.n + 1 });
      else go({ screen: "invia", topic: QUICK });
    } else {
      go({ screen: "home" });
    }
  }

  /** Controlla la decisione e la salva in bozza; false con gli errori accanto ai campi. */
  function decide(item: ReferentItemView, intent: ReferentIntent): boolean {
    const form = { ...(formsRef.current[item.id] ?? initialForm(item)), intent };
    const files = usableIds(attachmentsRef.current[item.id]);
    const check = checkSubmit(item, form, intentAction(intent), files, new Date());
    if (!check.ok) {
      setIssues((f) => ({ ...f, [item.id]: check.errors }));
      say(check.errors[0]?.message ?? "Controlla i campi segnati.");
      return false;
    }
    changeForm(item, form);
    flush(item.id);
    memory.unskip([item.id]);
    setNotice(null);
    return true;
  }

  /** Una risposta che parte subito: dato personale, aggiornamento, chiarimento. */
  async function sendNow(item: ReferentItemView, intent: ReferentIntent): Promise<boolean> {
    if (!writable) return false;
    const form = { ...(formsRef.current[item.id] ?? initialForm(item)), intent };
    const files = usableIds(attachmentsRef.current[item.id]);
    const action = intentAction(intent);
    const check = checkSubmit(item, form, action, files, new Date());
    if (!check.ok) {
      setIssues((f) => ({ ...f, [item.id]: check.errors }));
      say(check.errors[0]?.message ?? "Controlla i campi segnati.");
      return false;
    }
    forget(item.id);
    setBusy(true);
    const r = await postJson<SubmittedAnswer>(token, `items/${encodeURIComponent(item.id)}/answer`, answerBody(item, form, action, files));
    setBusy(false);
    if (!r.ok) {
      if (r.code === "link_non_valido") {
        setInvalid(true);
        return false;
      }
      setIssues((f) => ({ ...f, [item.id]: r.issues.length > 0 ? r.issues : [{ code: r.code, message: r.message }] }));
      say(r.message);
      if (r.code === "conflitto" || r.code === "voce_non_disponibile" || r.code === "stato_non_ammesso") await refresh();
      return false;
    }
    memory.unskip([item.id]);
    say("Inviata.");
    await refresh([item.id]);
    return true;
  }

  function onNext(item: ReferentItemView, intent: ReferentIntent) {
    const immediate = item.personal || item.can.newVersionOnly || route.screen === "voce";
    if (immediate) {
      const lastOfRound = !stepInfo || stepInfo.n >= stepInfo.steps.length;
      const topic = route.screen === "passo" ? route.topic : null;
      void sendNow(item, intent).then((ok) => {
        if (!ok) return;
        if (route.screen === "voce") {
          setNotice({ tone: "ok", text: "Risposta inviata. Lateral Space la controlla e ti scrive solo se serve un chiarimento." });
          go({ screen: "home" });
        } else if (lastOfRound) {
          // Era l'ultima del giro: si passa al riepilogo (o alla Home se non c'è niente da inviare).
          go(topic ? { screen: "invia", topic } : { screen: "home" }, { replace: true });
        }
        // Altrimenti la domanda inviata esce dal giro e lo stesso numero mostra già la successiva.
      });
      return;
    }
    if (decide(item, intent)) {
      if (intent === "non_so") say("Salvato: «Non lo so».");
      advance();
    }
  }

  function later(fn: () => void) {
    if (reduced) fn();
    else window.setTimeout(fn, 300);
  }

  function onConfirm(item: ReferentItemView) {
    if (!decide(item, "conferma")) return;
    say("Confermato.");
    later(advance);
  }

  function onPicked(item: ReferentItemView) {
    if (!decide(item, "risposta")) return;
    later(advance);
  }

  function onSkip(item: ReferentItemView) {
    memory.skip(item.id);
    advance();
  }

  // ── Invio dell'argomento ────────────────────────────────────────────

  function scopeItems(scope: string): ReferentItemView[] {
    if (scope === QUICK) return items.filter((i) => ready.has(i.id));
    const mod = moduleById(scope);
    return mod ? topicSteps(mod).filter((i) => ready.has(i.id)) : [];
  }

  async function sendScope(scope: string) {
    if (!writable) return;
    const toSend = scopeItems(scope).filter(sendsInBatch);
    if (toSend.length === 0) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setReview({ scope, failures: {}, partial: null, offline: true });
      say("Sei offline: per inviare serve la connessione.");
      return;
    }
    // Le risposte sostituiscono le bozze: nessun salvataggio automatico deve partire in mezzo.
    for (const item of toSend) forget(item.id);
    setBusy(true);
    setReview(null);
    const entries = toSend.map((item) => batchEntry(item, formsRef.current[item.id] ?? initialForm(item), usableIds(attachmentsRef.current[item.id])));
    const failures: Record<string, string> = {};
    const sent: string[] = [];
    for (const chunk of chunkBatch(entries)) {
      const r = await postAnswers<BatchAnswersResult>(token, chunk);
      if (!r.ok) {
        if (r.code === "link_non_valido") {
          setBusy(false);
          setInvalid(true);
          return;
        }
        for (const e of chunk) failures[String(e.item_id)] = r.message;
        if (r.status === 0) break;
        continue;
      }
      for (const result of r.data.results) {
        if (result.ok) sent.push(result.itemId);
        else failures[result.itemId] = result.message;
      }
    }
    memory.unskip(sent);
    // Quelle non partite restano bozze: di nuovo in salvataggio, sul server e sul telefono.
    for (const item of toSend) {
      if (failures[item.id] !== undefined) schedule({ item, form: formsRef.current[item.id] ?? initialForm(item), fileIds: usableIds(attachmentsRef.current[item.id]) });
    }
    await refresh(sent);
    setBusy(false);
    const failed = Object.keys(failures).length;
    if (failed === 0) {
      say("Inviate.");
      go({ screen: "inviate", topic: scope }, { replace: true });
    } else {
      setReview({ scope, failures, partial: { sent: sent.length, failed }, offline: false });
      say(`${sent.length} inviate, ${failed} da sistemare.`);
    }
  }

  // ── Delega, chiarimenti, firme, informativa ─────────────────────────

  async function delegate(f: DelegateForm): Promise<DelegateResult> {
    const r = await postJson<DelegationResult>(token, "delegate", delegateBody(f));
    if (!r.ok) {
      if (r.code === "link_non_valido") setInvalid(true);
      return { ok: false, message: r.message, issues: r.issues };
    }
    for (const id of f.voci) forget(id);
    memory.unskip(f.voci);
    await refresh(f.voci);
    say("Fatto.");
    return { ok: true, status: r.data.status, items: r.data.items, link: r.data.link };
  }

  async function sendClarification(item: ReferentItemView) {
    const ok = await sendNow(item, "risposta");
    if (!ok) return;
    setNotice({ tone: "ok", text: "Grazie: abbiamo inviato la tua risposta al chiarimento." });
    go({ screen: "home" }, { replace: true });
  }

  async function decideApproval(body: Record<string, unknown>): Promise<ApprovalOutcome> {
    const r = await postJson<{ complete: boolean }>(token, "approve", body);
    if (!r.ok) {
      if (r.code === "link_non_valido") setInvalid(true);
      if (r.code === "testo_cambiato" || r.code === "approvazione_non_trovata") await refresh();
      return { ok: false, message: r.message };
    }
    // L'esito lo scrive il passo della firma con le frasi di `/firme` (anche dopo «Non approvo»): niente avviso sopra.
    await refresh();
    return { ok: true, message: "", complete: r.data.complete };
  }

  async function acknowledge() {
    setPrivacyBusy(true);
    setPrivacyError(null);
    const r = await postJson<{ version: string }>(token, "privacy-ack", { version: view.privacy.version });
    setPrivacyBusy(false);
    if (r.ok) {
      setPrivacyAck(true);
      return;
    }
    if (r.code === "link_non_valido") {
      setInvalid(true);
      return;
    }
    setPrivacyError(r.code === "informativa_cambiata" ? r.message : "Non riesco a registrarlo. Riprova tra poco.");
    if (r.code === "informativa_cambiata") await refresh();
  }

  // ── Schermate ───────────────────────────────────────────────────────

  const liveRegion = (
    <p className="sr-only" aria-live="polite" role="status">
      {announce}
    </p>
  );

  if (invalid) {
    return (
      <ReferentShell>
        <InvalidLinkCard />
      </ReferentShell>
    );
  }

  if (live && !privacyAck) {
    return (
      <ReferentShell>
        <PrivacyGate clientLabel={view.clientLabel} busy={privacyBusy} error={privacyError} disabled={!live} onAcknowledge={() => void acknowledge()} />
        {liveRegion}
      </ReferentShell>
    );
  }

  const homeNotice = notice ? (
    <Notice tone={notice.tone} className="mt-0">
      {notice.text}
    </Notice>
  ) : null;

  if (view.mode === "approvazioni") {
    return (
      <ReferentShell>
        <section aria-labelledby={SCREEN_TITLE_ID} className="mt-4 space-y-4">
          <div className="space-y-1">
            <ClientLine clientLabel={view.clientLabel} />
            <ScreenTitle>{view.greetingName ? `Ciao ${view.greetingName}` : "Ciao"}</ScreenTitle>
          </div>
          {view.paused ? <Notice tone="attenzione">Il caso è in pausa. Ti scriviamo quando riparte.</Notice> : null}
          {homeNotice}
        </section>
        <ApprovalsView approvals={view.approvals} disabled={!writable} onDecide={decideApproval} />
        {liveRegion}
      </ReferentShell>
    );
  }

  const homeScreen = (
    <ReferenteHome
      clientLabel={view.clientLabel}
      greetingName={view.greetingName}
      plan={plan}
      expiresAt={view.expiresAt}
      now={now}
      narrow={narrow}
      topicHref={(t) => topicEntryHash(t, memory.introSeen, ready)}
      notice={homeNotice}
      preview={readOnly}
      paused={view.paused}
    />
  );

  let screen: React.ReactNode = homeScreen;
  if (writable) {
    const r: ReferentRoute = route;
    if (r.screen === "intro") {
      const topic = topicById(r.topic);
      if (topic) {
        screen = (
          <ModuleIntro
            topic={topic}
            delegateItemId={view.delegation.allowed ? (topic.steps.find((id) => byId.get(id)?.can.delegate) ?? null) : null}
            onStart={() => {
              memory.seeIntro(topic.id);
              go({ screen: "passo", topic: topic.id, n: Math.max(1, topic.steps.findIndex((id) => !ready.has(id)) + 1) }, { replace: true });
            }}
          />
        );
      }
    } else if ((r.screen === "passo" || r.screen === "veloci" || r.screen === "voce") && (stepInfo || r.screen === "voce")) {
      const steps = r.screen === "voce" ? [byId.get(r.itemId)].filter((i): i is ReferentItemView => Boolean(i && i.can.answer)) : stepInfo!.steps;
      const n = r.screen === "voce" ? 1 : stepInfo!.n;
      const current = steps[n - 1];
      if (current && current.clarification !== null) {
        screen = (
          <ClarificationScreen
            item={current}
            token={token}
            form={forms[current.id] ?? initialForm(current)}
            attachments={attachments[current.id] ?? []}
            issues={issuesFor(current.id)}
            busy={busy}
            narrow={narrow}
            onForm={(next) => changeForm(current, next)}
            onAttachments={(next) => changeAttachments(current, next)}
            onSend={() => void sendClarification(current)}
          />
        );
      } else if (current) {
        screen = (
          <StepRunner
            steps={steps}
            n={n}
            contextFor={contextFor}
            backHref={referentHash({ screen: "home" })}
            token={token}
            forms={forms}
            attachments={attachments}
            issues={Object.fromEntries(steps.map((i) => [i.id, issuesFor(i.id)]))}
            busy={busy}
            narrow={narrow}
            savedFor={(item) => changed.has(item.id) && autosave.states[item.id] === "saved"}
            immediateFor={(item) => item.personal || item.can.newVersionOnly || r.screen === "voce"}
            delegateHrefFor={delegateHrefFor}
            inRound={r.screen !== "voce"}
            onForm={changeForm}
            onAttachments={changeAttachments}
            onNext={onNext}
            onConfirm={onConfirm}
            onSkip={onSkip}
            onPicked={onPicked}
          />
        );
      }
    } else if (r.screen === "invia") {
      const scope = r.topic;
      const topic = scope === QUICK ? null : topicById(scope);
      const rows: ReviewRow[] = scopeItems(scope).map((item) => {
        const quickAt = round.findIndex((i) => i.id === item.id) + 1;
        const editHref = scope === QUICK && quickAt > 0 ? referentHash({ screen: "veloci", n: quickAt }) : stepHashFor(item);
        return {
          id: item.id,
          title: item.title,
          summary: answerSummary(item, forms[item.id] ?? initialForm(item), usableIds(attachments[item.id])),
          editHref,
          failure: review?.scope === scope ? (review.failures[item.id] ?? null) : null,
        };
      });
      const openSteps = topic ? topic.steps.filter((id) => !ready.has(id)) : round.filter((i) => !ready.has(i.id)).map((i) => i.id);
      const firstOpen = openSteps[0];
      const laterHref = firstOpen
        ? topic
          ? referentHash({ screen: "passo", topic: topic.id, n: topic.steps.indexOf(firstOpen) + 1 })
          : referentHash({ screen: "veloci", n: round.findIndex((i) => i.id === firstOpen) + 1 })
        : referentHash({ screen: "home" });
      screen = (
        <ModuleReview
          backHref={firstOpen || rows.length > 0 ? laterHref : referentHash({ screen: "home" })}
          backLabel={topic ? topic.title : "Le più veloci"}
          rows={rows}
          later={openSteps.length > 0 ? { count: openSteps.length, href: laterHref } : null}
          sending={busy}
          offline={review?.scope === scope && review.offline}
          partial={review?.scope === scope ? review.partial : null}
          onSend={() => void sendScope(scope)}
        />
      );
    } else if (r.screen === "inviate") {
      const next = nextTopic(plan.topics, r.topic === QUICK ? null : r.topic);
      screen = <SentScreen next={next} nextHref={next ? topicEntryHash(next, memory.introSeen, ready) : null} />;
    } else if (r.screen === "collega") {
      const item = byId.get(r.itemId);
      const mod = item ? moduleOf(view, item.id) : undefined;
      if (item && mod && item.can.delegate && view.delegation.allowed) {
        const topicItems = mod.items.filter((i) => i.can.delegate && !i.done).map((i) => ({ id: i.id, title: i.title }));
        const groups = view.modules
          .map((m) => ({ title: m.title, items: m.items.filter((i) => i.can.delegate && !i.done).map((i) => ({ id: i.id, title: i.title })) }))
          .filter((g) => g.items.length > 0);
        // «‹ Indietro» torna da dove si è partiti (DESIGN §4.1, §4.3 R5): l'inizio
        // dell'argomento per «Gira tutto l'argomento», altrimenti la domanda.
        const backHref = r.wholeTopic ? referentHash({ screen: "intro", topic: topicId(mod) }) : stepHashFor(item);
        screen = (
          <DelegateScreen
            key={`${item.id}:${r.wholeTopic ? 1 : 0}`}
            itemId={item.id}
            topicTitle={mod.title}
            topicItems={topicItems}
            groups={groups}
            emailConfigured={view.emailConfigured}
            wholeTopic={r.wholeTopic === true}
            backHref={backHref}
            onDelegate={delegate}
          />
        );
      }
    } else if (r.screen === "chiarimento") {
      const item = byId.get(r.itemId);
      if (item && item.clarification !== null && item.can.answer) {
        screen = (
          <ClarificationScreen
            item={item}
            token={token}
            form={forms[item.id] ?? initialForm(item)}
            attachments={attachments[item.id] ?? []}
            issues={issuesFor(item.id)}
            busy={busy}
            narrow={narrow}
            onForm={(next) => changeForm(item, next)}
            onAttachments={(next) => changeAttachments(item, next)}
            onSend={() => void sendClarification(item)}
          />
        );
      }
    }
  }

  return (
    <ReferentShell>
      <FileDeclarationContext value={fileDeclaration}>{screen}</FileDeclarationContext>
      {liveRegion}
    </ReferentShell>
  );
}
