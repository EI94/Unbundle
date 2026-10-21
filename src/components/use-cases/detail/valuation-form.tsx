"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { saveValuationAction } from "@/lib/actions/use-case-edit";
import { COST_BANDS, type CostBandInfo } from "@/lib/use-cases/cost-bands";
import type { DecisionItem } from "@/lib/use-cases/decision-ui";
import { VALUE_EUR_YEAR_MAX, parseEuroAmount } from "@/lib/use-cases/inputs";
import type { CostInput as CostValue } from "@/lib/use-cases/types";
import type { HubAiSuggestion } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { CostInput } from "../cost-input";
import { costInputValue, initialCostInputState, type CostValueResult, type SavedCost } from "../cost-input-state";
import { useDecisionRunner } from "../decision-buttons";
import { ESTIMATES_TEXT } from "@/lib/use-cases/estimates";
import { AiSuggestionBox, hasAiSuggestion } from "./ai-suggestion-box";
import type { ValuationKpiGroup } from "./section-valuation";

/** I testi del modulo (§6.3, §14.3). */
export const VALUATION_FORM_TEXT = Object.freeze({
  edit: "Modifica valutazione",
  save: "Salva la valutazione",
  cancel: "Annulla",
  noValue: "Nessun valore",
  valuePerYear: "Valore all'anno (facoltativo)",
  valuePerYearPlaceholder: "es. 60000",
  rubric: "Come si dà il punteggio",
});

/** I punteggi del modulo: per dimensione, per KPI, da 1 a 5; un KPI assente è «Nessun valore». */
export type KpiValues = Record<string, Record<string, number>>;

/** Il valore di una scelta del KPI: «1» … «5», oppure «nessuno». */
const NO_VALUE = "nessuno";
const SCORE_CHOICES = ["1", "2", "3", "4", "5"] as const;

function withoutError(errors: Record<string, string>, key: string): Record<string, string> {
  if (!(key in errors)) return errors;
  const next = { ...errors };
  delete next[key];
  return next;
}

/** I punteggi dell'AI sopra quelli salvati, KPI per KPI («Usa questi valori»). */
export function mergeKpiValues(base: KpiValues, over: KpiValues): KpiValues {
  const out = structuredClone(base);
  for (const [dimension, scores] of Object.entries(over)) out[dimension] = { ...(out[dimension] ?? {}), ...scores };
  return out;
}

