"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addAgentQuestionAction, dismissAgentQuestionAction, type AgentQuestionActionResult } from "@/lib/actions/use-case-agent-questions";
import type { AgentProposalView } from "@/lib/db/queries/use-case-agent-questions";

const day = (iso: string) => new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", timeZone: "Europe/Rome" }).format(new Date(iso));

/**
 * «Proposte dei coding agent» (rilascio 8.0b), sopra «Cosa serve»: le domande per il referente che un coding agent
 * ha proposto mentre costruiva. Non partono da sole: «Aggiungi a Cosa serve» le fa diventare un requisito da
 * chiedere, «Lascia stare» le chiude. Chi non può aggiungere esigenze le legge soltanto.
 */
export function AgentProposals({ workspaceId, useCaseId, proposals, canDecide }: { workspaceId: string; useCaseId: string; proposals: AgentProposalView[]; canDecide: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!proposals.length) return null;
  const run = (call: () => Promise<AgentQuestionActionResult>) =>
    start(async () => {
      const result = await call();
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      router.refresh();
    });
  return (
    <section id="proposte-agenti" aria-labelledby="proposte-agenti-titolo" className="scroll-mt-20 space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Bot className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="proposte-agenti-titolo" className="text-base font-semibold">
            Proposte dei coding agent · {proposals.length}
          </h2>
          <p className="text-sm text-muted-foreground">Domande per il referente nate mentre si costruisce l&apos;agente. Non partono da sole.</p>
        </div>
      </div>
      <ul className="divide-y">
        {proposals.map((p) => (
          <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 text-sm">
              <p className="break-words">{p.question}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {day(p.createdAt)}
                {p.reason ? ` · Perché: ${p.reason}` : ""}
              </p>
            </div>
            {canDecide ? (
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" className="h-11 sm:h-8" disabled={pending} onClick={() => run(() => dismissAgentQuestionAction(workspaceId, useCaseId, p.id))}>
                  Lascia stare
                </Button>
                <Button className="h-11 sm:h-8" disabled={pending} onClick={() => run(() => addAgentQuestionAction(workspaceId, useCaseId, p.id))}>
                  Aggiungi a Cosa serve
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
