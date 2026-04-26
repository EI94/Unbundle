"use client";

import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import type { ScoringModelConfig } from "@/lib/db/queries/scoring-model";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  TeamNameForm,
  WhatsappWebhookForm,
} from "@/components/portfolio/team-settings-form";
import { ScoringModelForm } from "@/components/portfolio/scoring-model-form";

export function PortfolioSettingsSheet({
  workspaceId,
  teamName,
  initialTeamName,
  initialWhatsappUrl,
  initialConfig,
  esgEnabled,
}: {
  workspaceId: string;
  teamName: string;
  initialTeamName: string;
  initialWhatsappUrl: string;
  initialConfig: ScoringModelConfig;
  esgEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const storageKey = useMemo(
    () => `unbundle:portfolio-settings-seen:${workspaceId}`,
    [workspaceId]
  );

  useEffect(() => {
    let frame = 0;
    try {
      if (window.localStorage.getItem(storageKey) !== "1") {
        window.localStorage.setItem(storageKey, "1");
        frame = window.requestAnimationFrame(() => setOpen(true));
      }
    } catch {
      // If storage is blocked, keep the panel available through the button.
    }
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [storageKey]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="h-4 w-4" />
        Team e ranking
      </Button>

      <SheetContent
        side="right"
        className="!w-[min(100vw,44rem)] overflow-y-auto p-0 sm:!max-w-2xl"
      >
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>Team e modello di ranking</SheetTitle>
          <SheetDescription>
            Configura chi valuta i contributi e quali criteri guidano la
            matrice.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-5 py-5">
          <section className="space-y-4 rounded-2xl border p-4">
            <div>
              <h3 className="text-sm font-semibold">Team reviewer</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Oggi i contributi sono assegnati a <strong>{teamName}</strong>.
              </p>
            </div>
            <TeamNameForm
              workspaceId={workspaceId}
              initialName={initialTeamName}
            />
          </section>

          <details className="group rounded-2xl border p-4">
            <summary className="cursor-pointer list-none text-sm font-semibold outline-none marker:hidden">
              Notifiche esterne
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                opzionale
              </span>
            </summary>
            <div className="mt-4">
              <WhatsappWebhookForm
                workspaceId={workspaceId}
                initialUrl={initialWhatsappUrl}
              />
            </div>
          </details>

          <section className="rounded-2xl border p-4">
            <div className="mb-4">
              <h3 className="text-sm font-semibold">Scorecard</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Pochi criteri chiari, modificabili solo quando serve.
              </p>
            </div>
            <ScoringModelForm
              workspaceId={workspaceId}
              initialConfig={initialConfig}
              esgEnabled={esgEnabled}
            />
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