function sameScore(a: number | undefined, b: number | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

/**
 * I KPI da mandare a «Salva la valutazione»: solo quelli cambiati rispetto ai punteggi salvati
 * delle persone (un numero, oppure null per «Nessun valore», che toglie il valore e non vale
 * zero). Senza cambi niente `kpis`: la Storia non registra punteggi che non sono cambiati.
 */
export function changedKpis(
  groups: readonly ValuationKpiGroup[],
  saved: KpiValues,
  values: KpiValues,
): Partial<Record<ValuationKpiGroup["dimension"], Record<string, number | null>>> | undefined {
  const out: Partial<Record<ValuationKpiGroup["dimension"], Record<string, number | null>>> = {};
  for (const group of groups) {
    for (const kpi of group.kpis) {
      const before = saved[group.dimension]?.[kpi.id];
      const after = values[group.dimension]?.[kpi.id];
      if (sameScore(before, after)) continue;
      (out[group.dimension] ??= {})[kpi.id] = after ?? null;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** Due costi del campo di §5.4 sono lo stesso costo? (`null` è «nessun costo».) */
export function sameCost(a: CostValue, b: CostValue): boolean {
  if (a === null || b === null) return a === b;
  return (a.eurOnce ?? null) === (b.eurOnce ?? null) && (a.band ?? null) === (b.band ?? null);
}

/**
 * Il testo di «Valore all'anno» dice lo stesso valore di `saved`? Vuoto è nessun valore; il testo
 * si legge come lo legge il servizio (`parseEuroAmount`, «60.000» vale 60.000). Un testo non
 * valido è un cambio: va al servizio, che risponde con l'errore del campo.
 */
export function sameValueText(text: string, saved: number | null): boolean {
  const parsed = parseEuroAmount(text, VALUE_EUR_YEAR_MAX);
  return parsed.ok && parsed.value === saved;
}

/**
 * Da cosa partono i cambi del modulo: la `version` e i valori salvati letti quando il modulo si è
 * aperto, oppure riletti dopo una versione superata (`rebaseValuationForm`). Il modulo manda solo
 * ciò che la persona ha cambiato rispetto a questa base, con questa `version` (§6.8): un valore
 * che non ha toccato non sovrascrive mai quello che un collega ha salvato nel frattempo.
 */
export interface ValuationBase {
  version: number;
  kpis: KpiValues;
  valueEurYear: number | null;
  cost: CostValue;
}

/** La base del modulo dalle prop della pagina. */
export function valuationBaseOf(version: number, kpis: KpiValues, valueEurYear: number | null, savedCost: SavedCost): ValuationBase {
  const cost = costInputValue(initialCostInputState(savedCost));
  return { version, kpis: structuredClone(kpis), valueEurYear, cost: cost.ok ? cost.value : null };
}

export type ValuationPayload = {
  kpis?: Partial<Record<ValuationKpiGroup["dimension"], Record<string, number | null>>>;
  valueEurYear?: string | null;
  cost?: CostValue;
};

/**
 * Il corpo di `saveValuationAction`: solo i campi cambiati rispetto alla base del modulo (KPI,
 * valore all'anno, costo). Un campo non toccato non parte: se un collega l'ha appena cambiato,
 * il suo valore resta. Senza nessun cambio parte `kpis: {}`, che non cambia punteggi: salvare
 * porta comunque la scheda a «valutata» (§6.3).
 */
export function valuationPayload(input: {
  groups: readonly ValuationKpiGroup[];
  base: Pick<ValuationBase, "kpis" | "valueEurYear" | "cost">;
  values: KpiValues;
  valueText: string;
  cost: CostValue;
}): ValuationPayload {
  const out: ValuationPayload = {};
  const kpis = changedKpis(input.groups, input.base.kpis, input.values);
  if (kpis) out.kpis = kpis;
  if (!sameValueText(input.valueText, input.base.valueEurYear)) {
    const value = input.valueText.trim();
    out.valueEurYear = value === "" ? null : value;
  }
  if (!sameCost(input.cost, input.base.cost)) out.cost = input.cost;
  return Object.keys(out).length ? out : { kpis: {} };
}

/**
 * I KPI del modulo dopo una versione superata: quelli che la persona ha cambiato rispetto alla
 * base vecchia restano come li ha scelti (§6.8: quello che ha scritto resta); gli altri prendono
 * i valori appena riletti.
 */
export function rebaseKpis(groups: readonly ValuationKpiGroup[], before: KpiValues, fresh: KpiValues, values: KpiValues): KpiValues {
  const out: KpiValues = structuredClone(fresh);
  for (const group of groups) {
    for (const kpi of group.kpis) {
      const chosen = values[group.dimension]?.[kpi.id];
      if (sameScore(before[group.dimension]?.[kpi.id], chosen)) continue;
      const dim = { ...(out[group.dimension] ?? {}) };
      if (chosen === undefined) delete dim[kpi.id];
      else dim[kpi.id] = chosen;
      out[group.dimension] = dim;
    }
  }
  return out;
}

export interface ValuationFormProps {
  workspaceId: string;
  item: Pick<DecisionItem, "id" | "version">;
  groups: readonly ValuationKpiGroup[];
  /** I punteggi salvati delle persone (`custom_scores`), riletti con la pagina. */
  saved: KpiValues;
  /** Con cosa parte il modulo: i punteggi salvati, oppure quelli dell'AI («Usa questi valori»). */
  initial: KpiValues;
  valueEurYear: number | null;
  savedCost: SavedCost;
  costBands?: readonly CostBandInfo[];
  onDone: () => void;
  className?: string;
}

/**
 * Il modulo «Modifica valutazione» (docs/use-case/DESIGN.md §6.3, §5.4, §7.6), aperto sul posto:
 * i KPI del modello del workspace per Valore, Fattibilità ed ESG (se attivo), da 1 a 5, con la
 * rubrica nel suggerimento e «Nessun valore» (vuoto non vuol dire zero); «Valore all'anno
 * (facoltativo)»; il campo costo di §5.4 con le fasce del workspace; «Salva la valutazione» e
 * «Annulla».
 *
 * Controllo di versione (§6.8): il modulo resta legato a ciò che ha letto quando si è aperto
 * (`ValuationBase`), anche se la pagina intanto si rilegge. Manda quella `version` e solo i campi
 * cambiati rispetto a quella base. Dopo una versione superata, appena la pagina porta i dati
 * nuovi, la base diventa quella nuova: i campi che la persona aveva cambiato restano come li ha
 * scritti, gli altri mostrano i valori appena salvati dal collega, e il salvataggio dopo non li
 * riporta indietro.
 */
export function ValuationForm({ workspaceId, item, groups, saved, initial, valueEurYear, savedCost, costBands = COST_BANDS, onDone, className }: ValuationFormProps) {
  const formId = useId();
  const [base, setBase] = useState<ValuationBase>(() => valuationBaseOf(item.version, saved, valueEurYear, savedCost));
  const [values, setValues] = useState<KpiValues>(() => structuredClone(initial));
  const [valueText, setValueText] = useState(valueEurYear === null ? "" : String(valueEurYear));
  const [cost, setCost] = useState<CostValueResult>(() => costInputValue(initialCostInputState(savedCost)));
  /** Cambia quando il campo costo riparte dal costo appena riletto (non toccato dalla persona). */
  const [costKey, setCostKey] = useState(0);
  const [stale, setStale] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, pending } = useDecisionRunner();

  // Dopo una versione superata, appena la pagina porta una versione nuova: la base si aggiorna e
  // ciò che la persona non aveva toccato prende i valori riletti (stato aggiornato nel render,
  // come chiede React per uno stato che dipende dalle prop).
  if (stale && item.version !== base.version) {
    const fresh = valuationBaseOf(item.version, saved, valueEurYear, savedCost);
    setValues(rebaseKpis(groups, base.kpis, fresh.kpis, values));
    if (sameValueText(valueText, base.valueEurYear)) setValueText(fresh.valueEurYear === null ? "" : String(fresh.valueEurYear));
    if (cost.ok && sameCost(cost.value, base.cost) && !sameCost(fresh.cost, base.cost)) {
      setCost({ ok: true, value: fresh.cost });
      setCostKey((key) => key + 1);
    }
    setBase(fresh);
    setStale(false);
  }

  function setKpi(dimension: string, kpiId: string, raw: unknown) {
    setValues((current) => {
      const next = structuredClone(current);
      const dim = { ...(next[dimension] ?? {}) };
      const score = typeof raw === "string" && (SCORE_CHOICES as readonly string[]).includes(raw) ? Number(raw) : null;
      if (score === null) delete dim[kpiId];
      else dim[kpiId] = score;
      next[dimension] = dim;
      return next;
    });
    setErrors((current) => withoutError(current, `kpis.${dimension}.${kpiId}`));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!cost.ok) {
      setErrors({ cost: cost.message });
      return;
    }
    setErrors({});
    const payload = valuationPayload({ groups, base, values, valueText, cost: cost.value });
    // La versione della base, non quella della pagina riletta: `run` la alza solo dopo le
    // scritture riuscite di questa pagina (`createDecisionWriteQueue`).
    const result = await run({ id: item.id, version: base.version }, (version) => saveValuationAction(workspaceId, item.id, version, payload));
    if (result.ok) onDone();
    else if (result.fieldErrors) setErrors(result.fieldErrors);
    else if (result.error === "versione_superata") setStale(true);
  }

  const valueId = `${formId}-valore`;
  const valueErrorId = `${formId}-valore-errore`;
  const generalError = errors.payload ?? null;

  return (
    <form onSubmit={submit} noValidate data-slot="valuation-form" className={cn("space-y-5 rounded-lg border border-border p-3 sm:p-4", className)}>
      {groups.map((group) => (
        <fieldset key={group.dimension} className="space-y-3">
          <legend className="mb-2 text-sm font-medium">{group.title}</legend>
          {group.kpis.map((kpi) => {
            const fieldId = `${formId}-${group.dimension}-${kpi.id}`;
            const errorKey = `kpis.${group.dimension}.${kpi.id}`;
            const current = values[group.dimension]?.[kpi.id];
            const error = errors[errorKey] ?? null;
            return (
              <div key={kpi.id} className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center sm:gap-3">
                <div className="flex min-w-0 items-center gap-1">
                  <Label htmlFor={fieldId} className="min-w-0">
                    {kpi.label}
                  </Label>
                  {kpi.description ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            aria-label={`${VALUATION_FORM_TEXT.rubric}: ${kpi.label}`}
                            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:size-7"
                          />
                        }
                      >
                        <Info aria-hidden className="size-4" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-sm">{kpi.description}</TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
                <div className="min-w-0 space-y-1">
                  <Select
                    items={[{ value: NO_VALUE, label: VALUATION_FORM_TEXT.noValue }, ...SCORE_CHOICES.map((choice) => ({ value: choice, label: choice }))]}
                    value={current === undefined ? NO_VALUE : String(current)}
                    onValueChange={(next) => setKpi(group.dimension, kpi.id, next)}
                  >
                    <SelectTrigger id={fieldId} aria-invalid={error ? true : undefined} className="min-h-11 w-full sm:min-h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_VALUE}>{VALUATION_FORM_TEXT.noValue}</SelectItem>
                      {SCORE_CHOICES.map((choice) => (
                        <SelectItem key={choice} value={choice}>
                          {choice}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {error ? (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </fieldset>
      ))}

      <div className="space-y-1.5">
        <Label htmlFor={valueId}>{VALUATION_FORM_TEXT.valuePerYear}</Label>
        <div className="relative w-full max-w-60">
          <Input
            id={valueId}
            inputMode="numeric"
            autoComplete="off"
            placeholder={VALUATION_FORM_TEXT.valuePerYearPlaceholder}
            value={valueText}
            aria-describedby={errors.valueEurYear ? valueErrorId : undefined}
            aria-invalid={errors.valueEurYear ? true : undefined}
            className="pr-8"
            onChange={(event) => {
              setValueText(event.target.value);
              setErrors((current) => withoutError(current, "valueEurYear"));
            }}
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
            €
          </span>
        </div>
        {errors.valueEurYear ? (
          <p id={valueErrorId} role="alert" className="text-sm text-destructive">
            {errors.valueEurYear}
          </p>
        ) : null}
      </div>

      <CostInput
        key={costKey}
        defaultValue={savedCost}
        bands={costBands}
        error={errors.cost ?? null}
        onValueChange={(result) => {
          setCost(result);
          setErrors((current) => withoutError(current, "cost"));
        }}
      />

      {generalError ? (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" aria-busy={pending || undefined} className="min-h-11 sm:min-h-8">
          {VALUATION_FORM_TEXT.save}
        </Button>
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" onClick={onDone}>
          {VALUATION_FORM_TEXT.cancel}
        </Button>
      </div>
    </form>
  );
}

export interface ValuationEditorProps {
  workspaceId: string;
  item: Pick<DecisionItem, "id" | "version">;
  groups: readonly ValuationKpiGroup[];
  /** I punteggi salvati delle persone (`personKpiValues`). */
  personValues: KpiValues;
  valueEurYear: number | null;
  savedCost: SavedCost;
  costBands?: readonly CostBandInfo[];
  suggestion: Pick<HubAiSuggestion, "scores" | "rationale" | "at"> | null;
  /** `canEditValuation`. */
  canEdit: boolean;
  /** I chip di rischio, tra il suggerimento e «Modifica valutazione» (§6.3). */
  risks?: ReactNode;
  /** Le righe della stima di Claude e di chi ha proposto (`unofficialEstimateLines`); vuoto senza dati. */
  estimateLines?: readonly string[];
  className?: string;
}

/**
 * La parte del capitolo «Valutazione» che cambia nel browser (§6.3): un solo riquadro «Stime non
 * ufficiali» con la stima di Claude e di chi ha proposto e il «Suggerimento AI» (H4p: una frase
 * sola, «Conta la valutazione del team.»), i chip di rischio e «Modifica valutazione», che apre il
 * modulo sul posto. «Usa questi valori» apre il modulo con i punteggi dell'AI, senza salvare.
 */
export function ValuationEditor({ workspaceId, item, groups, personValues, valueEurYear, savedCost, costBands, suggestion, canEdit, risks, estimateLines = [], className }: ValuationEditorProps) {
  const [editing, setEditing] = useState(false);
  const [prefill, setPrefill] = useState<KpiValues | null>(null);
  const [formKey, setFormKey] = useState(0);

  function open(values: KpiValues | null) {
    setPrefill(values);
    setFormKey((key) => key + 1);
    setEditing(true);
  }

  const aiBox = (className?: string) => (
    <AiSuggestionBox
      workspaceId={workspaceId}
      item={item}
      suggestion={suggestion}
      groups={groups}
      canEdit={canEdit}
      onUse={(values) => open(mergeKpiValues(personValues, values))}
      className={className}
    />
  );
  // Il riquadro solo con qualcosa dentro (H7): senza stime e senza suggerimento resta, per chi
  // valuta, il solo «Suggerimento AI» da chiedere; per gli altri niente.
  const hasEstimates = estimateLines.length > 0 || hasAiSuggestion(suggestion, groups);

  return (
    <div data-slot="valuation-editor" className={cn("space-y-4", className)}>
      {hasEstimates ? (
        <aside data-slot="unofficial-estimates" aria-label={ESTIMATES_TEXT.title} className="space-y-2 rounded-lg bg-muted/60 px-3 py-2.5 text-sm">
          <div className="space-y-0.5">
            <p className="font-medium">{ESTIMATES_TEXT.title}</p>
            <p className="text-xs text-muted-foreground">{ESTIMATES_TEXT.note}</p>
          </div>
          {estimateLines.length ? (
            <div data-slot="claude-estimate" className="space-y-1 text-muted-foreground">
              {estimateLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : null}
          {aiBox("bg-background/60")}
        </aside>
      ) : canEdit ? (
        aiBox()
      ) : null}
      {risks}
      {canEdit ? (
        editing ? (
          <ValuationForm
            key={formKey}
            workspaceId={workspaceId}
            item={item}
            groups={groups}
            saved={personValues}
            initial={prefill ?? personValues}
            valueEurYear={valueEurYear}
            savedCost={savedCost}
            costBands={costBands}
            onDone={() => setEditing(false)}
          />
        ) : (
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => open(null)}>
            {VALUATION_FORM_TEXT.edit}
          </Button>
        )
      ) : null}
    </div>
  );
}
