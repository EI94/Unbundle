"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { validateItemAction } from "@/lib/actions/uc-catalog";
import { DOMANDE_TEXT } from "@/lib/uc/views/domande-text";
import { formatCountIt } from "@/lib/uc/views/format";
import { REVIEW_SHORTCUTS_KEY, reviewHref, reviewKeyAction, shortcutsOn, type ReviewPosition } from "@/lib/uc/views/verification";
import { QuestionActionBar, type QuestionActionBarProps } from "./item-actions";
import { useUcAction } from "./use-uc-action";

type FormKey = NonNullable<QuestionActionBarProps["openForm"]>;

export interface ReviewModeProps {
  /** `/domande/verifica`: la scheda è `?voce=<id>`. */
  baseHref: string;
  /** «‹ Esci»: Domande › Da verificare. */
  exitHref: string;
  panoramicaHref: string;
  position: ReviewPosition;
  /** La scheda, già disegnata dal server (senza le azioni). */
  card: React.ReactNode;
  actions: Omit<QuestionActionBarProps, "filledFirst" | "onDone" | "shortcuts" | "keysOn" | "openForm" | "onFormChange"> | null;
  /** «Valida» si può fare adesso (quattro occhi): il tasto V fa lo stesso. */
  canValidate: boolean;
  /** Fine della coda: «12 risposte le hai date tu: le verifica un'altra persona.» */
  mineNote: string | null;
}

// (Rilascio 10, §3.5; WCAG 2.1.4) L'interruttore dei tasti rapidi: la scelta resta da una scheda all'altra (la pagina
// rimonta la verifica a ogni scheda), solo in questo browser. Senza memoria del browser vale per questa pagina.
const shortcutListeners = new Set<() => void>();
function subscribeShortcuts(onChange: () => void): () => void {
  shortcutListeners.add(onChange);
  return () => shortcutListeners.delete(onChange);
}
function readShortcuts(): boolean {
  try {
    return shortcutsOn(window.localStorage.getItem(REVIEW_SHORTCUTS_KEY));
  } catch {
    return true;
  }
}
function writeShortcuts(on: boolean) {
  try {
    window.localStorage.setItem(REVIEW_SHORTCUTS_KEY, on ? "si" : "no");
  } catch {
    // Senza memoria del browser la scelta non resta.
  }
  for (const l of shortcutListeners) l();
}

function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.closest("[role=menu],[role=listbox],[role=dialog]") !== null;
}

/**
 * «Verifica una alla volta» (DESIGN §3.6.4): una risposta per scheda, dalla
 * più vecchia. Tasti rapidi V, C, → e ←; un interruttore spegne V e C (rilascio
 * 10, §3.5; le frecce restano) e «‹ Precedente» torna alla scheda di prima.
 * Dopo ogni azione si passa alla scheda successiva senza ricaricare
 * la pagina. Al telefono la riga delle azioni resta fissa in basso. La pagina
 * lo monta con `key` sulla scheda: un modulo aperto e il testo scritto non
 * passano alla scheda dopo.
 */
export function ReviewMode({ baseHref, exitHref, panoramicaHref, position, card, actions, canValidate, mineNote }: ReviewModeProps) {
  const router = useRouter();
  const { pending, run } = useUcAction();
  const [form, setForm] = useState<FormKey | null>(null);
  const keys = useSyncExternalStore(subscribeShortcuts, readShortcuts, () => true);
  const switchId = useId();
  const go = (to: "next" | "prev" | "done") => router.replace(reviewHref(baseHref, position, to), { scroll: true });
  const next = () => go("done");

  useEffect(() => {
    if (position.nextId) router.prefetch(reviewHref(baseHref, position, "next"));
  }, [router, baseHref, position]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = reviewKeyAction({ key: e.key, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, typing: typingIn(e.target), enabled: keys });
      if (!action) return;
      if (action === "next" && position.nextId) {
        e.preventDefault();
        go("next");
      } else if (action === "prev" && position.prevId) {
        e.preventDefault();
        go("prev");
      } else if (action === "clarify" && actions?.plan.primary.includes("clarify")) {
        e.preventDefault();
        setForm("clarify");
      } else if (action === "validate" && actions && canValidate && !pending) {
        e.preventDefault();
        run(() => validateItemAction(actions.workspaceId, actions.caseId, { itemId: actions.itemId }), { success: "Risposta validata: la domanda è a posto.", onSuccess: next });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!position.currentId) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-12 text-center">
        <CheckCircle2 className="size-10 text-uc-verde" aria-hidden />
        <p className="text-lg font-semibold">Tutto verificato.</p>
        {mineNote && <p className="text-sm text-muted-foreground">{mineNote}</p>}
        <Button className="mt-2 min-h-11 sm:min-h-9" render={<Link href={panoramicaHref} />} nativeButton={false}>
          Torna alla Panoramica
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl pb-40 sm:pb-0">
      <nav aria-label="Verifica" className="mb-4 flex min-w-0 items-center justify-between gap-2 text-sm">
        <Link href={exitHref} className="inline-flex min-h-11 items-center gap-1 text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          Esci
        </Link>
        <p className="font-medium tabular-nums" aria-live="polite">
          Verifica · {formatCountIt(position.index)} di {formatCountIt(position.total)}
        </p>
        {position.nextId ? (
          <button type="button" onClick={() => go("next")} aria-keyshortcuts="ArrowRight" className="inline-flex min-h-11 items-center gap-1 text-muted-foreground hover:text-foreground">
            Salta
            <ChevronRight className="size-4" aria-hidden />
          </button>
        ) : (
          <span className="w-12" aria-hidden />
        )}
      </nav>
      <article className="min-w-0 space-y-5 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-6">
        {card}
        {actions && (
          <div className="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-30 max-sm:max-h-[60dvh] max-sm:overflow-y-auto max-sm:border-t max-sm:bg-background max-sm:p-3">
            <QuestionActionBar {...actions} filledFirst filledForms={false} shortcuts keysOn={keys} openForm={form} onFormChange={setForm} onDone={next} />
          </div>
        )}
      </article>
      {/* (Rilascio 10, §3.5) «‹ Precedente» per chi non usa i tasti; l'interruttore spegne V e C (WCAG 2.1.4: i tasti di
          un carattere), le frecce restano. Si vede a ogni larghezza, anche con una tastiera collegata al tablet. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {position.prevId && (
          <Button type="button" variant="ghost" className="-ml-2 min-h-11 sm:min-h-9" onClick={() => go("prev")} aria-keyshortcuts="ArrowLeft">
            <ChevronLeft aria-hidden data-icon="inline-start" />
            {DOMANDE_TEXT.verify.previous}
          </Button>
        )}
        <label htmlFor={switchId} className="flex min-h-11 cursor-pointer items-center gap-2 sm:min-h-9">
          <Switch id={switchId} checked={keys} onCheckedChange={(on) => writeShortcuts(on)} />
          {DOMANDE_TEXT.verify.shortcuts}
        </label>
        <span className="hidden sm:inline">{keys ? DOMANDE_TEXT.verify.hint : DOMANDE_TEXT.verify.hintArrows}</span>
      </div>
    </div>
  );
}
