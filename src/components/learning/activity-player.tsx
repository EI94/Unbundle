"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronRight, CircleCheck, CircleX, Download, LoaderCircle, RotateCcw, Send, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { startLearningAttempt, saveLearningDraft, submitLearningAttempt, submitLearningDecisions, startLearningRetake } from "@/lib/learning/client";
import type { AttemptDTO } from "@/lib/learning/server";
import type { AttemptResponses, LearnerActivityDTO } from "@/lib/learning/types";
import { useLearningUnsavedChanges } from "./use-unsaved-changes";
import { LearningRefresh } from "./learning-refresh";
import { downloadLearningDraft } from "./download-draft";
import { createAcknowledgedMemory } from "@/lib/learning/acknowledged-memory";
import { LEARNING_TEXT } from "@/lib/learning/text";
import { confirmDescription, exerciseProgress, problemSentence, readableDraft } from "@/lib/learning/exercise-view";

const EX = LEARNING_TEXT.exercise;

// Memory only: an accidental SPA back/forward navigation must not discard a
// draft. Keys are server-authorized attempt UUIDs, never a shared activity ID.
const pendingDrafts = new Map<string, { responses: AttemptResponses; revision: number }>();
const acknowledgedAttempts = createAcknowledgedMemory<AttemptDTO>();
const attemptScope = (workspaceId: string, programId: string, userId: string, version: string, activityId: string) => JSON.stringify([workspaceId, programId, userId, version, activityId]);

const modeCopy: Record<string, { title: string; hint: string }> = {
  execute_authorized_assistant: { title: "Ho usato Claude Cowork", hint: "Ho fatto l’esercizio in Cowork con i file di esempio." },
  review_reference_output: { title: "Ho letto l’esempio qui", hint: "Non ho usato l’AI: ho letto l’esempio preparato." },
};
const modeTitle = (mode: string) => modeCopy[mode]?.title ?? mode;

const SAVED = "Salvato";
const SAVING = "Salvataggio…";
const bigButton = "h-12 w-full px-6 text-base sm:w-auto";
const answerRow = cn(
  "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border bg-background px-4 py-3 text-base transition-colors hover:bg-muted/60",
  "has-[:checked]:border-foreground has-[:checked]:bg-muted has-[:checked]:ring-1 has-[:checked]:ring-foreground",
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:disabled]:cursor-default",
);
const radioInput = "size-5 shrink-0 accent-foreground";
const heading = "outline-none";

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}
function introLine(active: LearnerActivityDTO) {
  const parts = [
    `${plural(active.items.length, "domanda", "domande")}${active.type === "case_review" ? " sul caso" : ""}`,
    `circa ${plural(active.estimatedMinutes, "minuto", "minuti")}`,
  ];
  if (active.aiAssistance === "not_allowed") parts.push("rispondi da solo, senza AI");
  return parts.join(" · ");
}
function correctLine(correct: number, total: number) {
  return `${correct} ${correct === 1 ? "risposta giusta" : "risposte giuste"} su ${total}`;
}

const CASE_STEPS = ["Rispondi", "Confronta", "Risultato"];
function CaseSteps({ current }: { current: number }) {
  return <ol aria-label="Passaggi dell’esercizio" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:gap-x-2">
    {CASE_STEPS.map((label, index) => {
      const step = index + 1;
      const done = step < current;
      const here = step === current;
      return <li key={label} aria-current={here ? "step" : undefined} className="flex items-center gap-2">
        {index > 0 && <span aria-hidden className="hidden h-px w-8 bg-border sm:block" />}
        <span aria-hidden className={cn("flex size-7 items-center justify-center rounded-full text-xs font-semibold",
          here ? "bg-foreground text-background" : done ? "bg-uc-verde-bg text-uc-verde" : "border text-muted-foreground")}>
          {done ? <Check className="size-4" /> : step}
        </span>
        <span className={here ? "font-medium" : "text-muted-foreground"}>{label}<span className="sr-only">{done ? " (fatto)" : ""}</span></span>
      </li>;
    })}
  </ol>;
}

