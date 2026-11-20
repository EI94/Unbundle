"use client";

import { useEffect, useRef, useState } from "react";
import { Presentation, Users } from "lucide-react";
import type { GroupActivity, GroupResults } from "@/lib/learning/results";
import { LEARNING_TEXT } from "@/lib/learning/text";
import { Button } from "@/components/ui/button";
import { BigNumber } from "@/components/ui-10/big-number";
import { Fold } from "@/components/ui-10/fold";
import { ImportantTag, ItemBars, ShareBar } from "./results-charts";
import { formatDecimal, percent } from "./results-format";
import { ResultsUpdatedAt } from "./results-auto-refresh";
import { ResultsPresent } from "./results-present";
import { ResultsToggle } from "./results-toggle";

const R = LEARNING_TEXT.results;

/**
 * «In aula» (rilascio 10, ondata 7a, §3.9): quanti hanno finito e come hanno risposto, senza nomi. La barra ha l'ora
 * dell'ultima lettura (la pagina si aggiorna da sola), «Mostra le risposte giuste» e «Presenta in aula», il solo
 * pulsante pieno. Un numero solo, «12 su 20 hanno finito»; gli altri in «Tutti i numeri»; ogni esercizio in una piega,
 * con la sua riga «12 su 20 hanno consegnato».
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
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <ResultsUpdatedAt refreshedAt={refreshedAt} />
      <div className="flex flex-wrap items-center gap-2">
        {visible && <ResultsToggle checked={showAnswers} onChange={setShowAnswers} label={R.showAnswers} testId="show-answers-toggle" />}
        <Button ref={presentButton} type="button" onClick={present} data-testid="present-button" className="min-h-11 flex-1 sm:min-h-9 sm:flex-none">
          <Presentation aria-hidden data-icon="inline-start" />{R.present}
        </Button>
      </div>
    </div>
    <p className="text-sm text-muted-foreground">{R.noNames}</p>

    {group.suppressed ? <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center">
      <Users aria-hidden className="size-8 text-muted-foreground" />
      <p className="max-w-md text-base font-medium">{R.suppressed(group.minimum)}</p>
      <p className="text-sm text-muted-foreground">{R.refreshesItself}</p>
    </div> : <>
      {/* Lo zero non si mostra: finché nessuno ha finito, il numero è quello degli iscritti. */}
      {group.completed > 0
        ? <BigNumber value={R.finished(group.completed, group.enrolled)} label={R.finishedLabel} note={group.required > 0 ? R.finishedNote(group.required) : null} />
        : <BigNumber value={String(group.enrolled)} label={R.enrolled} />}
      <div>
        <Fold id="tutti-i-numeri" title={R.allNumbers}>
          <dl data-testid="group-kpis" className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Kpi label={R.enrolled} value={group.enrolled} />
            <Kpi label={R.started} value={group.started} total={group.enrolled} />
            <Kpi label={R.completed} value={group.completed} total={group.enrolled} />
            <Kpi label={R.achieved} value={group.achieved} total={group.enrolled} />
          </dl>
          {group.leftOutTurns > 0 && <p className="text-sm text-muted-foreground">{R.leftOut(group.leftOutTurns, group.minimum)}</p>}
        </Fold>
        {group.activities.map((activity) => <ActivityResults key={activity.id} activity={activity} enrolled={group.enrolled} minimum={group.minimum} showAnswers={showAnswers} />)}
      </div>
      {group.activities.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">{R.noExercises}</p>}
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

/** Un numero di «Tutti i numeri»; lo zero non si mostra. */
function Kpi({ label, value, total }: { label: string; value: number; total?: number }) {
  if (value === 0) return null;
  return <div className="space-y-0.5">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="font-semibold tabular-nums">{value}{total !== undefined && <span className="font-normal text-muted-foreground"> su {total}</span>}</dd>
  </div>;
}

function ActivityResults({ activity, enrolled, minimum, showAnswers }: { activity: GroupActivity; enrolled: number; minimum: number; showAnswers: boolean }) {
  const answering = Math.max(0, activity.started - activity.submitted);
  const summary = [R.submitted(activity.submitted, enrolled), activity.required ? null : R.optional].filter(Boolean).join(" · ");
  return <Fold id={`esercizio-${activity.id}`} title={activity.title} summary={summary}>
    <section data-testid="group-activity" aria-label={activity.title} className="space-y-4">
      {answering > 0 && <p className="text-sm text-muted-foreground">{R.answering(answering)}</p>}
      {!activity.visible ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        {activity.submitted >= minimum
          // Succede solo con tutte le lezioni insieme: una lezione ha meno consegne della soglia.
          ? R.hiddenAllLessons(minimum)
          : R.hiddenUntil(minimum, activity.submitted)}
      </p> : <>
        <div className="grid gap-4 sm:grid-cols-2">
          {activity.required && activity.achieved !== null && <ShareBar
            label={`${R.achieved}: ${activity.achieved} su ${activity.submitted}`}
            value={activity.achieved}
            total={activity.submitted}
            tone="emerald"
          />}
          {activity.averageCorrect !== null && <p className="self-end text-sm">
            In media <strong className="tabular-nums">{formatDecimal(activity.averageCorrect)}</strong> risposte giuste su {activity.totalItems}
          </p>}
        </div>
        <ol className="grid gap-4 lg:grid-cols-2">
          {activity.items.map((item, index) => <li key={item.id} data-testid="group-item-chart" className="flex flex-col gap-3 rounded-xl border bg-background/60 p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">Domanda {index + 1}</span>
              {item.critical && <ImportantTag />}
              <span className="ml-auto tabular-nums">{item.answered} {item.answered === 1 ? "risposta" : "risposte"}</span>
            </div>
            <p className="font-medium leading-snug">{item.prompt}</p>
            {showAnswers && <p className="text-sm font-semibold text-uc-verde">{percent(item.correct, item.answered)}% ha risposto giusto</p>}
            <ItemBars item={item} showAnswer={showAnswers} />
            {showAnswers && item.feedback && <p className="border-t pt-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Perché: </span>{item.feedback}
            </p>}
          </li>)}
        </ol>
      </>}
    </section>
  </Fold>;
}
