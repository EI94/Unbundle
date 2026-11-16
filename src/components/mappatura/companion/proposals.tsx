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
 *
 * (Rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §6.2) Senza l'ok ai sub-responsabili la lettura non parte
 * (`consentMissing`): il toast lo dice, non «Dai documenti non emergono passi chiari», che direbbe una cosa falsa.
 */
import { useState, type JSX } from "react";
import type { PreGeneratedActivity } from "@/lib/actions/pre-generate-activities";
import { CONTEXT_TEXT } from "../../../lib/context/text.ts";
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

/**
 * Una riga per proposta, da scegliere o togliere (`aria-pressed`): titolo, descrizione, tipo di lavoro, ore, strumenti.
 * `busy`: i passi si stanno aggiungendo, e le righe non si cambiano (restano raggiungibili).
 */
export function ProposalList(p: { items: readonly PreGeneratedActivity[]; chosen: ReadonlySet<number>; busy?: boolean; onToggle(index: number): void }): JSX.Element {
  return (
    <div className="b-comp-props" data-b="proposals">
      {p.items.map((item, index) => {
        const meta = [item.workType ? workTypeLabel(item.workType) : null, typeof item.estimatedHoursWeek === "number" ? `${formatHours(item.estimatedHoursWeek)} h a settimana` : null].filter(Boolean);
        const tools = (item.toolsUsed ?? []).filter((tool) => tool.trim() !== "");
        return (
          <button
            key={index}
            type="button"
            className="b-comp-prop"
            aria-pressed={p.chosen.has(index)}
            // Mentre i passi si aggiungono restano raggiungibili (aria-disabled): il fuoco resta nel drawer (F1).
            aria-disabled={p.busy || undefined}
            onClick={() => {
              if (!p.busy) p.onToggle(index);
            }}
          >
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

/**
 * Che cosa fare con la risposta della lettura dei documenti: senza l'ok ai sub-responsabili la riga dell'ok (rilascio
 * 9a), senza passi «Dai documenti non emergono passi chiari», altrimenti il drawer con le proposte.
 */
export function proposalsNext(result: { activities: readonly PreGeneratedActivity[]; consentMissing?: true }): { toast: string } | { open: readonly PreGeneratedActivity[] } {
  if (result.consentMissing) return { toast: CONTEXT_TEXT.consent.title };
  if (result.activities.length === 0) return { toast: COMPANION_TEXT.proposals.none };
  return { open: result.activities };
}

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
      const next = proposalsNext(await preGenerateActivitiesFromDocuments(p.workspaceId, p.departmentId));
      if ("toast" in next) {
        setPhase("idle");
        client.notify(next.toast);
        return;
      }
      const activities = [...next.open];
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
      {/* Mentre legge resta raggiungibile (aria-disabled): spento, il fuoco cadrebbe sulla pagina (F1). */}
      <BoardButton
        small
        disabled={p.disabled}
        aria-disabled={phase !== "idle" || undefined}
        aria-busy={phase === "reading" || undefined}
        onClick={() => {
          if (phase === "idle") void propose();
        }}
        data-action="propose"
      >
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
        <ProposalList items={items} chosen={chosen} busy={adding} onToggle={toggle} />
        <div className="b-comp-foot">
          <BoardButton
            aria-disabled={adding || undefined}
            onClick={() => {
              if (!adding) setPhase("idle");
            }}
          >
            {T.cancel}
          </BoardButton>
          {/* Mentre aggiunge resta raggiungibile (aria-disabled): il fuoco resta nel drawer finché si chiude (F1). */}
          <BoardButton
            variant="primary"
            disabled={chosen.size === 0}
            aria-disabled={adding || undefined}
            aria-busy={adding || undefined}
            onClick={() => {
              if (!adding) void add();
            }}
          >
            {addStepsLabel(chosen.size)}
          </BoardButton>
        </div>
      </Drawer>
    </>
  );
}
