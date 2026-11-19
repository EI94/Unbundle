"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Hammer, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Fold } from "@/components/ui-10/fold";
import { notifyDone } from "@/components/ui-10/toast";
import { createQuickUseCaseAction, createUseCaseFromFormAction } from "@/lib/actions/use-case-create";
import { COST_BANDS, type CostBandInfo } from "@/lib/use-cases/cost-bands";
import {
  FORM_FIELD_NAMES,
  FORM_TEXT,
  ORIGIN_OPTIONS,
  QUICK_CREATE_MAX,
  QUICK_CREATE_TEXT,
  formFields,
  parseQuickUseCaseForm,
  parseUseCaseForm,
  type FormFieldSpec,
} from "@/lib/use-cases/create";
import { KIND_LABEL } from "@/lib/use-cases/labels";
import { KINDS, type Origin, type UseCaseKind } from "@/lib/use-cases/types";
import { cn } from "@/lib/utils";
import { CostInput } from "./cost-input";
import { ORIGIN_DOT_CLASS } from "./origin-chip";

export interface UseCaseFormProps {
  workspaceId: string;
  /** Revisori: «Origine» e «Valutazione iniziale» in più, dentro «Aggiungi dettagli». */
  isReviewer: boolean;
  /** L'origine proposta (`defaultOriginFor`): «Dall'alto» per Lateral Space. */
  defaultOrigin: Origin;
  /** «Impatto ambientale e sociale» solo con ESG attivo. */
  esgEnabled: boolean;
  /** Le 5 fasce del costo del workspace (D15, `resolveCostBands`); predefinite `COST_BANDS`. */
  costBands?: readonly CostBandInfo[];
  /**
   * «pagina» (`/use-cases/nuovo`): «Invia lo use case», `web_proposed`, poi la ricevuta. «pannello» (il pannello rapido
   * di Lateral Space): «Salva» pieno e «Salva e aggiungi un altro» bordato, con «AI Lab», `manual`.
   */
  variant?: "pagina" | "pannello";
  /** Pannello: i valori di «AI Lab» del workspace, dal più recente, e l'ultimo usato, da cui parte il campo. */
  aiLabs?: readonly string[];
  lastAiLab?: string | null;
  /** Pannello: dopo «Salva», lo use case salvato (il pannello si chiude e apre il suo pannello laterale). */
  onSaved?: (useCaseId: string) => void;
  /** Il campo «Titolo», per il fuoco all'apertura del pannello. */
  titleRef?: RefObject<HTMLInputElement | null>;
}

const KIND_ICON = { da_costruire: Hammer, da_diffondere: Megaphone } as const;

/** I campi in vista: il resto sta in «Aggiungi dettagli». */
const IN_VIEW: readonly string[] = ["title", "description"];

type SaveMode = "invia" | "salva" | "altro";

/**
 * Mette a fuoco un campo del modulo (il primo con un errore, o il titolo dopo «Salva e aggiungi un altro»): se sta in
 * «Aggiungi dettagli» chiusa, prima la apre.
 */
function focusFieldIn(form: HTMLFormElement | null, detailsId: string, name: string): void {
  if (!form) return;
  if (!IN_VIEW.includes(name) && name !== FORM_FIELD_NAMES.kind) {
    form.querySelector<HTMLButtonElement>(`#${CSS.escape(detailsId)} button[aria-expanded="false"]`)?.click();
  }
  const selector = `[name="${CSS.escape(name)}"]:not([type="hidden"]), [data-field="${CSS.escape(name)}"]`;
  requestAnimationFrame(() => {
    const target = form.querySelector<HTMLElement>(selector);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (target && "focus" in target) target.focus({ preventScroll: true });
  });
}

/**
 * Il modulo di «Nuovo use case» (docs/use-case/DESIGN.md §5.3, §5.4; rilascio 10, §3.4, D8): uno solo, nella pagina
 * `/use-cases/nuovo` e nel pannello rapido di Lateral Space.
 * - In vista il tipo, due scelte grandi «Da costruire» e «Da diffondere» (parte da «Da costruire»), il Titolo e il
 *   Problema («Prima» per «Da diffondere»): i soli obbligatori.
 * - Tutto il resto in «Aggiungi dettagli», chiusa: gli stessi campi di prima, nello stesso ordine e con le stesse
 *   etichette per tipo; nel pannello anche «AI Lab» (in testa, e la piega dice quale); per i revisori «Origine» e
 *   «Valutazione iniziale» (Valore all'anno e il campo costo). Un errore lì apre la piega.
 * - Un solo pulsante pieno: «Invia lo use case» nella pagina; nel pannello «Salva» (salva e apre lo use case) e,
 *   bordato, «Salva e aggiungi un altro» (salva, svuota i campi, tiene tipo, origine e AI Lab, torna al titolo).
 * I campi si controllano qui con le stesse regole dell'action (`parseUseCaseForm`, `parseQuickUseCaseForm`).
 */
