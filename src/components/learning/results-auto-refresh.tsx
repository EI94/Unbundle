"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clockLabel } from "./results-format";
import { ResultsToggle } from "./results-toggle";

/**
 * Tiene aggiornati i risultati di gruppo mentre l'aula risponde: chiede al
 * server una nuova lettura ogni pochi secondi, solo quando la scheda è in
 * primo piano. Si può spegnere, e si può aggiornare a mano.
 */
export function ResultsAutoRefresh({ refreshedAt, seconds = 10 }: { refreshedAt: number; seconds?: number }) {
  const router = useRouter();
  const [auto, setAuto] = useState(true);
  // Una transizione propria: l'aggiornamento automatico non fa lampeggiare il pulsante.
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!auto) return;
    const refresh = () => { if (document.visibilityState === "visible") startTransition(() => router.refresh()); };
    const id = setInterval(refresh, seconds * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", refresh); };
  }, [auto, router, seconds]);

  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
    <ResultsUpdatedAt refreshedAt={refreshedAt} live={auto} />
    <ResultsToggle checked={auto} onChange={setAuto} label="Aggiornamento automatico" testId="results-auto-refresh" />
    <ResultsRefreshButton />
  </div>;
}

/** L'ora dell'ultima lettura. */
export function ResultsUpdatedAt({ refreshedAt, live = false }: { refreshedAt: number; live?: boolean }) {
  return <p className="inline-flex items-center gap-2 text-sm text-muted-foreground" aria-live="off">
    <span aria-hidden className={cn("size-2 rounded-full", live ? "animate-pulse bg-emerald-400" : "bg-muted-foreground/50")} />
    <span>Aggiornato alle <span className="tabular-nums text-foreground">{clockLabel(refreshedAt)}</span></span>
  </p>;
}

/** Aggiornamento a mano: chiede al server una nuova lettura della pagina. */
export function ResultsRefreshButton({ label = "Aggiorna ora" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <Button
    type="button"
    variant="ghost"
    className="min-h-10 gap-2"
    disabled={pending}
    aria-busy={pending}
    data-testid="results-refresh-now"
    onClick={() => startTransition(() => router.refresh())}
  >
    <RefreshCw aria-hidden className={cn(pending && "animate-spin")} />
    {label}
  </Button>;
}
