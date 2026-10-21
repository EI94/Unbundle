"use client";

import { useId, useState } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COST_BANDS, type CostBandInfo } from "@/lib/use-cases/cost-bands";
import { cn } from "@/lib/utils";
import {
  COST_FIELD_NAME,
  COST_INPUT_TEXT,
  bandOptions,
  chooseBand,
  clearCost,
  costFormValue,
  costInputValue,
  hasCostValue,
  initialCostInputState,
  setAmountText,
  switchToAmount,
  switchToBand,
  type CostInputState,
  type CostValueResult,
  type SavedCost,
} from "./cost-input-state";

export interface CostInputProps {
  /** Nome del campo nascosto del modulo (`costFormValue`; l'action lo legge con `readCostFormValue`). Predefinito «cost». */
  name?: string;
  /** Il costo salvato della scheda (`costEurOnce`, `costBand`): si parte dall'importo o dalla fascia. */
  defaultValue?: SavedCost | null;
  /** Le 5 fasce del workspace (D15, `resolveCostBands`); predefinite `COST_BANDS`. */
  bands?: readonly CostBandInfo[];
  /** A ogni cambio: il valore da salvare (`{ eurOnce }`, `{ band }` o `null`) oppure l'errore dell'importo. */
  onValueChange?: (result: CostValueResult) => void;
  /** Errore restituito dall'action per questo campo. */
  error?: string | null;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * Il campo «Costo di realizzazione» (docs/use-case/DESIGN.md §5.4, D5, D15): importo una
 * tantum, oppure una delle 5 fasce del workspace. Lo usano il modulo completo (revisori) e
 * «Modifica valutazione». Manda un solo campo nascosto (`name`), mai importo e fascia insieme;
 * della fascia si salva l'indice. La logica sta in `cost-input-state.ts`.
 */
export function CostInput({
  name = COST_FIELD_NAME,
  defaultValue,
  bands = COST_BANDS,
  onValueChange,
  error,
  disabled = false,
  id,
  className,
}: CostInputProps) {
  const generatedId = useId();
  const baseId = id ?? `costo-${generatedId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const labelId = `${baseId}-etichetta`;
  const helpId = `${baseId}-aiuto`;
  const errorId = `${baseId}-errore`;
  const amountId = `${baseId}-importo`;

  const [state, setState] = useState<CostInputState>(() => initialCostInputState(defaultValue));
  const [touched, setTouched] = useState(false);

  function update(next: CostInputState) {
    setState(next);
    onValueChange?.(costInputValue(next));
  }

  const result = costInputValue(state);
  const amountError = state.mode === "importo" && touched && !result.ok ? result.message : null;
  const shownError = amountError ?? (error || null);
  const describedBy = shownError ? `${helpId} ${errorId}` : helpId;
  const options = bandOptions(bands);

  return (
    <div role="group" aria-labelledby={labelId} data-slot="cost-input" data-mode={state.mode} className={cn("space-y-2", className)}>
      <input type="hidden" name={name} value={costFormValue(state)} />
      <div className="space-y-1">
        <Label id={labelId} htmlFor={state.mode === "importo" ? amountId : undefined}>
          {COST_INPUT_TEXT.label}
        </Label>
        <p id={helpId} className="text-sm text-muted-foreground">
          {state.mode === "importo" ? COST_INPUT_TEXT.amountHelp : COST_INPUT_TEXT.bandHelp}
        </p>
      </div>

      {state.mode === "importo" ? (
        <div className="relative w-full max-w-60">
          <Input
            id={amountId}
            inputMode="numeric"
            autoComplete="off"
            placeholder={COST_INPUT_TEXT.amountPlaceholder}
            value={state.amountText}
            disabled={disabled}
            aria-describedby={describedBy}
            aria-invalid={shownError ? true : undefined}
            className="pr-8"
            onChange={(event) => update(setAmountText(state, event.target.value))}
            onBlur={() => setTouched(true)}
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
            {COST_INPUT_TEXT.amountSuffix}
          </span>
        </div>
      ) : (
        <RadioGroup<string | null>
          value={state.band === null ? null : String(state.band)}
          onValueChange={(value) => update(chooseBand(state, value))}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          className="grid gap-0.5"
        >
          {options.map((option) => (
            <label
              key={option.value}
              className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
            >
              <Radio.Root
                value={option.value}
                // Il bordo si vede anche col tema scuro (H4p): `border-input` lì quasi sparisce.
                className="flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/70 bg-background outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:border-primary data-checked:bg-primary data-disabled:opacity-50"
              >
                <Radio.Indicator className="size-1.5 rounded-full bg-primary-foreground" />
              </Radio.Root>
              <span className="w-14 shrink-0 font-mono text-sm text-muted-foreground">{option.symbol}</span>
              <span className="min-w-0 text-sm">{option.label}</span>
            </label>
          ))}
        </RadioGroup>
      )}

      {shownError && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {shownError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          disabled={disabled}
          className="text-sm font-medium text-primary underline underline-offset-4 outline-none hover:decoration-2 focus-visible:decoration-2 disabled:opacity-50"
          onClick={() => update(state.mode === "importo" ? switchToBand(state, bands) : switchToAmount(state))}
        >
          {state.mode === "importo" ? COST_INPUT_TEXT.toBand : COST_INPUT_TEXT.toAmount}
        </button>
        {hasCostValue(state) && (
          <button
            type="button"
            disabled={disabled}
            className="text-sm text-muted-foreground underline underline-offset-4 outline-none hover:decoration-2 focus-visible:decoration-2 disabled:opacity-50"
            onClick={() => {
              setTouched(false);
              update(clearCost(state));
            }}
          >
            {COST_INPUT_TEXT.clear}
          </button>
        )}
      </div>
    </div>
  );
}
