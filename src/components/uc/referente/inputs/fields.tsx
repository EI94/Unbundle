"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Issue } from "@/lib/uc/answers/issues";
import type { ResponseConfig } from "@/lib/uc/answers/types";
import type { Json } from "@/lib/uc/types";

/**
 * Pezzi comuni degli input della pagina del referente: campi nativi grandi
 * (area di tocco di almeno 44 px, testo a 16 px così il telefono non ingrandisce),
 * etichette che vanno a capo, errori accanto al campo. Nessun componente con
 * portale (Select, Popover, Tooltip): resterebbe scuro fuori da `.survey-light`.
 */

export interface InputProps {
  /** Prefisso degli id dei campi, unico per voce. */
  id: string;
  config: ResponseConfig;
  value: Json;
  onChange: (next: Json) => void;
  issues: readonly Issue[];
  disabled: boolean;
  /** Etichetta accessibile del campo principale (il testo della domanda). */
  label: string;
}

export const CONTROL_CLASS =
  "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive";

export const TEXTAREA_CLASS =
  "min-h-24 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2.5 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive";

export const CHOICE_ROW_CLASS =
  "flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-base has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60";

export const NATIVE_CHECK_CLASS = "size-5 shrink-0 accent-primary";

export function obj(value: Json): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, Json>) : {};
}

export function text(value: Json | undefined): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

/** Problemi di un campo: esatto o annidato (`fx.date`, `rows[2]`). */
export function issuesFor(issues: readonly Issue[], field: string): Issue[] {
  return issues.filter((i) => i.field === field || i.field?.startsWith(`${field}.`) || i.field?.startsWith(`${field}[`));
}

export function FieldErrors({ id, issues }: { id?: string; issues: readonly Issue[] }) {
  if (issues.length === 0) return null;
  const unique = [...new Map(issues.map((i) => [i.message, i])).values()];
  return (
    <ul id={id} className="space-y-1 text-sm break-words text-uc-rosso" aria-live="polite">
      {unique.map((i) => (
        <li key={`${i.code}-${i.message}`}>{i.message}</li>
      ))}
    </ul>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  issues = [],
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  issues?: readonly Issue[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium break-words">
        {label}
      </label>
      {children}
      {hint ? <p className="text-sm break-words text-muted-foreground">{hint}</p> : null}
      <FieldErrors id={htmlFor ? `${htmlFor}-err` : undefined} issues={issues} />
    </div>
  );
}

export function TextControl({
  id,
  value,
  onChange,
  disabled,
  invalid,
  inputMode,
  placeholder,
  type = "text",
  ariaLabel,
  autoCapitalize,
  list,
  max,
  className,
  enterKeyHint = "next",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  invalid?: boolean;
  inputMode?: "text" | "decimal" | "numeric" | "email";
  placeholder?: string;
  type?: "text" | "date" | "time" | "email";
  ariaLabel?: string;
  autoCapitalize?: "none" | "characters" | "sentences";
  list?: string;
  max?: string;
  className?: string;
  /** Tasto Invio della tastiera del telefono: «avanti» di default (Invio equivale ad «Avanti»). */
  enterKeyHint?: "next" | "done" | "send" | "enter";
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-err` : undefined}
      aria-label={ariaLabel}
      enterKeyHint={enterKeyHint}
      inputMode={inputMode}
      placeholder={placeholder}
      autoCapitalize={autoCapitalize}
      autoComplete="off"
      spellCheck={type === "text" && inputMode !== "decimal" && inputMode !== "numeric"}
      list={list}
      max={max}
      className={cn(CONTROL_CLASS, className)}
    />
  );
}

export function TextAreaControl({
  id,
  value,
  onChange,
  disabled,
  invalid,
  placeholder,
  ariaLabel,
  rows = 3,
  className,
  onPaste,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  invalid?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  rows?: number;
  className?: string;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <textarea
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPaste={onPaste}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-err` : undefined}
      aria-label={ariaLabel}
      placeholder={placeholder}
      rows={rows}
      className={cn(TEXTAREA_CLASS, className)}
    />
  );
}

export function SelectControl({
  id,
  value,
  onChange,
  disabled,
  invalid,
  options,
  placeholder,
  ariaLabel,
  className,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  invalid?: boolean;
  options: readonly { value: string; label: string }[];
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-label={ariaLabel}
      className={cn(CONTROL_CLASS, "pr-8", className)}
    >
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Gruppo di scelte singole (radio nativi grandi). */
export function RadioRows({
  name,
  value,
  onChange,
  disabled,
  options,
  legend,
  issues = [],
  columns = 1,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  options: readonly { value: string; label: string }[];
  legend: string;
  issues?: readonly Issue[];
  columns?: 1 | 2;
}) {
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="sr-only">{legend}</legend>
      <div className={cn("grid gap-2", columns === 2 && "grid-cols-2")}>
        {options.map((o) => (
          <label key={o.value} className={CHOICE_ROW_CLASS}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              disabled={disabled}
              className={NATIVE_CHECK_CLASS}
            />
            <span className="min-w-0 break-words">{o.label}</span>
          </label>
        ))}
      </div>
      <FieldErrors issues={issues} />
    </fieldset>
  );
}

/** Casella con l'etichetta che fa da area di tocco. */
export function CheckRow({ id, checked, onChange, disabled, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean; children: ReactNode }) {
  return (
    <label htmlFor={id} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 text-base has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} className={NATIVE_CHECK_CLASS} />
      <span className="min-w-0 break-words">{children}</span>
    </label>
  );
}

/** Testo dell'unità accanto al campo («richieste al mese»). */
export function Suffix({ children }: { children: ReactNode }) {
  return <span className="min-w-0 shrink text-sm break-words text-muted-foreground">{children}</span>;
}
