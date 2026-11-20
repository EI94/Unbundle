"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { LEVER_META } from "@/components/uc/common/lever-icons";
import { DetailSheet } from "@/components/uc/ui/detail-sheet";
import { updateCaseSettingsAction } from "@/lib/actions/uc-cases";
import { VALUE_TEXT } from "@/lib/uc/views/roi";
import { LEVERS, type Lever } from "@/lib/uc/vocab";

/**
 * «Cambia le leve» (rilascio 10, §3.5; F-096): le 8 leve della realizzazione come interruttori, con il loro nome (mai
 * icone sole), in un pannello di Valore (`?apri=leve`). Prima stavano in Impostazioni del caso; le salva lo stesso
 * comando (`updateCaseSettingsAction`, solo le leve), solo il responsabile Lateral Space.
 */
export function LeverSwitchesPanel({ workspaceId, caseId, levers, closeHref }: { workspaceId: string; caseId: string; levers: readonly Lever[]; closeHref: string }) {
  const { pending, run } = useUcAction();
  const [on, setOn] = useState<Set<Lever>>(new Set(levers));
  const dirty = LEVERS.some((l) => on.has(l) !== levers.includes(l));
  return (
    <DetailSheet
      title={VALUE_TEXT.leversTitle}
      description={VALUE_TEXT.leversNote}
      closeHref={closeHref}
      footer={
        <Button type="submit" form="uc-levers" className="h-11 sm:h-8" disabled={pending || !dirty}>
          {VALUE_TEXT.save}
        </Button>
      }
    >
      <form
        id="uc-levers"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateCaseSettingsAction(workspaceId, caseId, { levers: LEVERS.filter((l) => on.has(l)) }));
        }}
      >
        <fieldset className="space-y-1">
          <legend className="sr-only">{VALUE_TEXT.levers}</legend>
          {LEVERS.map((lever) => {
            const { label, icon: Icon } = LEVER_META[lever];
            const id = `uc-lever-${lever}`;
            return (
              <label key={lever} htmlFor={id} className="flex min-h-11 items-center justify-between gap-3 text-sm sm:min-h-9">
                <span className="inline-flex items-center gap-2">
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {label}
                </span>
                <Switch
                  id={id}
                  checked={on.has(lever)}
                  onCheckedChange={(checked) => {
                    const next = new Set(on);
                    if (checked) next.add(lever);
                    else next.delete(lever);
                    setOn(next);
                  }}
                />
              </label>
            );
          })}
        </fieldset>
      </form>
    </DetailSheet>
  );
}
