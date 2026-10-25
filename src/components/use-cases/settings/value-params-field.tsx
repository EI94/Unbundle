"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { saveValueParamsAction } from "@/lib/actions/use-case-settings";
import { VALUATION_SETTINGS_TEXT } from "@/lib/use-cases/settings";
import type { ValueParams } from "@/lib/use-cases/value-model";
import {
  VALUE_PARAMS_TEXT,
  parseValueParamsTexts,
  valueParamsTexts,
  valueParamsTextsChanged,
  type ValueParamsField as FieldKey,
  type ValueParamsTexts,
} from "@/lib/use-cases/value-params-form";
import { SaveRow } from "./save-row";

const TEXT = VALUE_PARAMS_TEXT;

/** I campi numerici, a coppie: costi, soglie del Valore, mesi. */
const GROUPS: ReadonlyArray<readonly FieldKey[]> = [
  ["hourlyCostEur", "dayCostEur"],
  ["midValueEur", "highValueEur"],
  ["buildMonths", "rampMonths"],
  ["horizonMonths", "originMonth"],
];

/**
 * «Ipotesi di calcolo» di Impostazioni › Valutazione: costo di un'ora e di una giornata, soglie in
 * euro del Valore («Medio da», «Alto da»), mesi tra avvio ed entrata in uso, mesi per il
 * beneficio pieno, mesi e primo mese della curva, e se contare le voci da misurare. Solo chi
 * gestisce il workspace (la sezione non si monta per gli altri; l'action rifà il controllo).
 * Salva e Annulla compaiono solo con una modifica.
 */
export function ValueParamsField({
  workspaceId,
  initial,
  storedOriginMonth,
}: {
  workspaceId: string;
  initial: ValueParams;
  /** Il primo mese salvato; null: il workspace segue il mese corrente. */
  storedOriginMonth: string | null;
}) {
  const baseId = `ipotesi-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [saved, setSaved] = useState<ValueParamsTexts>(() => valueParamsTexts(initial, storedOriginMonth));
  const [texts, setTexts] = useState<ValueParamsTexts>(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const dirty = valueParamsTextsChanged(texts, saved);

  function change<K extends keyof ValueParamsTexts>(key: K, value: ValueParamsTexts[K]) {
    setTexts((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseValueParamsTexts(texts);
    if (!parsed.ok) {
      setErrors(parsed.fieldErrors);
      return;
    }
    startTransition(async () => {
      try {
        const result = await saveValueParamsAction(workspaceId, texts);
        if (result.ok) {
          const next = valueParamsTexts(result.value.valueParams, result.value.storedOriginMonth);
          setErrors({});
          setSaved(next);
          setTexts(next);
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

  const helpId = `${baseId}-aiuto`;
  const switchId = `${baseId}-da-misurare`;

  return (
    <form onSubmit={submit} className="space-y-4" data-slot="value-params-field" noValidate>
      <p id={helpId} className="text-sm text-muted-foreground">
        {TEXT.help}
      </p>
      {GROUPS.map((group) => (
        <div key={group.join("-")} className="grid gap-4 @md:grid-cols-2">
          {group.map((key) => {
            const field = TEXT.fields[key];
            const id = `${baseId}-${key}`;
            const error = errors[key];
            const suffix = "suffix" in field ? field.suffix : null;
            const help = "help" in field ? field.help : null;
            const describedBy = [help ? `${id}-aiuto` : null, error ? `${id}-errore` : null].filter(Boolean).join(" ") || undefined;
            return (
              <div key={key} className="space-y-2">
                <Label htmlFor={id}>{field.label}</Label>
                {key === "originMonth" ? (
                  <Input
                    id={id}
                    type="month"
                    value={texts.originMonth}
                    aria-describedby={describedBy}
                    aria-invalid={error ? true : undefined}
                    className="max-w-48"
                    onChange={(event) => change("originMonth", event.target.value)}
                  />
                ) : (
                  <div className="relative max-w-56">
                    <Input
                      id={id}
                      value={texts[key]}
                      inputMode="decimal"
                      autoComplete="off"
                      aria-describedby={describedBy}
                      aria-invalid={error ? true : undefined}
                      className="pr-24"
                      onChange={(event) => change(key, event.target.value)}
                    />
                    {suffix ? (
                      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                        {suffix}
                      </span>
                    ) : null}
                  </div>
                )}
                {help ? (
                  <p id={`${id}-aiuto`} className="text-xs text-muted-foreground">
                    {help}
                  </p>
                ) : null}
                {error ? (
                  <p id={`${id}-errore`} role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
      <div className="flex items-start gap-3">
        <Switch
          id={switchId}
          checked={texts.includeUnmeasured}
          onCheckedChange={(checked) => change("includeUnmeasured", checked === true)}
          aria-describedby={`${switchId}-aiuto`}
          className="mt-0.5"
        />
        <div className="space-y-0.5">
          <Label htmlFor={switchId}>{TEXT.fields.includeUnmeasured.label}</Label>
          <p id={`${switchId}-aiuto`} className="text-xs text-muted-foreground">
            {TEXT.fields.includeUnmeasured.help}
          </p>
        </div>
      </div>
      {dirty && (
        <SaveRow
          label={TEXT.save}
          pending={pending}
          onCancel={() => {
            setTexts(saved);
            setErrors({});
          }}
        />
      )}
    </form>
  );
}
