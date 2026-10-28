"use client";

import { useOptimistic, useState } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { decideUseCaseAction, setWhenAction } from "@/lib/actions/use-case-decisions";
import {
  currentWhenChoice,
  instantOfDay,
  whenOptions,
  type DecisionActionResult,
  type DecisionItem,
  type PageDecision,
} from "@/lib/use-cases/decision-ui";
import { whenChoiceParts, whenChoiceShortLabel, whenLabel } from "@/lib/use-cases/quarter";
import type { WhenChoice } from "@/lib/use-cases/types";
import { cn } from "@/lib/utils";
import { ApproveDialog } from "./approve-dialog";
import { useDecisionRunner } from "./decision-buttons";

export interface WhenControlProps {
  workspaceId: string;
  item: DecisionItem;
  /** Oggi a Roma (`AAAA-MM-GG`), letto sul server: le etichette dei trimestri. */
  today: string;
  /** `abilitiesForUseCase(viewer).canDecide`: senza, «Quando» si legge e basta. */
  canDecide: boolean;
  /**
   * `segmentato` (scheda e pannello laterale, §6.4 e §4.8) oppure `select` (la riga della
   * lista di «Priorità», §4.4).
   */
  variant?: "segmentato" | "select";
  /** L'id dell'etichetta «Quando» che sta accanto. */
  labelledBy?: string;
  className?: string;
}

/** Testi del controllo (§4.4, §6.4). */
export const WHEN_CONTROL_TEXT = Object.freeze({
  /**
   * Nella riga di «Priorità», su uno use case da decidere: il menu senza scelta. Una scelta apre
   * il dialogo «Approva» con quel trimestre già scelto.
   */
  choose: "Scegli…",
});

/**
 * «Quando» di uno use case (docs/use-case/DESIGN.md §3.6, §4.4, §4.8, §6.4): «Questo trimestre
 * (T4 2026)», «Prossimo trimestre (T1 2027)», «Più avanti».
 * - Approvato: la scelta cambia solo il trimestre (`setWhenAction`). Un trimestre che non è né
 *   questo né il prossimo (passato, o scelto via MCP del team) non seleziona nessuna scelta.
 *   Il controllo segmentato mette il trimestre sotto la parola e non va mai a capo (pannello,
 *   telefono); il `Select` in riga mostra la forma corta («T1 2027»), intera, e nell'elenco le
 *   scelte per esteso.
 * - Da decidere, solo nel `Select` in riga di «Priorità» (§4.4): il menu parte da «Scegli…» e
 *   la scelta vale come «Approva», ma non approva in silenzio: apre il dialogo di conferma con
 *   quella scelta già fatta.
 * - Chi non decide legge il trimestre («T1 2027», «Più avanti»), solo se approvato.
 * Le scritture portano `today`, il giorno delle etichette: se nel frattempo è cominciato un
 * altro trimestre, l'action non salva e la pagina si rilegge con le etichette nuove.
 */
export function WhenControl({ workspaceId, item, today, canDecide, variant = "segmentato", labelledBy, className }: WhenControlProps) {
  const now = instantOfDay(today);
  const options = whenOptions(now);
  const current = currentWhenChoice(item.targetQuarter, now);
  const [shown, setShown] = useOptimistic(current);
  const [approveWith, setApproveWith] = useState<WhenChoice | null>(null);
  const { run, pending } = useDecisionRunner();

  const approved = item.phase === "approvato";
  const approvesHere = item.phase === "da_valutare" && variant === "select";
  if (!canDecide || (!approved && !approvesHere)) {
    if (!approved) return null;
    return (
      <span data-slot="when-control" className={cn("text-sm", className)}>
        {whenLabel(item.targetQuarter)}
      </span>
    );
  }

  function choose(choice: WhenChoice) {
    if (approvesHere) {
      setApproveWith(choice);
      return;
    }
    // Il confronto è con la scelta a schermo, che può essere ancora in volo: tornare alla scelta
    // salvata mentre l'altra si sta scrivendo è una scrittura anche lei.
    if (choice === shown) return;
    void run(
      item,
      (version) => setWhenAction(workspaceId, item.id, version, choice, today),
      () => setShown(choice),
    );
  }

  async function approve(decision: PageDecision): Promise<DecisionActionResult> {
    const result = await run(item, (version) => decideUseCaseAction(workspaceId, item.id, version, decision, today));
    if (result.ok) setApproveWith(null);
    return result;
  }

  const fromValue = (value: unknown) => options.find((option) => option.choice === value)?.choice ?? null;

  if (variant === "select") {
    return (
      <>
        <Select
          // Nel riquadro la forma corta, sempre intera; nell'elenco le scelte per esteso.
          items={options.map((option) => ({ value: option.choice, label: whenChoiceShortLabel(option.choice, now) }))}
          // Da decidere nessuna scelta resta nel menu: la conferma è del dialogo.
          value={approvesHere ? null : shown}
          onValueChange={(value) => {
            const choice = fromValue(value);
            if (choice) choose(choice);
          }}
        >
          <SelectTrigger data-slot="when-control" aria-labelledby={labelledBy} aria-busy={pending || undefined} className={cn("min-h-11 w-full sm:min-h-8 sm:w-auto", className)}>
            <SelectValue placeholder={approvesHere ? WHEN_CONTROL_TEXT.choose : whenLabel(item.targetQuarter)} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.choice} value={option.choice}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {approveWith ? (
          <ApproveDialog
            open
            onOpenChange={(next) => {
              if (!next) setApproveWith(null);
            }}
            item={item}
            today={today}
            defaultWhen={approveWith}
            pending={pending}
            onSubmit={approve}
          />
        ) : null}
      </>
    );
  }

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
