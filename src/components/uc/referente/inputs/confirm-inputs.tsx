"use client";

import type { Json } from "@/lib/uc/types";
import { confirmationBase } from "@/lib/uc/answers/confirm";
import { Field, RadioRows, TextAreaControl, issuesFor, obj, text, type InputProps } from "./fields";

/**
 * Conferme: `conferma_regola` («È così», «Va corretta», «Non vale»; le
 * eccezioni si chiedono solo con «Va corretta», con «È così» si registra
 * «nessuna segnalata», DESIGN §4.3 R2b), `conferma_formula` e `conferma_valore`
 * come tipo della voce. Il testo da confermare è quello della domanda: si salva
 * la sua impronta. «Non lo so» è il pulsante sotto la domanda.
 */

export function RuleConfirmInput({ id, config, value, onChange, issues, disabled, label }: InputProps) {
  const v = obj(value);
  const choice = text(v.choice);
  const set = (patch: Record<string, string>) => onChange({ ...v, ...patch });
  const askExceptions = config.ask_exceptions === true;
  return (
    <div className="space-y-3">
      <RadioRows
        name={`${id}-choice`}
        value={choice}
        onChange={(x) => set({ choice: x })}
        disabled={disabled}
        legend={label}
        options={[
          { value: "confermo", label: "È così" },
          { value: "correggo", label: "Va corretta" },
          { value: "non_vale", label: "Non vale" },
        ]}
        issues={issuesFor(issues, "choice")}
      />
      {choice === "correggo" ? (
        <Field label="Come va scritta" htmlFor={`${id}-text`} issues={issuesFor(issues, "text")}>
          <TextAreaControl id={`${id}-text`} value={text(v.text)} onChange={(x) => set({ text: x })} disabled={disabled} invalid={issuesFor(issues, "text").length > 0} placeholder="Scrivi la regola come la applicate davvero" />
        </Field>
      ) : null}
      {choice === "correggo" ? (
        <Field
          label={askExceptions ? "Eccezioni" : "Eccezioni (facoltativo)"}
          htmlFor={`${id}-exceptions`}
          issues={issuesFor(issues, "exceptions")}
          hint={askExceptions ? "Se non ce ne sono, scrivi «nessuna»." : undefined}
        >
          <TextAreaControl id={`${id}-exceptions`} value={text(v.exceptions)} onChange={(x) => set({ exceptions: x })} disabled={disabled} invalid={issuesFor(issues, "exceptions").length > 0} placeholder="Eccezioni o casi particolari" rows={2} />
        </Field>
      ) : null}
    </div>
  );
}

export function FormulaConfirmInput({ id, value, onChange, issues, disabled, label }: InputProps) {
  const v = obj(value);
  const choice = text(v.choice);
  const set = (patch: Record<string, string>) => onChange({ ...v, ...patch });
  return (
    <div className="space-y-3">
      <RadioRows
        name={`${id}-choice`}
        value={choice}
        onChange={(x) => set({ choice: x })}
        disabled={disabled}
        legend={label}
        options={[
          { value: "confermo", label: "È così" },
          { value: "correggo", label: "Va corretta" },
        ]}
        issues={issuesFor(issues, "choice")}
      />
      {choice === "correggo" ? (
        <Field label="Come si calcola" htmlFor={`${id}-formula`} issues={issuesFor(issues, "formula")} hint="Anche a parole: per esempio «prezzo meno costi diretti».">
          <TextAreaControl id={`${id}-formula`} value={text(v.formula)} onChange={(x) => set({ formula: x })} disabled={disabled} invalid={issuesFor(issues, "formula").length > 0} />
        </Field>
      ) : null}
    </div>
  );
}

/** `conferma_valore` come tipo della voce: «Confermo» o «Correggo» con l'input del tipo base. */
export function ValueConfirmInput(props: InputProps & { renderBase: (p: InputProps) => React.ReactNode }) {
  const { id, config, value, onChange, issues, disabled, label, renderBase } = props;
  const v = obj(value);
  const choice = text(v.choice);
  const base = confirmationBase(config);
  const inner = (v.value ?? null) as Json;
  return (
    <div className="space-y-3">
      <RadioRows
        name={`${id}-choice`}
        value={choice}
        onChange={(x) => onChange({ ...v, choice: x })}
        disabled={disabled}
        legend={label}
        options={[
          { value: "confermo", label: "Confermo" },
          { value: "correggo", label: "Correggo" },
        ]}
        issues={issuesFor(issues, "choice")}
      />
      {choice === "correggo" ? (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Il valore giusto</p>
          {renderBase({
            id: `${id}-base`,
            config: base.config,
            value: inner,
            onChange: (next) => onChange({ ...v, value: next }),
            issues: issues.filter((i) => i.field?.startsWith("value")).map((i) => ({ ...i, field: i.field === "value" ? undefined : i.field?.replace(/^value\./, "") })),
            disabled,
            label: `${label}: valore giusto`,
          })}
        </div>
      ) : null}
    </div>
  );
}
