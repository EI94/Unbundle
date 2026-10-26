"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { decideUseCaseAction } from "@/lib/actions/use-case-decisions";
import { DECISION_LABEL, type DecisionActionResult } from "@/lib/use-cases/decision-ui";
import type { Origin } from "@/lib/use-cases/types";
import { hoursLabel } from "@/lib/use-cases/views";
import { useDecisionRunner } from "./decision-buttons";
import { OriginChip } from "./origin-chip";
import { ConfirmDecisionDialog } from "./reopen-dialog";

/** Una best practice di «Da diffondere», con le sole parti che la lista mostra. */
export interface DiffuseItem {
  id: string;
  code: string | null;
  title: string;
  origin: Origin;
  area: string | null;
  /** Stima di Claude, non ufficiale (§7.5): ore all'anno; null senza dati. */
  claudeHoursPerYear: number | null;
  version: number;
  /** Apre il pannello laterale. */
  href: string;
}

export interface DiffuseListProps {
  workspaceId: string;
  /** Già in ordine: ore all'anno stimate, dalla più alta; senza stima in fondo (`buildPriority`). */
  items: readonly DiffuseItem[];
  /** `abilitiesForUseCase(viewer).canDecide`: senza, niente «Segna come diffusa». */
  canDecide: boolean;
}

/**
 * «Priorità › Da diffondere» (docs/use-case/DESIGN.md §4.4, §7.5): le best practice approvate e
 * non ancora diffuse. Codice, titolo, origine, area, «circa 180 ore all'anno» in grigio (è la
 * stima di Claude, non ufficiale) e il pulsante `outline` «Segna come diffusa», con la sua
 * conferma. Niente matrice e niente costo: non competono per il budget di sviluppo.
 */
export function DiffuseList({ workspaceId, items, canDecide }: DiffuseListProps) {
  const [confirm, setConfirm] = useState<DiffuseItem | null>(null);
  const { run, pending } = useDecisionRunner();

  async function submit(): Promise<DecisionActionResult> {
    const target = confirm;
    if (!target) return { ok: false, error: "riprova", message: "" };
    const result = await run(target, (version) => decideUseCaseAction(workspaceId, target.id, version, { type: "segna_diffusa" }));
    if (result.ok) setConfirm(null);
    return result;
  }

  return (
    <>
      <ul data-slot="diffuse-list" className="divide-y divide-border/70">
        {items.map((item) => (
          // Le colonne quando il riquadro della pagina (`@container/hub` di hub.tsx) è largo almeno
          // 56rem: da sole chiedono circa 46rem più il titolo. Sulla finestra (`lg`) a 1024 px, accanto
          // alla barra laterale, «Segna come diffusa» usciva dalla pagina.
          <li
            key={item.id}
            data-id={item.id}
            className="flex flex-col gap-2 px-3 py-2.5 @4xl/hub:grid @4xl/hub:grid-cols-[4.5rem_minmax(0,1fr)_8.75rem_9rem_11rem_auto] @4xl/hub:items-center @4xl/hub:gap-3"
          >
            <span className="flex min-w-0 items-baseline gap-3 @4xl/hub:contents">
              <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums empty:hidden @4xl/hub:empty:block">{item.code ?? ""}</span>
              <Link href={item.href} scroll={false} title={item.title} className="min-w-0 truncate text-sm font-semibold text-foreground outline-none hover:underline focus-visible:underline">
                {item.title}
              </Link>
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 @4xl/hub:contents">
              <span className="min-w-0">
                <OriginChip origin={item.origin} />
              </span>
              <span className="min-w-0 truncate text-sm">{item.area ?? ""}</span>
              <span className="text-sm text-muted-foreground">{item.claudeHoursPerYear !== null ? hoursLabel(item.claudeHoursPerYear) : ""}</span>
            </span>
            {canDecide ? (
              <span className="@4xl/hub:justify-self-end">
                <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => setConfirm(item)}>
                  {DECISION_LABEL.segna_diffusa}
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {confirm ? (
        <ConfirmDecisionDialog
          open
          onOpenChange={(next) => {
            if (!next) setConfirm(null);
          }}
          decision="segna_diffusa"
          code={confirm.code}
          pending={pending}
          onSubmit={submit}
        />
      ) : null}
    </>
  );
}
