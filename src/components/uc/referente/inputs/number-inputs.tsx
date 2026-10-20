"use client";

import { durationUnitChoice, numberUnitChoice } from "@/lib/uc/views/referente-form";
import { Field, FieldErrors, SelectControl, Suffix, TextControl, issuesFor, obj, text, type InputProps } from "./fields";

/**
 * Input dei numeri: `numero` (con l'unità del template, convertibile: piedi →
 * metri), `percentuale` (con la base) e `durata` (minuti, ore, giorni; anche
 * «2:30» o «1 ora e 30»). La tastiera del telefono è quella decimale.
 */

export function NumberInput({ id, config, value, onChange, issues, disabled, label }: InputProps) {
  const v = obj(value);
  const unit = numberUnitChoice(config);
  const valueIssues = issuesFor(issues, "value");
  const unitIssues = issuesFor(issues, "unit");
  const set = (patch: Record<string, string>) => onChange({ ...v, ...patch });
  return (
    <div className="space-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <TextControl
          id={`${id}-value`}
          value={text(v.value)}
          onChange={(x) => set({ value: x })}
          disabled={disabled}
          invalid={valueIssues.length > 0}
          inputMode="decimal"
          placeholder="Il valore"
          ariaLabel={label}
          className="flex-1 basis-40"
        />
        {unit.mode === "fissa" || unit.mode === "scelta" ? (
          <SelectControl
            id={`${id}-unit`}
            value={text(v.unit)}
            onChange={(x) => set({ unit: x })}
            disabled={disabled}
            invalid={unitIssues.length > 0}
            options={unit.options.map((o) => ({ value: o.code, label: o.label }))}
            placeholder={unit.mode === "scelta" ? "Unità" : undefined}
            ariaLabel="Unità"
            className="w-auto basis-36"
          />
        ) : unit.label ? (
          <Suffix>{unit.label}</Suffix>
        ) : null}
      </div>
      <FieldErrors id={`${id}-value-err`} issues={[...valueIssues, ...unitIssues]} />
    </div>
  );
}

export function PercentInput({ id, value, onChange, issues, disabled, label }: InputProps) {
  const v = obj(value);
  const valueIssues = issuesFor(issues, "value");
  const set = (patch: Record<string, string>) => onChange({ ...v, ...patch });
  return (
    <div className="space-y-3">
      <div className="flex min-w-0 items-center gap-2">
        <TextControl
          id={`${id}-value`}
          value={text(v.value)}
          onChange={(x) => set({ value: x })}
          disabled={disabled}
          invalid={valueIssues.length > 0}
          inputMode="decimal"
          placeholder="Per esempio 12,5"
          ariaLabel={label}
          className="max-w-48"
        />
        <Suffix>%</Suffix>
      </div>
      <FieldErrors id={`${id}-value-err`} issues={valueIssues} />
      <Field label="Su cosa si calcola" htmlFor={`${id}-base`} issues={issuesFor(issues, "base")} hint="Per esempio «del venduto» o «delle richieste».">
        <TextControl id={`${id}-base`} value={text(v.base)} onChange={(x) => set({ base: x })} disabled={disabled} invalid={issuesFor(issues, "base").length > 0} />
      </Field>
    </div>
  );
}

export function DurationInput({ id, config, value, onChange, issues, disabled, label }: InputProps) {
  const v = obj(value);
  const unit = durationUnitChoice(config);
  const amountIssues = issuesFor(issues, "amount");
  const unitIssues = issuesFor(issues, "unit");
  const set = (patch: Record<string, string>) => onChange({ ...v, ...patch });
  return (
    <div className="space-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <TextControl
          id={`${id}-amount`}
          value={text(v.amount)}
          onChange={(x) => set({ amount: x })}
          disabled={disabled}
          invalid={amountIssues.length > 0}
          inputMode="decimal"
          placeholder="Per esempio 1,5"
          ariaLabel={label}
          className="flex-1 basis-40"
        />
        <SelectControl
          id={`${id}-unit`}
          value={text(v.unit)}
          onChange={(x) => set({ unit: x })}
          disabled={disabled}
          invalid={unitIssues.length > 0}
          options={unit.options.map((o) => ({ value: o.code, label: o.label }))}
          placeholder="Unità"
          ariaLabel="Unità"
          className="w-auto basis-36"
        />
      </div>
      <p className="text-sm text-muted-foreground">Puoi scrivere anche «2:30» o «1 ora e 30».</p>
      <FieldErrors id={`${id}-amount-err`} issues={[...amountIssues, ...unitIssues]} />
    </div>
  );
}
