"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronRight, Plus, X } from "lucide-react";
import { LEVER_META } from "@/components/uc/common/lever-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LEVERS, type Lever } from "@/lib/uc/vocab";
import {
  LEVER_LABELS,
  VALUE_COMPONENTS_MAX,
  VALUE_COMPONENT_KINDS,
  VALUE_COMPONENT_KIND_LABELS,
  VALUE_CONFIDENCES,
  VALUE_CONFIDENCE_LABELS,
  VALUE_MODEL_LIMITS,
  type ValueParams,
} from "@/lib/use-cases/value-model";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { cn } from "@/lib/utils";
import {
  EASE_CHOICES,
  VALUE_MODEL_EDITOR_TEXT as TEXT,
  componentLine,
  draftLevers,
  draftPrimary,
  liveDraftErrors,
  newComponentDraft,
  totalsLines,
  type ComponentDraft,
  type ValueModelDraft,
} from "./value-model-draft";

/** I campi che stanno sotto «Avanzate»: un errore lì apre il riquadro. */
const ADVANCED_KEYS = ["plan", "plan.startMonth", "plan.goLiveMonth", "notCounted", "ref"];
const NO_EASE = "nessuna";

export interface ValueModelEditorProps {
  draft: ValueModelDraft;
  onChange: (next: ValueModelDraft) => void;
  /**
   * Errori per campo, con i percorsi del modello (`components.0.label`): quelli di «Salva». A questi
   * l'editor aggiunge, mentre si scrive, i numeri che non si leggono (`liveDraftErrors`).
   */
  errors: Readonly<Record<string, string>>;
  /** Le ipotesi del workspace, per le righe calcolate. */
  params: ValueParams;
  className?: string;
}

/**
 * «Benefici e costi» nel modulo «Modifica valutazione» (Dettaglio › Valutazione): le voci (al
 * massimo 6) con tipo di ritorno, che cosa, come si conta (ore, euro, qualitativo), quanto è
 * sicura, come si misura dopo e da dove viene la stima, ognuna con la sua riga calcolata
 * («116 h · 4.043 €»); poi ritorno principale e perché, costi, facilità, gruppo e chi conferma;
 * sotto «Avanzate» i mesi di avvio e di entrata in uso. Senza voci mostra solo «Aggiungi una
 * voce»: il resto compare con la prima voce.
 */
