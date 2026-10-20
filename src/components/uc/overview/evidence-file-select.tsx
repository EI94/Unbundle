"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VIA_EVIDENCE_HINT } from "@/lib/uc/views/progress";

const NONE = "__nessuno";

/**
 * Il file di prova (email, verbale, approvazione scritta) scelto fra i file
 * utilizzabili del caso, con il `Select` di shadcn (DESIGN §5.4: nel dashboard
 * niente `select` nativi). Senza file, il suggerimento di caricarlo prima in
 * Domande › Documenti.
 */
export function EvidenceFileSelect({
  id,
  label,
  files,
  value,
  onChange,
  placeholder = "Nessun file",
}: {
  id: string;
  label: string;
  files: readonly { id: string; name: string }[];
  value: string;
  onChange: (fileId: string) => void;
  placeholder?: string;
}) {
  if (files.length === 0) {
    return (
      <div className="min-w-0 space-y-0.5 text-sm">
        <p className="font-medium">{label}</p>
        <p className="text-muted-foreground">{VIA_EVIDENCE_HINT}</p>
      </div>
    );
  }
  const items = [{ value: NONE, label: placeholder }, ...files.map((f) => ({ value: f.id, label: f.name }))];
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select items={items} value={value || NONE} onValueChange={(v) => onChange(v && v !== NONE ? String(v) : "")}>
        <SelectTrigger id={id} className="min-h-11 w-full max-w-sm sm:min-h-8">
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
}
