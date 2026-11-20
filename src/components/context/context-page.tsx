"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check, FileText, MoreHorizontal, NotebookPen, PenLine, Plus, type LucideIcon } from "lucide-react";
import { SegmentedNav } from "@/components/dashboard/segmented-nav";
import { NextStep } from "@/components/ui-10/next-step";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLinkItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { AiConsentNoticeData } from "@/lib/db/queries/context-consent";
import { cn } from "@/lib/utils";
import { AddNotesDialog } from "./add-notes-dialog";
import { ContextSheet } from "./context-sheet";
import type { UseCaseOption } from "./fields";
import { useDocumentUpload } from "./upload-document";
import { ACCEPTED_FILES, CONTEXT_VIEWS, contextViewHref, type ContextView } from "./view-model";
import { WriteFactForm } from "./write-fact-form";

const T = CONTEXT_TEXT;

export type ContextTab = ContextView;

/** Il prossimo passo della vista, sotto il titolo: un link («Conferma N proposte», «Continua: Acquisti») o un'azione della pagina. */
export type HeaderStep =
  | { kind: "link"; label: string; why: string; href: string; icon: "check" | "continue" }
  | { kind: "action"; action: "add-unit"; label: string; why: string };

/** Quello che le viste chiedono alla testata: aprire «Aggiungi» o un'azione che la testata tiene (un'unità nuova). */
export interface ContextActions {
  /** «Aggiungi»: le tre scelte per Lateral Space, la scelta del file per gli altri. */
  add(): void;
  /** «Aggiungi un'unità» (la vista Processi la mette nella testata): null dove non si può. */
  addUnit: (() => void) | null;
}
const ActionsContext = createContext<ContextActions | null>(null);

/** Le azioni della testata, dentro una vista di «Contesto». */
export function useContextActions(): ContextActions | null {
  return useContext(ActionsContext);
}

export interface ContextPageProps {
  workspaceId: string;
  today: string;
  tab: ContextTab;
  /** Lateral Space: «Aggiungi» con le tre scelte (Appunti · File · Un fatto). Il cliente aggiunge solo file. */
  lateralSpace: boolean;
  canEditMemory: boolean;
  /** Chi può caricare un documento: «Aggiungi un file». */
  canUpload: boolean;
  /** Il prossimo passo della vista: il pulsante pieno sotto il titolo. Senza, il pieno è «Aggiungi». */
  step?: HeaderStep | null;
  /** Il «⋯» della testata: l'Intervista iniziale (revisori), i fatti da verificare (Lateral Space). Vuoto: niente «⋯». */
  menu?: ReadonlyArray<{ key: string; label: string; href: string }>;
  /** Gli use case del workspace, per collegarli a un fatto (solo Lateral Space). */
  useCaseOptions: readonly UseCaseOption[];
  /** L'avviso dell'ok ai fornitori, se manca l'ok: «Aggiungi appunti» lo mostra dopo il salvataggio. */
  consentNotice: AiConsentNoticeData | null;
  children: ReactNode;
}

const STEP_ICON: Readonly<Record<"check" | "continue" | "add-unit", LucideIcon>> = { check: Check, continue: ArrowRight, "add-unit": Plus };

/**
 * La testata comune di «Contesto» (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7, prototipo S6), uguale nelle tre viste:
 * - H1 «Contesto»; a destra «Aggiungi» e il «⋯» («Intervista iniziale»). «Aggiungi» apre una finestra con tre scelte
 *   (Appunti · File · Un fatto) per Lateral Space; per il cliente, che aggiunge solo documenti, «Aggiungi un file» apre
 *   subito la scelta del file. È il pulsante pieno quando la vista non ha un passo suo.
 * - Il prossimo passo della vista, quando c'è («Conferma N proposte», «Continua: Acquisti»): allora «Aggiungi» è bordato.
 * - Le viste: Memoria · Processi · Fonti.
 * Al telefono il titolo e le due azioni stanno su una riga; il passo, a tutta larghezza, nella prima schermata.
 */
