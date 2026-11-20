"use client";

import type { JSX } from "react";
import { useContextActions } from "@/components/context/context-page";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { BigNumber } from "@/components/ui-10/big-number";
import { EmptyState } from "@/components/ui-10/empty-state";
import { Row, RowList, TextAction } from "@/components/ui-10/row";
import type { UnitBoardSummary } from "@/lib/mappatura/board-model";
import { UNIT_TEXT, unitStatusLabel } from "@/lib/mappatura/text";
import { shownUnitStatus } from "@/lib/mappatura/board-model";
import { VIEW_TEXT } from "./text";
import { processesNumber, processesStep, unitDotTone, unitFactLine } from "./view-model";

const P = VIEW_TEXT.processes;

/**
 * La vista «Processi» di «Contesto» (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7; prima `/mapping`, che porta qui): un
 * numero solo, «2 di 6 unità mappate»; una riga per unità con il nome, lo stato (puntino e parola) e «25 passi · 40 h a
 * settimana», con «5 da validare» e «3 da classificare» solo se ci sono. Tutta la riga porta alla board dell'unità.
 * Il prossimo passo («Continua: {unità}», «Inizia: {unità}» o «Aggiungi un'unità») sta nella testata comune; quando il
 * passo è un altro, «Aggiungi un'unità» resta qui sotto, tranquillo. Senza unità, una frase e «Racconta l'azienda»
 * (l'Intervista iniziale, per chi la vede).
 */
export function ProcessesView(p: { workspaceId: string; units: readonly UnitBoardSummary[]; interviewHref: string | null }): JSX.Element {
  const actions = useContextActions();
  const addUnit = actions?.addUnit ?? null;
  const number = processesNumber(p.units);
  const step = processesStep(p.units);

  if (p.units.length === 0) {
    return <EmptyState text={P.empty} action={p.interviewHref ? { label: P.interview, href: p.interviewHref } : null} />;
  }
  return (
    <div className="space-y-6" data-slot="processes">
      {number ? <BigNumber value={number} label={P.mapped} /> : null}
      <RowList label={P.label}>
        {p.units.map((unit) => {
          const status = shownUnitStatus(unit.status, unit.steps);
          return (
            <li key={unit.id}>
              <Row
                href={`/dashboard/${p.workspaceId}/mapping/${unit.id}`}
                title={unit.name}
                fact={unitFactLine(unit)}
                trailing={<StatusDot tone={unitDotTone(status)} label={unitStatusLabel(status)} />}
                data-row="unit"
              />
            </li>
          );
        })}
      </RowList>
      {addUnit && step.kind !== "add" ? (
        <TextAction onClick={addUnit} opensPanel>
          {UNIT_TEXT.add}
        </TextAction>
      ) : null}
    </div>
  );
}
