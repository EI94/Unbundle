"use client";

import { useId, useState } from "react";
import { Copy, Link2 } from "lucide-react";
import { READINESS_TEXT } from "@/lib/ai-readiness/dashboard-text";
import { READINESS_ANCHORS } from "@/lib/ai-readiness/dashboard-view";
import { CONFIRM_TEXT } from "@/lib/confirm-text";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Fold } from "@/components/ui-10/fold";
import { useOpenLink } from "./open-link";

const ASK = CONFIRM_TEXT.aiReadiness;
const C = READINESS_TEXT.collection;

type SectionOption = { id: string; title: string; area: string };

/**
 * «Link per tutti» nella scheda Raccolta (rilascio 10, ondata 7b, §3.9; audit «Fuori» AD-10): lo stato in una parola,
 * le domande che il link mostra, «Copia il link» (bordato: quando è il prossimo passo il pieno sta nella testata).
 * «Domande da mostrare» è una piega chiusa con le aree del questionario per tutti e «Crea un link nuovo» (che chiede
 * prima: il link di prima e le sue copie smettono di funzionare) o, senza link, «Crea il link per tutti».
 */
export function OpenLinkForm({
  workspaceId,
  assessmentId,
  active,
  status,
  sections,
  scopeIds,
}: {
  workspaceId: string;
  assessmentId: string;
  /** C'è un link per tutti (`openLinkTokenHash`). */
  active: boolean;
  status: string;
  sections: readonly SectionOption[];
  /** Le aree del link di adesso; null: tutte. */
  scopeIds: readonly string[] | null;
}) {
  const link = useOpenLink({ workspaceId, assessmentId });
  const [selected, setSelected] = useState<string[]>(() => (scopeIds?.length ? sections.filter((s) => scopeIds.includes(s.id)).map((s) => s.id) : sections.map((s) => s.id)));
  const [asking, setAsking] = useState<FormData | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const titleId = useId();
  const shown = scopeIds?.length ? sections.filter((s) => scopeIds.includes(s.id)).length : sections.length;
  const note = status === "draft" ? C.linkDraftNote : status === "open" ? null : C.linkClosedNote;

  return (
    <section id={READINESS_ANCHORS.link} aria-labelledby={titleId} className="scroll-mt-20 space-y-3" data-testid="open-link-form" data-survey-track="everyone">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="flex items-center gap-3 text-base font-semibold">
          {C.linkTitle}
          <StatusDot tone={active ? "verde" : "grigio"} label={active ? C.linkActive : C.linkNone} />
        </h2>
        {active ? (
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={link.pending} onClick={() => link.copy()}>
            <Copy aria-hidden data-icon="inline-start" />
            {C.copy}
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {[shown < sections.length ? C.linkScopeSome(shown, sections.length) : C.linkScopeAll, note].filter(Boolean).join(" · ")}
      </p>
      {link.error ? (
        <p role="alert" className="text-sm text-destructive">
          {link.error}
        </p>
      ) : null}
      <div>
        <Fold id="domande-del-link" title={C.areasFold} summary={C.linkScopeSome(selected.length, sections.length)}>
          <form
            className="space-y-3 pb-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (selected.length === 0) {
                setLocalError(C.areasNone);
                return;
              }
              const data = new FormData(event.currentTarget);
              if (active) setAsking(data);
              else link.create(data);
            }}
          >
            <input type="hidden" name="scopeConfigured" value="1" />
            <fieldset className="space-y-2">
              <legend className="sr-only">{C.areasFold}</legend>
              <p className="text-sm text-muted-foreground">{C.areasHint}</p>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => {
                    setLocalError(null);
                    setSelected(sections.map((s) => s.id));
                  }}>
                  {C.selectAll}
                </Button>
                <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => setSelected([])}>
                  {C.selectNone}
                </Button>
              </div>
              {sections.map((section) => (
                <label key={section.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-checked:border-foreground/60 has-checked:bg-muted/60">
                  <input
                    type="checkbox"
                    name="sectionIds"
                    value={section.id}
                    checked={selected.includes(section.id)}
                    onChange={(event) => {
                      setLocalError(null);
                      setSelected((list) => (event.target.checked ? [...new Set([...list, section.id])] : list.filter((id) => id !== section.id)));
                    }}
                    className="mt-0.5 size-4"
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{section.title}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{section.area}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {localError ? (
              <p role="alert" className="text-xs text-destructive">
                {localError}
              </p>
            ) : null}
            <Button type="submit" variant="outline" className="min-h-11 sm:min-h-9" disabled={link.pending}>
              <Link2 aria-hidden data-icon="inline-start" />
              {active ? C.regenerate : C.create}
            </Button>
          </form>
        </Fold>
      </div>
      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) setAsking(null);
        }}
        title={ASK.newLinkTitle}
        description={ASK.newLinkBody}
        confirmLabel={ASK.newLink}
        pending={link.pending}
        onConfirm={() => {
          const data = asking;
          setAsking(null);
          if (data) link.create(data);
        }}
      />
      {link.dialog}
    </section>
  );
}