export function ContextPage({ workspaceId, today, tab, lateralSpace, canEditMemory, canUpload, step = null, menu = [], useCaseOptions, consentNotice, children }: ContextPageProps) {
  const [choosing, setChoosing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);
  const [writing, setWriting] = useState(false);
  const notesFile = useRef<HTMLInputElement | null>(null);
  const upload = useDocumentUpload(workspaceId);
  const canAdd = lateralSpace || canUpload;

  const add = useCallback(() => {
    if (lateralSpace) setChoosing(true);
    else upload.pick();
  }, [lateralSpace, upload]);
  const actions = useMemo<ContextActions>(() => ({ add, addUnit: null }), [add]);

  const tabs = useMemo(
    () =>
      CONTEXT_VIEWS.map((view) => ({
        key: view,
        label: view === "memoria" ? T.page.tabMemory : view === "processi" ? T.page.tabProcesses : T.page.tabNotes,
        href: contextViewHref(workspaceId, view),
      })),
    [workspaceId],
  );

  const choose = (choice: "appunti" | "file" | "fatto") => {
    if (choice === "file") {
      // La scelta del file si apre dentro il tocco: Safari la apre solo così.
      notesFile.current?.click();
      return;
    }
    setChoosing(false);
    if (choice === "appunti") setAddOpen(true);
    else setWriting(true);
  };

  const Icon = step ? STEP_ICON[step.kind === "link" ? step.icon : step.action] : null;
  const stepItem = step
    ? step.kind === "link"
      ? { label: step.label, why: step.why, mine: true, href: step.href, icon: Icon ?? undefined }
      : { label: step.label, why: step.why, mine: true, onClick: () => actions.addUnit?.(), icon: Icon ?? undefined }
    : null;

  return (
    <ActionsContext.Provider value={actions}>
      <div className="space-y-6">
        <header data-slot="context-header" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <h1 className="min-w-0 text-2xl font-semibold tracking-tight">{T.page.title}</h1>
            <div className="flex shrink-0 items-center gap-2">
              {canAdd ? (
                <Button type="button" variant={step ? "outline" : "default"} className="min-h-11 sm:min-h-8" disabled={upload.pending} onClick={add} data-action="context-add">
                  <Plus aria-hidden data-icon="inline-start" />
                  {lateralSpace ? T.page.add : T.page.addFile}
                </Button>
              ) : null}
              {menu.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label={T.page.more} className="size-11 sm:size-8" />} data-action="context-menu">
                    <MoreHorizontal aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-auto min-w-48 max-w-[min(20rem,calc(100vw-2rem))]">
                    {menu.map((item) => (
                      <DropdownMenuLinkItem key={item.key} render={<Link href={item.href} />} className="min-h-11 px-2 sm:min-h-8">
                        {item.label}
                      </DropdownMenuLinkItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </div>
          {stepItem ? <NextStep step={stepItem} id="contesto-passo" /> : null}
          <SegmentedNav items={tabs} active={tab} ariaLabel={T.page.title} />
        </header>

        {children}
      </div>

      {canUpload && !lateralSpace ? upload.input : null}

      {lateralSpace ? (
        <>
          <input
            ref={notesFile}
            type="file"
            accept={ACCEPTED_FILES}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            data-slot="add-file"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = "";
              if (!file) return;
              setChoosing(false);
              setPicked(file);
              setAddOpen(true);
            }}
          />
          <Dialog open={choosing} onOpenChange={setChoosing}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-base font-semibold">{T.page.addTitle}</DialogTitle>
                <DialogDescription className="sr-only">{T.page.addTitle}</DialogDescription>
              </DialogHeader>
              <ul className="divide-y overflow-hidden rounded-xl border" data-slot="add-choices">
                <AddChoice icon={NotebookPen} title={T.page.choiceNotes} hint={T.page.choiceNotesHint} onChoose={() => choose("appunti")} />
                <AddChoice icon={FileText} title={T.page.choiceFile} hint={T.page.choiceFileHint} onChoose={() => choose("file")} />
                {canEditMemory ? <AddChoice icon={PenLine} title={T.page.choiceFact} hint={T.page.choiceFactHint} onChoose={() => choose("fatto")} /> : null}
              </ul>
            </DialogContent>
          </Dialog>
          <AddNotesDialog
            open={addOpen}
            onOpenChange={(open) => {
              setAddOpen(open);
              if (!open) setPicked(null);
            }}
            workspaceId={workspaceId}
            today={today}
            consentNotice={consentNotice}
            pickedFile={picked}
          />
        </>
      ) : null}

      {lateralSpace && canEditMemory ? (
        <ContextSheet open={writing} onOpenChange={setWriting} title={T.writeFact.title}>
          {writing ? <WriteFactForm workspaceId={workspaceId} useCaseOptions={useCaseOptions} onCancel={() => setWriting(false)} onDone={() => setWriting(false)} /> : null}
        </ContextSheet>
      ) : null}

    </ActionsContext.Provider>
  );
}

/** Una scelta di «Aggiungi»: l'icona, il nome e una riga grigia; tutta la riga si tocca (almeno 44 px). */
function AddChoice({ icon: Icon, title, hint, onChoose }: { icon: LucideIcon; title: string; hint: string; onChoose: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onChoose}
        className={cn("flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left text-sm outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50")}
      >
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 space-y-0.5">
          <span className="block font-medium">{title}</span>
          <span className="block text-muted-foreground">{hint}</span>
        </span>
      </button>
    </li>
  );
}
