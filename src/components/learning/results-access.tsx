"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Lock } from "lucide-react";
import { learningAdminRequest } from "@/lib/learning/admin-client";
import { Button } from "@/components/ui/button";

export type ResultsCapability = "aggregate" | "review" | "export";

const explanation: Record<ResultsCapability, { title: string; text: string }> = {
  aggregate: { title: "Risultati di gruppo", text: "Questo permesso fa vedere i risultati di tutta l’aula, senza nomi, pronti da mostrare." },
  review: { title: "Risultati individuali", text: "Questo permesso fa leggere le risposte e i risultati di ogni persona, con il suo nome." },
  export: { title: "Scarica", text: "Questo permesso fa scaricare in un file i risultati di ogni persona, con nome ed email." },
};

/**
 * Una sezione per cui serve un permesso che non hai. Chi gestisce il corso
 * può attivarlo per sé con un clic; gli altri sanno a chi chiederlo.
 */
export function ResultsLocked({ capability, canManage, viewerId, workspaceId, programId }: {
  capability: ResultsCapability; canManage: boolean; viewerId: string; workspaceId: string; programId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const copy = explanation[capability];

  async function grant() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setMessage("");
    try {
      const result = await learningAdminRequest({
        expectedUserId: viewerId,
        operation: "grant",
        input: { workspaceId, programId, userId: viewerId, capability, cohortId: null },
      });
      if (!result.ok) { setMessage(result.message); return; }
      startTransition(() => router.refresh());
    } catch {
      setMessage("Permesso non attivato. Controlla la connessione e riprova.");
    } finally {
      inFlight.current = false; setBusy(false);
    }
  }

  const pending = busy || refreshing;
  return <div data-testid="results-locked" className="flex flex-col items-start gap-4 rounded-2xl border border-dashed bg-card p-5 sm:p-8">
    <span className="inline-flex size-10 items-center justify-center rounded-full bg-muted"><Lock aria-hidden className="size-5 text-muted-foreground" /></span>
    <div className="space-y-1.5">
      <h2 className="text-lg font-semibold">{copy.title}: serve un permesso</h2>
      <p className="max-w-prose text-muted-foreground">{copy.text}</p>
    </div>
    {canManage ? <div className="space-y-2">
      <Button type="button" onClick={grant} disabled={pending} aria-busy={pending} data-testid="results-grant-button" className="min-h-10 gap-2 px-4">
        <KeyRound aria-hidden /> {pending ? "Attivazione…" : "Attiva per me"}
      </Button>
      <p className="text-xs text-muted-foreground">Gestisci tu il corso: puoi darti questo permesso. Resta scritto nel registro del corso.</p>
    </div> : <p className="font-medium">Chiedi a chi gestisce il corso di darti questo permesso.</p>}
    <div aria-live="polite">{message && <p role="alert" className="rounded-lg border border-destructive/50 p-3 text-sm text-destructive">{message}</p>}</div>
  </div>;
}
