"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Eye, EyeOff, X } from "lucide-react";
import type { GroupActivity, GroupItem } from "@/lib/learning/results";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ImportantTag, ItemBars } from "./results-charts";
import { clockLabel, formatDecimal, percent } from "./results-format";

/**
 * La presentazione in aula: una domanda per schermata, a tutto schermo, con
 * caratteri grandi. Nessun nome, mai. La risposta giusta resta nascosta finché
 * chi presenta non la mostra. Le schermate si ricavano dai dati ricevuti a ogni
 * aggiornamento, quindi le barre crescono mentre l'aula risponde.
 */

type Slide =
  | { key: string; kind: "summary"; activity: GroupActivity }
  | { key: string; kind: "item"; activity: GroupActivity; item: GroupItem; number: number };

function slidesOf(activities: GroupActivity[]): Slide[] {
  return activities.filter((activity) => activity.visible).flatMap((activity) => [
    { key: `${activity.id}:summary`, kind: "summary" as const, activity },
    ...activity.items.map((item, index) => ({ key: `${activity.id}:${item.id}`, kind: "item" as const, activity, item, number: index + 1 })),
  ]);
}

function interactive(target: EventTarget | null) {
  return target instanceof HTMLElement && !!target.closest("button, a, input, select, textarea");
}