export function ValueModelEditor({ draft, onChange, errors: saved, params, className }: ValueModelEditorProps) {
  const baseId = `benefici-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const errors: Readonly<Record<string, string>> = { ...liveDraftErrors(draft), ...saved };
  const advancedHasError = ADVANCED_KEYS.some((key) => key in errors);
  const [advancedOpen, setAdvancedOpen] = useState(() => Boolean(draft.startMonth || draft.goLiveMonth || draft.notCounted || draft.ref));
  const set = <K extends keyof ValueModelDraft>(key: K, value: ValueModelDraft[K]) => onChange({ ...draft, [key]: value });
  const setComponent = (index: number, patch: Partial<ComponentDraft>) =>
    onChange({ ...draft, components: draft.components.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
  const add = () => onChange({ ...draft, components: [...draft.components, newComponentDraft(draft.components)] });
  const remove = (index: number) => onChange({ ...draft, components: draft.components.filter((_, i) => i !== index) });
  const hasComponents = draft.components.length > 0;
  const totals = hasComponents ? totalsLines(draft, params) : null;
  const primary = draftPrimary(draft);
  const levers = draftLevers(draft);

  return (
    <fieldset data-slot="value-model-editor" className={cn("space-y-4", className)}>
      <legend className="mb-1 text-sm font-semibold">{TEXT.title}</legend>
      <p className="text-sm text-muted-foreground">{TEXT.intro}</p>
      {errors.model ? <ErrorText id={`${baseId}-errore`}>{errors.model}</ErrorText> : null}

      {hasComponents ? (
        <ol className="space-y-3">
          {draft.components.map((component, index) => (
            <li key={component.key}>
              <ComponentFields
                baseId={`${baseId}-${index}`}
                index={index}
                component={component}
                errors={errors}
                line={componentLine(component, params)}
                onChange={(patch) => setComponent(index, patch)}
                onRemove={() => remove(index)}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">{TEXT.noComponents}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" disabled={draft.components.length >= VALUE_COMPONENTS_MAX} onClick={add}>
          <Plus aria-hidden className="size-4" />
          {TEXT.addComponent}
        </Button>
        {draft.components.length >= VALUE_COMPONENTS_MAX ? <span className="text-xs text-muted-foreground">{TEXT.maxComponents}</span> : null}
      </div>

      {totals ? (
        <div data-slot="value-model-totals" className="space-y-0.5 rounded-lg bg-muted/60 px-3 py-2 text-sm tabular-nums">
          <p className="font-medium">{totals.counted}</p>
          {totals.pending ? <p className="text-muted-foreground">{totals.pending}</p> : null}
        </div>
      ) : null}

      {hasComponents ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`${baseId}-principale`} label={TEXT.primary} error={errors.primary}>
              <Select
                items={levers.map((lever) => ({ value: lever, label: LEVER_LABELS[lever] }))}
                value={primary ?? undefined}
                onValueChange={(next) => set("primary", isLever(next) ? next : null)}
              >
                <SelectTrigger id={`${baseId}-principale`} className="min-h-11 w-full sm:min-h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {levers.map((lever) => (
                    <SelectItem key={lever} value={lever}>
                      <LeverOption lever={lever} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <TextField id={`${baseId}-perche`} label={TEXT.whyPrimary} value={draft.whyPrimary} max={VALUE_MODEL_LIMITS.whyPrimary} error={errors.whyPrimary} onChange={(v) => set("whyPrimary", v)} />
          </div>

          <fieldset className="space-y-3">
            <legend className="mb-1 text-sm font-medium">{TEXT.costs}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <NumberField id={`${baseId}-giorni`} label={TEXT.devDays} suffix={TEXT.daysSuffix} value={draft.devDays} error={errors["costs.devDays"]} onChange={(v) => set("devDays", v)} />
              <NumberField id={`${baseId}-ore-interne`} label={TEXT.internalHours} suffix={TEXT.hoursUnitSuffix} value={draft.internalHours} error={errors["costs.internalHours"]} onChange={(v) => set("internalHours", v)} />
              <NumberField id={`${baseId}-ricorrenti`} label={TEXT.runCostEurYear} suffix={TEXT.euroYearSuffix} value={draft.runCostEurYear} error={errors["costs.runCostEurYear"]} onChange={(v) => set("runCostEurYear", v)} />
            </div>
            <TextField id={`${baseId}-nota-ricorrenti`} label={TEXT.runCostNote} value={draft.runCostNote} max={VALUE_MODEL_LIMITS.runCostNote} error={errors["costs.runCostNote"]} onChange={(v) => set("runCostNote", v)} />
            {totals?.costs ? (
              <p data-slot="value-model-costs" className="text-sm font-medium tabular-nums">
                {keepTogether(totals.costs)}
              </p>
            ) : null}
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`${baseId}-facilita`} label={TEXT.ease} error={errors.ease}>
              <Select
                items={[{ value: NO_EASE, label: TEXT.easeNone }, ...EASE_CHOICES]}
                value={draft.ease || NO_EASE}
                onValueChange={(next) => set("ease", typeof next === "string" && next !== NO_EASE ? next : "")}
              >
                <SelectTrigger id={`${baseId}-facilita`} className="min-h-11 w-full sm:min-h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_EASE}>{TEXT.easeNone}</SelectItem>
                  {EASE_CHOICES.map((choice) => (
                    <SelectItem key={choice.value} value={choice.value}>
                      {choice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <TextField id={`${baseId}-facilita-perche`} label={TEXT.easeWhy} value={draft.easeWhy} max={VALUE_MODEL_LIMITS.easeWhy} error={errors.easeWhy} onChange={(v) => set("easeWhy", v)} />
            <TextField
              id={`${baseId}-gruppo`}
              label={TEXT.group}
              placeholder={TEXT.groupPlaceholder}
              value={draft.group}
              max={VALUE_MODEL_LIMITS.group}
              error={errors.group}
              onChange={(v) => set("group", v)}
            />
            <TextField id={`${baseId}-conferma`} label={TEXT.confirmBy} value={draft.confirmBy} max={VALUE_MODEL_LIMITS.confirmBy} error={errors.confirmBy} onChange={(v) => set("confirmBy", v)} />
          </div>

          <details
            open={advancedOpen || advancedHasError}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            className="group"
            data-slot="value-model-advanced"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium outline-none marker:hidden focus-visible:underline [&::-webkit-details-marker]:hidden">
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
              {TEXT.advanced}
            </summary>
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <MonthField id={`${baseId}-avvio`} label={TEXT.startMonth} value={draft.startMonth} error={errors["plan.startMonth"] ?? errors.plan} onChange={(v) => set("startMonth", v)} />
                <MonthField id={`${baseId}-in-uso`} label={TEXT.goLiveMonth} value={draft.goLiveMonth} error={errors["plan.goLiveMonth"]} onChange={(v) => set("goLiveMonth", v)} />
              </div>
              <p className="text-xs text-muted-foreground">{TEXT.monthsHelp}</p>
              <TextField id={`${baseId}-fuori`} label={TEXT.notCounted} value={draft.notCounted} max={VALUE_MODEL_LIMITS.notCounted} error={errors.notCounted} onChange={(v) => set("notCounted", v)} />
              <TextField id={`${baseId}-rif`} label={TEXT.ref} value={draft.ref} max={VALUE_MODEL_LIMITS.ref} error={errors.ref} onChange={(v) => set("ref", v)} />
            </div>
          </details>
        </>
      ) : null}
    </fieldset>
  );
}

function isLever(value: unknown): value is Lever {
  return typeof value === "string" && (LEVERS as readonly string[]).includes(value);
}

function LeverOption({ lever }: { lever: Lever }) {
  const Icon = LEVER_META[lever].icon;
  return (
    <span className="inline-flex items-center gap-2">
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      {LEVER_LABELS[lever]}
    </span>
  );
}

function ComponentFields({
  baseId,
  index,
  component,
  errors,
  line,
  onChange,
  onRemove,
}: {
  baseId: string;
  index: number;
  component: ComponentDraft;
  errors: Readonly<Record<string, string>>;
  line: string;
  onChange: (patch: Partial<ComponentDraft>) => void;
  onRemove: () => void;
}) {
  const path = `components.${index}`;
  const error = (key: string) => errors[`${path}.${key}`];
  return (
    <div data-slot="value-component" className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {TEXT.component} {index + 1}
        </span>
        <Button type="button" variant="ghost" size="sm" className="min-h-11 text-muted-foreground sm:min-h-7" onClick={onRemove}>
          <X aria-hidden className="size-4" />
          {TEXT.removeComponent}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${baseId}-tipo`} label={TEXT.lever} error={error("lever")}>
          <Select
            items={LEVERS.map((lever) => ({ value: lever, label: LEVER_LABELS[lever] }))}
            value={component.lever}
            onValueChange={(next) => isLever(next) && onChange({ lever: next })}
          >
            <SelectTrigger id={`${baseId}-tipo`} className="min-h-11 w-full sm:min-h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEVERS.map((lever) => (
                <SelectItem key={lever} value={lever}>
                  <LeverOption lever={lever} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <TextField
          id={`${baseId}-etichetta`}
          label={TEXT.label}
          placeholder={TEXT.labelPlaceholder}
          value={component.label}
          max={VALUE_MODEL_LIMITS.label}
          error={error("label")}
          onChange={(v) => onChange({ label: v })}
        />
        <div className="space-y-1.5">
          <span id={`${baseId}-come`} className="text-sm font-medium">
            {TEXT.kind}
          </span>
          <div role="radiogroup" aria-labelledby={`${baseId}-come`} className="inline-flex w-full rounded-lg border border-border p-0.5">
            {VALUE_COMPONENT_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={component.kind === kind}
                onClick={() => onChange({ kind })}
                className={cn(
                  "min-h-11 flex-1 rounded-md px-2 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-7",
                  component.kind === kind ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {VALUE_COMPONENT_KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        </div>
        <Field id={`${baseId}-fiducia`} label={TEXT.confidence} error={error("confidence")}>
          <Select
            items={VALUE_CONFIDENCES.map((c) => ({ value: c, label: VALUE_CONFIDENCE_LABELS[c] }))}
            value={component.confidence}
            onValueChange={(next) => {
              const found = VALUE_CONFIDENCES.find((c) => c === next);
              if (found) onChange({ confidence: found });
            }}
          >
            <SelectTrigger id={`${baseId}-fiducia`} className="min-h-11 w-full sm:min-h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VALUE_CONFIDENCES.map((c) => (
                <SelectItem key={c} value={c}>
                  {VALUE_CONFIDENCE_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {component.kind === "ore" ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <NumberField id={`${baseId}-volte`} label={TEXT.volumeYear} value={component.volumeYear} error={error("volumeYear")} onChange={(v) => onChange({ volumeYear: v })} />
          <TextField
            id={`${baseId}-unita`}
            label={TEXT.unit}
            placeholder={TEXT.unitPlaceholder}
            value={component.unit}
            max={VALUE_MODEL_LIMITS.unit}
            error={error("unit")}
            onChange={(v) => onChange({ unit: v })}
          />
          <NumberField id={`${baseId}-minuti`} label={TEXT.minutesPerUnit} value={component.minutesPerUnit} error={error("minutesPerUnit")} onChange={(v) => onChange({ minutesPerUnit: v })} />
          <NumberField id={`${baseId}-quota`} label={TEXT.automatablePct} suffix={TEXT.percentSuffix} value={component.automatablePct} error={error("automatablePct")} onChange={(v) => onChange({ automatablePct: v })} />
        </div>
      ) : component.kind === "euro" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField id={`${baseId}-euro`} label={TEXT.eurYear} suffix={TEXT.euroSuffix} value={component.eurYear} error={error("eurYear")} onChange={(v) => onChange({ eurYear: v })} />
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id={`${baseId}-misura`} label={TEXT.indicator} value={component.indicator} max={VALUE_MODEL_LIMITS.indicator} error={error("indicator")} onChange={(v) => onChange({ indicator: v })} />
        <TextField id={`${baseId}-base`} label={TEXT.basis} value={component.basis} max={VALUE_MODEL_LIMITS.basis} error={error("basis")} onChange={(v) => onChange({ basis: v })} />
      </div>

      <p data-slot="value-component-line" aria-live="polite" className="text-right text-sm font-medium tabular-nums">
        {keepTogether(line)}
      </p>
    </div>
  );
}

function ErrorText({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <ErrorText id={`${id}-errore`}>{error}</ErrorText> : null}
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  max,
  error,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  max: number;
  error?: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field id={id} label={label} error={error}>
      <Input
        id={id}
        value={value}
        maxLength={max}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-errore` : undefined}
        className="min-h-11 sm:min-h-8"
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function NumberField({
  id,
  label,
  value,
  suffix,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  suffix?: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field id={id} label={label} error={error}>
      <div className="relative">
        <Input
          id={id}
          value={value}
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-errore` : undefined}
          className={cn("min-h-11 sm:min-h-8", suffix && "pr-16")}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix ? (
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
    </Field>
  );
}

function MonthField({ id, label, value, error, onChange }: { id: string; label: string; value: string; error?: string; onChange: (value: string) => void }) {
  return (
    <Field id={id} label={label} error={error}>
      <Input
        id={id}
        type="month"
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-errore` : undefined}
        className="min-h-11 sm:min-h-8"
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
