"use client";

import { useId } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { UI10_TEXT } from "@/components/ui-10/text";
import { NextStepIconView, NextStepWhy } from "@/components/use-cases/detail/next-step-box";
import { ActionMenu, type ActionMenuItem } from "@/components/uc/ui/action-menu";
import { transitionCaseAction } from "@/lib/actions/uc-cases";
import { stepHiddenOn, type CaseMenuKey, type CaseTrail, type StepPanel } from "@/lib/uc/views/case-shell";
import type { CaseStatus } from "@/lib/uc/vocab";
import type { NextStepIcon } from "@/lib/use-cases/guided";
import { cn } from "@/lib/utils";

/**
 * Le parti interattive della testata del dossier (DESIGN §3.3): il percorso,
 * il pulsante primario, il menu «⋯» e i pannelli che si aprono dall'indirizzo
 * (`?conferma=<stato>` per un passo di stato, `?esporta=1` per Esporta…).
 *
 * I pannelli stanno nell'indirizzo, non nello stato del componente: così li
 * aprono allo stesso modo il primario della testata, quello della barra fissa,
 * il menu e le righe «Da fare adesso» della Panoramica. Ce n'è una copia sola
 * (`CaseUrlPanels`), nella testata.
 */

// ── Percorso ──────────────────────────────────────────────────────────

/**
 * «Use case › XX-0012 › Realizzazione», su una riga anche a 400 px: il pezzo
 * di mezzo si accorcia con i puntini. Senza scheda madre «‹ Realizzazioni».
 * (Rilascio 10, §3.5) «Realizzazione» è dove si è, mai un link: alla
 * Panoramica porta la sua scheda; in Panoramica è la pagina corrente.
 */
export function CaseTrailNav({ trail }: { trail: CaseTrail }) {
  const pathname = usePathname();
  const link = "rounded-sm hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";
  if (trail.kind === "lista") {
    return (
      <nav aria-label="Percorso" className="min-w-0 text-sm text-muted-foreground">
        <Link href={trail.back.href} className={cn("inline-flex min-h-11 items-center gap-1 sm:min-h-6", link)}>
          <ChevronLeft className="size-4 shrink-0" aria-hidden />
          {trail.back.label}
        </Link>
      </nav>
    );
  }
  const current = pathname.replace(/\/+$/, "") === trail.current.href;
  const sep = <ChevronRight className="size-3.5 shrink-0 opacity-70" aria-hidden />;
  return (
    <nav aria-label="Percorso" className="min-w-0 text-sm text-muted-foreground">
      <ol className="flex min-h-11 min-w-0 items-center gap-1 whitespace-nowrap sm:min-h-6">
        <li className="shrink-0">
          <Link href={trail.root.href} className={link}>
            {trail.root.label}
          </Link>
        </li>
        <li className="flex min-w-0 items-center gap-1">
          {sep}
          <Link href={trail.parent.href} title={trail.parent.label} className={cn("truncate", trail.parent.isCode && "tabular-nums", link)}>
            {trail.parent.label}
          </Link>
        </li>
        <li className="flex shrink-0 items-center gap-1">
          {sep}
          {current ? (
            <span aria-current="page" className="text-foreground">
              {trail.current.label}
            </span>
          ) : (
            <span>{trail.current.label}</span>
          )}
        </li>
      </ol>
    </nav>
  );
}

// ── Pulsante primario ─────────────────────────────────────────────────

/** Il passo della testata, pronto per il client: un link, oppure un pannello dall'indirizzo. */
export interface CaseStepView {
  label: string;
  /** Indirizzo completo del passo (`resolveStepHref`). */
  href: string;
  /** Radice del dossier: dice dove il passo si nasconde (`stepHiddenOn`). */
  caseBase: string;
  /**
   * Il passo apre un pannello invece di cambiare pagina (`stepPanelOf`): quelli del guscio (`conferma`, `esporta`,
   * `firma`) su ogni pagina; (rilascio 10, §3.5) `apri` sulla pagina d'arrivo del passo (il pannello «File» di
   * Domande), che dalle altre pagine si raggiunge con `href`.
   */
  panel?: StepPanel;
  /** (Rilascio 10, §7.4) L'icona accanto al verbo, come nei passi dello use case (`NEXT_STEP_ICON`). */
  icon?: NextStepIcon;
  /** (Rilascio 10, §7.4) Il perché del passo, nel «?» accanto al pulsante (`NextStepWhy`); null senza niente da dire. */
  why?: string | null;
  /**
   * (Rilascio 10, §3.5) Il comando del passo sta nella pagina d'arrivo («Proponi il via allo sviluppo» nella sezione
   * «Via allo sviluppo»): lì la pagina ha il suo pulsante pieno e questo si nasconde (`stepHiddenOn`).
   */
  pageCommand?: boolean;
}

function withParam(pathname: string, current: URLSearchParams, name: string, value: string): string {
  const next = new URLSearchParams(current.toString());
  next.set(name, value);
  return `${pathname}?${next.toString()}`;
}

