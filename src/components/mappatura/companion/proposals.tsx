"use client";

/**
 * «Mappatura board»: «Proponi passi dai documenti» e il drawer «Passi dai documenti» (docs/mappatura/MAPPATURA-BOARD-PIANO.md
 * §1.5, §5.5, §7.4).
 *
 * Il bottone piccolo legge i documenti dell'unità (l'azione di sempre, `preGenerateActivitiesFromDocuments`); se ne
 * escono dei passi, il drawer stretto li mostra con una riga da scegliere per ciascuno (tutti scelti all'inizio), il
 * contesto «{k} di {n} scelti», «Annulla» e l'unico bottone pieno del drawer, «Aggiungi {k} passi». I passi scelti
 * entrano sulla board «da validare» (`confirmPreGeneratedActivities`, che scrive con la board), la board si rilegge e un
 * toast lo dice.
 *
 * Le due azioni si caricano quando servono: il modulo delle azioni vive sul server, e questo componente si carica anche
 * nei test con Node.
 */
import { useState, type JSX } from "react";
import type { PreGeneratedActivity } from "@/lib/actions/pre-generate-activities";
import { formatHours, workTypeLabel } from "../../../lib/mappatura/text.ts";
import { useBoardClient } from "../store/use-board.tsx";
import { BoardButton } from "../ui/atoms.tsx";
import { Drawer } from "../ui/drawer.tsx";
import { COMPANION_TEXT, addStepsLabel, chosenText, stepsAddedText } from "./text.ts";

const loadActions = () => import("@/lib/actions/pre-generate-activities");

const STEP_CHECK = (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
    <path d="M2 6.3l2.5 2.4L10 3.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Una riga per proposta, da scegliere o togliere (`aria-pressed`): titolo, descrizione, tipo di lavoro, ore, strumenti. */
export function ProposalList(p: { items: readonly PreGeneratedActivity[]; chosen: ReadonlySet<number>; disabled?: boolean; onToggle(index: number): void }): JSX.Element {
  return (
    <div className="b-comp-props" data-b="proposals">
      {p.items.map((item, index) => {
        const meta = [item.workType ? workTypeLabel(item.workType) : null, typeof item.estimatedHoursWeek === "number" ? `${formatHours(item.estimatedHoursWeek)} h a settimana` : null].filter(Boolean);
        const tools = (item.toolsUsed ?? []).filter((tool) => tool.trim() !== "");
        return (
          <button key={index} type="button" className="b-comp-prop" aria-pressed={p.chosen.has(index)} disabled={p.disabled} onClick={() => p.onToggle(index)}>
            <span className="b-comp-tick" aria-hidden="true">
              {p.chosen.has(index) ? STEP_CHECK : null}
            </span>
            <span className="b-comp-prop-body">
              <b>{item.title}</b>
              {item.description ? <span>{item.description}</span> : null}
              {meta.length > 0 ? <small>{meta.join(" · ")}</small> : null}
              {tools.length > 0 ? (
                <span className="b-chips">
                  {tools.map((tool, at) => (
                    <span className="b-chip b-tool" key={`${at}:${tool}`}>
                      {tool}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

type Phase = "idle" | "reading" | "open" | "adding";

export function Proposals(p: { workspaceId: string; departmentId: string; disabled?: boolean }): JSX.Element {
  const client = useBoardClient();
  const [phase, setPhase] = useState<Phase>("idle");
  const [items, setItems] = useState<PreGeneratedActivity[]>([]);
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set());
  const T = COMPANION_TEXT.proposals;

  const propose = async () => {
    setPhase("reading");
    try {
      const { preGenerateActivitiesFromDocuments } = await loadActions();
      const { activities } = await preGenerateActivitiesFromDocuments(p.workspaceId, p.departmentId);
      if (activities.length === 0) {
        setPhase("idle");
        client.notify(T.none);
        return;
      }
      setItems(activities);
      setChosen(new Set(activities.map((_, index) => index)));
      setPhase("open");
    } catch {
      setPhase("idle");
      client.notify(T.failed);
    }
  };

  const add = async () => {
    const picked = items.filter((_, index) => chosen.has(index));
    if (picked.length === 0) return;
    setPhase("adding");
    try {
      const { confirmPreGeneratedActivities } = await loadActions();
      const { saved } = await confirmPreGeneratedActivities(p.workspaceId, p.departmentId, picked);
      // Le proposte restano nel drawer mentre si chiude; la prossima lettura le sostituisce.
      setPhase("idle");
      await client.pull();
      client.notify(stepsAddedText(saved));
    } catch {
      setPhase("open");
      client.notify(T.failed);
    }
  };

  const toggle = (index: number) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const adding = phase === "adding";
  return (
    <>
      <BoardButton small disabled={p.disabled || phase !== "idle"} aria-busy={phase === "reading" || undefined} onClick={() => void propose()} data-action="propose">
        {phase === "reading" ? T.reading : T.propose}
      </BoardButton>
      <Drawer
        open={phase === "open" || adding}
        onClose={() => {
          if (!adding) setPhase("idle");
        }}
        context={chosenText(chosen.size, items.length)}
        title={T.drawerTitle}
      >
        <ProposalList items={items} chosen={chosen} disabled={adding} onToggle={toggle} />
        <div className="b-comp-foot">
          <BoardButton disabled={adding} onClick={() => setPhase("idle")}>
            {T.cancel}
          </BoardButton>
          <BoardButton variant="primary" disabled={adding || chosen.size === 0} aria-busy={adding || undefined} onClick={() => void add()}>
            {addStepsLabel(chosen.size)}
          </BoardButton>
        </div>
      </Drawer>
    </>
  );
}
