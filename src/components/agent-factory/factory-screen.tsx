"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  Eye,
  FlaskConical,
  Gauge,
  KeyRound,
  ListChecks,
  MessageCircle,
  MessageCircleQuestion,
  Play,
  Terminal,
  X,
  type LucideIcon,
} from "lucide-react";
import { PAGE_TITLE_CLASS, PageContainer } from "@/components/dashboard/page-container";
import { AgentTag } from "@/components/use-cases/agent-tag";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { ActionMenu, type ActionMenuItem } from "@/components/uc/ui/action-menu";
import { EmptyState } from "@/components/ui-10/empty-state";
import { NextStep } from "@/components/ui-10/next-step";
import { Row, RowList, TextAction } from "@/components/ui-10/row";
import { SideSheet, useSheetParam } from "@/components/ui-10/side-sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BuildersPanelBody, type FactoryBuildersData } from "./builders-panel";
import { CiRow } from "./ci-row";
import type { CiFamilyRow } from "./ci-view";
import { FACTORY_TEXT } from "./factory-text";
import { FACTORY_OLD_ANCHORS, FACTORY_PANELS, FACTORY_TODO_ROWS, factoryPanelKeys, factoryPanelOf, type FactoryCaseView, type FactoryFamilyView, type FactoryScreenModel, type FactoryTodoView } from "./factory-view";

const T = FACTORY_TEXT;

/** L'icona del pulsante pieno, per tipo di voce: decorativa, il verbo dice tutto. */
const TODO_ICON: Readonly<Record<string, LucideIcon>> = {
  collega: Terminal,
  chiesto: MessageCircle,
  fermo: Play,
  approva: Check,
  domande: MessageCircleQuestion,
  proposte: ListChecks,
  rivedi: Eye,
  banco: FlaskConical,
  evals: Gauge,
};

/** Una modifica su GitHub: si apre in una nuova scheda, e lo dice ai lettori di schermo. */
function External({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <span className="sr-only"> ({T.todo.external})</span>
    </>
  );
}

const ROW_CLASS =
  "group flex min-h-11 w-full min-w-0 items-center gap-3 px-4 py-3 text-left text-sm outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 sm:min-h-12";

/**
 * Una riga di «Da fare per te»: il verbo, il codice (e il compito) in grigio, la freccia; una modifica si apre su GitHub.
 * (Revisione 6b) `onSamePage`: dentro un pannello, una voce che porta a un punto di questa pagina (la famiglia di una
 * voce della CI) chiude prima il pannello, sostituendo il suo passo della cronologia; poi il link va all'ancora.
 */
function TodoRow({ todo, onSamePage }: { todo: FactoryTodoView; onSamePage?: () => void }) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
        <span className="min-w-0 font-medium break-words">{todo.external ? <External>{todo.row}</External> : todo.row}</span>
        {todo.code ? <span className="text-muted-foreground tabular-nums sm:text-right">{todo.code}</span> : null}
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
    </>
  );
  return (
    <li data-todo={todo.kind}>
      {todo.external ? (
        <a href={todo.href} target="_blank" rel="noreferrer" className={ROW_CLASS}>
          {body}
        </a>
      ) : (
        <Link href={todo.href} className={ROW_CLASS} onClick={todo.samePage && onSamePage ? onSamePage : undefined} data-same-page={todo.samePage ? "" : undefined}>
          {body}
        </Link>
      )}
    </li>
  );
}

