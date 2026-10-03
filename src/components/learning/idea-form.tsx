"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLearningUnsavedChanges } from "./use-unsaved-changes";
import { downloadLearningDraft } from "./download-draft";
import { LearningRefresh } from "./learning-refresh";
import { createAcknowledgedMemory } from "@/lib/learning/acknowledged-memory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveLearningIdea, submitLearningIdea } from "@/lib/learning/client";
import { emptyIdeaFields, ideaSubmissionSchema, ideaValidationErrors, requiredIdeaFields, type IdeaFields } from "@/lib/learning/idea-contract";
import type { IdeaDTO } from "@/lib/learning/ideas";

const pendingIdeas = new Map<string, { fields: IdeaFields; draft: IdeaDTO | null }>();
const acknowledgedIdeas = createAcknowledgedMemory<IdeaDTO>();
const labels: Record<keyof IdeaFields, string> = { title: "Attività da migliorare", problem: "Problema concreto", frequency: "Frequenza indicativa", inputs: "Input necessari, senza dati riservati", desiredOutput: "Risultato desiderato", contact: "Ruolo o referente che conosce il processo", constraints: "Vincoli e controlli" };
type IdeaFormProps = { workspaceId: string; programId: string; userId: string; initial: IdeaDTO | null; readOnly?: boolean };
export function IdeaForm(props: IdeaFormProps) {
  return <IdeaFormFields key={`${props.initial?.id ?? "new"}:${props.initial?.revision ?? 0}`} {...props} />;
}
function IdeaFormFields({ workspaceId, programId, userId, initial, readOnly = false }: IdeaFormProps) {
  const memoryKey = `${workspaceId}:${programId}:${userId}`;
  const initialContent = useRef(acknowledgedIdeas.restore(memoryKey, initial)).current;
  const restoredAcknowledgement = initialContent !== initial;
  const recovered = useRef(!initialContent || initialContent.status === "draft" ? pendingIdeas.get(memoryKey) : undefined);
  const [draft, setDraft] = useState(recovered.current?.draft ?? initialContent);
  const [fields, setFields] = useState<IdeaFields>(recovered.current?.fields ?? initialContent?.fields ?? emptyIdeaFields);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(recovered.current ? "Modifiche non confermate recuperate in questa scheda. La revisione originale resta protetta dai conflitti." : restoredAcknowledgement ? "Ultima proposta confermata dal server recuperata in questa scheda." : "");
  const [confirm, setConfirm] = useState(false);
  const [dirty, setDirty] = useState(!!recovered.current);
  const [errors, setErrors] = useState<Partial<Record<keyof IdeaFields, string>>>({});
  const [closedByServer, setClosedByServer] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);
  const errorBox = useRef<HTMLDivElement>(null);
  const focusErrors = useRef(false);
  const key = useRef<string | null>(null);
  const done = draft?.status === "submitted";
  const frozen = draft?.status === "promoting" || done;
  // A historical null snapshot cannot authorize edits to the remembered object.
  const needsObjectRefresh = !initial && !!initialContent && !done;
  const closed = readOnly || !!closedByServer || needsObjectRefresh;
  useEffect(() => { if (focusErrors.current) { errorBox.current?.focus(); focusErrors.current = false; } }, [errors]);
  useLearningUnsavedChanges({ dirty, pending: busy, onDiscard: () => {
    pendingIdeas.delete(memoryKey);
    setFields(draft?.fields ?? emptyIdeaFields);
    setDirty(false);
    setConfirm(false);
    setMessage("Modifiche non salvate scartate.");
  } });
  const reportFailure = (result: { code: string; message: string; fieldErrors?: Record<string, string> }) => {
    setMessage(result.message);
    setProblem(true);
    if (result.code === "closed" || result.code === "forbidden") { setClosedByServer(result.message); setConfirm(false); }
    if (result.fieldErrors && Object.keys(result.fieldErrors).length) {
      focusErrors.current = true; setErrors(result.fieldErrors); setConfirm(false);
    }
  };
  const validateForSending = () => {
    const parsed = ideaSubmissionSchema.safeParse(fields);
    if (!parsed.success) {
      focusErrors.current = true; setErrors(ideaValidationErrors(parsed.error)); setConfirm(false);
      setMessage("Completa i campi indicati prima di inviare. Puoi comunque conservare una bozza incompleta.");
      return false;
    }
    setErrors({}); return true;
  };
  const save = async () => {
    if (closed || busy) return;
    if (!navigator.onLine) { setProblem(true); setMessage("Connessione assente: proposta non salvata. Lascia aperta la pagina e riprova."); return; }
    setBusy(true);
    const sentMemory = pendingIdeas.get(memoryKey);
    setMessage("Salvataggio in corso…");
    try {
      const result = await saveLearningIdea({ workspaceId, programId, expectedUserId: userId, draftId: draft?.id ?? null, expectedRevision: draft?.revision ?? null, fields });
      if (!result.ok) { reportFailure(result); return; }
      acknowledgedIdeas.remember(memoryKey, result.data);
      // An older, unmounted form must not delete a newer form's edits.
      if (pendingIdeas.get(memoryKey) === sentMemory) pendingIdeas.delete(memoryKey);
      setDraft(result.data); setDirty(false); setProblem(false); setMessage("Bozza salvata sul server. Non è ancora nel portfolio.");
    } catch { setProblem(true); setMessage("Salvataggio non confermato. Il testo resta in questa pagina."); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (!draft || dirty || closed || busy || !validateForSending()) return;
    setBusy(true);
    key.current ??= crypto.randomUUID();
    try {
      const result = await submitLearningIdea({ workspaceId, programId, expectedUserId: userId, draftId: draft.id, expectedRevision: draft.revision, idempotencyKey: key.current });
      if (!result.ok) { reportFailure(result); return; }
      acknowledgedIdeas.remember(memoryKey, result.data);
      setDraft(result.data); setProblem(false); setMessage("Proposta ricevuta nel portfolio. L’invio non avvia un progetto o un’automazione."); setConfirm(false);
    } catch { setProblem(true); setMessage("Conferma non ricevuta. Riprova lo stesso invio: la proposta non verrà duplicata."); }
    finally { setBusy(false); }
  };
  return <section className="space-y-4 rounded-xl border p-5">
    <h2 className="text-xl font-semibold">La mia idea, facoltativa</h2>
    <p>Descrivi un miglioramento del tuo lavoro. Nessuna risposta al quiz viene copiata qui. Solo “Invia ai referenti” condivide questi campi nel portfolio del workspace.</p>
    <p className="text-sm">Per inviare servono attività da migliorare, problema concreto e risultato desiderato, con almeno 5 caratteri ciascuno. Gli altri campi sono facoltativi. Puoi salvare una bozza incompleta. Usa “Salva bozza” e attendi la conferma prima di uscire.</p>
    {closed && <p role="status" className="rounded-lg border p-3">{closedByServer ?? (needsObjectRefresh ? "La proposta confermata è conservata. Aggiorna la proposta per verificare l’accesso e continuare." : "Il corso è chiuso alle nuove risposte. La proposta è consultabile; salvataggio e invio non sono disponibili.")} Le eventuali modifiche non confermate restano soltanto in questa scheda. <a className="underline" target="_blank" rel="noopener noreferrer" href={`/dashboard/${workspaceId}/learning/${programId}/ideas`}>Controlla la disponibilità in una nuova scheda</a>.</p>}
    {needsObjectRefresh && <LearningRefresh label="Aggiorna la proposta" />}
    {Object.keys(errors).length > 0 && <div ref={errorBox} tabIndex={-1} role="alert" className="rounded-lg border p-3"><p className="font-medium">Controlla i campi prima dell’invio.</p><ul className="list-disc pl-5">{Object.entries(errors).map(([field, error]) => <li key={field}><a className="underline" href={`#idea-${field}`}>{labels[field as keyof IdeaFields]}: {error}</a></li>)}</ul></div>}
    {Object.entries(labels).map(([key, label]) => {
      const field = key as keyof IdeaFields;
      const required = requiredIdeaFields.some(requiredField => requiredField === field);
      const props = { id: `idea-${key}`, value: fields[field], disabled: busy || frozen, readOnly: closed, "aria-required": required, "aria-invalid": !!errors[field], "aria-describedby": errors[field] ? `idea-error-${field}` : undefined, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { const next = { ...fields, [field]: event.target.value }; setFields(next); pendingIdeas.set(memoryKey, { fields: next, draft }); setDirty(true); setConfirm(false); setErrors(previous => { const next = { ...previous }; delete next[field]; return next; }); setMessage("Modifiche non ancora salvate."); } };
      return <div className="space-y-2" key={key}><label htmlFor={`idea-${key}`} className="font-medium">{label}{required ? " (necessario per inviare)" : " (facoltativo)"}</label>{field === "title" || field === "frequency" || field === "contact" ? <Input {...props} maxLength={field === "title" ? 200 : 300} /> : <Textarea {...props} rows={3} maxLength={field === "problem" ? 3000 : 2000} />}{errors[field] && <p id={`idea-error-${field}`} className="text-sm font-medium">{errors[field]}</p>}</div>;
    })}
    <p role="status" aria-live="polite">{message || (done ? "Proposta già inviata ai referenti." : frozen ? "Invio da completare: riprova per ricevere la conferma." : "Puoi lasciare questa proposta in bozza.")}</p>
    {!done && (dirty || problem || closed) && <div className="flex flex-wrap items-center gap-3 text-sm">
      <Button type="button" variant="outline" onClick={() => downloadLearningDraft("mia-proposta-formazione.txt", fields)}>Scarica la mia proposta</Button>
      <a className="underline" target="_blank" rel="noopener noreferrer" href={`/dashboard/${workspaceId}/learning/${programId}/ideas`}>Confronta la versione sul server</a>
    </div>}
    {done && draft.resultingUseCaseId && <Link className="inline-block underline" href={`/dashboard/${workspaceId}/portfolio?created=${encodeURIComponent(draft.resultingUseCaseId)}`}>Vedi la proposta nel portfolio</Link>}
    {!done && !closed && <div className="flex flex-wrap gap-3">
      {!frozen && <Button disabled={busy} variant="outline" onClick={save}>Salva bozza</Button>}
      {!confirm ? <Button disabled={busy || !draft || dirty} onClick={() => { if (validateForSending()) setConfirm(true); }}>{frozen ? "Riprendi invio" : "Rivedi proposta da inviare"}</Button> : <div className="space-y-3"><p>I campi sopra saranno visibili ai referenti del portfolio. Confermi l’invio volontario?</p><Button disabled={busy} onClick={submit}>Invia ai referenti</Button></div>}
    </div>}
  </section>;
}
