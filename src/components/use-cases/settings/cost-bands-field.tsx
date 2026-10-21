"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { saveCostBandsAction } from "@/lib/actions/use-case-settings";
import type { CostBandInfo } from "@/lib/use-cases/cost-bands";
import { VALUATION_SETTINGS_TEXT, bandFieldName, proposedLabelAction } from "@/lib/use-cases/settings";
import {
  COST_BAND_COUNT,
  applyProposedLabel,
  defaultCostBandsDraft,
  draftErrors,
  draftFromBands,
  draftInput,
  isDefaultDraft,
  labelProposal,
  sameDraft,
  setDraftLabel,
  setDraftLimit,
  setDraftTopReference,
  tidyDraft,
  type CostBandsDraft,
} from "@/lib/use-cases/settings-bands";
import { cn } from "@/lib/utils";
import { SaveRow } from "./save-row";

const TEXT = VALUATION_SETTINGS_TEXT.costBands;
const SYMBOLS = ["€", "€€", "€€€", "€€€€", "€€€€€"] as const;
/** Ogni campo segnato come toccato mostra i suoi errori; «*» li mostra tutti (dopo «Salva»). */
const ALL = "*";

/** La chiave dell'errore di un campo, come la scrive `validateCostBands`. */
type FieldKey = `limits.${number}` | `labels.${number}` | "topReferenceEur";

const LINK = "text-sm font-medium text-primary underline underline-offset-4 outline-none hover:decoration-2 focus-visible:decoration-2 disabled:opacity-50";

/**
 * «Fasce del costo» di Impostazioni › Valutazione (docs/use-case/DESIGN.md §7.2 «Fasce del
 * workspace», §14.3; D15). Per ogni fascia il simbolo, «Fino a» (la quinta non ce l'ha) ed
 * «Etichetta»; per la quinta «Valore nei totali». Parte dalle fasce del workspace o dalle
 * predefinite, propone l'etichetta quando cambia un confine, valida con `validateCostBands`
 * (la stessa dell'action) e, prima di salvare, dice che i costi già salvati non cambiano.
 * La logica sta in `src/lib/use-cases/settings-bands.ts`.
 */
