"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { cn } from "@/lib/utils";

export interface ChapterLink {
  /** L'ancora del capitolo (`id` della sezione), es. «valutazione». */
  id: string;
  label: string;
}

export interface ChapterNavProps {
  chapters: readonly ChapterLink[];
  /** `?capitolo=`: la pagina parte da quel capitolo (email, campanella). */
  initial?: string | null;
  className?: string;
}

/**
 * Apre il `<details>` di un capitolo chiuso (la «Storia») quando ci si arriva: solo quello che è il
 * capitolo stesso, figlio diretto della sezione. I riquadri chiusi dentro un capitolo aperto («Già a
 * posto» di «Cosa serve», «Suggerimento AI») restano chiusi.
 */
function openDetailsOf(target: HTMLElement | null): void {
  const details = target?.querySelector<HTMLDetailsElement>(":scope > details");
  if (details && !details.open) details.open = true;
}

/** Tasti che scorrono la pagina: chi li usa sta scorrendo da sé. */
const SCROLL_KEYS: ReadonlySet<string> = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "]);

/** Quanto sotto la barra delle ancore deve arrivare la testata di un capitolo per essere «in vista». */
const ACTIVE_LINE_OFFSET = 24;

/**
 * Il capitolo in vista, dalla posizione di scorrimento: l'ultimo la cui testata è salita sopra la
 * linea `line` (il fondo della barra delle ancore più un margine). In cima alla pagina, prima che
 * una testata arrivi alla linea, il primo. In fondo alla pagina (che non scorre più) l'ultimo
 * capitolo visibile: i capitoli brevi in coda («Realizzazione», «Storia») non arrivano mai alla
 * linea. `sections` in ordine di pagina, con la loro distanza dal bordo alto della finestra.
 */
export function activeChapterAt(
  sections: readonly { id: string; top: number }[],
  view: { line: number; height: number; atBottom: boolean },
): string | null {
  if (!sections.length) return null;
  if (view.atBottom) {
    for (let index = sections.length - 1; index >= 0; index--) if (sections[index].top < view.height) return sections[index].id;
  }
  let current = sections[0].id;
  for (const section of sections) if (section.top <= view.line) current = section.id;
  return current;
}

/**
 * Le schede-ancora della scheda (docs/use-case/DESIGN.md §6.1): fisse in alto sotto la barra del
 * workspace (61 px sul telefono, 53 px da tablet in su), `min-h-11`, una per capitolo che chi
 * guarda vede: chi ha meno permessi ha meno ancore, mai ancore spente. Da `md` in giù scorrono in
 * orizzontale con la sfumatura a destra. `?capitolo=` porta al capitolo; l'ancora del capitolo in
 * vista è evidenziata (`activeChapterAt`).
 *
 * Arrivando da `?capitolo=` (email, campanella) o toccando un'ancora, resta evidenziata quell'ancora
 * finché la persona non scorre da sé (rotella, tocco, tasti, barra di scorrimento): lo scorrimento
 * fatto dalla pagina non la cambia, anche quando il capitolo è in fondo e non arriva in cima.
 */
export function ChapterNav({ chapters, initial, className }: ChapterNavProps) {
  const arrival = initial && chapters.some((chapter) => chapter.id === initial) ? initial : null;
  const [active, setActive] = useState<string | null>(arrival ?? chapters[0]?.id ?? null);
  const [shownArrival, setShownArrival] = useState(arrival);
  const listRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  /** L'ancora scelta da `?capitolo=` o da un tocco: tiene l'evidenza finché la persona non scorre. */
  const pinned = useRef<string | null>(arrival);

  // Un altro `?capitolo=` sulla stessa scheda (la campanella aperta mentre si è qui).
  if (shownArrival !== arrival) {
    setShownArrival(arrival);
    if (arrival) setActive(arrival);
  }

  // `?capitolo=`: all'arrivo, e quando cambia.
  useEffect(() => {
    if (!arrival) return;
    const target = document.getElementById(arrival);
    if (!target) return;
    pinned.current = arrival;
    openDetailsOf(target);
    target.scrollIntoView({ block: "start" });
  }, [arrival]);

  // Il capitolo in vista, a ogni scorrimento (una misura per fotogramma).
  useEffect(() => {
    const ids = chapters.map((chapter) => chapter.id);
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (pinned.current) return;
      const sections = ids.flatMap((id) => {
        const el = document.getElementById(id);
        return el ? [{ id, top: el.getBoundingClientRect().top }] : [];
      });
      const root = document.scrollingElement ?? document.documentElement;
      const height = window.innerHeight;
      const atBottom = root.scrollHeight > height + 2 && root.scrollTop + height >= root.scrollHeight - 2;
      const line = (navRef.current?.getBoundingClientRect().bottom ?? 0) + ACTIVE_LINE_OFFSET;
      const next = activeChapterAt(sections, { line, height, atBottom });
      if (next) setActive(next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    // Scorre la persona: l'ancora scelta lascia il posto al capitolo in vista.
    const release = () => {
      pinned.current = null;
    };
    const onKey = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) release();
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchstart", release, { passive: true });
    window.addEventListener("pointerdown", release, { passive: true });
    window.addEventListener("keydown", onKey);
    if (!pinned.current) schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchstart", release);
      window.removeEventListener("pointerdown", release);
      window.removeEventListener("keydown", onKey);
    };
  }, [chapters]);

  // L'ancora attiva resta in vista nella riga che scorre (solo in orizzontale).
  useEffect(() => {
    const box = listRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-chapter="${active}"]`);
    if (!box || !el || box.scrollWidth <= box.clientWidth) return;
    const a = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (a.left < b.left) box.scrollLeft -= b.left - a.left + 8;
    else if (a.right > b.right) box.scrollLeft += a.right - b.right + 24;
  }, [active]);

  if (chapters.length < 2) return null;

  function go(event: MouseEvent<HTMLAnchorElement>, id: string) {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    pinned.current = id;
    openDetailsOf(target);
    target.scrollIntoView({ block: "start", behavior: "smooth" });
    setActive(id);
    window.history.replaceState(null, "", `#${id}`);
  }

  return (
    <nav ref={navRef} aria-label="Capitoli" data-slot="chapter-nav" className={cn("sticky top-[61px] z-10 -mx-4 border-b border-border bg-background/95 px-4 backdrop-blur sm:-mx-6 sm:px-6 md:top-[53px]", className)}>
      {/* contain: inline-size: la larghezza delle ancore non allarga la pagina, la riga scorre. */}
      <div
        ref={listRef}
        className="-mb-px flex min-w-0 gap-1 overflow-x-auto [contain:inline-size] [mask-image:linear-gradient(to_right,black_85%,transparent)] [scrollbar-width:none] md:[mask-image:none]"
      >
        {chapters.map((chapter) => {
          const isActive = chapter.id === active;
          return (
            <a
              key={chapter.id}
              href={`#${chapter.id}`}
              data-chapter={chapter.id}
              aria-current={isActive ? "location" : undefined}
              onClick={(event) => go(event, chapter.id)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center border-b-2 px-2.5 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                isActive ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {chapter.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
