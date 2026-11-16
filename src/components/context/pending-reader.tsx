"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { readPending } from "./read-client";

const T = CONTEXT_TEXT;

/**
 * «Leggo gli appunti… 1 di 3» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.2, §8.7): gli appunti in
 * attesa (entrati da Granola, da Claude, documenti caricati, letture rimaste a metà), letti uno alla volta appena
 * Lateral Space apre la Memoria. Una lettura per richiesta, sulla rotta di lettura; la presa in carico sul server
 * impedisce due letture insieme. Alla fine, se qualcosa è stato letto, la pagina si aggiorna («12 proposte da
 * confermare»). La pagina lo monta solo con l'ok ai fornitori: senza, c'è l'avviso al suo posto.
 */
export function PendingReader({ workspaceId, sourceIds }: { workspaceId: string; sourceIds: readonly string[] }) {
  const router = useRouter();
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null);
  const [limited, setLimited] = useState(false);
  const key = sourceIds.join(",");

  useEffect(() => {
    if (!key) return;
    const ids = key.split(",");
    const controller = new AbortController();
    let alive = true;
    readPending(fetch, workspaceId, ids, {
      signal: controller.signal,
      onProgress: (index, total) => {
        if (alive) setProgress({ index, total });
      },
    })
      .then((run) => {
        if (!alive) return;
        setProgress(null);
        if (run.stoppedBy === "limite") setLimited(true);
        if (run.read > 0) router.refresh();
      })
      .catch(() => {
        if (alive) setProgress(null);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [workspaceId, key, router]);

  if (limited) return <p className="rounded-lg border px-3 py-2.5 text-sm text-muted-foreground">{T.read.limit}</p>;
  if (!progress) return null;
  return (
    <p role="status" className="flex min-h-11 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground">
      <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-current" />
      {progress.total > 1 ? T.page.readingOf(progress.index, progress.total) : T.page.reading}
    </p>
  );
}
