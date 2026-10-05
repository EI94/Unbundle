"use client";

import { useEffect, useRef, useState } from "react";
import { Presentation, ShieldCheck, Users } from "lucide-react";
import type { GroupActivity, GroupResults } from "@/lib/learning/results";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ImportantTag, ItemBars, ShareBar } from "./results-charts";
import { formatDecimal, percent } from "./results-format";
import { ResultsAutoRefresh } from "./results-auto-refresh";
import { ResultsPresent } from "./results-present";
import { ResultsToggle } from "./results-toggle";

/**
 * Risultati di gruppo: quanti hanno consegnato e come hanno risposto, senza
 * nomi. Si aggiorna da solo mentre l'aula lavora e si può proiettare.
 */
export function ResultsGroup({ group, refreshedAt, contextLabel }: { group: GroupResults; refreshedAt: number; contextLabel: string }) {
  // Le risposte giuste restano nascoste finché chi tiene il corso non le mostra:
  // se lo schermo è proiettato, chi sta ancora rispondendo non le vede.
  const [showAnswers, setShowAnswers] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const presentButton = useRef<HTMLButtonElement>(null);
  const wasPresenting = useRef(false);

  // Uscire dallo schermo intero (anche con Esc del browser) chiude la presentazione.
  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement) return;
      setPresenting(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Comunque si esca dalla presentazione, il fuoco torna su «Presenta in aula».
  useEffect(() => {
    if (wasPresenting.current && !presenting) presentButton.current?.focus();
    wasPresenting.current = presenting;
  }, [presenting]);

  function present() {
    try {
      const root = document.documentElement;
      if (!document.fullscreenElement && typeof root.requestFullscreen === "function") void root.requestFullscreen().catch(() => undefined);
    } catch { /* Lo schermo intero è un di più: la presentazione funziona anche senza. */ }
    setPresenting(true);
  }
  function close() {
    setPresenting(false);
    try { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); } catch { /* già uscito */ }
  }

  const visible = !group.suppressed;
  return <div className="space-y-6">
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <ResultsAutoRefresh refreshedAt={refreshedAt} />
      <div className="flex flex-wrap items-center gap-2">
        {visible && <ResultsToggle checked={showAnswers} onChange={setShowAnswers} label="Mostra le risposte giuste" testId="show-answers-toggle" />}
        <Button
          ref={presentButton}
          type="button"
          onClick={present}
          data-testid="present-button"
          className="min-h-10 gap-2 bg-emerald-600 px-4 text-white hover:bg-emerald-500"
        >
          <Presentation aria-hidden /> Presenta in aula
        </Button>
      </div>
    </div>
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <ShieldCheck aria-hidden className="size-4 shrink-0 text-emerald-400" />
      Qui non ci sono nomi: puoi mostrarla in aula. Le risposte giuste compaiono solo quando le mostri tu.
    </p>

    {group.suppressed ? <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-8 text-center">
      <Users aria-hidden className="size-8 text-muted-foreground" />
      <p className="max-w-md text-base font-medium">I risultati di gruppo compaiono quando nel turno ci sono almeno {group.minimum} iscritti.</p>
      <p className="text-sm text-muted-foreground">La pagina si aggiorna da sola.</p>
    </div> : <>
      <dl data-testid="group-kpis" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Iscritti" value={group.enrolled} />
        <Kpi label="Hanno iniziato" value={group.started} total={group.enrolled} />
        <Kpi label="Hanno finito gli esercizi" value={group.completed} total={group.enrolled}
          hint={group.required === 1 ? "l’esercizio da fare" : `tutti i ${group.required} esercizi da fare`} />
        <Kpi label="Obiettivo raggiunto" value={group.achieved} total={group.enrolled} good />
      </dl>
      {group.leftOutTurns > 0 && <p className="text-sm text-muted-foreground">
        {group.leftOutTurns === 1 ? "Un turno con" : `${group.leftOutTurns} turni con`} meno di {group.minimum} iscritti non {group.leftOutTurns === 1 ? "è contato" : "sono contati"} qui: i loro risultati restano privati.
      </p>}
      {group.activities.length === 0
        ? <p className="rounded-2xl border border-dashed p-6 text-center text-muted-foreground">Questo corso non ha ancora esercizi.</p>
        : <div className="space-y-6">{group.activities.map((activity) => <ActivityResults key={activity.id} activity={activity} enrolled={group.enrolled} minimum={group.minimum} showAnswers={showAnswers} />)}</div>}
    </>}

    {presenting && <ResultsPresent
      activities={group.suppressed ? [] : group.activities}
      enrolled={group.suppressed ? 0 : group.enrolled}
      minimum={group.minimum}
      suppressed={group.suppressed}
      contextLabel={contextLabel}
      refreshedAt={refreshedAt}
      onClose={close}
    />}
  </div>;
}

