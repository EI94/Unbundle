"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { retireFactAction } from "@/lib/actions/context";
import { reconfirmFactsAction } from "@/lib/actions/context-work";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { FactView } from "@/lib/db/queries/context-memory";
import { LsLock } from "./fact-row";
import { chunkItems, initialVerifyChoice, toCheckMeta, verifyButtonLabel, verifyChosen } from "./view-model";

const T = CONTEXT_TEXT;

/**
 * «Da verificare» (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.10, D9): i fatti che nessuno ha riconfermato
 * da più di 6 mesi, i più vecchi prima, solo per Lateral Space. Come «Da confermare»: in testa «← Contesto», il titolo e
 * la domanda; una riga per fatto con la casella (mai spuntata all'inizio), la frase, sotto la fonte e l'ultima conferma,
 * a destra «Non più vero» (con la conferma); in fondo, fisso, l'unico pulsante pieno, «Ancora veri (n)».
 *
 * Le righe arrivano sempre dal server: dopo un'azione la pagina si rilegge, e un fatto tolto esce subito anche dal conto.
 * Nessun modello.
 */
export function VerifyView({ workspaceId, today, facts }: { workspaceId: string; today: string; facts: readonly FactView[] }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(initialVerifyChoice);
  const [retiring, setRetiring] = useState<string | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, startTransition] = useTransition();
  const shown = gone.size === 0 ? facts : facts.filter((fact) => !gone.has(fact.id));
  const selected = verifyChosen(shown, chosen);
  const memoryHref = `/dashboard/${workspaceId}/contesto`;

  const toggle = (factId: string, checked: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (checked) next.add(factId);
      else next.delete(factId);
      return next;
    });

  const reconfirm = () => {
    if (selected.length === 0) return;
    startTransition(async () => {
      let done = 0;
      for (const chunk of chunkItems(selected)) {
        const result = await reconfirmFactsAction(workspaceId, chunk);
        if (!result.ok) {
          if (done > 0) toast.success(T.verify.done(done));
          toast.error(result.message);
          router.refresh();
          return;
        }
        done += result.value.reconfirmed;
      }
      toast.success(T.verify.done(done));
      setChosen(initialVerifyChoice());
      router.refresh();
    });
  };

  const retire = (fact: FactView) =>
    startTransition(async () => {
      const result = await retireFactAction(workspaceId, fact.id, fact.version);
      setRetiring(null);
      if (!result.ok) {
        toast.error(result.message);
        router.refresh();
        return;
      }
      toast.success(T.fact.retired);
      setGone((current) => new Set(current).add(fact.id));
      router.refresh();
    });

  return (
    <div className="space-y-6 pb-2">
      <header className="space-y-2">
        <Link href={memoryHref} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0">
          <ArrowLeft aria-hidden className="size-4" />
          {T.verify.back}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{T.verify.title}</h1>
        {shown.length > 0 ? <p className="text-sm text-muted-foreground">{T.verify.lead}</p> : null}
      </header>

      {shown.length === 0 ? (
        <div className="space-y-3 py-8 text-center">
          <p className="text-sm text-muted-foreground">{T.verify.empty}</p>
          <Link href={memoryHref} className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">
            {T.confirm.backToMemory}
          </Link>
        </div>
      ) : (
        <ul className="divide-y rounded-xl border">
          {shown.map((fact) => (
            <li key={`${fact.id}:${fact.version}`} data-slot="fact-to-check" className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-4">
              {/* Sul telefono tutta la riga si tocca, e la casella sta in un'area di 44 × 44 px. */}
              <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-3 text-sm sm:min-h-0">
                <span className="flex min-h-11 min-w-11 shrink-0 items-start justify-center pt-0.5 sm:min-h-0 sm:min-w-0">
                  <Checkbox checked={chosen.has(fact.id)} disabled={pending} onCheckedChange={(next) => toggle(fact.id, next === true)} aria-labelledby={`verifica-${fact.id}`} />
                </span>
                <span className="min-w-0 space-y-0.5">
                  <span id={`verifica-${fact.id}`} className="block leading-relaxed break-words">
                    {fact.statement}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>{toCheckMeta(fact, today)}</span>
                    {fact.visibility === "ls" ? <LsLock /> : null}
                  </span>
                </span>
              </label>
              {/* Sul telefono sotto la frase, allineato a lei (la casella e il suo spazio sono 56 px); a destra sullo schermo largo. */}
              {retiring === fact.id ? (
                <div className="ml-14 space-y-2 sm:ml-0 sm:max-w-xs">
                  <p className="text-sm">{T.fact.retireConfirm}</p>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" disabled={pending} onClick={() => setRetiring(null)}>
                      {T.notes.cancel}
                    </Button>
                    <Button type="button" variant="destructive" className="min-h-11 sm:min-h-8" disabled={pending} onClick={() => retire(fact)}>
                      {T.fact.noLongerTrue}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button type="button" variant="ghost" className="ml-14 min-h-11 shrink-0 self-start sm:ml-0 sm:min-h-8" disabled={pending} onClick={() => setRetiring(fact.id)}>
                  {T.fact.noLongerTrue}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {shown.length === 0 ? null : (
        <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-3">
          <Button type="button" size="lg" className="min-h-11 w-full sm:w-auto sm:px-6" disabled={pending || selected.length === 0} onClick={reconfirm}>
            {verifyButtonLabel(shown, chosen)}
          </Button>
        </div>
      )}
    </div>
  );
}