function CaseCard({ activity }: { activity: LearnerActivityDTO }) {
  const material = activity.case;
  if (!material) return null;
  return <section aria-label="Il caso" className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
    <div>
      <p className="text-xs font-medium text-muted-foreground">Il caso · dati inventati</p>
      {material.title !== activity.title && <h3 className="mt-1 text-lg font-semibold">{material.title}</h3>}
    </div>
    {material.text && <p className="whitespace-pre-wrap break-words">{material.text}</p>}
    {material.preparedBadOutput && <div className="rounded-xl border border-uc-giallo/40 bg-uc-giallo-bg p-4">
      <p className="mb-2 text-sm font-semibold text-uc-giallo">La bozza da controllare</p>
      <p className="whitespace-pre-wrap break-words">{material.preparedBadOutput}</p>
    </div>}
    {material.task && <div className="space-y-1">
      <p className="text-sm font-semibold">Il compito</p>
      <p className="whitespace-pre-wrap break-words">{material.task}</p>
    </div>}
  </section>;
}

function ExampleCard({ example }: { example: NonNullable<AttemptDTO["caseExample"]> }) {
  return <section aria-label="L’esempio preparato" className="space-y-3 rounded-2xl border border-uc-verde/40 bg-uc-verde-bg p-4 sm:p-5">
    <h3 className="text-lg font-semibold">L’esempio preparato</h3>
    <p className="text-sm text-muted-foreground">Confrontalo con quello che hai ottenuto in Cowork, oppure leggilo qui.</p>
    <p className="whitespace-pre-wrap break-words">{example.referenceOutput}</p>
    {example.prompt && <details className="rounded-xl border bg-background px-3 py-2">
      <summary className="min-h-11 cursor-pointer py-2 font-medium">Il prompt usato</summary>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{example.prompt}</p>
    </details>}
  </section>;
}

