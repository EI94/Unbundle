"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PageContainer } from "@/components/dashboard/page-container";
import { StartList } from "@/components/home/start-list";
import { stepItem } from "@/components/home/step-icons";
import { ActionMenu, type ActionMenuItem } from "@/components/uc/ui/action-menu";
import { BigNumber } from "@/components/ui-10/big-number";
import { NextStep } from "@/components/ui-10/next-step";
import { Row, RowList, TextAction } from "@/components/ui-10/row";
import { useSheetParam } from "@/components/ui-10/side-sheet";
import type { ReviewerHomeData } from "@/lib/db/queries/use-case-home";
import { HOME_TEXT } from "@/lib/home/text";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { ProgramPanelSheet, programPanelOf, type ProgramPanel } from "./program-panels";

/** Scarica il PDF del SAL (POST: un'esportazione lascia una traccia e non parte mai da un prefetch). Falso se non riesce. */
async function downloadSal(workspaceId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/workspaces/${workspaceId}/programma/sal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!response.ok) return false;
    const blob = await response.blob();
    const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "sal.pdf";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = decodeURIComponent(name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * La Home dei revisori (rilascio 10, prototipo S1 e S1b): il Programma con il prossimo passo in cima.
 *
 * - Testata: H1 «Home» e «⋯» con «Esporta il SAL (PDF)», «Chiudi il SAL» e «Impostazioni del programma» (le ultime
 *   due a chi può cambiarli).
 * - Il prossimo passo (`NextStep`, il solo pulsante pieno): il passo del workspace (D3) o, in un workspace nuovo, la
 *   prima riga aperta di «Per partire». «Chiudi il SAL» apre il pannello del SAL, con quello che è cambiato.
 * - Il numero grande «Valore all'anno» con «Tutti i numeri ›»; in un workspace nuovo «Per partire» al suo posto.
 * - Quattro righe che aprono un pannello: Iniziative, Persone, Obiettivi, SAL. Le righe a zero non ci sono.
 * - I pannelli del Programma (`?apri=`), anche quelli dei link di prima (`/programma?apri=rivedere` della campanella).
 */
export function ProgramHome({ data, initialPanel }: { data: ReviewerHomeData; initialPanel: string | null }) {
  const view = data.program;
  const { home } = data;
  const [panel, setPanel] = useSheetParam<ProgramPanel>({ initial: view ? initialPanel : null, accept: programPanelOf });
  const [exporting, setExporting] = useState(false);
  const open = (next: ProgramPanel) => setPanel(next);
  const runExport = async () => {
    if (!view || exporting) return;
    setExporting(true);
    const ok = await downloadSal(view.workspaceId);
    setExporting(false);
    if (!ok) toast.error(HOME_TEXT.exportSalFailed);
  };
  const menu: ActionMenuItem[] = view
    ? [
        { label: HOME_TEXT.menu.exportSal, onSelect: () => void runExport(), disabled: exporting },
        ...(view.viewer.canEdit
          ? [
              { label: HOME_TEXT.menu.closeSal, onSelect: () => open("sal") },
              { label: HOME_TEXT.menu.settings, onSelect: () => open("impostazioni") },
            ]
          : []),
      ]
    : [];
  const allNumbers = (
    <TextAction onClick={() => open("numeri")} opensPanel>
      {HOME_TEXT.value.allNumbers}
    </TextAction>
  );
  return (
    <PageContainer size="narrow">
      <div data-slot="home" data-home="revisore" className="space-y-8">
        <header className="space-y-1">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">{HOME_TEXT.title}</h1>
            {menu.length ? <ActionMenu items={menu} label={HOME_TEXT.menu.label} /> : null}
          </div>
          {data.description ? <p className="line-clamp-2 text-sm text-muted-foreground">{data.description}</p> : null}
        </header>
        <NextStep step={stepItem(home.step, open)} />
        {home.start ? <StartList start={home.start} /> : null}
        {home.bigNumber ? (
          <BigNumber value={home.bigNumber.value} label={home.bigNumber.label} note={keepTogether(home.bigNumber.note)} action={allNumbers} />
        ) : view && !home.start ? (
          allNumbers
        ) : null}
        {home.rows.length ? (
          <RowList>
            {home.rows.map((row) => (
              <li key={row.key}>
                <Row data-row={row.key} title={row.title} fact={keepTogether(row.fact)} onClick={() => open(row.panel)} opensPanel />
              </li>
            ))}
          </RowList>
        ) : null}
        {data.programState === "non_pronto" ? <p className="text-sm text-muted-foreground">{HOME_TEXT.notReady}</p> : null}
      </div>
      {view ? (
        <ProgramPanelSheet panel={panel} view={view} onOpen={open} onClose={() => setPanel(null)} extras={{ pendingValue: data.pendingValue, participation: data.participation }} />
      ) : null}
    </PageContainer>
  );
}
