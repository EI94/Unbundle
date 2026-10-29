"use client";

import { useOptimistic } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { setWhenAction } from "@/lib/actions/use-case-decisions";
import { currentWhenChoice, instantOfDay, whenOptions, type DecisionItem } from "@/lib/use-cases/decision-ui";
import { whenChoiceParts, whenLabel } from "@/lib/use-cases/quarter";
import type { WhenChoice } from "@/lib/use-cases/types";
import { cn } from "@/lib/utils";
import { useDecisionRunner } from "./decision-buttons";

export interface WhenControlProps {
  workspaceId: string;
  item: DecisionItem;
  /** Oggi a Roma (`AAAA-MM-GG`), letto sul server: le etichette dei trimestri. */
  today: string;
  /** `abilitiesForUseCase(viewer).canDecide`: senza, «Quando» si legge e basta. */
  canDecide: boolean;
  /** L'id dell'etichetta «Quando» che sta accanto. */
  labelledBy?: string;
  className?: string;
}

/**
 * «Quando» di uno use case approvato (docs/use-case/DESIGN.md §3.6, §4.8, §6.4): un controllo
 * segmentato, nel pannello laterale e nel capitolo «Decisione» della scheda, con «Questo trimestre
 * (T4 2026)», «Prossimo trimestre (T1 2027)», «Più avanti».
 * - La scelta cambia solo il trimestre (`setWhenAction`). Un trimestre che non è né questo né il
 *   prossimo (passato, o scelto via MCP del team) non seleziona nessuna scelta. Il trimestre sta
 *   sotto la parola e il controllo non va mai a capo (pannello, telefono).
 * - Chi non decide legge il trimestre («T1 2027», «Più avanti»).
 * - Da decidere non c'è: il trimestre si sceglie approvando, nel dialogo di «Approva».
 * Le scritture portano `today`, il giorno delle etichette: se nel frattempo è cominciato un
 * altro trimestre, l'action non salva e la pagina si rilegge con le etichette nuove.
 */
export function WhenControl({ workspaceId, item, today, canDecide, labelledBy, className }: WhenControlProps) {
  const now = instantOfDay(today);
  const options = whenOptions(now);
  const current = currentWhenChoice(item.targetQuarter, now);
  const [shown, setShown] = useOptimistic(current);
  const { run, pending } = useDecisionRunner();

  if (item.phase !== "approvato") return null;
  if (!canDecide) {
    return (
      <span data-slot="when-control" className={cn("text-sm", className)}>
        {whenLabel(item.targetQuarter)}
      </span>
    );
  }

  function choose(choice: WhenChoice) {
    // Il confronto è con la scelta a schermo, che può essere ancora in volo: tornare alla scelta
    // salvata mentre l'altra si sta scrivendo è una scrittura anche lei.
    if (choice === shown) return;
    void run(
      item,
      (version) => setWhenAction(workspaceId, item.id, version, choice, today),
      () => setShown(choice),
    );
  }

  const fromValue = (value: unknown) => options.find((option) => option.choice === value)?.choice ?? null;

  return (
    <RadioGroup<string | null>
      data-slot="when-control"
      value={shown}
      onValueChange={(value) => {
        const choice = fromValue(value);
        if (choice) choose(choice);
      }}
      aria-labelledby={labelledBy}
      aria-busy={pending || undefined}
      className={cn("grid w-full max-w-md grid-cols-3 gap-1 rounded-lg bg-muted p-1", className)}
    >
      {options.map((option) => {
        const parts = whenChoiceParts(option.choice, now);
        return (
          <Radio.Root
            key={option.choice}
            value={option.choice}
            aria-label={option.label}
            className="flex min-h-11 min-w-0 cursor-pointer flex-col items-center justify-center rounded-md px-1.5 py-1 text-center text-muted-foreground outline-none transition-colors select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:bg-background data-checked:text-foreground data-checked:shadow-sm data-checked:inset-ring data-checked:inset-ring-input"
          >
            <span className="w-full truncate text-xs leading-tight">{parts.title}</span>
            {parts.quarter ? <span className="text-sm leading-tight font-medium whitespace-nowrap">{parts.quarter}</span> : null}
          </Radio.Root>
        );
      })}
    </RadioGroup>
  );
}
