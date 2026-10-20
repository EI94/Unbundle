"use client";

import { romeToday } from "@/lib/uc/answers/datetime";
import { intervalKindOf, intervalUnitChoice } from "@/lib/uc/views/referente-form";
import { Field, FieldErrors, SelectControl, Suffix, TextControl, issuesFor, obj, text, type InputProps } from "./fields";

/**
 * Input di date e orari: `data` (calendario del telefono), `data_ora` (data,
 * ora e fuso: si salva in UTC con il fuso d'origine) e `intervallo` (da – a,
 * con orari a cavallo della mezzanotte).
 */

function maxDate(config: InputProps["config"]): string | undefined {
  if (config.max_date === "today") return romeToday(new Date());
  return typeof config.max_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(config.max_date) ? config.max_date : undefined;
}

export function DateInput({ id, config, value, onChange, issues, disabled, label }: InputProps) {
  const own = issues.filter((i) => !i.field || i.field === "value" || i.field === "date");
  return (
    <div className="space-y-2">
      <TextControl id={`${id}-date`} type="date" value={text(value)} onChange={(x) => onChange(x)} disabled={disabled} invalid={own.length > 0} ariaLabel={label} max={maxDate(config)} className="max-w-56" />
      <FieldErrors id={`${id}-date-err`} issues={own} />
    </div>
  );
}

export function DateTimeInput({ id, config, value, onChange, issues, disabled, label }: InputProps) {
  const v = obj(value);
  const set = (patch: Record<string, string>) => onChange({ ...v, ...patch });
  const timeOnly = config.time_only === true;
  const tz = text(v.tz) || "Europe/Rome";
  return (
    <div className="space-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {timeOnly ? null : (
          <TextControl
            id={`${id}-date`}
            type="date"
            value={text(v.date)}
            onChange={(x) => set({ date: x })}
            disabled={disabled}
            invalid={issuesFor(issues, "date").length > 0}
            ariaLabel={`${label}: data`}
            max={maxDate(config)}
            className="w-auto flex-1 basis-40"
          />
        )}
        <TextControl
          id={`${id}-time`}
          type="time"
          value={text(v.time)}
          onChange={(x) => set({ time: x })}
          disabled={disabled}
          invalid={issuesFor(issues, "time").length > 0}
          ariaLabel={`${label}: ora`}
          className="w-auto basis-32"
        />
      </div>
      <p className="text-sm text-muted-foreground">Ora locale · fuso {tz === "UTC" ? "UTC" : tz.replace(/_/g, " ")}</p>
      <FieldErrors id={`${id}-time-err`} issues={issues} />
    </div>
  );
}

export function IntervalInput({ id, config, value, onChange, issues, disabled, label }: InputProps) {
  const v = obj(value);
  const set = (patch: Record<string, string>) => onChange({ ...v, ...patch });
  const kind = intervalKindOf(config);
  const type = kind === "ora" ? "time" : kind === "data" ? "date" : "text";
  const inputMode = kind === "numero" || kind === "durata" ? "decimal" : undefined;
  const placeholder = kind === "giorno_mese" ? "gg/mm" : kind === "numero" || kind === "durata" ? "Numero" : kind === null ? "Per esempio 10 o 22:00" : undefined;
  const unit = intervalUnitChoice(config);
  const end = (field: "from" | "to", text_: string) => (
    <Field label={text_} htmlFor={`${id}-${field}`} issues={issuesFor(issues, field)} className="flex-1 basis-36">
      <TextControl
        id={`${id}-${field}`}
        type={type}
        value={text(v[field])}
        onChange={(x) => set({ [field]: x })}
        disabled={disabled}
        invalid={issuesFor(issues, field).length > 0}
        inputMode={inputMode}
        placeholder={placeholder}
        ariaLabel={`${label}: ${text_.toLowerCase()}`}
      />
    </Field>
  );
  return (
    <div className="space-y-2">
      <div className="flex min-w-0 flex-wrap items-start gap-3">
        {end("from", "Da")}
        {end("to", "A")}
      </div>
      {unit && (unit.mode === "fissa" || unit.mode === "scelta") && unit.options.length > 0 ? (
        <Field label="Unità" htmlFor={`${id}-unit`} issues={issuesFor(issues, "unit")} className="max-w-56">
          <SelectControl
            id={`${id}-unit`}
            value={text(v.unit) || unit.defaultCode}
            onChange={(x) => set({ unit: x })}
            disabled={disabled}
            options={unit.options.map((o) => ({ value: o.code, label: o.label }))}
            placeholder={unit.defaultCode ? undefined : "Unità"}
          />
        </Field>
      ) : unit?.label ? (
        <Suffix>In {unit.label}.</Suffix>
      ) : null}
      {kind === "ora" ? <p className="text-sm text-muted-foreground">Se la fine è dopo mezzanotte, va bene: per esempio dalle 22:00 alle 06:00.</p> : null}
      <FieldErrors issues={issues.filter((i) => !i.field || !["from", "to", "unit"].some((f) => i.field === f || i.field!.startsWith(`${f}.`)))} />
    </div>
  );
}
