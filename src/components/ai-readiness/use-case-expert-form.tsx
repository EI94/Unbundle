"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  finishUseCaseExpertAction,
  submitUseCaseExpertCaseAction,
  type AiReadinessActionState,
} from "@/lib/actions/ai-readiness";
import {
  filterUseCaseBlocks,
  validateUseCaseValues,
  type UseCaseField,
} from "@/lib/ai-readiness/use-case-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, ListChecks, Plus } from "lucide-react";

const SUBMIT_INITIAL: AiReadinessActionState<{ savedCount: number }> = { ok: true };
const FINISH_INITIAL: AiReadinessActionState<{ completed: true }> = { ok: true };

function draftKey(token: string) {
  return `unbundle-air-usecase:${token.slice(-16)}`;
}

function FieldControl({
  field,
  error,
}: {
  field: UseCaseField;
  error?: string;
}) {
  const common = {
    name: field.id,
    id: `uc-${field.id}`,
    placeholder: field.placeholder,
    "aria-invalid": error ? true : undefined,
  } as const;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`uc-${field.id}`} className="text-sm leading-5">
        {field.label}
        {field.required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {field.help && (
        <p className="text-xs leading-5 text-muted-foreground">{field.help}</p>
      )}
      {field.type === "textarea" ? (
        <Textarea rows={3} {...common} />
      ) : field.type === "select" ? (
        <select
          {...common}
          defaultValue=""
          className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
        >
          <option value="">Seleziona...</option>
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <Input type={field.type === "number" ? "number" : "text"} min={0} {...common} />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function UseCaseExpertForm({
  token,
  initialCount,
  fieldIds,
}: {
  token: string;
  initialCount: number;
  fieldIds?: string[] | null;
}) {
  const submitAction = submitUseCaseExpertCaseAction.bind(null, token);
  const finishAction = finishUseCaseExpertAction.bind(null, token);
  const [submitState, submitFormAction, submitPending] = useActionState(
    submitAction,
    SUBMIT_INITIAL
  );
  const [finishState, finishFormAction, finishPending] = useActionState(
    finishAction,
    FINISH_INITIAL
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const finished = finishState.data?.completed === true;
  // Stato derivato dal risultato dell'action: nessun setState negli effect.
  const savedCount = submitState.data?.savedCount ?? initialCount;
  const justSaved = submitState.ok && submitState.data?.savedCount != null;
  const visibleBlocks = useMemo(() => filterUseCaseBlocks(fieldIds), [fieldIds]);

  // Autosave sul dispositivo: se l'esperto chiude a metà, ritrova il caso.
  const persist = () => {
    const form = formRef.current;
    if (!form) return;
    const data: Record<string, string> = {};
    for (const el of Array.from(form.elements)) {
      const input = el as HTMLInputElement;
      if (!input.name || input.name.startsWith("$")) continue;
      if (input.value) data[input.name] = input.value;
    }
    try {
      window.localStorage.setItem(draftKey(token), JSON.stringify(data));
    } catch {}
  };

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    try {
      const raw = window.localStorage.getItem(draftKey(token));
      if (!raw) return;
      const data = JSON.parse(raw) as Record<string, string>;
      for (const [name, value] of Object.entries(data)) {
        const el = form.elements.namedItem(name) as
          | HTMLInputElement
          | HTMLTextAreaElement
          | HTMLSelectElement
          | null;
        if (el) el.value = value;
      }
    } catch {}
  }, [token]);

  // Caso salvato con successo: resetta il form per il prossimo, pulisci draft.
  // Solo side-effect sul DOM (nessun setState) → un effect e appropriato.
  useEffect(() => {
    if (submitState.ok && submitState.data?.savedCount != null) {
      formRef.current?.reset();
      try {
        window.localStorage.removeItem(draftKey(token));
      } catch {}
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [submitState, token]);

  if (finished) {
    return (
      <div className="rounded-[32px] border bg-card p-8 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
          <CheckCircle2 className="size-6" />
        </div>
        <h1 className="text-2xl font-semibold">Grazie!</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Hai inviato {savedCount}{" "}
          {savedCount === 1 ? "caso" : "casi"}. Il team li esaminera e li
          trasformera in ipotesi concrete su dove l&apos;AI puo aiutare.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4"
        data-testid="usecase-counter"
      >
        <div className="flex items-center gap-2 text-sm">
          <ListChecks className="size-4 text-emerald-600" />
          <span className="font-medium">
            {savedCount === 0
              ? "Nessun caso inviato finora"
              : `${savedCount} ${savedCount === 1 ? "caso inviato" : "casi inviati"}`}
          </span>
        </div>
        {savedCount > 0 && (
          <form action={finishFormAction}>
            <Button type="submit" variant="outline" size="sm" disabled={finishPending}>
              {finishPending ? "Chiudo..." : "Ho finito"}
            </Button>
          </form>
        )}
      </div>

      {justSaved && submitState.message && (
        <p
          className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm"
          role="status"
          data-testid="usecase-saved"
        >
          {submitState.message}
        </p>
      )}

      <form
        ref={formRef}
        action={submitFormAction}
        onChange={() => {
          persist();
          const form = formRef.current;
          if (!form) return;
          const data = new FormData(form);
          setLocalErrors((current) => {
            const next: Record<string, string> = {};
            for (const [key, message] of Object.entries(current)) {
              if (String(data.get(key) ?? "").trim()) continue;
              next[key] = message;
            }
            return next;
          });
        }}
        noValidate
        onSubmit={(event) => {
          const form = event.currentTarget;
          const data = new FormData(form);
          const values: Record<string, string> = {};
          for (const [key, raw] of data.entries()) {
            if (typeof raw === "string" && raw.trim()) values[key] = raw.trim();
          }
          const errors = validateUseCaseValues(values, fieldIds);
          if (Object.keys(errors).length === 0) {
            setLocalErrors({});
            return;
          }
          event.preventDefault();
          setLocalErrors(errors);
          const first = Object.keys(errors)[0];
          form
            .querySelector<HTMLElement>(`[name="${CSS.escape(first)}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
        className="space-y-6"
      >
        {visibleBlocks.map((block) => (
          <section key={block.id} className="rounded-[32px] border bg-card p-6">
            <div className="text-xs uppercase tracking-[0.22em] text-emerald-600">
              {block.title}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{block.subtitle}</p>
            <div className="mt-5 space-y-5">
              {block.fields.map((field) => (
                <FieldControl
                  key={field.id}
                  field={field}
                  error={localErrors[field.id] || submitState.fieldErrors?.[field.id]}
                />
              ))}
            </div>
          </section>
        ))}

        {Object.keys(localErrors).length > 0 && (
          <p className="rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
            Completa i campi evidenziati prima di salvare il caso.
          </p>
        )}

        {!submitState.ok && submitState.message && (
          <p className="text-sm text-destructive" role="alert">
            {submitState.message}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={submitPending} data-testid="usecase-submit">
            <Plus className="mr-1 size-4" />
            {submitPending
              ? "Salvo il caso..."
              : savedCount > 0
                ? "Aggiungi questo caso"
                : "Invia questo caso"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Puoi inviare quanti casi vuoi: uno alla volta.
          </span>
        </div>
      </form>
    </div>
  );
}