function Kpi({ label, value, total, hint, good = false }: { label: string; value: number; total?: number; hint?: string; good?: boolean }) {
  return <div className={cn("flex flex-col gap-2 rounded-2xl border p-4", good ? "border-emerald-500/30 bg-emerald-500/10" : "bg-card")}>
    <dt className="text-sm text-muted-foreground">{label}</dt>
    <dd className="space-y-2">
      <p className="flex items-baseline gap-1.5">
        <span className={cn("text-3xl font-semibold tabular-nums sm:text-4xl", good && "text-emerald-300")}>{value}</span>
        {total !== undefined && <span className="text-sm text-muted-foreground">su {total}</span>}
      </p>
      {total !== undefined && <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full transition-[width] duration-700", good ? "bg-emerald-500" : "bg-sky-400/80")} style={{ width: `${percent(value, total)}%` }} />
      </span>}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </dd>
  </div>;
}

function ActivityResults({ activity, enrolled, minimum, showAnswers }: { activity: GroupActivity; enrolled: number; minimum: number; showAnswers: boolean }) {
  const answering = Math.max(0, activity.started - activity.submitted);
  return <section data-testid="group-activity" className="space-y-5 rounded-2xl border bg-card p-4 sm:p-6">
    <header className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-lg font-semibold leading-snug sm:text-xl">{activity.title}</h3>
        {!activity.required && <span className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">facoltativo</span>}
      </div>
      <ShareBar label={`Hanno consegnato ${activity.submitted} su ${enrolled}`} value={activity.submitted} total={enrolled} />
      {answering > 0 && <p className="text-xs text-muted-foreground">{answering === 1 ? "1 persona sta" : `${answering} persone stanno`} ancora rispondendo.</p>}
    </header>
    {!activity.visible ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
      {activity.submitted >= minimum
        // Succede solo con tutti i turni insieme: un turno ha meno consegne della soglia.
        ? `Con tutti i turni insieme, le risposte compaiono quando ogni turno ha almeno ${minimum} consegne. Scegli un turno per vederle.`
        : `I risultati compaiono da ${minimum} consegne (ora ${activity.submitted}).`}
    </p> : <>
      <div className="grid gap-4 sm:grid-cols-2">
        {activity.required && activity.achieved !== null && <ShareBar
          label={`Obiettivo raggiunto: ${activity.achieved} su ${activity.submitted}`}
          value={activity.achieved}
          total={activity.submitted}
          tone="emerald"
        />}
        {activity.averageCorrect !== null && <p className="self-end text-sm">
          In media <strong className="text-lg tabular-nums">{formatDecimal(activity.averageCorrect)}</strong> risposte giuste su {activity.totalItems}
        </p>}
      </div>
      <ol className="grid gap-4 lg:grid-cols-2">
        {activity.items.map((item, index) => <li key={item.id} data-testid="group-item-chart" className="flex flex-col gap-3 rounded-xl border bg-background/60 p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium uppercase tracking-wide">Domanda {index + 1}</span>
            {item.critical && <ImportantTag />}
            <span className="ml-auto tabular-nums">{item.answered} risposte</span>
          </div>
          <p className="font-medium leading-snug">{item.prompt}</p>
          {showAnswers && <p className="text-sm font-semibold text-emerald-300">{percent(item.correct, item.answered)}% ha risposto giusto</p>}
          <ItemBars item={item} showAnswer={showAnswers} />
          {showAnswers && item.feedback && <p className="border-t pt-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Perché: </span>{item.feedback}
          </p>}
        </li>)}
      </ol>
    </>}
  </section>;
}
