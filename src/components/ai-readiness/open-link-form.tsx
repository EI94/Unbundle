"use client";

import { useActionState, useState } from "react";
import {
  generateAiReadinessOpenLinkAction,
  type AiReadinessActionState,
} from "@/lib/actions/ai-readiness";
import { AI_READINESS_SURVEY_TRACKS } from "@/lib/ai-readiness/survey-track";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, Copy, Link2 } from "lucide-react";

const INITIAL: AiReadinessActionState<{ openUrl: string }> = { ok: true };

type SectionOption = {
  id: string;
  title: string;
  description?: string;
  pillarTitle: string;
};

export function OpenLinkForm({
  workspaceId,
  assessmentId,
  hasExisting,
  sections,
}: {
  workspaceId: string;
  assessmentId: string;
  hasExisting: boolean;
  sections: SectionOption[];
}) {
  const action = generateAiReadinessOpenLinkAction.bind(null, workspaceId, assessmentId);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [copied, setCopied] = useState(false);
  const [selectedSectionIds, setSelectedSectionIds] = useState(() =>
    sections.map((section) => section.id)
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const url = state.ok ? state.data?.openUrl : undefined;
  const allSelected =
    sections.length > 0 && selectedSectionIds.length === sections.length;
  const track = AI_READINESS_SURVEY_TRACKS.everyone;

  return (
    <div
      className="rounded-[28px] border border-emerald-500/25 bg-emerald-500/5 p-5"
      data-testid="open-link-form"
      data-survey-track="everyone"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/25 bg-background text-emerald-600">
            <Building2 className="size-4" />
          </span>
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
              Percorso 1 · {track.audience}
            </div>
            <div className="mt-1 text-base font-semibold">{track.label}</div>
          </div>
        </div>
        <span className="rounded-full border border-emerald-500/25 bg-background px-2.5 py-1 text-xs font-medium">
          Link condivisibile
        </span>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
        Un unico link da girare in chat, email o intranet: chi lo apre inserisce
        la propria area e riceve la survey generale con salvataggio automatico.
      </p>
      <div className="mt-3 rounded-2xl border border-emerald-500/20 bg-background/80 p-3 text-xs leading-5">
        <span className="font-medium">Alimenta: {track.feeds}.</span>{" "}
        <span className="text-muted-foreground">
          Non raccoglie infrastruttura, dati aziendali o processi interni: per
          Context e Workflow usa la scheda referenti qui sotto.
        </span>
      </div>
      <form
        action={formAction}
        className="mt-4 space-y-4"
        noValidate
        onSubmit={(event) => {
          if (selectedSectionIds.length === 0) {
            event.preventDefault();
            setLocalError("Scegli almeno un'area da mostrare nella survey.");
            return;
          }
          if (
            hasExisting &&
            !window.confirm(
              "Generare un nuovo link condivisibile? Quello precedente smetterà di funzionare per chi non ha ancora iniziato."
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="scopeConfigured" value="1" />
        <div className="rounded-2xl border bg-background/70 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Domande da mostrare</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Qui sono disponibili solo le aree della survey organizzazione.
                Puoi partire da tutte e alleggerire il questionario.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setLocalError(null);
                setSelectedSectionIds(
                  allSelected ? [] : sections.map((section) => section.id)
                );
              }}
            >
              {allSelected ? "Deseleziona tutto" : "Seleziona tutto"}
            </Button>
          </div>
          <div className="mt-3 grid gap-2">
            {sections.map((section) => {
              const checked = selectedSectionIds.includes(section.id);
              return (
                <label
                  key={section.id}
                  className="flex cursor-pointer gap-3 rounded-2xl border p-3 text-sm has-checked:border-emerald-500 has-checked:bg-emerald-500/5"
                >
                  <input
                    type="checkbox"
                    name="sectionIds"
                    value={section.id}
                    checked={checked}
                    onChange={(event) => {
                      setLocalError(null);
                      setSelectedSectionIds((current) =>
                        event.target.checked
                          ? [...new Set([...current, section.id])]
                          : current.filter((id) => id !== section.id)
                      );
                    }}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">{section.title}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {section.pillarTitle}
                    </span>
                    {section.description && (
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {section.description}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          {(localError || state.fieldErrors?.sectionIds) && (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {localError ?? state.fieldErrors?.sectionIds}
            </p>
          )}
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          <Link2 className="size-4" />
          {pending
            ? "Genero..."
            : hasExisting || url
              ? "Rigenera link organizzazione"
              : "Genera link organizzazione"}
        </Button>
      </form>
      {url && (
        <div className="mt-4 rounded-2xl border bg-background/80 p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Link survey organizzazione
          </div>
          <div className="flex gap-2">
            <Input readOnly value={url} className="text-xs" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              }}
            >
              <Copy className="mr-1 size-3.5" /> {copied ? "Copiato" : "Copia"}
            </Button>
          </div>
        </div>
      )}
      {state.message && (
        <p className={`mt-2 text-xs ${state.ok ? "text-emerald-600" : "text-destructive"}`} role="status">
          {state.message}
        </p>
      )}
      {hasExisting && !url && (
        <p className="mt-2 text-xs text-muted-foreground">
          Un link è già attivo: per motivi di sicurezza è visibile solo appena generato.
        </p>
      )}
    </div>
  );
}
