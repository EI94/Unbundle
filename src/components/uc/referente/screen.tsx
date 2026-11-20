"use client";

import { useState, type ReactNode } from "react";
import { ChevronLeft, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { R_TEXT } from "@/lib/uc/views/referente-text";
import { cn } from "@/lib/utils";

/**
 * Pezzi comuni delle schermate del referente (DESIGN §4.3, §4.7): il titolo che
 * riceve il focus a ogni cambio di passo, il link «‹ Indietro», gli avvisi in
 * linea (niente toast né portali su `/r`), il link da copiare e la scheda
 * dell'errore. Testi a 16 px, aree di tocco di almeno 44 px, il primario a 48 px.
 * (Rilascio 10, §3.11) La riga del cliente sta nel guscio (`ReferentShell`), non
 * sopra il titolo; le parole stanno in `referente-text.ts`.
 */

/** Id del titolo di ogni schermata: la pagina gli dà il focus a ogni cambio di passo. */
export const SCREEN_TITLE_ID = "uc-r-titolo";

/** Classi del pulsante primario (48 px, tutta la larghezza al telefono). */
export const PRIMARY_CLASS = "h-12 w-full text-base sm:w-auto sm:min-w-48";
/** Classi dei pulsanti secondari (outline, 48 px). */
export const SECONDARY_CLASS = "h-12 w-full text-base sm:w-auto";
/** Pulsante testuale (44 px). */
export const TEXT_BUTTON_CLASS = "min-h-11 h-auto px-2 text-base";

export function ScreenTitle({ children, size = "page", className }: { children: ReactNode; size?: "page" | "question"; className?: string }) {
  return (
    <h1
      id={SCREEN_TITLE_ID}
      tabIndex={-1}
      className={cn(
        "break-words outline-none",
        size === "page" ? "text-2xl leading-[1.875rem] font-semibold tracking-tight" : "text-xl leading-7 font-semibold",
        className,
      )}
    >
      {children}
    </h1>
  );
}

/** «‹ Argomenti», «‹ Indietro»: un link nell'hash, area di tocco di 44 px. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-md pr-2 text-base text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      <ChevronLeft className="size-5 shrink-0" aria-hidden />
      {children}
    </a>
  );
}

export type NoticeTone = "ok" | "info" | "attenzione" | "errore";

/** Avviso in linea (mai un toast): `role=alert` per gli errori, `status` per il resto. */
export function Notice({ tone, children, className }: { tone: NoticeTone; children: ReactNode; className?: string }) {
  return (
    <div
      role={tone === "errore" ? "alert" : "status"}
      className={cn(
        "rounded-xl px-4 py-3 text-base break-words",
        tone === "ok" && "bg-uc-verde-bg",
        tone === "info" && "bg-uc-blu-bg",
        tone === "attenzione" && "bg-uc-giallo-bg",
        tone === "errore" && "bg-uc-rosso-bg text-uc-rosso",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Il link del collega da copiare (delega senza email): campo a 16 px, così iOS non ingrandisce. */
export function CopyLink({ link, name }: { link: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const full = typeof window === "undefined" ? link : `${window.location.origin}${link}`;
  return (
    <div className="mt-3 space-y-2">
      <input
        readOnly
        value={full}
        onFocus={(e) => e.currentTarget.select()}
        aria-label={R_TEXT.delegate.linkLabel(name)}
        className="h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 font-mono text-base"
      />
      <Button
        type="button"
        variant="outline"
        className={SECONDARY_CLASS}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(full);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        <Copy aria-hidden />
        {copied ? R_TEXT.delegate.copied : R_TEXT.delegate.copyLink}
      </Button>
    </div>
  );
}

/**
 * (Rilascio 10, §3.11) La scheda dell'errore, una sola: il titolo, una riga calma e il solo «Riprova», pieno. Con
 * `retry` (l'`error.tsx` di Next 16) rilegge i dati; senza, quando il servizio non ha risposto al primo caricamento,
 * ricarica la pagina.
 */
export function ErrorCard({ retry }: { retry?: () => void }) {
  return (
    <section className="mt-8 rounded-xl bg-card p-6 text-card-foreground ring-1 ring-foreground/10">
      <h1 className="text-xl font-semibold break-words">{R_TEXT.error.title}</h1>
      <p className="mt-3 text-base leading-7 break-words text-muted-foreground">{R_TEXT.error.body}</p>
      <div className="mt-5">
        <Button type="button" className={PRIMARY_CLASS} onClick={() => (retry ? retry() : window.location.reload())}>
          {R_TEXT.error.retry}
        </Button>
      </div>
    </section>
  );
}

/** Riquadro richiudibile con il triangolo («▸ Istruzioni»), area di tocco di 44 px. */
export function Disclosure({ summary, children, className, defaultOpen }: { summary: ReactNode; children: ReactNode; className?: string; defaultOpen?: boolean }) {
  return (
    <details className={cn("group text-base", className)} open={defaultOpen}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
          ▸
        </span>
        {summary}
      </summary>
      <div className="pb-1 pl-5">{children}</div>
    </details>
  );
}
