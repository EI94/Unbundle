"use client";

import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * «Filtri» (DESIGN §5.1): un pulsante con il numero dei filtri attivi e un
 * pannello con un `Select` di shadcn per ogni campo, al posto delle `select`
 * native. I valori vivono nell'URL: il genitore riceve `onChange` e `onClear`.
 */
export interface FilterField {
  key: string;
  label: string;
  options: readonly { value: string; label: string }[];
  /** Testo del valore vuoto, es. «Tutti». */
  placeholder?: string;
}

export interface FilterPopoverProps {
  fields: readonly FilterField[];
  values: Readonly<Record<string, string | null | undefined>>;
  onChange: (key: string, value: string | null) => void;
  onClear: () => void;
  label?: string;
}

const ALL = "__tutti__";

export function FilterPopover({ fields, values, onChange, onClear, label = "Filtri" }: FilterPopoverProps) {
  const active = fields.filter((f) => values[f.key]).length;
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" className="min-h-11 sm:min-h-8" />}>
        <SlidersHorizontal aria-hidden />
        {label}
        {active > 0 && (
          <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums" aria-label={`${active} attivi`}>
            {active}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] gap-3 p-3">
        {fields.map((field) => {
          const id = `filtro-${field.key}`;
          const items = [{ value: ALL, label: field.placeholder ?? "Tutti" }, ...field.options];
          return (
            <div key={field.key} className="space-y-1">
              <label htmlFor={id} className="text-xs text-muted-foreground">
                {field.label}
              </label>
              <Select items={items} value={values[field.key] ?? ALL} onValueChange={(v) => onChange(field.key, v && v !== ALL ? String(v) : null)}>
                <SelectTrigger id={id} className="min-h-11 w-full sm:min-h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {items.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
        {active > 0 && (
          <Button type="button" variant="ghost" className="min-h-11 justify-start sm:min-h-8" onClick={onClear}>
            Togli i filtri
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