const pathOf = (href: string) => href.split(/[?#]/)[0].replace(/\/+$/, "");

/**
 * Dove porta il passo da questa pagina: un pannello del guscio (conferma, esporta, firma) si apre qui; un pannello di
 * pagina (`apri`) si apre qui solo sulla sua pagina, con i filtri di chi guarda; altrimenti l'indirizzo del passo.
 * `inPlace`: si resta qui.
 */
export function stepTarget(step: Pick<CaseStepView, "href" | "panel">, pathname: string, current: URLSearchParams): { href: string; inPlace: boolean } {
  if (!step.panel) return { href: step.href, inPlace: false };
  if (step.panel.name === "apri" && pathOf(pathname) !== pathOf(step.href)) return { href: step.href, inPlace: false };
  return { href: withParam(pathname, current, step.panel.name, step.panel.value), inPlace: true };
}

/**
 * Il pulsante pieno (DESIGN §2.7, `nextStepFor`). Si nasconde sulla pagina in
 * cui porta e su Impostazioni; resta sulle ancore di Panoramica e sui passi
 * che aprono un pannello (`stepHiddenOn`). (Rilascio 10, §7.4) Come il passo
 * dello use case: l'icona accanto al verbo e, nella testata, il «?» con il
 * perché (`NextStepWhy`); nella barra fissa (`size="sm"`) solo icona e verbo.
 * (Rilascio 10, §3.5) Nella testata, sopra, l'etichetta «Prossimo passo» del
 * pezzo comune (`withLabel`): c'è solo quando c'è il pulsante. 44 px al
 * telefono, 36 px da 640 px, largo quanto la colonna meno il «?».
 */
export function CaseStepButton({ step, size = "default", withLabel = false, className }: { step: CaseStepView; size?: "default" | "sm"; withLabel?: boolean; className?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const whyId = useId();
  const labelId = useId();
  if (stepHiddenOn({ href: step.href, caseBase: step.caseBase, panel: !!step.panel, pageCommand: step.pageCommand }, pathname)) return null;
  const { href, inPlace } = stepTarget(step, pathname, searchParams);
  const why = size === "default" && step.why ? step.why : null;
  const button = (
    <Button
      size={size}
      data-slot="case-step"
      className={cn(size === "default" ? "min-w-0 flex-1 sm:flex-none" : "min-h-8", !why && !withLabel ? className : undefined)}
      render={<Link href={href} scroll={!inPlace} aria-describedby={why ? whyId : undefined} />}
      nativeButton={false}
    >
      {step.icon ? <NextStepIconView icon={step.icon} /> : null}
      {step.label}
    </Button>
  );
  const row =
    why || withLabel ? (
      <span className={cn("flex min-w-0 items-center gap-1", withLabel ? undefined : className)}>
        {button}
        {why ? <NextStepWhy id={whyId} text={why} /> : null}
      </span>
    ) : (
      button
    );
  if (!withLabel) return row;
  return (
    <section aria-labelledby={labelId} data-slot="next-step" className={cn("min-w-0 space-y-2", className)}>
      <p id={labelId} className="text-xs text-muted-foreground">
        {UI10_TEXT.nextStep.label}
      </p>
      {row}
    </section>
  );
}

// ── Menu «⋯» ──────────────────────────────────────────────────────────

export interface CaseMenuEntry {
  key: CaseMenuKey;
  label: string;
  /** Indirizzo completo; null per «Esporta…», che apre il pannello. */
  href: string | null;
}

/** Il menu «⋯» del dossier (DESIGN §2.2). Senza voci non c'è. */
export function CaseMenu({ items, className }: { items: readonly CaseMenuEntry[]; className?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const entries: ActionMenuItem[] = items.map((item) =>
    item.href ? { label: item.label, href: item.href } : { label: item.label, onSelect: () => router.push(withParam(pathname, searchParams, "esporta", "1"), { scroll: false }) },
  );
  return <ActionMenu items={entries} label="Altre azioni sulla realizzazione" className={className} />;
}

// ── Pannelli dall'indirizzo ───────────────────────────────────────────

export interface CaseTransitionView {
  to: CaseStatus;
  /** Il testo del passo («Avvia lo sviluppo»). */
  label: string;
  /** Cosa succede, in una frase (`transitionHint`). */
  hint: string;
  /** L'etichetta dello stato di arrivo («In sviluppo»). */
  statusLabel: string;
}

/**
 * Il dialogo di conferma del passo di stato e il pannello Esporta…, aperti da
 * `?conferma=<stato>` e `?esporta=1`. Chiudere toglie il parametro.
 */
export function CaseUrlPanels({
  workspaceId,
  caseId,
  transition,
  exportPanel,
}: {
  workspaceId: string;
  caseId: string;
  transition: CaseTransitionView | null;
  exportPanel: { title: string; note: string; content: React.ReactNode } | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { pending, run } = useUcAction();
  const confirmOpen = transition !== null && searchParams.get("conferma") === transition.to;
  const exportOpen = exportPanel !== null && searchParams.get("esporta") === "1";

  function close(name: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(name);
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }

  function confirm() {
    if (!transition) return;
    run(() => transitionCaseAction(workspaceId, caseId, { to: transition.to, reason: null }), {
      success: `La realizzazione ora è «${transition.statusLabel}».`,
      onSuccess: () => close("conferma"),
    });
  }

  return (
    <>
      {transition && (
        <Dialog open={confirmOpen} onOpenChange={(open) => !open && close("conferma")}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{transition.label}</DialogTitle>
              {transition.hint && <DialogDescription>{transition.hint}</DialogDescription>}
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" className="h-11 sm:h-8" onClick={() => close("conferma")}>
                Annulla
              </Button>
              <Button className="h-11 sm:h-8" disabled={pending} onClick={confirm}>
                {pending ? "Un momento…" : "Conferma"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {exportPanel && (
        <Sheet open={exportOpen} onOpenChange={(open) => !open && close("esporta")}>
          <SheetContent side="right" className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md">
            <SheetHeader className="pr-12">
              <SheetTitle>{exportPanel.title}</SheetTitle>
              <SheetDescription>{exportPanel.note}</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">{exportPanel.content}</div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