export function CostBandsField({ workspaceId, bands }: { workspaceId: string; bands: readonly CostBandInfo[] }) {
  const baseId = `fasce-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [saved, setSaved] = useState<CostBandsDraft>(() => draftFromBands(bands));
  const [draft, setDraft] = useState<CostBandsDraft>(saved);
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const errors: Record<string, string> = { ...draftErrors(draft), ...serverErrors };
  const dirty = !sameDraft(draft, saved);
  const shownError = (key: FieldKey) => (touched.has(key) || touched.has(ALL) ? errors[key] : undefined);
  const formError = touched.has(ALL) ? (errors.limits ?? errors.labels ?? errors.payload) : undefined;

  function update(next: CostBandsDraft) {
    setDraft(next);
    setServerErrors({});
  }

  function touch(key: FieldKey) {
    setTouched((current) => new Set(current).add(key));
    setDraft((current) => tidyDraft(current));
  }

  function restart(next: CostBandsDraft) {
    update(next);
    setTouched(new Set());
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tidy = tidyDraft(draft);
    setDraft(tidy);
    if (Object.keys(draftErrors(tidy)).length) {
      setTouched(new Set([ALL]));
      return;
    }
    startTransition(async () => {
      try {
        const result = await saveCostBandsAction(workspaceId, draftInput(tidy));
        if (result.ok) {
          const next = draftFromBands(result.value.costBands);
          setSaved(next);
          setDraft(next);
          setTouched(new Set());
          setServerErrors({});
          toast.success(TEXT.saved);
        } else {
          setServerErrors(result.fieldErrors ?? {});
          setTouched(new Set([ALL]));
          if (!result.fieldErrors) toast.error(result.message);
        }
      } catch {
        toast.error(VALUATION_SETTINGS_TEXT.failed);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-slot="cost-bands-field" noValidate>
      <div className="flex flex-col gap-2 @md:flex-row @md:items-start @md:justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{TEXT.title}</h3>
          <p className="text-sm text-muted-foreground">{TEXT.help}</p>
        </div>
        {!isDefaultDraft(draft) && (
          <button type="button" disabled={pending} className={cn(LINK, "self-start @md:shrink-0")} onClick={() => restart(defaultCostBandsDraft())}>
            {TEXT.reset}
          </button>
        )}
      </div>

      <div className="space-y-3 @md:space-y-2">
        <div aria-hidden className="hidden text-xs font-medium text-muted-foreground @md:grid @md:grid-cols-[4.5rem_11rem_minmax(0,1fr)] @md:gap-3">
          <span />
          <span>{TEXT.limit}</span>
          <span>{TEXT.label}</span>
        </div>
        {Array.from({ length: COST_BAND_COUNT }, (_, index) => {
          const symbol = SYMBOLS[index];
          const isTop = index === COST_BAND_COUNT - 1;
          const amountKey: FieldKey = isTop ? "topReferenceEur" : `limits.${index}`;
          const labelKey: FieldKey = `labels.${index}`;
          const amountId = `${baseId}-importo-${index}`;
          const labelId = `${baseId}-etichetta-${index}`;
          const amountError = shownError(amountKey);
          const labelError = shownError(labelKey);
          const proposal = labelProposal(draft, saved, index);
          const amountName = isTop ? TEXT.topReference : TEXT.limit;
          return (
            <div
              key={symbol}
              data-band={index + 1}
              className={cn(
                "grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg border p-3",
                "@md:grid-cols-[4.5rem_11rem_minmax(0,1fr)] @md:border-0 @md:p-0",
                isTop ? "@md:items-end" : "@md:items-start",
              )}
            >
              <span className={cn("row-span-2 pt-1.5 font-mono text-sm text-muted-foreground @md:row-span-1", isTop && "@md:pb-1.5")}>{symbol}</span>
              <div className="space-y-1">
                <label htmlFor={amountId} className={cn("block text-xs font-medium text-muted-foreground", !isTop && "@md:sr-only")}>
                  {amountName}
                </label>
                <div className="relative">
                  <Input
                    id={amountId}
                    value={isTop ? draft.topReference : draft.limits[index]}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-label={bandFieldName(amountName, symbol)}
                    aria-invalid={amountError ? true : undefined}
                    aria-describedby={amountError ? `${amountId}-errore` : undefined}
                    className="pr-8 tabular-nums"
                    onChange={(event) =>
                      update(isTop ? setDraftTopReference(draft, event.target.value) : setDraftLimit(draft, index, event.target.value))
                    }
                    onBlur={() => touch(amountKey)}
                  />
                  <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                    €
                  </span>
                </div>
                {amountError && (
                  <p id={`${amountId}-errore`} role="alert" className="text-xs text-destructive">
                    {amountError}
                  </p>
                )}
              </div>
              <div className="col-start-2 space-y-1 @md:col-start-auto">
                <label htmlFor={labelId} className="block text-xs font-medium text-muted-foreground @md:sr-only">
                  {TEXT.label}
                </label>
                <Input
                  id={labelId}
                  value={draft.labels[index]}
                  autoComplete="off"
                  aria-label={bandFieldName(TEXT.label, symbol)}
                  aria-invalid={labelError ? true : undefined}
                  aria-describedby={labelError ? `${labelId}-errore` : undefined}
                  onChange={(event) => update(setDraftLabel(draft, index, event.target.value))}
                  onBlur={() => touch(labelKey)}
                />
                {labelError && (
                  <p id={`${labelId}-errore`} role="alert" className="text-xs text-destructive">
                    {labelError}
                  </p>
                )}
                {proposal !== null && (
                  <button type="button" className={cn(LINK, "text-xs")} onClick={() => update(applyProposedLabel(draft, index))}>
                    {proposedLabelAction(proposal)}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      {dirty && (
        <SaveRow label={TEXT.save} pending={pending} onCancel={() => restart(saved)}>
          <p role="note" className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <span>{TEXT.warning}</span>
          </p>
        </SaveRow>
      )}
    </form>
  );
}