export function UseCaseForm({
  workspaceId,
  isReviewer,
  defaultOrigin,
  esgEnabled,
  costBands = COST_BANDS,
  variant = "pagina",
  aiLabs = [],
  lastAiLab = null,
  onSaved,
  titleRef,
}: UseCaseFormProps) {
  const router = useRouter();
  const baseId = `modulo-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const detailsId = `${baseId}-dettagli`;
  const formRef = useRef<HTMLFormElement>(null);
  const ownTitleRef = useRef<HTMLInputElement>(null);
  const titleInput = titleRef ?? ownTitleRef;
  const problemRef = useRef<HTMLTextAreaElement>(null);
  /** Il campo da mettere a fuoco quando il salvataggio finisce: mentre salva i campi sono spenti. */
  const focusAfterSave = useRef<string | null>(null);
  const panel = variant === "pannello";
  const [kind, setKind] = useState<UseCaseKind>("da_costruire");
  const [origin, setOrigin] = useState<Origin>(defaultOrigin);
  const [aiLab, setAiLab] = useState(lastAiLab ?? "");
  const [labs, setLabs] = useState<readonly string[]>(aiLabs);
  /** Cresce dopo «Salva e aggiungi un altro»: i campi di testo ripartono vuoti. */
  const [round, setRound] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const fields = formFields(kind, { esgEnabled });
  const inView = fields.filter((field) => IN_VIEW.includes(field.name));
  const details = fields.filter((field) => !IN_VIEW.includes(field.name));

  // Dopo un salvataggio (i campi tornano attivi) il fuoco va dove serve: il primo errore, o il titolo.
  useEffect(() => {
    if (pending) return;
    const name = focusAfterSave.current;
    if (!name) return;
    focusAfterSave.current = null;
    focusFieldIn(formRef.current, detailsId, name);
  }, [pending, round, detailsId]);

  function clearError(name: string) {
    setErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  /** Gli errori del controllo nel browser: il fuoco va subito al primo campo da correggere. */
  function showErrors(fieldErrors: Record<string, string>, text: string | null) {
    setErrors(fieldErrors);
    setMessage(text);
    const first = Object.keys(fieldErrors)[0];
    if (first) focusFieldIn(formRef.current, detailsId, first);
  }

  function save(mode: SaveMode) {
    if (pending || !formRef.current) return;
    const data = new FormData(formRef.current);
    const read = (name: string) => data.get(name);
    const checked = panel ? parseQuickUseCaseForm(read, { esgEnabled, isReviewer }) : parseUseCaseForm(read, { esgEnabled, isReviewer });
    if (!checked.ok) {
      showErrors(checked.fieldErrors, checked.message);
      return;
    }
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      if (!panel) {
        let result: Awaited<ReturnType<typeof createUseCaseFromFormAction>>;
        try {
          result = await createUseCaseFromFormAction(workspaceId, data);
        } catch {
          setMessage(FORM_TEXT.error);
          return;
        }
        if (!result.ok) {
          focusAfterSave.current = Object.keys(result.fieldErrors)[0] ?? null;
          setErrors(result.fieldErrors);
          setMessage(result.message);
          return;
        }
        router.push(result.href);
        return;
      }
      let result: Awaited<ReturnType<typeof createQuickUseCaseAction>>;
      try {
        result = await createQuickUseCaseAction(workspaceId, data);
      } catch {
        setMessage(QUICK_CREATE_TEXT.error);
        return;
      }
      if (!result.ok) {
        focusAfterSave.current = Object.keys(result.fieldErrors)[0] ?? null;
        setErrors(result.fieldErrors);
        setMessage(result.message);
        return;
      }
      const savedLab = aiLab.trim();
      if (savedLab && !labs.includes(savedLab)) setLabs([savedLab, ...labs]);
      if (mode === "altro") {
        notifyDone(result.message);
        setRound((value) => value + 1);
        focusAfterSave.current = "title";
        router.refresh();
        return;
      }
      onSaved?.(result.id);
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save(panel ? "salva" : "invia");
  }

  /** Invio nel titolo porta al problema, non invia: il problema è obbligatorio. */
  function onTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    problemRef.current?.focus();
  }

  const listId = `${baseId}-ai-lab-elenco`;

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="space-y-6" data-slot="use-case-form" data-variant={variant}>
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
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2 font-semibold">
                    <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    {KIND_LABEL[value].label}
                  </span>
                  <span className="text-muted-foreground">{FORM_TEXT.kindOptions[value]}</span>
                </span>
              </label>
            );
          })}
        </div>
        {errors.kind && <p className="text-sm text-destructive">{errors.kind}</p>}
      </fieldset>

      <div key={round} className="space-y-6">
        <div className="space-y-5">
          {inView.map((field) => (
            <TextField
              key={field.name}
              id={`${baseId}-${field.name}`}
              field={field}
              error={errors[field.name]}
              disabled={pending}
              onChange={() => clearError(field.name)}
              inputRef={field.name === "title" ? titleInput : undefined}
              textareaRef={field.name === "description" ? problemRef : undefined}
              onKeyDown={field.name === "title" ? onTitleKeyDown : undefined}
            />
          ))}
        </div>

        <Fold id={detailsId} title={FORM_TEXT.details} summary={panel && aiLab.trim() ? aiLab.trim() : null}>
          {panel ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${baseId}-ai-lab`}>{QUICK_CREATE_TEXT.aiLabLabel}</Label>
              <Input
                id={`${baseId}-ai-lab`}
                name={FORM_FIELD_NAMES.aiLab}
                value={aiLab}
                list={listId}
                maxLength={QUICK_CREATE_MAX.aiLab}
                autoComplete="off"
                placeholder={QUICK_CREATE_TEXT.aiLabPlaceholder}
                disabled={pending}
                aria-invalid={errors.aiLab ? true : undefined}
                aria-describedby={errors.aiLab ? `${baseId}-ai-lab-errore` : undefined}
                onChange={(event) => {
                  setAiLab(event.target.value);
                  clearError(FORM_FIELD_NAMES.aiLab);
                }}
                className="h-11 text-base sm:h-9 sm:text-sm"
              />
              <datalist id={listId}>
                {labs.map((lab) => (
                  <option key={lab} value={lab} />
                ))}
              </datalist>
              {errors.aiLab && (
                <p id={`${baseId}-ai-lab-errore`} className="text-sm text-destructive">
                  {errors.aiLab}
                </p>
              )}
            </div>
          ) : null}
          {details.map((field) => (
            <TextField key={field.name} id={`${baseId}-${field.name}`} field={field} error={errors[field.name]} disabled={pending} onChange={() => clearError(field.name)} />
          ))}
          {isReviewer ? (
            <>
              <fieldset className="space-y-2" data-field={FORM_FIELD_NAMES.origin}>
                <legend className="mb-1 text-sm font-medium">{FORM_TEXT.originBlock}</legend>
                {ORIGIN_OPTIONS.map((option) => (
                  <label key={option.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 sm:min-h-10">
                    <input
                      type="radio"
                      name={FORM_FIELD_NAMES.origin}
                      value={option.value}
                      checked={origin === option.value}
                      disabled={pending}
                      onChange={() => {
                        setOrigin(option.value);
                        clearError(FORM_FIELD_NAMES.origin);
                      }}
                      className="size-4 shrink-0 accent-primary"
                    />
                    <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", ORIGIN_DOT_CLASS[option.value])} />
                    <span>{option.label}</span>
                  </label>
                ))}
                {errors.origin && <p className="px-2 text-sm text-destructive">{errors.origin}</p>}
              </fieldset>
              <fieldset className="space-y-6">
                <legend className="mb-1 text-sm font-medium">{FORM_TEXT.valuationBlock}</legend>
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
                      className="h-11 pr-8 text-base sm:h-9 sm:text-sm"
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
                  <CostInput name={FORM_FIELD_NAMES.cost} bands={costBands} error={errors.cost} disabled={pending} onValueChange={() => clearError(FORM_FIELD_NAMES.cost)} />
                </div>
              </fieldset>
            </>
          ) : null}
        </Fold>
      </div>

      {message && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {message}
        </p>
      )}

      {panel ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" className="min-h-11 sm:min-h-9" disabled={pending}>
            {pending ? QUICK_CREATE_TEXT.saving : QUICK_CREATE_TEXT.save}
          </Button>
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={pending} onClick={() => save("altro")}>
            {QUICK_CREATE_TEXT.saveAndAdd}
          </Button>
        </div>
      ) : (
        <Button type="submit" className="min-h-11 w-full sm:w-auto sm:min-h-9" disabled={pending}>
          {pending ? FORM_TEXT.submitting : FORM_TEXT.submit}
        </Button>
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
  inputRef,
  textareaRef,
  onKeyDown,
}: {
  id: string;
  field: FormFieldSpec;
  error?: string;
  disabled: boolean;
  onChange: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
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
      <Label htmlFor={id}>{field.label}</Label>
      {field.multiline ? (
        <Textarea ref={textareaRef} rows={3} className="text-base sm:text-sm" {...common} />
      ) : (
        <Input ref={inputRef} autoComplete="off" className="h-11 text-base sm:h-9 sm:text-sm" onKeyDown={onKeyDown} {...common} />
      )}
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
