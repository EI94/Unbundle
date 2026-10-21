"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveThresholdsAction } from "@/lib/actions/use-case-settings";
import type { CostBandInfo } from "@/lib/use-cases/cost-bands";
import {
  VALUATION_SETTINGS_TEXT,
  costLowBandOptions,
  parseThresholds,
  thresholdsInputTexts as textsOf,
  thresholdsTextsChanged,
  type ThresholdsTexts as Texts,
  type ThresholdsValue,
} from "@/lib/use-cases/settings";
import { SaveRow } from "./save-row";

const TEXT = VALUATION_SETTINGS_TEXT.thresholds;

/**
 * «Soglie» di Impostazioni › Valutazione (docs/use-case/DESIGN.md §7.1, §7.2, §7.4, §14.3;
 * D15, D18): «Valore alto da» (`thresholds.highImpact`) e «Costo basso fino alla fascia»
 * (`thresholds.costLowBand`, una delle fasce 1-4 del workspace, predefinita la 1). Insieme
 * decidono le zone e le linee della matrice. La soglia del valore medio resta nel modulo del
 * modello: «Valore alto da» non può scendere sotto.
 */
export function ThresholdsField({
  workspaceId,
  initial,
  midImpact,
  bands,
}: {
  workspaceId: string;
  initial: ThresholdsValue;
  midImpact: number;
  /** Le fasce del costo del workspace (D15): le scelte del costo basso con le loro etichette. */
  bands: readonly CostBandInfo[];
}) {
  const baseId = `soglie-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [saved, setSaved] = useState<ThresholdsValue>(initial);
  const [texts, setTexts] = useState<Texts>(() => textsOf(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const parsed = parseThresholds(texts, { midImpact });
  // Alla precisione dei campi: una soglia salvata con più decimali non risulta modificata.
  const dirty = thresholdsTextsChanged(texts, saved);

  function change(key: keyof Texts, value: string) {
    setTexts((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parsed.ok) {
      setErrors(parsed.fieldErrors);
      return;
    }
    startTransition(async () => {
      try {
        const result = await saveThresholdsAction(workspaceId, texts);
        if (result.ok) {
          setErrors({});
          setSaved(result.value);
          setTexts(textsOf(result.value));
          toast.success(TEXT.saved);
        } else {
          setErrors(result.fieldErrors ?? {});
          if (!result.fieldErrors) toast.error(result.message);
        }
      } catch {
        toast.error(VALUATION_SETTINGS_TEXT.failed);
      }
    });
  }

  const highId = `${baseId}-highImpact`;
  const highError = errors.highImpact;
  const bandId = `${baseId}-costLowBand`;
  const bandError = errors.costLowBand;
  const bandOptions = costLowBandOptions(bands);

  return (
    <form onSubmit={submit} className="space-y-3" data-slot="thresholds-field" noValidate>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{TEXT.title}</h3>
        <p id={`${baseId}-aiuto`} className="text-sm text-muted-foreground">
          {TEXT.help}
        </p>
      </div>
      <div className="grid gap-4 @md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={highId}>{TEXT.highImpact}</Label>
          <div className="relative max-w-36">
            <Input
              id={highId}
              name="highImpact"
              value={texts.highImpact}
              inputMode="decimal"
              autoComplete="off"
              aria-describedby={highError ? `${baseId}-aiuto ${highId}-errore` : `${baseId}-aiuto`}
              aria-invalid={highError ? true : undefined}
              className="pr-12"
              onChange={(event) => change("highImpact", event.target.value)}
            />
            <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
              {TEXT.highImpactSuffix}
            </span>
          </div>
          {highError && (
            <p id={`${highId}-errore`} role="alert" className="text-sm text-destructive">
              {highError}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label id={`${bandId}-etichetta`}>{TEXT.costLowBand}</Label>
          <Select items={bandOptions} value={texts.costLowBand} onValueChange={(next) => change("costLowBand", typeof next === "string" ? next : "")}>
            <SelectTrigger
              aria-labelledby={`${bandId}-etichetta`}
              aria-describedby={bandError ? `${baseId}-aiuto ${bandId}-errore` : `${baseId}-aiuto`}
              aria-invalid={bandError ? true : undefined}
              data-slot="cost-low-band"
              className="min-h-11 w-full max-w-72 sm:min-h-9"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {bandOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {bandError && (
            <p id={`${bandId}-errore`} role="alert" className="text-sm text-destructive">
              {bandError}
            </p>
          )}
        </div>
      </div>
      {dirty && (
        <SaveRow
          label={TEXT.save}
          pending={pending}
          onCancel={() => {
            setTexts(textsOf(saved));
            setErrors({});
          }}
        />
      )}
    </form>
  );
}
