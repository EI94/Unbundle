"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { startLearningAttempt, saveLearningDraft, submitLearningAttempt, submitLearningDecisions, startLearningRetake } from "@/lib/learning/client";
import type { AttemptDTO } from "@/lib/learning/server";
import type { AttemptResponses, LearnerActivityDTO } from "@/lib/learning/types";
import { outcomeLabel } from "./learning-shell";

// Memory only: an accidental SPA back/forward navigation must not discard a
// draft. Keys are server-authorized attempt UUIDs, never a shared activity ID.
const pendingDrafts = new Map<string, { responses: AttemptResponses; revision: number }>();

const modeLabel: Record<string, string> = {
  review_reference_output: "Analisi dell’esempio preparato, senza chiamate AI",
  execute_authorized_assistant: "Esecuzione con assistente autorizzato",
};

export function ActivityPlayer({ workspaceId, programId, version, activity, initialAttempt }: {
  workspaceId: string; programId: string; version: string; activity: LearnerActivityDTO; initialAttempt: AttemptDTO | null;
}) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(initialAttempt);
  const recovered = useRef(initialAttempt?.status === "draft" ? pendingDrafts.get(initialAttempt.id) : undefined);
  const [responses, setResponses] = useState<AttemptResponses>(() => recovered.current?.responses ?? initialAttempt?.responses ?? { answers: {}, fields: {} });
  const current = useRef(responses);
  const revision = useRef(recovered.current?.revision ?? initialAttempt?.revision ?? 1);
  const edits = useRef(recovered.current ? 1 : 0);
  const acknowledged = useRef(0);
  const inFlight = useRef(false);
  const submitKey = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(recovered.current ? "Modifiche non confermate recuperate in questa scheda. Salva o confronta la versione sul server." : initialAttempt ? "Bozza caricata dal server." : "");
  const [problem, setProblem] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);
  const errorBox = useRef<HTMLDivElement>(null);
  const active = attempt?.activity ?? activity;
  const decisionsPending = active.type === "case_review" && !attempt?.decisionsSubmittedAt;
  const phase = !attempt ? "start" : attempt.status === "submitted" && attempt.result ? "feedback" : reviewing ? "review" : decisionsPending || active.type !== "case_review" ? "questions" : "reflection";
  const previousPhase = useRef(phase);
  const phaseHeading = useRef<HTMLHeadingElement>(null);
  const base = `/dashboard/${workspaceId}/learning/${programId}`;
  const activityPath = `${base}/activities/${activity.id}`;

  const update = (next: AttemptResponses) => {
    current.current = next;
    edits.current += 1;
    setResponses(next);
    if (attempt) pendingDrafts.set(attempt.id, { responses: structuredClone(next), revision: revision.current });
    setMessage("Modifiche non ancora salvate.");
    if (problem !== "conflict") setProblem(null);
    setErrors({});
  };

  const save = useCallback(async (): Promise<boolean> => {
    if (!attempt || attempt.status !== "draft" || inFlight.current) return false;
    if (edits.current === acknowledged.current) return true;
    if (!navigator.onLine) {
      setProblem("offline");
      setMessage("Connessione assente: queste modifiche non sono ancora salvate. Lascia aperta la pagina e riprova.");
      return false;
    }
    const sentEdits = edits.current;
    const sentMemory = pendingDrafts.get(attempt.id);
    const sentResponses = structuredClone(current.current);
    inFlight.current = true;
    setBusy(true);
    setMessage("Salvataggio in corso…");
    try {
      const result = await saveLearningDraft({ workspaceId, programId, attemptId: attempt.id, expectedRevision: revision.current, responses: sentResponses });
      if (!result.ok) {
        setProblem(result.code);
        setMessage(result.message);
        setErrors(result.fieldErrors ?? {});
        return false;
      }
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
      setProblem(null);
      setMessage(edits.current === sentEdits
        ? `Salvato alle ${new Date(result.data.savedAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}.`
        : "Le ultime modifiche non sono ancora salvate.");
      return edits.current === sentEdits;
    } catch {
      setProblem("technical");
      setMessage("Conferma del salvataggio non ricevuta. La bozza resta qui: riprova o confronta la versione sul server.");
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [attempt, workspaceId, programId]);

  useEffect(() => {
    if (!attempt || attempt.status !== "draft" || problem || busy || reviewing || edits.current === acknowledged.current) return;
    const timer = setTimeout(() => { void save(); }, 900);
    return () => clearTimeout(timer);
  }, [responses, attempt, save, problem, busy, reviewing]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (edits.current !== acknowledged.current || inFlight.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const guardNavigation = (event: MouseEvent) => {
      const link = (event.target as Element).closest("a");
      if (!link || link.target === "_blank" || link.hasAttribute("download") || link.getAttribute("href")?.startsWith("#")) return;
      if (edits.current !== acknowledged.current || inFlight.current) {
        event.preventDefault(); event.stopPropagation();
        setMessage("Salva le modifiche o scarica la tua bozza prima di lasciare questa pagina.");
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guardNavigation, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", guardNavigation, true); };
  }, []);

  useEffect(() => { if (Object.keys(errors).length) errorBox.current?.focus(); }, [errors]);

  useEffect(() => {
    if (previousPhase.current === phase) return;
    previousPhase.current = phase;
    // Only a deliberate phase change moves focus, never mount or an autosave.
    // Field errors retain priority over the destination heading.
    if (!Object.keys(errors).length) phaseHeading.current?.focus();
  }, [phase, errors]);

  const backup = () => {
    const blob = new Blob([JSON.stringify(current.current, null, 2)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "mia-bozza-formazione.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const start = async () => {
    setBusy(true);
    try {
      const result = await startLearningAttempt({ workspaceId, programId, activityId: activity.id, expectedVersion: version });
      if (!result.ok) { setProblem(result.code); setMessage(result.message); return; }
      const pending = result.data.status === "draft" ? pendingDrafts.get(result.data.id) : undefined;
      revision.current = pending?.revision ?? result.data.revision;
      setAttempt(result.data);
      current.current = pending?.responses ?? result.data.responses;
      edits.current = pending ? 1 : 0;
      acknowledged.current = 0;
      setResponses(current.current);
      setMessage(pending ? "Modifiche non confermate recuperate in questa scheda. Salva o confronta la versione sul server." : "Tentativo aperto. Le risposte verranno salvate sul server.");
    } catch { setMessage("Impossibile aprire l’attività. Riprova: nessuna risposta è stata inviata."); }
    finally { setBusy(false); }
  };

  const prepareSubmit = async () => {
    const fieldErrors: Record<string, string> = {};
    for (const item of active.items) if (!current.current.answers[item.id]) fieldErrors[item.id] = "Scegli una risposta, anche “Non so ancora”.";
    for (const field of decisionsPending ? [] : active.requiredTextFields) {
      const value = current.current.fields[field.id]?.trim() ?? "";
      if (value.length < field.minChars || value.length > field.maxChars) fieldErrors[field.id] = `Inserisci da ${field.minChars} a ${field.maxChars} caratteri.`;
    }
    if (!decisionsPending && active.allowedModes.length && !active.allowedModes.includes(current.current.mode ?? "")) fieldErrors.mode = "Indica la modalità usata.";
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return;
    if (await save()) setReviewing(true);
  };

  const submit = async () => {
    if (!attempt || inFlight.current || edits.current !== acknowledged.current) return;
    inFlight.current = true;
    setBusy(true);
    submitKey.current ??= crypto.randomUUID();
    try {
      const result = decisionsPending
        ? await submitLearningDecisions({ workspaceId, programId, attemptId: attempt.id, expectedRevision: revision.current })
        : await submitLearningAttempt({ workspaceId, programId, attemptId: attempt.id, expectedRevision: revision.current, idempotencyKey: submitKey.current });
      if (!result.ok) { setProblem(result.code); setMessage(result.message); setErrors(result.fieldErrors ?? {}); return; }
      revision.current = result.data.revision;
      setAttempt(result.data);
      setReviewing(false);
      setProblem(null);
      setMessage(decisionsPending ? "Decisioni ricevute e bloccate. Ora confronta l’esempio e completa la riflessione." : "Risposte inviate. Puoi leggere il feedback.");
    } catch { setProblem("technical"); setMessage("Conferma dell’invio non ricevuta. Riprova con lo stesso pulsante: non verrà creata una seconda consegna."); }
    finally { inFlight.current = false; setBusy(false); }
  };

  const retake = async () => {
    if (!attempt) return;
    setBusy(true);
    try {
      const result = await startLearningRetake({ workspaceId, programId, parentAttemptId: attempt.id });
      if (!result.ok) { setMessage(result.message); return; }
      router.push(`${base}/attempts/${result.data.id}`);
    } catch { setMessage("Recupero non aperto. Riprova senza cancellare il tentativo precedente."); }
    finally { setBusy(false); }
  };

  return <div className="space-y-6">
    <Card><CardHeader><CardTitle>Prima di iniziare</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
      <p>Durata orientativa: {active.estimatedMinutes} minuti. Nessun punteggio legato alla velocità.</p>
      <p>{active.aiAssistance === "not_allowed" ? "Svolgi da solo, senza assistente AI." : "Prendi prima le decisioni individuali. Puoi poi analizzare l’esempio o usare un assistente autorizzato su dati fittizi."}</p>
      <p>{active.completionGate ? `Criterio didattico: almeno ${active.passMinCorrect}/${active.items.length} risposte corrette${active.requiresCriticalCorrect ? " e tutti i punti essenziali corretti" : ""}.` : "Checkpoint formativo: non contribuisce al risultato finale."} Non è una certificazione.</p>
      <p>Le risposte sono nominative e visibili a te e ai formatori autorizzati. La survey AI Readiness resta separata.</p>
      <p className="text-muted-foreground">Versione {version}. Il tentativo conserva i contenuti con cui è iniziato.</p>
    </CardContent></Card>
    <div role="status" aria-live="polite" className="rounded-lg border p-3 text-sm">{message || "Nessuna risposta ancora salvata."}</div>
    {problem && <div className="space-y-3 rounded-lg border p-4" role="alert">
      <p>{problem === "conflict" ? "La bozza sul server è cambiata in un’altra scheda. Le risposte qui restano intatte: conserva una copia e confronta le versioni prima di ricaricare." : "Mantieni aperta questa pagina per conservare le modifiche non confermate."}</p>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={backup}>Scarica la mia bozza</Button>
        <a className="underline" href={activityPath} target="_blank" rel="noopener noreferrer">Confronta la versione sul server</a>
        {(problem === "unauthenticated" || problem === "technical") && <a className="underline" target="_blank" rel="noopener noreferrer" href={`/login?session=stale&callbackUrl=${encodeURIComponent(activityPath)}`}>Se la sessione è terminata, accedi in una nuova scheda e poi riprova qui</a>}
      </div>
    </div>}
    {phase === "reflection" && <h2 ref={phaseHeading} tabIndex={-1} className="font-heading text-lg font-medium">Confronto e riflessione</h2>}
    {attempt?.caseExample && <Card><CardHeader><CardTitle>Esempio preparato per il confronto</CardTitle></CardHeader><CardContent className="space-y-3"><p className="whitespace-pre-wrap">{attempt.caseExample.referenceOutput}</p>{attempt.caseExample.prompt && <><p className="font-medium">Prompt da provare solo nell’ambiente autorizzato, se disponibile</p><p className="whitespace-pre-wrap">{attempt.caseExample.prompt}</p></>}<p className="text-sm">La lettura dell’esempio consente di completare l’attività senza usare un modello AI. Indica la modalità effettivamente svolta.</p></CardContent></Card>}
    {!attempt ? <Button onClick={start} disabled={busy}>Inizia attività</Button> : attempt.status === "submitted" && attempt.result ? <>
      <Card><CardHeader><h2 ref={phaseHeading} tabIndex={-1} className="font-heading text-base font-medium">Feedback: {outcomeLabel(attempt.result.status)}</h2></CardHeader><CardContent className="space-y-3">
        <p>{attempt.result.correct} risposte corrette su {attempt.result.total}. Tentativo {attempt.attemptNumber} — consegna ricevuta.</p>
        {attempt.result.essential_errors.length > 0 && <p>Riprendi i punti essenziali segnalati sotto, anche se hai raggiunto la soglia numerica.</p>}
        <p>Completamento dell’attività ed esito della verifica sono distinti. La riflessione non riceve un voto automatico.</p>
      </CardContent></Card>
      {active.requiredTextFields.length > 0 && <Card><CardHeader><CardTitle>La tua riflessione consegnata</CardTitle></CardHeader><CardContent className="space-y-3">
        {active.requiredTextFields.map((field) => <div key={field.id}><p className="font-medium">{field.label}</p><p className="whitespace-pre-wrap break-words">{attempt.responses.fields[field.id]}</p></div>)}
        {attempt.responses.mode && <p className="text-sm">{modeLabel[attempt.responses.mode] ?? attempt.responses.mode}</p>}
      </CardContent></Card>}
      {attempt.result.items.map((item) => {
        const question = active.items.find((q) => q.id === item.itemId);
        return <Card key={item.itemId}><CardHeader><CardTitle className="text-base">{question?.prompt}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
          <p>La tua risposta: {question?.options.find((o) => o.id === item.selectedOptionId)?.text}</p>
          <p className="font-medium">{item.correct ? "Corretto" : "Da riprendere"}{item.critical && !item.correct ? " — punto essenziale" : ""}</p>
          <p>{item.feedback}</p>
          {item.evidence.map((evidence, index) => <p className="break-words text-muted-foreground" key={index}>Evidenza: {evidence}</p>)}
        </CardContent></Card>;
      })}
      <div className="flex flex-wrap gap-4">{active.purpose !== "formative" && <Button disabled={busy} onClick={retake}>Riprendi e riprova</Button>}<Link className="self-center underline" href={`${base}/progress`}>I miei progressi e tentativi</Link></div>
    </> : <>
      {phase === "questions" && <h2 ref={phaseHeading} tabIndex={-1} className="font-heading text-lg font-medium">Le tue risposte</h2>}
      {active.case && <Card><CardHeader><CardTitle>{active.case.title}</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Caso interamente fittizio. Nessuna azione su pratiche reali.</p>
        <p className="whitespace-pre-wrap">{active.case.text}</p>
        {active.case.preparedBadOutput && <div className="rounded-lg bg-muted p-4"><p className="mb-2 font-medium">Riepilogo da verificare</p><p>{active.case.preparedBadOutput}</p></div>}
        <p>{active.case.task}</p>
      </CardContent></Card>}
      {Object.keys(errors).length > 0 && <div ref={errorBox} tabIndex={-1} role="alert" className="rounded-lg border p-4"><p className="font-medium">Controlla i campi prima dell’invio.</p><ul className="list-disc pl-5">{Object.entries(errors).map(([id, error]) => <li key={id}><a className="underline" href={`#field-${id}`}>{error}</a></li>)}</ul></div>}
      {reviewing ? <Card><CardHeader><h2 ref={phaseHeading} tabIndex={-1} className="font-heading text-base font-medium">Riepilogo prima dell’invio</h2></CardHeader><CardContent className="space-y-4">
        <p>{decisionsPending ? "Consegna le decisioni individuali: non saranno più modificabili. Si aprirà l’esempio per il confronto; potrai poi completare riflessione e modalità." : "Dopo la consegna questo tentativo non sarà modificabile. Potrai leggere il feedback e avviare un recupero."}</p>
        <ol className="list-decimal space-y-3 pl-5">{active.items.map((item) => <li key={item.id}><p>{item.prompt}</p><p className="font-medium">{item.options.find((o) => o.id === responses.answers[item.id])?.text}</p></li>)}</ol>
        {active.requiredTextFields.map((field) => <div key={field.id}><p className="font-medium">{field.label}</p><p className="whitespace-pre-wrap break-words">{responses.fields[field.id]}</p></div>)}
        {responses.mode && <p>{modeLabel[responses.mode] ?? responses.mode}</p>}
        <div className="flex flex-wrap gap-3"><Button onClick={submit} disabled={busy}>{decisionsPending ? "Consegna decisioni e apri esempio" : "Conferma e invia risposte"}</Button><Button variant="outline" disabled={busy} onClick={() => setReviewing(false)}>Torna alle risposte</Button></div>
      </CardContent></Card> : <>
        {active.items.map((item, index) => <fieldset key={item.id} id={`field-${item.id}`} className="space-y-3 rounded-xl border p-5" aria-describedby={errors[item.id] ? `error-${item.id}` : undefined}>
          <legend className="px-1 font-medium">{index + 1}. {item.prompt}</legend>
          {item.options.map((option) => <label key={option.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted">
            <input type="radio" className="mt-1 size-4 shrink-0" disabled={!!attempt.decisionsSubmittedAt} name={item.id} value={option.id} checked={responses.answers[item.id] === option.id} onChange={() => update({ ...current.current, answers: { ...current.current.answers, [item.id]: option.id } })} />
            <span>{option.text}</span>
          </label>)}
          {errors[item.id] && <p id={`error-${item.id}`} className="text-sm font-medium">{errors[item.id]}</p>}
        </fieldset>)}
        {(!decisionsPending ? active.requiredTextFields : []).map((field) => <div key={field.id} className="space-y-2"><label className="font-medium" htmlFor={`field-${field.id}`}>{field.label}</label><Textarea id={`field-${field.id}`} rows={5} maxLength={field.maxChars} value={responses.fields[field.id] ?? ""} aria-invalid={!!errors[field.id]} aria-describedby={`help-${field.id}`} onChange={(event) => update({ ...current.current, fields: { ...current.current.fields, [field.id]: event.target.value } })} /><p id={`help-${field.id}`} className="text-sm">{errors[field.id] ?? `${field.minChars}–${field.maxChars} caratteri. Completezza richiesta; nessun voto automatico sul testo.`}</p></div>)}
        {!decisionsPending && active.allowedModes.length > 0 && <fieldset id="field-mode" className="space-y-3 rounded-lg border p-4"><legend className="font-medium">Quale modalità hai usato?</legend>{active.allowedModes.map((mode) => <label className="flex gap-3" key={mode}><input type="radio" name="mode" checked={responses.mode === mode} onChange={() => update({ ...current.current, mode })} /><span>{modeLabel[mode] ?? mode}</span></label>)}{errors.mode && <p>{errors.mode}</p>}</fieldset>}
        <div className="flex flex-wrap gap-3"><Button onClick={prepareSubmit} disabled={busy || problem === "conflict"}>Rivedi e invia</Button><Button variant="outline" onClick={() => void save()} disabled={busy || problem === "conflict"}>Salva ora / riprova</Button></div>
      </>}
    </>}
  </div>;
}
