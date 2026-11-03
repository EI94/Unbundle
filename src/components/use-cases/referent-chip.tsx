import { UserRound } from "lucide-react";
import { SEMAFORO_TONE } from "@/components/uc/common/semaforo-tone";
import { REFERENT_STATE_TEXT, REFERENT_STATE_TONE, type ReferentStateKey } from "@/lib/use-cases/referent/use-case-state";
import { cn } from "@/lib/utils";

/**
 * (Rilascio 5, SPEC §10.3) Lo stato del referente di uno use case, sulle card della Panoramica, nelle
 * righe, nel pannello e nella testata del contributore: un'icona con il tono e la parola in grigio.
 * Non è una pillola: non è una fase. Lo vedono tutti, i contributori compresi (solo la parola, mai un
 * nome o un numero). Senza stato (uno use case che non ha un referente da scegliere) niente.
 */
export function ReferentChip({ state, className }: { state: ReferentStateKey | null | undefined; className?: string }) {
  if (!state) return null;
  return (
    <span data-slot="referent-chip" data-state={state} className={cn("inline-flex max-w-full min-w-0 items-center gap-1 align-middle text-xs text-muted-foreground", className)}>
      <UserRound aria-hidden className={cn("size-3.5 shrink-0", SEMAFORO_TONE[REFERENT_STATE_TONE[state]].text)} />
      <span className="truncate">{REFERENT_STATE_TEXT[state]}</span>
    </span>
  );
}
