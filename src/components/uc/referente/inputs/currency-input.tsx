"use client";

import { CURRENCY_PER_SUGGESTIONS } from "@/lib/uc/answers/currency";
import { currencyChoices, fixedVat } from "@/lib/uc/views/referente-form";
import { Field, FieldErrors, RadioRows, SelectControl, TextControl, issuesFor, obj, text, type InputProps } from "./fields";

/**
 * Input `valuta`: importo, valuta (EUR proposta), IVA inclusa o esclusa,
 * a cosa si riferisce («a volo», «a notte»…) e, fuori dall'euro, il cambio con
 * data e fonte. «Valido dal» è sotto, tra i campi comuni della voce.
 */
export function CurrencyInput({ id, config, value, onChange, issues, disabled, label }: InputProps) {
  const v = obj(value);
  const fx = obj(v.fx ?? null);
  const set = (patch: Record<string, unknown>) => onChange({ ...v, ...patch } as typeof value);
  const setFx = (patch: Record<string, string>) => set({ fx: { ...fx, ...patch } });
  const amountIssues = issuesFor(issues, "amount");
  const currency = text(v.currency) || "EUR";
  const vatFixed = fixedVat(config);
  const listId = `${id}-per-list`;
  return (
    <div className="space-y-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <TextControl
          id={`${id}-amount`}
          value={text(v.amount)}
          onChange={(x) => set({ amount: x })}
          disabled={disabled}
          invalid={amountIssues.length > 0}
          inputMode="decimal"
          placeholder="Importo, per esempio 1.200,50"
          ariaLabel={label}
          className="flex-1 basis-44"
        />
        <SelectControl
          id={`${id}-currency`}
          value={currency}
          onChange={(x) => set({ currency: x })}
          disabled={disabled}
          invalid={issuesFor(issues, "currency").length > 0}
          options={currencyChoices(config).map((c) => ({ value: c, label: c }))}
          ariaLabel="Valuta"
          className="w-auto basis-28"
        />
      </div>
      <FieldErrors id={`${id}-amount-err`} issues={[...amountIssues, ...issuesFor(issues, "currency")]} />
      {vatFixed ? (
        <p className="text-sm text-muted-foreground">IVA {vatFixed}.</p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">IVA</p>
          <RadioRows
            name={`${id}-vat`}
            value={text(v.vat)}
            onChange={(x) => set({ vat: x })}
            disabled={disabled}
            legend="IVA"
            columns={2}
            options={[
              { value: "esclusa", label: "IVA esclusa" },
              { value: "inclusa", label: "IVA inclusa" },
            ]}
            issues={issuesFor(issues, "vat")}
          />
        </div>
      )}
      <Field label="A cosa si riferisce l'importo" htmlFor={`${id}-per`} issues={issuesFor(issues, "per")} hint="Per esempio a volo, a ora, a notte, a persona, all'anno.">
        <TextControl id={`${id}-per`} value={text(v.per)} onChange={(x) => set({ per: x })} disabled={disabled} invalid={issuesFor(issues, "per").length > 0} list={listId} />
        <datalist id={listId}>
          {CURRENCY_PER_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      {currency !== "EUR" ? (
        <fieldset className="min-w-0 space-y-3 rounded-lg border border-dashed border-border p-3">
          <legend className="px-1 text-sm font-medium">Cambio verso l&apos;euro</legend>
          <Field label={`Quanti euro vale 1 ${currency}`} htmlFor={`${id}-fx-rate`} issues={issuesFor(issues, "fx.rate_to_eur")}>
            <TextControl id={`${id}-fx-rate`} value={text(fx.rate_to_eur)} onChange={(x) => setFx({ rate_to_eur: x })} disabled={disabled} inputMode="decimal" invalid={issuesFor(issues, "fx.rate_to_eur").length > 0} />
          </Field>
          <Field label="Data del cambio" htmlFor={`${id}-fx-date`} issues={issuesFor(issues, "fx.date")}>
            <TextControl id={`${id}-fx-date`} type="date" value={text(fx.date)} onChange={(x) => setFx({ date: x })} disabled={disabled} invalid={issuesFor(issues, "fx.date").length > 0} />
          </Field>
          <Field label="Fonte del cambio" htmlFor={`${id}-fx-source`} issues={issuesFor(issues, "fx.source")} hint="Per esempio BCE.">
            <TextControl id={`${id}-fx-source`} value={text(fx.source)} onChange={(x) => setFx({ source: x })} disabled={disabled} invalid={issuesFor(issues, "fx.source").length > 0} />
          </Field>
          <FieldErrors issues={issues.filter((i) => i.field === "fx")} />
        </fieldset>
      ) : null}
    </div>
  );
}