type PlayerProps = {
  workspaceId: string; programId: string; userId: string; version: string; activity: LearnerActivityDTO; initialAttempt: AttemptDTO | null;
};
export function ActivityPlayer(props: PlayerProps) {
  // A refreshed server revision reloads acknowledged answers. Unsaved answers
  // survive in the attempt-scoped memory entry with their original revision.
  return <ActivityPlayerForm key={`${props.initialAttempt?.id ?? "new"}:${props.initialAttempt?.revision ?? 0}`} {...props} />;
}
function ActivityPlayerForm({ workspaceId, programId, userId, version, activity, initialAttempt }: PlayerProps) {
  const router = useRouter();
  const memoryScope = attemptScope(workspaceId, programId, userId, version, activity.id);
  // Letti una volta, al primo rendering (stato iniziale, non un ref letto a ogni rendering).
  const [initialContent] = useState(() => acknowledgedAttempts.restore(memoryScope, initialAttempt));
  const restoredAcknowledgement = initialContent !== initialAttempt;
  const [attempt, setAttempt] = useState(initialContent);
  const [mutationAccess, setMutationAccess] = useState<{ source: AttemptDTO | null; attempt: AttemptDTO } | null>(null);
  const [recovered] = useState(() => (initialContent?.status === "draft" ? pendingDrafts.get(initialContent.id) : undefined));
  const [responses, setResponses] = useState<AttemptResponses>(() => recovered?.responses ?? initialContent?.responses ?? { answers: {}, fields: {} });
  const current = useRef(responses);
  const revision = useRef(recovered?.revision ?? initialContent?.revision ?? 1);
  const edits = useRef(recovered ? 1 : 0);
  const acknowledged = useRef(0);
  const inFlight = useRef(false);
  const submitKey = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(recovered ? "Abbiamo ritrovato risposte non ancora salvate: le salviamo ora." : restoredAcknowledgement && initialContent?.status !== "submitted" ? "Abbiamo ritrovato le ultime risposte salvate." : "");
  const [denied, setDenied] = useState<{ source: AttemptDTO | null; reason: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);
  const errorBox = useRef<HTMLDivElement>(null);
  const active = attempt?.activity ?? activity;
  const decisionsPending = active.type === "case_review" && !attempt?.decisionsSubmittedAt;
  // (Ondata 7a) La conferma prima dell'invio è una finestra breve (`reviewing`), non più una fase con l'elenco delle risposte.
  const phase = !attempt ? "start" : attempt.status === "submitted" && attempt.result ? "feedback" : decisionsPending || active.type !== "case_review" ? "questions" : "reflection";
  const previousPhase = useRef(phase);
  const phaseHeading = useRef<HTMLHeadingElement>(null);
  const base = `/dashboard/${workspaceId}/learning/${programId}`;
  const activityPath = `${base}/activities/${activity.id}`;
  // A mutation response is current until a fresh server page arrives.
  const serverAccess = mutationAccess?.source === initialAttempt ? mutationAccess.attempt : initialAttempt?.id === attempt?.id ? initialAttempt : null;
  const deniedReason = denied?.source === initialAttempt ? denied.reason : null;
  const readOnly = !!attempt && (serverAccess?.writeAccess !== true || !!deniedReason);
  const readOnlyReason = deniedReason ?? serverAccess?.readOnlyReason ?? (!serverAccess ? "Le tue risposte sono salvate. Aggiorna la pagina per continuare." : null);
  const canRetake = !!serverAccess?.canRetake && !deniedReason;
  useLearningUnsavedChanges({
    // I due contatori cambiano sempre insieme a uno stato (`setResponses` a ogni modifica, `setBusy` a
    // ogni salvataggio): il rendering che li legge è quello dopo il cambio, mai uno vecchio.
    // eslint-disable-next-line react-hooks/refs -- contatori scritti dai gestori, letti dopo il loro rendering
    dirty: edits.current !== acknowledged.current,
    pending: busy,
    onDiscard: () => {
      if (attempt) pendingDrafts.delete(attempt.id);
      current.current = attempt?.responses ?? { answers: {}, fields: {} };
      setResponses(current.current);
      acknowledged.current = edits.current;
      setMessage("Modifiche non salvate scartate. Restano le risposte già salvate.");
    },
  });

  const update = (next: AttemptResponses) => {
    current.current = next;
    edits.current += 1;
    setResponses(next);
    if (attempt) pendingDrafts.set(attempt.id, { responses: structuredClone(next), revision: revision.current });
    setMessage(SAVING);
    if (problem !== "conflict") setProblem(null);
    setErrors({});
  };

  const save = useCallback(async (): Promise<boolean> => {
    if (!attempt || attempt.status !== "draft" || readOnly || inFlight.current) return false;
    if (edits.current === acknowledged.current) return true;
    if (!navigator.onLine) {
      setProblem("offline");
      setMessage("Sei senza connessione: le ultime risposte non sono salvate. Lascia aperta la pagina e premi Riprova quando torna la rete.");
      return false;
    }
    const sentEdits = edits.current;
    const sentMemory = pendingDrafts.get(attempt.id);
    const sentResponses = structuredClone(current.current);
    inFlight.current = true;
    setBusy(true);
    setMessage(SAVING);
    try {
      const result = await saveLearningDraft({ workspaceId, programId, attemptId: attempt.id, expectedRevision: revision.current, responses: sentResponses });
      if (!result.ok) {
        setProblem(result.code);
        if (result.code === "closed" || result.code === "forbidden") setDenied({ source: initialAttempt, reason: result.message });
        setMessage(result.message);
        setErrors(result.fieldErrors ?? {});
        return false;
      }
      acknowledgedAttempts.remember(memoryScope, result.data);
      revision.current = result.data.revision;
      acknowledged.current = sentEdits;
      // A late ACK from an unmounted player must not erase edits made by a
      // newer player after Back/Forward navigation. Object identity is the
      // generation token; every edit creates a new entry.
      if (pendingDrafts.get(attempt.id) === sentMemory) {
        if (edits.current === sentEdits) pendingDrafts.delete(attempt.id);
        else pendingDrafts.set(attempt.id, { responses: structuredClone(current.current), revision: revision.current });
      }
      setAttempt(result.data);
      setMutationAccess({ source: initialAttempt, attempt: result.data });
      setProblem(null);
      setMessage(edits.current === sentEdits ? SAVED : SAVING);
      return edits.current === sentEdits;
    } catch {
      setProblem("technical");
      setMessage("Il salvataggio non è stato confermato. Le risposte restano qui: premi Riprova.");
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [attempt, workspaceId, programId, readOnly, initialAttempt, memoryScope]);

  useEffect(() => {
    if (!attempt || attempt.status !== "draft" || readOnly || problem || busy || reviewing || edits.current === acknowledged.current) return;
    const timer = setTimeout(() => { void save(); }, 900);
    return () => clearTimeout(timer);
  }, [responses, attempt, save, problem, busy, reviewing, readOnly]);

  useEffect(() => { if (Object.keys(errors).length) errorBox.current?.focus(); }, [errors]);

  useEffect(() => {
    if (previousPhase.current === phase) return;
    previousPhase.current = phase;
    // Only a deliberate phase change moves focus, never mount or an autosave.
    // Field errors retain priority over the destination heading.
    if (!Object.keys(errors).length) phaseHeading.current?.focus();
  }, [phase, errors]);

  // (Ondata 7a) La copia in parole: le domande con la risposta scelta, i testi, come si è lavorato. Niente id né JSON.
  const backup = () => downloadLearningDraft("le-mie-risposte.txt", readableDraft(active, current.current, modeTitle));
  // Senza modifiche da salvare, Riprova toglie l'avviso: si continua con «Controlla e invia».
  const retry = () => {
    if (edits.current === acknowledged.current) { setProblem(null); setMessage(""); return; }
    void save();
  };

  const start = async () => {
    setBusy(true);
    try {
      const result = await startLearningAttempt({ workspaceId, programId, activityId: activity.id, expectedUserId: userId, expectedVersion: version });
      if (!result.ok) { setProblem(result.code); setMessage(result.message); return; }
      acknowledgedAttempts.remember(memoryScope, result.data);
      const pending = result.data.status === "draft" ? pendingDrafts.get(result.data.id) : undefined;
      revision.current = pending?.revision ?? result.data.revision;
      setAttempt(result.data);
      setMutationAccess({ source: initialAttempt, attempt: result.data });
      current.current = pending?.responses ?? result.data.responses;
      edits.current = pending ? 1 : 0;
      acknowledged.current = 0;
      setResponses(current.current);
      setMessage(pending ? "Abbiamo ritrovato risposte non ancora salvate: le salviamo ora." : "");
    } catch { setMessage("Non è stato possibile iniziare. Riprova: nessuna risposta è stata inviata."); }
    finally { setBusy(false); }
  };

  const prepareSubmit = async () => {
    if (readOnly || busy) return;
    const fieldErrors: Record<string, string> = {};
    for (const item of active.items) if (!current.current.answers[item.id]) fieldErrors[item.id] = "scegli una risposta.";
    for (const field of decisionsPending ? [] : active.requiredTextFields) {
      const value = current.current.fields[field.id]?.trim() ?? "";
      if (value.length < field.minChars || value.length > field.maxChars) fieldErrors[field.id] = value.length < field.minChars ? `scrivi almeno ${field.minChars} caratteri.` : `massimo ${field.maxChars} caratteri.`;
    }
    if (!decisionsPending && active.allowedModes.length && !active.allowedModes.includes(current.current.mode ?? "")) fieldErrors.mode = "scegli come hai lavorato.";
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return;
    if (await save()) setReviewing(true);
  };

  const submit = async () => {
    if (!attempt || readOnly || inFlight.current || edits.current !== acknowledged.current) return;
    inFlight.current = true;
    setBusy(true);
    submitKey.current ??= crypto.randomUUID();
    try {
      const result = decisionsPending
        ? await submitLearningDecisions({ workspaceId, programId, attemptId: attempt.id, expectedRevision: revision.current })
        : await submitLearningAttempt({ workspaceId, programId, attemptId: attempt.id, expectedRevision: revision.current, idempotencyKey: submitKey.current });
      if (!result.ok) { setReviewing(false); setProblem(result.code); setMessage(result.message); setErrors(result.fieldErrors ?? {}); if (result.code === "closed" || result.code === "forbidden") setDenied({ source: initialAttempt, reason: result.message }); return; }
      acknowledgedAttempts.remember(memoryScope, result.data);
      revision.current = result.data.revision;
      setAttempt(result.data);
      setMutationAccess({ source: initialAttempt, attempt: result.data });
      setReviewing(false);
      setProblem(null);
      setMessage(decisionsPending ? "Risposte inviate. Ora confronta con l’esempio." : "");
    } catch { setReviewing(false); setProblem("technical"); setMessage("L’invio non è stato confermato. Premi di nuovo Invia: le risposte non verranno inviate due volte."); }
    finally { inFlight.current = false; setBusy(false); }
  };

  const retake = async () => {
    if (!attempt || !canRetake || busy) return;
    setBusy(true);
    try {
      const result = await startLearningRetake({ workspaceId, programId, parentAttemptId: attempt.id });
      if (!result.ok) { setMessage(result.message); if (result.code === "closed" || result.code === "forbidden") setDenied({ source: initialAttempt, reason: result.message }); return; }
      acknowledgedAttempts.remember(attemptScope(workspaceId, programId, userId, version, result.data.activityId), result.data);
      router.push(`${base}/attempts/${result.data.id}`);
    } catch { setMessage("Non è stato possibile aprire una nuova prova. Riprova: il risultato di prima resta salvato."); }
    finally { setBusy(false); }
  };

  const isCase = active.type === "case_review";
  const step = phase === "feedback" ? 3 : decisionsPending ? 1 : 2;
  const answered = active.items.filter((item) => !!responses.answers[item.id]).length;
  const hasErrors = Object.keys(errors).length > 0;
  const optionText = (itemId: string, optionId: string | null | undefined) => active.items.find((item) => item.id === itemId)?.options.find((option) => option.id === optionId)?.text;
  const errorLabel = (id: string) => {
    const index = active.items.findIndex((item) => item.id === id);
    if (index >= 0) return `Domanda ${index + 1}`;
    if (id === "mode") return "Come hai lavorato";
    const field = active.requiredTextFields.find((entry) => entry.id === id);
    if (field) return field.label;
    return null;
  };
  const noAnswersYet = answered === 0 && !Object.values(responses.fields).some(Boolean) && !responses.mode;
  const quietStatus = message || (attempt?.status === "draft" && !readOnly ? (noAnswersYet ? "Le risposte si salvano da sole." : SAVED) : "");

  const errorList = hasErrors && <div ref={errorBox} tabIndex={-1} role="alert" className="rounded-xl border border-uc-giallo/40 bg-uc-giallo-bg p-4 text-sm outline-none">
    <p className="font-medium">Prima di inviare, completa:</p>
    <ul className="mt-2 list-disc space-y-1 pl-5">{Object.entries(errors).map(([id, error]) => {
      const label = errorLabel(id);
      return <li key={id}><a className="underline underline-offset-4" href={`#field-${id}`}>{label ? `${label}: ${error}` : error}</a></li>;
    })}</ul>
  </div>;

  // Commento e «Come hai lavorato»: nel caso guidato dopo l'esempio, altrimenti
  // sotto le domande. Se il corso li chiede, devono essere sempre a vista.
  const commentAndMode = <>
    {active.requiredTextFields.map((field) => <div key={field.id} className="space-y-2">
      <label className="block text-base font-medium" htmlFor={`field-${field.id}`}>{field.label}</label>
      <Textarea id={`field-${field.id}`} rows={4} className="min-h-28 text-base md:text-base" readOnly={readOnly} maxLength={field.maxChars} value={responses.fields[field.id] ?? ""} aria-invalid={!!errors[field.id]} aria-describedby={`help-${field.id}`} onChange={(event) => update({ ...current.current, fields: { ...current.current.fields, [field.id]: event.target.value } })} />
      <p id={`help-${field.id}`} className={cn("text-sm", errors[field.id] ? "font-medium text-uc-giallo" : "text-muted-foreground")}>{errors[field.id] ? `${field.label}: ${errors[field.id]}` : `Basta una frase (almeno ${field.minChars} caratteri).`}</p>
    </div>)}
    {active.allowedModes.length > 0 && <fieldset id="field-mode" className="min-w-0 rounded-2xl border bg-card p-4 sm:p-5" aria-describedby={errors.mode ? "error-mode" : undefined}>
      <legend className="float-left w-full text-base font-medium">Come hai lavorato?</legend>
      <div className="clear-left grid gap-2 pt-3 sm:grid-cols-2">
        {active.allowedModes.map((mode) => <label key={mode} className={answerRow}>
          <input type="radio" className={radioInput} name="mode" value={mode} disabled={readOnly} checked={responses.mode === mode} onChange={() => update({ ...current.current, mode })} />
          <span className="min-w-0"><span className="block font-medium">{modeTitle(mode)}</span>{modeCopy[mode] && <span className="block text-sm text-muted-foreground">{modeCopy[mode].hint}</span>}</span>
        </label>)}
      </div>
      {errors.mode && <p id="error-mode" className="mt-3 text-sm font-medium text-uc-giallo">Come hai lavorato: {errors.mode}</p>}
    </fieldset>}
  </>;

  const saveStatus = <p role="status" aria-live="polite" className="flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground">
    {!problem && quietStatus === SAVING && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
    {!problem && quietStatus === SAVED && <Check aria-hidden className="size-3.5" />}
    {problem ? "" : quietStatus}
  </p>;

  /**
   * (Ondata 7a, PROPOSTA-10 §3.9) La barra fissa in fondo: un numero solo («3 di 5»), lo stato del salvataggio accanto e
   * «Invia», il solo pulsante pieno; la conferma breve si apre nella finestra dell'app.
   */
  const bar = (step: "decisions" | "reflection" | "questions") => {
    const progress = exerciseProgress(active, responses, step);
    return <div data-slot="exercise-bar" className="sticky bottom-0 z-10 -mx-4 flex items-center gap-3 border-t bg-background px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="min-w-0 flex-1">
        {progress.total > 0 && <p className="text-base font-semibold tabular-nums" data-testid="learning-progress">
          <span className="sr-only">{EX.progressLabel}: </span>{EX.progress(progress.done, progress.total)}
        </p>}
        {saveStatus}
      </div>
      <Button data-testid="learning-submit" className="min-h-11 px-6 sm:min-h-9" onClick={prepareSubmit} disabled={busy || readOnly || problem === "conflict"}>
        <Send aria-hidden data-icon="inline-start" />{EX.send}
      </Button>
    </div>;
  };

  /** Le azioni di riserva di un problema: chiuse, a un tocco. */
  const moreOptions = (refresh: boolean) => <details className="group">
    <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-md text-sm font-medium underline decoration-foreground/40 underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-9 [&::-webkit-details-marker]:hidden">
      {EX.more}<ChevronRight aria-hidden className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
    </summary>
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={backup}><Download aria-hidden data-icon="inline-start" />{EX.copy}</Button>
      {refresh && <LearningRefresh label={EX.refresh} className="min-h-11 sm:min-h-9" />}
      {attempt && <a className="inline-flex min-h-11 items-center underline underline-offset-4 sm:min-h-9" href={activityPath} target="_blank" rel="noopener noreferrer">{EX.openSaved}</a>}
      {(problem === "unauthenticated" || problem === "technical") && <a className="inline-flex min-h-11 items-center underline underline-offset-4 sm:min-h-9" target="_blank" rel="noopener noreferrer" href={`/login?session=stale&callbackUrl=${encodeURIComponent(activityPath)}`}>{EX.signIn}</a>}
    </div>
  </details>;

  return <div className="space-y-6">
    <header className="space-y-4">
      <p className="text-base text-muted-foreground">{introLine(active)}</p>
      {isCase && <CaseSteps current={step} />}
    </header>

    {attempt?.status === "draft" && readOnly && <div className="space-y-2 rounded-xl border border-uc-giallo/40 bg-uc-giallo-bg p-4 text-sm" role="status">
      <p className="font-medium">{readOnlyReason ?? EX.readOnly}</p>
      <p>{EX.unsavedHere}</p>
      {moreOptions(true)}
    </div>}
    {problem && !(readOnly && attempt?.status === "draft") && <div className="space-y-2 rounded-xl border border-uc-giallo/40 bg-uc-giallo-bg p-4 text-sm" role="alert">
      <p className="flex items-start gap-2 font-medium">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-uc-giallo" />
        <span>{problemSentence(problem, message)}</span>
      </p>
      {problem === "conflict" && <p>{EX.conflictHelp}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {attempt && problem !== "conflict" && !reviewing && <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={retry} disabled={busy || readOnly}>{EX.retry}</Button>}
        {!attempt && <LearningRefresh label={EX.refresh} className="min-h-11 sm:min-h-9" />}
      </div>
      {attempt && moreOptions(problem === "conflict")}
    </div>}

    {!attempt ? <section className="space-y-4 rounded-2xl border bg-card p-5 sm:p-6">
      <p className="text-base">{isCase
        ? "Prima rispondi da solo alle domande sul caso. Poi confronti con un esempio preparato e vedi il risultato."
        : "Scegli una risposta per ogni domanda. Alla fine vedi subito quante sono giuste."}</p>
      {!active.completionGate && <p className="text-sm text-muted-foreground">Serve per ripassare: non conta per il risultato.</p>}
      <Button data-testid="learning-activity-start" className="h-12 w-full px-10 text-base sm:w-auto" onClick={start} disabled={busy}>{busy ? "Apertura…" : "Inizia"}</Button>
      <p role="status" aria-live="polite" className="text-sm">{problem ? "" : message}</p>
    </section> : phase === "feedback" && attempt.result ? (() => {
      const result = attempt.result;
      const order = (itemId: string) => { const index = active.items.findIndex((item) => item.id === itemId); return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
      const items = [...result.items].sort((a, b) => order(a.itemId) - order(b.itemId));
      const good = result.status !== "needs_practice";
      const headline = result.status === "formative_completed" ? "Fatto!" : result.status === "consolidated" ? "Obiettivo raggiunto" : "Da ripassare";
      const essential = result.essential_errors.length;
      const practice = active.purpose !== "formative";
      // Riprovare serve a chi deve ripassare: chi ha raggiunto l'obiettivo non
      // rischia di peggiorare il risultato per curiosità.
      const offerRetake = practice && result.status === "needs_practice";
      const retakeReason = deniedReason ?? (restoredAcknowledgement ? "Aggiorna la pagina per controllare." : serverAccess?.retakeUnavailableReason) ?? null;
      // (Ondata 7a, FO-16) Con «Da ripassare» il passo utile è riprovare: «Riprova l'esercizio» è il pulsante pieno.
      const retakeFirst = offerRetake && canRetake;
      return <>
        <section data-testid="learning-result-score" className={cn("space-y-3 rounded-2xl border p-5 sm:p-6", good ? "border-uc-verde/40 bg-uc-verde-bg" : "border-uc-giallo/40 bg-uc-giallo-bg")}>
          <div className="flex items-start gap-3">
            {good ? <CircleCheck aria-hidden className="mt-1 size-8 shrink-0 text-uc-verde" /> : <RotateCcw aria-hidden className="mt-1 size-8 shrink-0 text-uc-giallo" />}
            <div className="min-w-0">
              <h2 ref={phaseHeading} tabIndex={-1} className={cn(heading, "text-2xl font-semibold")}>{headline}</h2>
              <p className="mt-1 text-lg font-medium">{correctLine(result.correct, result.total)}</p>
            </div>
          </div>
          {result.status === "needs_practice" && <p>{canRetake ? "Rileggi le spiegazioni qui sotto e riprova quando vuoi." : "Rileggi le spiegazioni qui sotto."}</p>}
          {result.status === "formative_completed" && <p className="text-sm text-muted-foreground">Serviva per ripassare: non conta per il risultato.</p>}
          {essential > 0 && <p className="font-medium">{essential === 1 ? "Una risposta importante è da rivedere." : `${essential} risposte importanti sono da rivedere.`}</p>}
        </section>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {retakeFirst && <Button data-testid="learning-retake" className={bigButton} disabled={busy} onClick={retake}><RotateCcw aria-hidden />{busy ? EX.retakeOpening : EX.retake}</Button>}
          <Button render={<Link href={base} />} nativeButton={false} variant={retakeFirst ? "outline" : "default"} className={bigButton}>{EX.back}</Button>
        </div>
        {offerRetake && !canRetake && <div className="space-y-2 text-sm">
          <p className="font-medium">{EX.retakeBlocked}</p>
          {retakeReason && <p className="text-muted-foreground">{retakeReason}</p>}
          <LearningRefresh label={EX.refresh} className="min-h-11 sm:min-h-9" />
        </div>}
        <p role="status" aria-live="polite" className="text-sm">{message}</p>

        <ol className="space-y-3" aria-label="Le risposte, una per una">
          {items.map((item, index) => {
            const question = active.items.find((entry) => entry.id === item.itemId);
            const chosen = question?.options.find((option) => option.id === item.selectedOptionId)?.text;
            const rightId = attempt.answerKey?.[item.itemId];
            const right = rightId ? question?.options.find((option) => option.id === rightId)?.text : undefined;
            return <li key={item.itemId} data-testid="learning-result-item" className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
              <div className="flex items-start gap-3">
                {item.correct ? <CircleCheck aria-hidden className="mt-0.5 size-6 shrink-0 text-uc-verde" /> : <CircleX aria-hidden className="mt-0.5 size-6 shrink-0 text-uc-giallo" />}
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Domanda {index + 1} · {item.correct ? "giusta" : "da rivedere"}{item.critical && !item.correct ? " · importante" : ""}</p>
                  <h3 className="break-words text-base font-medium">{question?.prompt}</h3>
                </div>
              </div>
              <div className="space-y-1 text-sm sm:pl-9">
                <p><span className="text-muted-foreground">La tua risposta: </span><span className="font-medium">{chosen ?? "—"}</span></p>
                {!item.correct && right && <p><span className="text-muted-foreground">Risposta giusta: </span><span className="font-medium text-uc-verde">{right}</span></p>}
              </div>
              {item.feedback && <p className="rounded-xl bg-muted p-3 text-sm sm:ml-9">{item.feedback}</p>}
            </li>;
          })}
        </ol>

        {active.requiredTextFields.length > 0 && <details className="rounded-2xl border px-4 py-3">
          <summary className="min-h-11 cursor-pointer py-2 font-medium">Il tuo commento</summary>
          <div className="mt-3 space-y-3 text-sm">
            {active.requiredTextFields.map((field) => <div key={field.id}><p className="text-muted-foreground">{field.label}</p><p className="whitespace-pre-wrap break-words">{attempt.responses.fields[field.id]}</p></div>)}
            {attempt.responses.mode && <p><span className="text-muted-foreground">Come hai lavorato: </span>{modeTitle(attempt.responses.mode)}</p>}
          </div>
        </details>}
        {attempt.caseExample && <details className="rounded-2xl border px-4 py-3">
          <summary className="min-h-11 cursor-pointer py-2 font-medium">L’esempio preparato</summary>
          <div className="mt-3 space-y-3 text-sm">
            <p className="whitespace-pre-wrap break-words">{attempt.caseExample.referenceOutput}</p>
            {attempt.caseExample.prompt && <><p className="font-medium">Il prompt usato</p><p className="whitespace-pre-wrap break-words">{attempt.caseExample.prompt}</p></>}
          </div>
        </details>}
      </>;
    })() : phase === "reflection" ? <section className="space-y-5">
      <h2 ref={phaseHeading} tabIndex={-1} className={cn(heading, "text-xl font-semibold")}>Confronta con l’esempio</h2>
      {errorList}
      <details className="rounded-2xl border px-4 py-3">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">Rivedi il caso e le tue risposte</summary>
        <div className="mt-3 space-y-4 text-sm">
          {active.case?.text && <p className="whitespace-pre-wrap break-words">{active.case.text}</p>}
          {active.case?.preparedBadOutput && <div className="rounded-xl border border-uc-giallo/40 bg-uc-giallo-bg p-3"><p className="mb-1 font-semibold text-uc-giallo">La bozza da controllare</p><p className="whitespace-pre-wrap break-words">{active.case.preparedBadOutput}</p></div>}
          <ol className="space-y-2">{active.items.map((item, index) => <li key={item.id} id={`field-${item.id}`}>
            <p className="text-muted-foreground">Domanda {index + 1} · {item.prompt}</p>
            <p className="font-medium">{optionText(item.id, responses.answers[item.id]) ?? "—"}</p>
          </li>)}</ol>
          <p className="text-muted-foreground">Queste risposte sono già inviate e non si possono cambiare.</p>
        </div>
      </details>
      {attempt.caseExample && <ExampleCard example={attempt.caseExample} />}
      {commentAndMode}
      {bar("reflection")}
    </section> : <section className="space-y-5">
      <h2 ref={phaseHeading} tabIndex={-1} className={cn(heading, "text-xl font-semibold")}>{isCase ? "Leggi il caso e rispondi" : "Rispondi alle domande"}</h2>
      {errorList}
      <CaseCard activity={active} />
      {active.items.map((item, index) => <fieldset key={item.id} id={`field-${item.id}`} data-testid="learning-question" className={cn("min-w-0 rounded-2xl border bg-card p-4 sm:p-5", errors[item.id] && "border-uc-giallo/60")} aria-describedby={errors[item.id] ? `error-${item.id}` : undefined}>
        <legend className="float-left w-full">
          <span className="block text-xs font-medium text-muted-foreground">Domanda {index + 1} di {active.items.length}</span>
          <span className="mt-1 block break-words text-base font-medium sm:text-lg">{item.prompt}</span>
        </legend>
        <div className="clear-left space-y-2 pt-4">
          {item.options.map((option) => <label key={option.id} className={answerRow}>
            <input type="radio" className={radioInput} disabled={readOnly || !!attempt.decisionsSubmittedAt} name={item.id} value={option.id} checked={responses.answers[item.id] === option.id} onChange={() => update({ ...current.current, answers: { ...current.current.answers, [item.id]: option.id } })} />
            <span className="min-w-0 break-words">{option.text}</span>
          </label>)}
        </div>
        {errors[item.id] && <p id={`error-${item.id}`} className="mt-3 text-sm font-medium text-uc-giallo">Domanda {index + 1}: {errors[item.id]}</p>}
      </fieldset>)}
      {!isCase && commentAndMode}
      {bar(decisionsPending ? "decisions" : "questions")}
    </section>}

    {attempt && phase !== "feedback" && <ConfirmDialog
      open={reviewing}
      onOpenChange={(open) => { if (!open && !busy) setReviewing(false); }}
      title={EX.confirmTitle}
      description={confirmDescription({ decisionsPending, isCase })}
      confirmLabel={busy ? EX.sending : EX.send}
      cancelLabel={EX.cancel}
      pending={busy}
      confirmDisabled={readOnly}
      onConfirm={() => { void submit(); }}
    />}
  </div>;
}
