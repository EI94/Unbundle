"use client";

import { ChevronRight } from "lucide-react";
import type { Issue } from "@/lib/uc/answers/issues";
import { fieldIssues } from "@/lib/uc/views/referente-form";
import { R_TEXT } from "@/lib/uc/views/referente-text";
import { Field, TextControl } from "./inputs/fields";

/**
 * R3 · «Non lo so» (DESIGN §4.3): un pannello in linea, senza finestre sopra,
 * con un tono che non fa sentire in difetto. «Chi potrebbe saperlo?» è
 * facoltativo; «Chiedi a un'altra persona» (rilascio 10, §4.1) compare solo se
 * la delega è ammessa. «Non lo so» conta come fatta nell'avanzamento. La barra
 * con «Annulla» e «Avanti» la mette il passo.
 */
export function DontKnowPanel({
  id,
  who,
  issues,
  disabled,
  delegateHref,
  onWho,
}: {
  id: string;
  who: string;
  issues: readonly Issue[];
  disabled: boolean;
  /** Indirizzo di R5 per questa domanda, oppure null se la delega non è ammessa. */
  delegateHref: string | null;
  onWho: (v: string) => void;
}) {
  const own = fieldIssues(issues, "who_might_know");
  return (
    <div className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="text-base font-medium">{R_TEXT.dontKnow.lead}</p>
      <Field label={R_TEXT.dontKnow.who} htmlFor={`${id}-who`} issues={own}>
        <TextControl id={`${id}-who`} value={who} onChange={onWho} disabled={disabled} invalid={own.length > 0} placeholder={R_TEXT.dontKnow.whoPlaceholder} enterKeyHint="done" />
      </Field>
      {delegateHref ? (
        <a href={delegateHref} className="inline-flex min-h-11 items-center gap-1 text-base text-primary underline-offset-4 hover:underline">
          {R_TEXT.dontKnow.delegate}
          <ChevronRight className="size-4" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}
