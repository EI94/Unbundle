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
import { SURVEY_TEXT, expertCount, expertDone } from "@/lib/public/survey";
import { PUBLIC_TEXT } from "@/lib/public/text";
import { cn } from "@/lib/utils";
import { PUBLIC_FIELD, PUBLIC_LABEL, PUBLIC_LINK, PUBLIC_PRIMARY } from "@/components/public/classes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, ListChecks, Plus } from "lucide-react";

/**
 * La raccolta dei casi d'uso dal link personale (`/a/<token>`, percorso «esperto»): uno alla volta, quanti se ne vuole.
 *
 * (Rilascio 10, ondata 4, PROPOSTA-10 §3.11, audit Fuori §3.8 AR-15…17) Prima del primo caso il pieno è «Invia questo caso
 * d'uso»; dopo, il pieno è «Ho finito» (in cima, con il conto) e «Aggiungi un altro caso d'uso» diventa bordato. Accanto
 * all'invio una riga con il link a «Come usiamo le tue risposte»: chi chiude registra la presa visione (come prima, sul
 * server). La bozza resta sul dispositivo. Etichette a 14 px scure, campi a 16 px e 44 px, niente occhielli maiuscoli.
 */

const E = SURVEY_TEXT.expert;

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
  const id = `uc-${field.id}`;
  const helpId = field.help ? `${id}-aiuto` : null;
  const errorId = error ? `${id}-errore` : null;
  const common = {
    name: field.id,
    id,
    placeholder: field.placeholder,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": [helpId, errorId].filter(Boolean).join(" ") || undefined,
  } as const;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className={PUBLIC_LABEL}>
        {field.label}
        {field.required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {field.help && (
        <p id={helpId ?? undefined} className="text-sm text-muted-foreground">
          {field.help}
        </p>
      )}
      {field.type === "textarea" ? (
        <Textarea rows={3} className="text-base md:text-base" {...common} />
      ) : field.type === "select" ? (
        <select
          {...common}
          defaultValue=""
          className="h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base text-foreground"
        >
          <option value="">{E.choose}</option>
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <Input type={field.type === "number" ? "number" : "text"} min={0} className={PUBLIC_FIELD} {...common} />
      )}
      {error && (
        <p id={errorId ?? undefined} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function UseCaseExpertForm({
  token,
  initialCount,
  fieldIds,
  noticeHref,
}: {
  token: string;
  initialCount: number;
  fieldIds?: string[] | null;
  /** L'informativa unica, «Come usiamo le tue risposte». */
  noticeHref: string;
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
  // Solo side-effect sul DOM (nessun setState) → un effect è appropriato.
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
      <section role="status" className="mt-6 rounded-xl bg-card p-5 ring-1 ring-foreground/10 sm:p-6" data-testid="usecase-done">
        <CheckCircle2 aria-hidden className="size-6 text-primary" />
        <h2 className="mt-3 text-xl font-semibold">{E.doneTitle}</h2>
        <p className="mt-2 text-muted-foreground">{expertDone(savedCount)}</p>
      </section>
    );
  }

  return (
    <div className="mt-6 space-y-8">
      {/* Lo zero non si vede: il conto e «Ho finito» arrivano con il primo caso. */}
      {savedCount > 0 && (
        <div className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10" data-testid="usecase-counter">
          <p className="flex items-center gap-2 font-medium">
            <ListChecks aria-hidden className="size-4 text-primary" />
            {expertCount(savedCount)}
          </p>
          {justSaved && (
            <p role="status" className="text-muted-foreground" data-testid="usecase-saved">
              {E.saved}
            </p>
          )}
          <form action={finishFormAction}>
            <Button type="submit" className={PUBLIC_PRIMARY} disabled={finishPending} data-testid="usecase-finish">
              {finishPending ? E.finishing : E.finish}
            </Button>
          </form>
        </div>
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
        className="space-y-8"
      >
        {visibleBlocks.map((block) => (
          <section key={block.id} className="space-y-5">
            <div>
              <h2 className="text-xl font-semibold">{block.title}</h2>
              <p className="mt-1 text-muted-foreground">{block.subtitle}</p>
            </div>
            {block.fields.map((field) => (
              <FieldControl
                key={field.id}
                field={field}
                error={localErrors[field.id] || submitState.fieldErrors?.[field.id]}
              />
            ))}
          </section>
        ))}

        <div className="space-y-4">
          {Object.keys(localErrors).length > 0 && (
            <p className="rounded-xl bg-destructive/10 px-4 py-3 text-destructive" role="alert">
              {E.missing}
            </p>
          )}

          {!submitState.ok && submitState.message && (
            <p className="text-destructive" role="alert">
              {submitState.message}
            </p>
          )}

          <p className="text-muted-foreground" data-testid="usecase-acknowledge">
            {E.acknowledge}{" "}
            <a href={noticeHref} className={cn(PUBLIC_LINK, "text-foreground")}>
              {PUBLIC_TEXT.notice}
            </a>
            .
          </p>
          {/* Un solo pieno: prima del primo caso è questo; dopo è «Ho finito», e questo diventa bordato. */}
          <Button type="submit" variant={savedCount > 0 ? "outline" : "default"} className={PUBLIC_PRIMARY} disabled={submitPending} data-testid="usecase-submit">
            <Plus aria-hidden className="size-4" />
            {submitPending ? E.sending : savedCount > 0 ? E.add : E.send}
          </Button>
          <p className="text-sm text-muted-foreground">{E.oneAtATime}</p>
        </div>
      </form>
    </div>
  );
}
