"use client";

import type { ReferentDeclaredValue } from "@/lib/uc/public-view";

/**
 * R2a · «Ci avete già detto» (DESIGN §4.3): il valore già dichiarato, in un
 * gruppo con la sua provenienza nelle parole del referente («In una call con
 * Lateral Space», «Da un documento: …»), mai con codici. Il riquadro compare
 * solo se il referente vede il valore: altrimenti la domanda si pone
 * normalmente.
 */
export function DeclaredValue({ declared, id }: { declared: ReferentDeclaredValue; id: string }) {
  if (declared.display === null) return null;
  return (
    <div role="group" aria-labelledby={`${id}-gia`} className="space-y-1 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
      <p id={`${id}-gia`} className="text-sm text-muted-foreground">
        Ci avete già detto
      </p>
      <p className="text-xl leading-7 font-semibold break-words">{declared.display}</p>
      <p className="text-sm break-words text-muted-foreground">{declared.sourceLabel}</p>
    </div>
  );
}
