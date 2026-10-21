"use client";

import { useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Hammer, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createUseCaseFromFormAction } from "@/lib/actions/use-case-create";
import { COST_BANDS, type CostBandInfo } from "@/lib/use-cases/cost-bands";
import {
  FORM_FIELD_NAMES,
  FORM_TEXT,
  ORIGIN_OPTIONS,
  formFields,
  parseUseCaseForm,
  type FormFieldSpec,
} from "@/lib/use-cases/create";
import { KINDS, type Origin, type UseCaseKind } from "@/lib/use-cases/types";
import { cn } from "@/lib/utils";
import { CostInput } from "./cost-input";
import { ORIGIN_DOT_CLASS } from "./origin-chip";

export interface UseCaseFormProps {
  workspaceId: string;
  /** Revisori: «Origine» e «Valutazione iniziale (facoltativa)» in più, chiusi. */
  isReviewer: boolean;
  /** L'origine proposta (`defaultOriginFor("modulo_completo", …)`): AI Transformation per Lateral Space. */
  defaultOrigin: Origin;
  /** «Impatto ambientale e sociale» solo con ESG attivo. */
  esgEnabled: boolean;
  /** Le 5 fasce del costo del workspace (D15, `resolveCostBands`); predefinite `COST_BANDS`. */
  costBands?: readonly CostBandInfo[];
}

const KIND_ICON = { da_costruire: Hammer, da_diffondere: Megaphone } as const;

/** I campi dei blocchi chiusi dei revisori: un errore lì apre il blocco. */
const ORIGIN_FIELDS = [FORM_FIELD_NAMES.origin];
const VALUATION_FIELDS = [FORM_FIELD_NAMES.valueEurYear, FORM_FIELD_NAMES.cost];

/**
 * Il modulo completo di «Nuovo use case» (docs/use-case/DESIGN.md §5.3, §5.4): il modulo di
 * oggi con un primo passo «Che cosa proponi?» e le etichette di §6.2 per tipo. Solo per i
 * revisori, chiusi, «Origine» e «Valutazione iniziale (facoltativa)» con «Valore all'anno» e il
 * campo costo (importo, oppure una fascia del workspace). Un solo pulsante pieno, «Invia lo
 * use case». I campi si controllano qui con le stesse regole dell'action (`parseUseCaseForm`);
 * dopo l'invio si va alla ricevuta in cima alla pagina «Use case».
 */
