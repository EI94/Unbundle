"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveLearningIdea, submitLearningIdea } from "@/lib/learning/client";
import { emptyIdeaFields, type IdeaFields } from "@/lib/learning/idea-contract";
import type { IdeaDTO } from "@/lib/learning/ideas";

const pendingIdeas = new Map<string, { fields: IdeaFields; draft: IdeaDTO | null }>();
const labels: Record<keyof IdeaFields, string> = { title: "Attività da migliorare", problem: "Problema concreto", frequency: "Frequenza indicativa", inputs: "Input necessari, senza dati riservati", desiredOutput: "Risultato desiderato", contact: "Ruolo o referente che conosce il processo", constraints: "Vincoli e controlli" };
export function IdeaForm({ workspaceId, programId, userId, initial }: { workspaceId: string; programId: string; userId: string; initial: IdeaDTO | null }) {
  const memoryKey = `${workspaceId}:${programId}:${userId}`;
  const recovered = useRef(!initial || initial.status === "draft" ? pendingIdeas.get(memoryKey) : undefined);
  const [draft, setDraft] = useState(recovered.current?.draft ?? initial);
  const [fields, setFields] = useState<IdeaFields>(recovered.current?.fields ?? initial?.fields ?? emptyIdeaFields);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(recovered.current ? "Modifiche non confermate recuperate in questa scheda. La revisione originale resta protetta dai conflitti." : "");
  const [confirm, setConfirm] = useState(false);
  const [dirty, setDirty] = useState(!!recovered.current);
  const key = useRef<string | null>(null);
  const done = draft?.status === "submitted";
  const frozen = draft?.status === "promoting" || done;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } };
    const guard = (event: MouseEvent) => {
      const link = (event.target as Element).closest("a");
      if (link && link.target !== "_blank" && (dirty || busy)) { event.preventDefault(); event.stopPropagation(); setMessage("Salva la proposta prima di lasciare questa pagina."); }
    };
    window.addEventListener("beforeunload", warn); document.addEventListener("click", guard, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", guard, true); };
  }, [dirty, busy]);
  const save = async () => {
    if (!navigator.onLine) { setMessage("Connessione assente: proposta non salvata. Lascia aperta la pagina e riprova."); return; }
    setBusy(true);
    const sentMemory = pendingIdeas.get(memoryKey);
    setMessage("Salvataggio in corso…");
    try {
      const result = await saveLearningIdea({ workspaceId, programId, expectedRevision: draft?.revision ?? null, fields });
      if (!result.ok) { setMessage(result.message); return; }
      // An older, unmounted form must not delete a newer form's edits.
      if (pendingIdeas.get(memoryKey) === sentMemory) pendingIdeas.delete(memoryKey);
      setDraft(result.data); setDirty(false); setMessage("Bozza salvata sul server. Non è ancora nel portfolio.");
    } catch { setMessage("Salvataggio non confermato. Il testo resta in questa pagina."); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (!draft || dirty) return;
    setBusy(true);
    key.current ??= crypto.randomUUID();
    try {
      const result = await submitLearningIdea({ workspaceId, programId, draftId: draft.id, expectedRevision: draft.revision, idempotencyKey: key.current });
      if (!result.ok) { setMessage(result.message); return; }
      setDraft(result.data); setMessage("Proposta ricevuta nel portfolio. L’invio non avvia un progetto o un’automazione."); setConfirm(false);
    } catch { setMessage("Conferma non ricevuta. Riprova lo stesso invio: la proposta non verrà duplicata."); }
    finally { setBusy(false); }
  };
  return <section className="space-y-4 rounded-xl border p-5">
    <h2 className="text-xl font-semibold">La mia idea, facoltativa</h2>
    <p>Descrivi un miglioramento del tuo lavoro. Nessuna risposta al quiz viene copiata qui. Solo “Invia ai referenti” condivide questi campi nel portfolio del workspace.</p>
    {Object.entries(labels).map(([key, label]) => {
      const field = key as keyof IdeaFields;
      const props = { id: `idea-${key}`, value: fields[field], disabled: busy || frozen, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { const next = { ...fields, [field]: event.target.value }; setFields(next); pendingIdeas.set(memoryKey, { fields: next, draft }); setDirty(true); setConfirm(false); setMessage("Modifiche non ancora salvate."); } };
      return <div className="space-y-2" key={key}><label htmlFor={`idea-${key}`} className="font-medium">{label}</label>{field === "title" || field === "frequency" || field === "contact" ? <Input {...props} maxLength={field === "title" ? 200 : 300} /> : <Textarea {...props} rows={3} maxLength={field === "problem" ? 3000 : 2000} />}</div>;
    })}
    <p role="status" aria-live="polite">{message || (done ? "Proposta già inviata ai referenti." : frozen ? "Invio da completare: riprova per ricevere la conferma." : "Puoi lasciare questa proposta in bozza.")}</p>
    {!done && <div className="flex flex-wrap gap-3">
      {!frozen && <Button disabled={busy} variant="outline" onClick={save}>Salva bozza</Button>}
      {!confirm ? <Button disabled={busy || !draft || dirty} onClick={() => setConfirm(true)}>{frozen ? "Riprendi invio" : "Rivedi proposta da inviare"}</Button> : <div className="space-y-3"><p>I campi sopra saranno visibili ai referenti del portfolio. Confermi l’invio volontario?</p><Button disabled={busy} onClick={submit}>Invia ai referenti</Button></div>}
    </div>}
  </section>;
}
