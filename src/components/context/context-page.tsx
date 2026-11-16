"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { PenLine } from "lucide-react";
import { SegmentedNav } from "@/components/dashboard/segmented-nav";
import { Button } from "@/components/ui/button";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { AiConsentNoticeData } from "@/lib/db/queries/context-consent";
import { cn } from "@/lib/utils";
import { AskBox } from "./ask-box";
import { ContextSheet } from "./context-sheet";
import type { UseCaseOption } from "./fields";
import { WriteFactForm } from "./write-fact-form";

const T = CONTEXT_TEXT;

export type ContextTab = "memoria" | "appunti";

/** Apre «Aggiungi appunti» da qualunque punto della pagina (la testata, la Memoria vuota). */
const AddNotesContext = createContext<(() => void) | null>(null);

/** Il pulsante pieno «Aggiungi appunti»: c'è solo dove la pagina lo offre (Lateral Space). */
export function AddNotesButton({ className }: { className?: string }) {
  const open = useContext(AddNotesContext);
  if (!open) return null;
  return (
    <Button type="button" size="lg" className={cn("min-h-11 px-4", className)} onClick={open}>
      {T.page.addNotes}
    </Button>
  );
}

export interface ContextPageProps {
  workspaceId: string;
  workspaceName: string;
  today: string;
  tab: ContextTab;
  /** Lateral Space: «Aggiungi appunti», «Scrivi un fatto», la vista «Appunti» (per il cliente «Documenti»). */
  lateralSpace: boolean;
  canEditMemory: boolean;
  /** «Aggiungi appunti» nella testata: no quando la Memoria è vuota (il pulsante sta lì, uno solo per schermata). */
  addNotesInHeader: boolean;
  /** Gli use case del workspace, per collegarli a un fatto (solo Lateral Space). */
  useCaseOptions: readonly UseCaseOption[];
  /** L'avviso dell'ok ai fornitori, se manca l'ok: «Aggiungi appunti» lo mostra dopo il salvataggio. */
  consentNotice: AiConsentNoticeData | null;
  children: ReactNode;
}

/**
 * La pagina «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.1-§7.6): la testata (il nome del
 * workspace, il titolo, «Aggiungi appunti»), «Chiedi al contesto», le due schede («Memoria» e «Appunti», per il
 * cliente «Documenti») con «Scrivi un fatto», poi la vista. Sul telefono la testata si impila: titolo, domanda,
 * «Aggiungi appunti» su tutta la larghezza.
 */
export function ContextPage({ workspaceId, workspaceName, today, tab, lateralSpace, canEditMemory, useCaseOptions, children }: ContextPageProps) {
  const [writing, setWriting] = useState(false);
  const base = `/dashboard/${workspaceId}/contesto`;
  const tabs = useMemo(
    () => [
      { key: "memoria", label: T.page.tabMemory, href: base },
      { key: "appunti", label: lateralSpace ? T.page.tabNotes : T.page.tabDocuments, href: `${base}?vista=appunti` },
    ],
    [base, lateralSpace],
  );

  return (
    <AddNotesContext.Provider value={null}>
      <div className="space-y-6">
        <header className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground">{workspaceName}</p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">{T.page.title}</h1>
          </div>
          <div className="order-2 sm:order-3 sm:col-span-2">
            <AskBox workspaceId={workspaceId} today={today} lateralSpace={lateralSpace} />
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedNav items={tabs} active={tab} ariaLabel={T.page.title} />
          {lateralSpace && canEditMemory ? (
            <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => setWriting(true)}>
              <PenLine aria-hidden />
              {T.page.writeFact}
            </Button>
          ) : null}
        </div>

        {children}
      </div>

      {lateralSpace && canEditMemory ? (
        <ContextSheet open={writing} onOpenChange={setWriting} title={T.writeFact.title}>
          {writing ? <WriteFactForm workspaceId={workspaceId} useCaseOptions={useCaseOptions} onCancel={() => setWriting(false)} onDone={() => setWriting(false)} /> : null}
        </ContextSheet>
      ) : null}
    </AddNotesContext.Provider>
  );
}
