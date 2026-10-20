import { EyeOff, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ValueView } from "@/lib/uc/views/format";

/**
 * Valore di una risposta. Quando il ruolo non lo vede, o il dato è personale o
 * sanitario, al posto del valore c'è il motivo. Un valore dichiarato nelle call
 * si mostra in grigio: va ancora confermato.
 */
export function ValueText({ value, declared = false, className }: { value: ValueView; declared?: boolean; className?: string }) {
  if (value.kind === "none") return <span className={cn("text-muted-foreground", className)}>—</span>;
  if (value.kind === "hidden") {
    const Icon = value.reason === "visibilita" ? EyeOff : Lock;
    return (
      <span className={cn("inline-flex min-w-0 items-start gap-1 text-xs text-muted-foreground", className)}>
        <Icon className="mt-0.5 size-3 shrink-0" aria-hidden />
        <span className="break-words">{value.text}</span>
      </span>
    );
  }
  return <span className={cn("min-w-0 break-words whitespace-pre-line", declared && "text-muted-foreground", className)}>{value.text}</span>;
}
