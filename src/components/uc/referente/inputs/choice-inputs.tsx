"use client";

import { choiceList } from "@/lib/uc/views/referente-form";
import { CHOICE_ROW_CLASS, Field, FieldErrors, NATIVE_CHECK_CLASS, RadioRows, SelectControl, TextControl, issuesFor, obj, text, type InputProps } from "./fields";

/**
 * Input delle scelte: `si_no`, `scelta` (elenco del template; con molte
 * opzioni un menu nativo), `scelta_multipla`. «Non lo so» non è mai tra le
 * opzioni: è il pulsante sotto la domanda. «Altro» chiede il testo.
 */

/** Oltre queste opzioni la scelta singola diventa un menu nativo. */
const MAX_RADIOS = 8;

export function YesNoInput({ id, value, onChange, issues, disabled, label }: InputProps) {
  const v = obj(value);
  const current = v.value === true ? "si" : v.value === false ? "no" : "";
  return (
    <RadioRows
      name={`${id}-yn`}
      value={current}
      onChange={(x) => onChange({ value: x === "si" })}
      disabled={disabled}
      legend={label}
      columns={2}
      options={[
        { value: "si", label: "Sì" },
        { value: "no", label: "No" },
      ]}
      issues={issues}
    />
  );
}

export function ChoiceInput({ id, config, value, onChange, issues, disabled, label }: InputProps) {
  const v = obj(value);
  const options = choiceList(config);
  const selected = options.find((o) => o.value === text(v.option));
  const set = (patch: Record<string, string>) => onChange({ ...v, ...patch });
  const optionIssues = issuesFor(issues, "option");
  return (
    <div className="space-y-3">
      {options.length > MAX_RADIOS ? (
        <SelectControl
          id={`${id}-option`}
          value={text(v.option)}
          onChange={(x) => set({ option: x })}
          disabled={disabled}
          invalid={optionIssues.length > 0}
          options={options.map((o) => ({ value: o.value, label: o.label }))}
          placeholder="Scegli"
          ariaLabel={label}
        />
      ) : (
        <RadioRows name={`${id}-option`} value={text(v.option)} onChange={(x) => set({ option: x })} disabled={disabled} legend={label} options={options} />
      )}
      <FieldErrors issues={optionIssues} />
      {selected?.other ? (
        <Field label="Quale?" htmlFor={`${id}-other`} issues={issuesFor(issues, "other_text")}>
          <TextControl id={`${id}-other`} value={text(v.other_text)} onChange={(x) => set({ other_text: x })} disabled={disabled} invalid={issuesFor(issues, "other_text").length > 0} />
        </Field>
      ) : null}
    </div>
  );
}

export function MultiChoiceInput({ id, config, value, onChange, issues, disabled, label }: InputProps) {
  const v = obj(value);
  const chosen = Array.isArray(v.options) ? v.options.filter((x): x is string => typeof x === "string") : [];
  const options = choiceList(config);
  const otherChosen = options.some((o) => o.other && chosen.includes(o.value));
  const toggle = (option: string, on: boolean) => {
    const next = on ? [...chosen.filter((c) => c !== option), option] : chosen.filter((c) => c !== option);
    onChange({ ...v, options: options.map((o) => o.value).filter((o) => next.includes(o)) });
  };
  return (
    <div className="space-y-3">
      <fieldset className="min-w-0 space-y-2">
        <legend className="sr-only">{label}</legend>
        <p className="text-sm text-muted-foreground">Puoi sceglierne più di una.</p>
        <div className="grid gap-2">
          {options.map((o) => (
            <label key={o.value} className={CHOICE_ROW_CLASS}>
              <input type="checkbox" checked={chosen.includes(o.value)} onChange={(e) => toggle(o.value, e.target.checked)} disabled={disabled} className={NATIVE_CHECK_CLASS} />
              <span className="min-w-0 break-words">{o.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <FieldErrors issues={issues.filter((i) => i.field !== "other_text")} />
      {otherChosen ? (
        <Field label="Quale?" htmlFor={`${id}-other`} issues={issuesFor(issues, "other_text")}>
          <TextControl id={`${id}-other`} value={text(v.other_text)} onChange={(x) => onChange({ ...v, other_text: x })} disabled={disabled} invalid={issuesFor(issues, "other_text").length > 0} />
        </Field>
      ) : null}
    </div>
  );
}