export function ResultsPresent({ activities, enrolled, minimum, suppressed, contextLabel, refreshedAt, onClose }: {
  activities: GroupActivity[]; enrolled: number; minimum: number; suppressed: boolean;
  contextLabel: string; refreshedAt: number; onClose: () => void;
}) {
  const slides = slidesOf(activities);
  const [position, setPosition] = useState<{ key: string | null; index: number }>(() => ({ key: slides[0]?.key ?? null, index: 0 }));
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const dialog = useRef<HTMLDivElement>(null);
  const answer = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  // Si resta sulla stessa domanda anche se, nel frattempo, compaiono altri esercizi.
  const found = slides.findIndex((slide) => slide.key === position.key);
  const index = slides.length === 0 ? -1 : found >= 0 ? found : Math.min(position.index, slides.length - 1);
  const slide = index >= 0 ? slides[index] : null;
  const isRevealed = !!slide && revealed.has(slide.key);

  function go(delta: number) {
    if (!slides.length) return;
    const next = Math.max(0, Math.min(slides.length - 1, index + delta));
    setPosition({ key: slides[next].key, index: next });
    if (next !== index) stage.current?.scrollTo({ top: 0 });
  }
  function toggleReveal() {
    if (!slide || slide.kind !== "item") return;
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(slide.key)) next.delete(slide.key); else next.add(slide.key);
      return next;
    });
    // Sugli schermi bassi la spiegazione può finire sotto: la si porta in vista.
    requestAnimationFrame(() => answer.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key === "ArrowRight" || event.key === "PageDown") { event.preventDefault(); go(1); return; }
    if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); go(-1); return; }
    // Su un pulsante la barra spaziatrice lo preme: non la si usa due volte.
    if (event.key === " " && !interactive(event.target)) { event.preventDefault(); go(1); return; }
    if ((event.key === "r" || event.key === "R") && !event.repeat) { event.preventDefault(); toggleReveal(); }
  });

  // Indietro o Avanti del browser chiudono la presentazione e lo schermo intero:
  // la pagina dove si arriva può avere i nomi.
  const onHistory = useEffectEvent(() => onClose());

  useEffect(() => {
    const node = dialog.current;
    const listener = (event: KeyboardEvent) => onKey(event);
    const onPopState = () => onHistory();
    window.addEventListener("keydown", listener);
    window.addEventListener("popstate", onPopState);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Il resto della pagina resta inerte: Tab, Spazio e Invio non arrivano ai controlli nascosti dietro.
    const muted = Array.from(document.body.children).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== node && !element.inert);
    for (const element of muted) element.inert = true;
    node?.focus();
    return () => {
      window.removeEventListener("keydown", listener);
      window.removeEventListener("popstate", onPopState);
      document.body.style.overflow = overflow;
      for (const element of muted) element.inert = false;
      // Tolta davvero dalla pagina (non solo nascosta per un controllo dell'accesso):
      // il proiettore non deve restare a tutto schermo.
      if (!node?.isConnected && document.fullscreenElement) {
        try { void document.exitFullscreen().catch(() => undefined); } catch { /* già uscito */ }
      }
    };
  }, []);

  const average = (activity: GroupActivity) => activity.averageCorrect === null ? "—" : formatDecimal(activity.averageCorrect);

  return createPortal(<div
    ref={dialog}
    tabIndex={-1}
    role="dialog"
    aria-modal="true"
    aria-labelledby="present-title"
    data-testid="present-overlay"
    className="fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none"
  >
    <div aria-hidden className="h-1 w-full bg-muted">
      <div className="h-full bg-emerald-500 transition-[width] duration-500" style={{ width: slides.length ? `${((index + 1) / slides.length) * 100}%` : "0%" }} />
    </div>
    <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-8">
      <div className="min-w-0 flex-1">
        <p id="present-title" className="truncate text-sm font-medium sm:text-base">{slide ? slide.activity.title : "Risultati di gruppo"}</p>
        <p className="truncate text-xs text-muted-foreground sm:text-sm">{contextLabel}<span className="hidden sm:inline"> · aggiornato alle {clockLabel(refreshedAt)}</span></p>
      </div>
      {slides.length > 0 && <p className="shrink-0 tabular-nums text-sm text-muted-foreground" aria-live="polite">{index + 1} / {slides.length}</p>}
      <Button type="button" variant="outline" className="min-h-10 gap-2 px-3" onClick={onClose} data-testid="present-exit">
        <X aria-hidden /> Esci
      </Button>
    </header>

    <div ref={stage} className="flex-1 overflow-y-auto px-4 py-4 sm:px-10 lg:px-16 [@media(min-height:760px)_and_(max-height:999px)]:py-6 [@media(min-height:1000px)]:py-10">
      <div className="mx-auto flex min-h-full max-w-6xl flex-col justify-center" data-testid="present-slide">
        {!slide ? <div className="mx-auto max-w-2xl space-y-4 text-center">
          <p className="text-3xl font-semibold sm:text-5xl">Ancora niente da mostrare</p>
          <p className="text-lg text-muted-foreground sm:text-2xl">
            {suppressed
              ? `I risultati di gruppo compaiono quando nel turno ci sono almeno ${minimum} iscritti.`
              : `Le domande di un esercizio compaiono qui quando ci sono almeno ${minimum} consegne.`}
          </p>
          <p className="text-base text-muted-foreground sm:text-lg">La pagina si aggiorna da sola.</p>
        </div> : slide.kind === "summary" ? <div className="space-y-8 sm:space-y-12">
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground sm:text-base">Com’è andata</p>
            <h2 className="text-3xl font-semibold leading-tight sm:text-5xl lg:text-6xl">{slide.activity.title}</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-3 sm:gap-6">
            <BigStat value={String(slide.activity.submitted)} label="consegne" detail={`su ${enrolled} iscritti`} />
            <BigStat value={average(slide.activity)} label="risposte giuste in media" detail={`su ${slide.activity.totalItems} domande`} />
            {slide.activity.required && slide.activity.achieved !== null
              ? <BigStat value={String(slide.activity.achieved)} label="obiettivo raggiunto" detail={`su ${slide.activity.submitted} consegne`} good />
              : <BigStat value={String(slide.activity.items.length)} label="domande da rivedere insieme" detail="una per schermata" />}
          </div>
        </div> : <div className="space-y-4 [@media(min-height:760px)_and_(max-height:999px)]:space-y-6 [@media(min-height:1000px)]:space-y-10">
          <div className="space-y-2 [@media(min-height:760px)_and_(max-height:999px)]:space-y-4 [@media(min-height:1000px)]:space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-base text-muted-foreground [@media(min-height:760px)_and_(max-height:999px)]:sm:text-xl [@media(min-height:1000px)]:sm:text-xl">
              <span>Domanda {slide.number} di {slide.activity.items.length}</span>
              {slide.item.critical && <ImportantTag large />}
              <span className="ml-auto tabular-nums">{slide.item.answered} risposte</span>
            </div>
            <h2 className="text-2xl font-semibold leading-tight sm:text-3xl [@media(min-height:760px)_and_(max-height:999px)]:lg:text-4xl [@media(min-height:1000px)]:lg:text-5xl">{slide.item.prompt}</h2>
          </div>
          <ItemBars item={slide.item} showAnswer={isRevealed} large />
          {isRevealed && <div ref={answer} className="space-y-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 [@media(min-height:760px)_and_(max-height:999px)]:sm:p-6 [@media(min-height:1000px)]:sm:p-6">
            <p className="text-xl font-semibold text-emerald-300 sm:text-2xl [@media(min-height:1000px)]:sm:text-3xl">{percent(slide.item.correct, slide.item.answered)}% ha risposto giusto</p>
            {slide.item.feedback && <p className="text-base leading-relaxed text-foreground/90 sm:text-lg [@media(min-height:1000px)]:sm:text-xl">{slide.item.feedback}</p>}
          </div>}
        </div>}
      </div>
    </div>

    <footer className="border-t px-4 py-3 sm:px-8">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
        <Button type="button" variant="outline" className="min-h-11 gap-2 px-3 sm:px-4" disabled={index <= 0} onClick={() => go(-1)} data-testid="present-prev">
          <ChevronLeft aria-hidden /> <span className="hidden sm:inline">Indietro</span><span className="sr-only sm:hidden">Indietro</span>
        </Button>
        {slide?.kind === "item" ? <Button
          type="button"
          variant={isRevealed ? "outline" : "default"}
          className={cn("min-h-11 min-w-0 flex-1 gap-2 px-3 text-sm sm:flex-none sm:px-4 sm:text-base", !isRevealed && "bg-emerald-600 text-white hover:bg-emerald-500")}
          aria-pressed={isRevealed}
          onClick={toggleReveal}
          data-testid="present-reveal"
        >
          {isRevealed ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          <span className="truncate sm:hidden">{isRevealed ? "Nascondi" : "Mostra la risposta"}</span>
          <span className="hidden sm:inline">{isRevealed ? "Nascondi la risposta" : "Mostra la risposta giusta"}</span>
        </Button> : <p className="hidden text-sm text-muted-foreground sm:block">Frecce per spostarti · R mostra la risposta · Esc per uscire</p>}
        <Button type="button" variant="outline" className="min-h-11 gap-2 px-3 sm:px-4" disabled={index < 0 || index >= slides.length - 1} onClick={() => go(1)} data-testid="present-next">
          <span className="hidden sm:inline">Avanti</span><span className="sr-only sm:hidden">Avanti</span> <ChevronRight aria-hidden />
        </Button>
      </div>
    </footer>
  </div>, document.body);
}

function BigStat({ value, label, detail, good = false }: { value: string; label: string; detail: string; good?: boolean }) {
  return <div className={cn("rounded-2xl border p-5 sm:p-8", good ? "border-emerald-500/30 bg-emerald-500/10" : "bg-card")}>
    <p className={cn("text-5xl font-semibold tabular-nums sm:text-7xl", good && "text-emerald-300")}>{value}</p>
    <p className="mt-2 text-lg font-medium sm:text-2xl">{label}</p>
    <p className="text-base text-muted-foreground sm:text-lg">{detail}</p>
  </div>;
}
