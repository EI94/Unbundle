"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Lock } from "lucide-react";
import { learningAdminRequest } from "@/lib/learning/admin-client";
import { LEARNING_TEXT } from "@/lib/learning/text";
import { Button } from "@/components/ui/button";

export type ResultsCapability = "aggregate" | "review" | "export";

const R = LEARNING_TEXT.results;
const explanation: Record<ResultsCapability, { title: string; text: string }> = {
  aggregate: { title: R.tabs.group, text: "Questo permesso fa vedere i risultati di tutta l’aula, senza nomi, pronti da mostrare." },
  review: { title: R.tabs.people, text: "Questo permesso fa leggere le risposte e i risultati di ogni persona, con il suo nome." },
  export: { title: R.downloadTitle, text: "Questo permesso fa scaricare in un file i risultati di ogni persona, con nome ed email." },
};

/**
 * Una sezione per cui serve un permesso che non hai. Chi gestisce il corso
 * può attivarlo per sé con un clic; gli altri sanno a chi chiederlo.
 * (Rilascio 10, ondata 7a, FO-26) La vedono solo chi gestisce il corso: per gli altri la scheda non c'è.
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
  return <div data-testid="results-locked" className="flex flex-col items-start gap-4 rounded-xl border border-dashed bg-card p-5 sm:p-6">
    <span className="inline-flex size-10 items-center justify-center rounded-full bg-muted"><Lock aria-hidden className="size-5 text-muted-foreground" /></span>
    <div className="space-y-1.5">
      <h2 className="text-base font-semibold">{R.lockedTitle(copy.title)}</h2>
      <p className="max-w-prose text-muted-foreground">{copy.text}</p>
    </div>
    {canManage ? <div className="space-y-2">
      <Button type="button" onClick={grant} disabled={pending} aria-busy={pending} data-testid="results-grant-button" className="min-h-11 gap-2 px-4 sm:min-h-9">
        <KeyRound aria-hidden /> {pending ? "Attivazione…" : R.grantSelf}
      </Button>
      <p className="text-sm text-muted-foreground">{R.grantSelfNote}</p>
    </div> : <p className="font-medium">Chiedi a chi gestisce il corso di darti questo permesso.</p>}
    <div aria-live="polite">{message && <p role="alert" className="rounded-lg border border-destructive/50 p-3 text-sm text-destructive">{message}</p>}</div>
  </div>;
}