export function UseCaseForm({ workspaceId, isReviewer, defaultOrigin, esgEnabled, costBands = COST_BANDS }: UseCaseFormProps) {
  const router = useRouter();
  const baseId = `modulo-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<UseCaseKind | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [originOpen, setOriginOpen] = useState(false);
  const [valuationOpen, setValuationOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const fields = kind ? formFields(kind, { esgEnabled }) : [];

  function clearError(name: string) {
    setErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  function showErrors(fieldErrors: Record<string, string>, text: string | null) {
    setErrors(fieldErrors);
    setMessage(text);
    if (ORIGIN_FIELDS.some((name) => fieldErrors[name])) setOriginOpen(true);
    if (VALUATION_FIELDS.some((name) => fieldErrors[name])) setValuationOpen(true);
    const first = Object.keys(fieldErrors)[0];
    if (!first) return;
    requestAnimationFrame(() => {
      const target = formRef.current?.querySelector<HTMLElement>(`[name="${CSS.escape(first)}"]:not([type="hidden"]), [data-field="${CSS.escape(first)}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (target && "focus" in target) target.focus({ preventScroll: true });
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const parsed = parseUseCaseForm((name) => data.get(name), { esgEnabled, isReviewer });
    if (!parsed.ok) {
      showErrors(parsed.fieldErrors, parsed.message);
      return;
    }
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof createUseCaseFromFormAction>>;
      try {
        result = await createUseCaseFromFormAction(workspaceId, data);
      } catch {
        setMessage(FORM_TEXT.error);
        return;
      }
      if (!result.ok) {
        showErrors(result.fieldErrors, result.message);
        return;
      }
      router.push(result.href);
    });
  }

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="space-y-8" data-slot="use-case-form">
      <fieldset className="space-y-3" data-field={FORM_FIELD_NAMES.kind}>
        <legend className="mb-3 text-base font-semibold">{FORM_TEXT.kindQuestion}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {KINDS.map((value) => {
            const Icon = KIND_ICON[value];
            return (
              <label
                key={value}
                className="flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border border-border p-4 text-sm transition-colors hover:bg-muted/50 has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
              >
                <input
                  type="radio"
                  name={FORM_FIELD_NAMES.kind}
                  value={value}
                  checked={kind === value}
                  disabled={pending}
                  onChange={() => {
                    setKind(value);
                    clearError(FORM_FIELD_NAMES.kind);
                  }}
                  className="mt-0.5 size-4 shrink-0 accent-primary outline-none"
                />
                <span className="flex min-w-0 flex-1 items-start justify-between gap-3">
                  <span className="font-medium">{FORM_TEXT.kindOptions[value]}</span>
                  <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                </span>
              </label>
            );
          })}
        </div>
        {errors.kind && <p className="text-sm text-destructive">{errors.kind}</p>}
      </fieldset>

      {kind && (
        <>
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">{FORM_TEXT.requiredNote}</p>
            {fields.map((field) => (
              <TextField
                key={field.name}
                id={`${baseId}-${field.name}`}
                field={field}
                error={errors[field.name]}
                disabled={pending}
                onChange={() => clearError(field.name)}
              />
            ))}
          </div>

          {isReviewer && (
            <div className="space-y-3">
              <Block title={FORM_TEXT.originBlock} open={originOpen} onOpenChange={setOriginOpen}>
                <fieldset className="space-y-2" data-field={FORM_FIELD_NAMES.origin}>
                  <legend className="sr-only">{FORM_TEXT.originBlock}</legend>
                  {ORIGIN_OPTIONS.map((option) => (
                    <label key={option.value} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                      <input
                        type="radio"
                        name={FORM_FIELD_NAMES.origin}
                        value={option.value}
                        defaultChecked={option.value === defaultOrigin}
                        disabled={pending}
                        onChange={() => clearError(FORM_FIELD_NAMES.origin)}
                        className="size-4 shrink-0 accent-primary"
                      />
                      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", ORIGIN_DOT_CLASS[option.value])} />
                      <span>{option.label}</span>
                    </label>
                  ))}
                  {errors.origin && <p className="px-2 text-sm text-destructive">{errors.origin}</p>}
                </fieldset>
              </Block>

              <Block title={FORM_TEXT.valuationBlock} open={valuationOpen} onOpenChange={setValuationOpen}>
                <div className="space-y-6">
                  <div className="space-y-1.5">
                    <Label htmlFor={`${baseId}-valore`}>{FORM_TEXT.valueLabel}</Label>
                    <div className="relative w-full max-w-60">
                      <Input
                        id={`${baseId}-valore`}
                        name={FORM_FIELD_NAMES.valueEurYear}
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder={FORM_TEXT.valuePlaceholder}
                        disabled={pending}
                        aria-invalid={errors.valueEurYear ? true : undefined}
                        aria-describedby={errors.valueEurYear ? `${baseId}-valore-errore` : undefined}
                        onChange={() => clearError(FORM_FIELD_NAMES.valueEurYear)}
                        className="h-10 pr-8 sm:h-9"
                      />
                      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                        €
                      </span>
                    </div>
                    {errors.valueEurYear && (
                      <p id={`${baseId}-valore-errore`} className="text-sm text-destructive">
                        {errors.valueEurYear}
                      </p>
                    )}
                  </div>
                  <div data-field={FORM_FIELD_NAMES.cost}>
                    <CostInput
                      name={FORM_FIELD_NAMES.cost}
                      bands={costBands}
                      error={errors.cost}
                      disabled={pending}
                      onValueChange={() => clearError(FORM_FIELD_NAMES.cost)}
                    />
                  </div>
                </div>
              </Block>
            </div>
          )}

          {message && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {message}
            </p>
          )}

          <Button type="submit" className="min-h-11 w-full sm:w-auto sm:min-h-9" disabled={pending}>
            {pending ? FORM_TEXT.submitting : FORM_TEXT.submit}
          </Button>
        </>
      )}
    </form>
  );
}

function TextField({
  id,
  field,
  error,
  disabled,
  onChange,
}: {
  id: string;
  field: FormFieldSpec;
  error?: string;
  disabled: boolean;
  onChange: () => void;
}) {
  const errorId = `${id}-errore`;
  const common = {
    id,
    name: field.name,
    placeholder: field.placeholder || undefined,
    maxLength: field.max,
    disabled,
    "aria-required": field.required || undefined,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
    onChange,
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {field.label}
        {/* Facoltativo, scritto (H4p): gli altri sono obbligatori, come dice la riga sopra i campi. */}
        {field.required ? null : <span className="font-normal text-muted-foreground"> ({FORM_TEXT.optional})</span>}
      </Label>
      {field.multiline ? <Textarea rows={3} {...common} /> : <Input autoComplete="off" className="h-10 sm:h-9" {...common} />}
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Un blocco chiuso dei revisori: si apre con un clic sul titolo. */
function Block({ title, open, onOpenChange, children }: { title: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return (
    <details
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      className="group rounded-lg border border-border"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm font-medium outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        {title}
      </summary>
      <div className="border-t border-border px-4 py-4">{children}</div>
    </details>
  );
}