/** «Dettagli» di una famiglia: il repository (su GitHub), la versione del modello e del comune. Chiusi. */
function FamilyDetails({ family }: { family: FactoryFamilyView }) {
  const [open, setOpen] = useState(false);
  const id = `${family.anchor}-dettagli`;
  if (!family.details.length) return null;
  return (
    <div className="min-w-0">
      <Button
        type="button"
        variant="ghost"
        className="-mr-2 min-h-11 text-muted-foreground sm:min-h-8"
        aria-expanded={open}
        aria-controls={id}
        aria-label={T.family.detailsOf(family.name)}
        onClick={() => setOpen(!open)}
      >
        {T.family.details}
        <ChevronRight aria-hidden className={cn("transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")} />
      </Button>
      <dl id={id} hidden={!open} className="mt-1 space-y-1 text-sm">
        {family.details.map((d) => (
          <div key={d.label} className="flex min-w-0 flex-wrap gap-x-2">
            <dt className="text-muted-foreground">{d.label}</dt>
            <dd className="min-w-0 break-words">
              {d.label === T.family.repo && family.repoUrl ? (
                <a href={family.repoUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  <External>{d.value}</External>
                </a>
              ) : (
                d.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Una riga per caso: il tag dell'agente, il codice e il titolo, la stazione e il passo in grigio, la qualità. */
function CaseRow({ c, onOpen }: { c: FactoryCaseView; onOpen: (key: string) => void }) {
  return (
    <li data-case={c.key}>
      <Row
        data-row="caso"
        onClick={() => onOpen(c.key)}
        opensPanel
        leading={c.tag ? <AgentTag label={c.tag.label} tone={c.tag.tone} decorative /> : undefined}
        title={
          <>
            {c.code ? <span className="mr-1.5 text-muted-foreground tabular-nums">{c.code}</span> : null}
            <span className="sr-only">{c.fullTitle !== c.title ? c.fullTitle : null}</span>
            <span aria-hidden={c.fullTitle !== c.title || undefined}>{c.title}</span>
          </>
        }
        fact={`${c.stationLabel} · ${c.next}`}
        trailing={c.health ? <StatusDot tone={c.health.tone} label={c.health.label} /> : undefined}
      />
    </li>
  );
}

/** Il corpo del pannello di un caso: i fatti, e dove serve il comando da usare. */
function CasePanelBody({ c }: { c: FactoryCaseView }) {
  return (
    <div className="space-y-4" data-slot="factory-case">
      <dl className="divide-y rounded-lg border text-sm">
        {c.facts.map((f, i) => (
          <div key={`${f.label}-${i}`} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <dt className="shrink-0 text-muted-foreground">{f.label}</dt>
            <dd className="min-w-0 break-words sm:text-right">{f.value}</dd>
          </div>
        ))}
      </dl>
      {c.how.map((line) => (
        <p key={line} className="text-sm break-words text-muted-foreground">
          {line}
        </p>
      ))}
    </div>
  );
}

export interface FactoryScreenProps {
  model: FactoryScreenModel;
  /** `?apri=` letto sul server: un link condiviso apre il pannello. */
  initialPanel: string | null;
  /** «Chi costruisce», solo per il manager di Lateral Space. */
  builders: FactoryBuildersData | null;
  /** (8.2b) La riga della CI di ogni famiglia, per repository in minuscolo. */
  ciRows: Readonly<Record<string, CiFamilyRow>>;
}

/**
 * La pagina «Agent Factory» (rilascio 10, ondata 6b, PROPOSTA-10 §3.6, prototipo S5): H1 e «⋯» (Chi costruisce ·
 * Repository da aggiornare, solo per il manager); il prossimo passo, la prima voce di «Da fare per te», il solo pulsante
 * pieno; sotto, al massimo tre voci e «Altre N»; «La linea» come filtro; le famiglie con una riga per caso e, sotto, la
 * riga della CI (8.2b). Ogni dettaglio sta in un pannello con il suo indirizzo (`?apri=`): il caso, «Chi costruisce»,
 * «Repository da aggiornare» e tutte le voci di «Da fare per te».
 */
export function FactoryScreen({ model, initialPanel, builders, ciRows }: FactoryScreenProps) {
  const keys = useMemo(() => factoryPanelKeys(model), [model]);
  const accept = useCallback((raw: string | null) => factoryPanelOf(keys, raw), [keys]);
  const [panel, setPanel] = useSheetParam<string>({ initial: initialPanel, accept });
  const open = useCallback((key: string) => setPanel(key), [setPanel]);

  // (Prima della 6b) `#team` e `#coda` aprono il pannello che ha preso il posto della sezione.
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const target = Object.hasOwn(FACTORY_OLD_ANCHORS, hash) ? FACTORY_OLD_ANCHORS[hash] : null;
    if (target && keys.includes(target)) setPanel(target);
    // Solo all'arrivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [first, ...rest] = model.todos;
  const shown = rest.slice(0, FACTORY_TODO_ROWS);
  const more = rest.length - shown.length;
  const menu: ActionMenuItem[] = [
    ...(model.manager && builders ? [{ label: T.menu.builders, onSelect: () => open(FACTORY_PANELS.builders) }] : []),
    ...(model.manager && model.queue.length ? [{ label: T.menu.queue, onSelect: () => open(FACTORY_PANELS.queue) }] : []),
  ];
  const openCase = panel ? model.cases.find((c) => c.key === panel) ?? null : null;
  const title = openCase ? openCase.fullTitle : panel === FACTORY_PANELS.builders ? T.builders.title : panel === FACTORY_PANELS.queue ? T.queue.title : panel === FACTORY_PANELS.todos ? T.todo.allTitle : "";

  return (
    <PageContainer>
      <div data-slot="agent-factory" className="space-y-8">
        <header className="space-y-1">
          <div className="flex items-start justify-between gap-4">
            <h1 className={PAGE_TITLE_CLASS}>{T.title}</h1>
            <ActionMenu items={menu} label={T.menu.label} />
          </div>
          {model.manager ? null : <p className="text-sm text-muted-foreground">{T.mine}</p>}
        </header>

        <div className="space-y-1">
          <NextStep
            id="agent-factory-passo"
            step={
              first
                ? {
                    label: first.button,
                    icon: first.kind.startsWith("ci-") ? KeyRound : TODO_ICON[first.kind],
                    why: first.why,
                    mine: true,
                    ...(first.external ? { link: <a href={first.href} target="_blank" rel="noreferrer" aria-label={T.todo.newTab(first.button)} /> } : { href: first.href }),
                  }
                : null
            }
          />
          {/* (Revisione 6b) Il codice del caso (e il compito) in grigio, accanto al verbo del pulsante (prototipo S5). */}
          {first?.code ? (
            <p data-slot="next-step-code" className="text-xs text-muted-foreground tabular-nums">
              {first.code}
            </p>
          ) : null}
        </div>

        {shown.length ? (
          <section aria-labelledby="per-te" className="space-y-2">
            <h2 id="per-te" className="text-base font-semibold">
              {T.todo.title}
            </h2>
            <RowList>
              {shown.map((t) => (
                <TodoRow key={t.key} todo={t} />
              ))}
            </RowList>
            {more > 0 ? (
              <TextAction onClick={() => open(FACTORY_PANELS.todos)} opensPanel>
                {T.todo.more(more)}
              </TextAction>
            ) : null}
          </section>
        ) : null}

        {model.totalCases === 0 ? (
          <EmptyState text={T.empty.text} action={{ label: T.empty.action, href: `/dashboard/${model.workspaceId}/use-cases` }} />
        ) : (
          <>
            {model.chips.length > 1 || model.filter ? (
              <nav aria-labelledby="la-linea" className="space-y-2">
                <h2 id="la-linea" className="text-base font-semibold">
                  {T.line.title}
                </h2>
                <ul className="flex flex-wrap gap-2">
                  {model.chips.map((chip) => (
                    <li key={chip.station}>
                      <Link
                        href={chip.href}
                        scroll={false}
                        aria-current={chip.active ? "true" : undefined}
                        aria-label={chip.active ? T.line.remove(chip.label) : undefined}
                        className={cn(
                          "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8",
                          chip.active ? "border-foreground bg-foreground text-background" : "hover:bg-muted/60",
                        )}
                      >
                        {chip.label}
                        <span className={cn("tabular-nums", chip.active ? "" : "text-muted-foreground")}>{chip.count}</span>
                        {chip.active ? <X aria-hidden className="size-3.5" /> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
                {model.filter ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    {model.filter.label}
                  </p>
                ) : null}
              </nav>
            ) : null}

            {model.families.map((f) => (
              <section key={f.key} id={f.anchor} aria-labelledby={`${f.anchor}-titolo`} className="scroll-mt-20 space-y-2" data-family={f.key}>
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3">
                  <h2 id={`${f.anchor}-titolo`} className="min-w-0 py-2 text-base font-semibold break-words">
                    {f.name}
                  </h2>
                  <FamilyDetails family={f} />
                </div>
                <RowList>
                  {f.cases.map((c) => (
                    <CaseRow key={c.caseId} c={c} onOpen={open} />
                  ))}
                </RowList>
                <CiRow workspaceId={model.workspaceId} row={ciRows[f.key]} />
              </section>
            ))}
          </>
        )}
      </div>

      <SideSheet
        open={panel !== null && title !== ""}
        onClose={() => setPanel(null)}
        title={title}
        footer={
          openCase ? (
            <Button render={<Link href={openCase.href} />} nativeButton={false} variant="outline" className="min-h-11 sm:min-h-9">
              {T.panel.open}
            </Button>
          ) : null
        }
      >
        {openCase ? <CasePanelBody c={openCase} /> : null}
        {panel === FACTORY_PANELS.todos ? (
          <RowList>
            {model.todos.map((t) => (
              <TodoRow key={t.key} todo={t} onSamePage={() => setPanel(null, { replace: true })} />
            ))}
          </RowList>
        ) : null}
        {panel === FACTORY_PANELS.builders && builders ? <BuildersPanelBody workspaceId={model.workspaceId} data={builders} /> : null}
        {panel === FACTORY_PANELS.queue ? (
          <div className="space-y-3" data-slot="factory-queue">
            <p className="text-sm text-muted-foreground">{T.queue.lead}</p>
            <ul className="divide-y rounded-lg border">
              {model.queue.map((q) => (
                <li key={q.repo} className="space-y-0.5 px-3 py-2.5 text-sm">
                  <p className="font-medium break-words">{q.repo}</p>
                  <p className="text-muted-foreground">{q.text}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </SideSheet>
    </PageContainer>
  );
}
