"use client";

import { Activity, useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useLearningUnsavedChanges } from "./use-unsaved-changes";

type Phase = "checking" | "verified" | "session_changed" | "unauthenticated" | "forbidden" | "unavailable";

/** Router history can retain an old user's RSC tree. Do not display it until
 * the current cookie has been checked. Activity suspends effects and hides the
 * UI while preserving owner-scoped, in-memory edits, including admin forms. */
export function LearningSessionBoundary({ workspaceId, expectedUserId, children }: { workspaceId: string; expectedUserId: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<{ path: string; phase: Phase }>({ path: "", phase: "checking" });
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const check = useCallback(async (announce = false) => {
    const generation = ++sequence.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setState({ path: pathname, phase: "checking" });
    const timeout = setTimeout(() => request.abort(), 10_000);
    try {
      const response = await fetch("/api/learning/session", { method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store", signal: request.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, expectedUserId }) });
      const data: unknown = await response.json();
      const code = data && typeof data === "object" && "code" in data ? data.code : null;
      const phase: Phase = response.ok && code === "verified" ? "verified"
        : code === "session_changed" || code === "unauthenticated" || code === "forbidden" ? code : "unavailable";
      if (generation !== sequence.current) return;
      setState({ path: pathname, phase });
      // A same-origin announcement is only a reason to recheck with the server,
      // never evidence of identity or permission and never carries draft data.
      if (announce && phase === "verified") channel.current?.postMessage({ userId: expectedUserId });
    } catch {
      if (generation === sequence.current) setState({ path: pathname, phase: "unavailable" });
    } finally { clearTimeout(timeout); }
  }, [workspaceId, expectedUserId, pathname]);

  useEffect(() => {
    const changes = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("unbundle-learning-session");
    channel.current = changes;
    if (changes) changes.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (data && typeof data === "object" && "userId" in data && data.userId !== expectedUserId) void check();
    };
    const recheck = () => { void check(); };
    const visibility = () => { if (document.visibilityState === "visible") recheck(); };
    window.addEventListener("focus", recheck);
    window.addEventListener("popstate", recheck);
    window.addEventListener("pageshow", recheck);
    document.addEventListener("visibilitychange", visibility);
    void check(true);
    const invalidatePendingCheck = () => { ++sequence.current; controller.current?.abort(); };
    return () => {
      invalidatePendingCheck(); changes?.close(); channel.current = null;
      window.removeEventListener("focus", recheck); window.removeEventListener("popstate", recheck); window.removeEventListener("pageshow", recheck);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [check, expectedUserId]);

  const phase = state.path === pathname ? state.phase : "checking";
  // Activity suspends the forms' effects while their edits remain in memory.
  // Keep navigation protection outside the hidden subtree during that interval.
  useLearningUnsavedChanges({
    pending: phase === "checking",
    dirty: phase !== "verified" && phase !== "checking",
  });
  return <>
    <Activity mode={phase === "verified" ? "visible" : "hidden"}>{children}</Activity>
    {phase !== "verified" && <section className="mx-auto max-w-3xl space-y-4 p-6" aria-busy={phase === "checking"}>
    <h1 className="text-xl font-semibold">{phase === "session_changed" ? "L’account è cambiato" : phase === "checking" ? "Verifica dell’accesso…" : "Accesso da verificare"}</h1>
    <p role="status" aria-live="polite">{phase === "checking" ? "Controllo della sessione prima di mostrare il percorso."
      : phase === "session_changed" ? "Questa pagina era stata aperta con un altro account. I suoi contenuti sono nascosti. Mantieni aperta la scheda e rientra con l’account iniziale per riprendere le modifiche non confermate."
      : "Non posso confermare l’accesso a questa pagina. Mantieni aperta la scheda: le modifiche non confermate restano nella sua memoria."}</p>
    {phase !== "checking" && <div className="flex flex-wrap items-center gap-4">
      <Button type="button" variant="outline" onClick={() => { void check(true); }}>Verifica di nuovo l’accesso</Button>
      <a className="underline" target="_blank" rel="noopener noreferrer" href={`/login?session=stale&callbackUrl=${encodeURIComponent(pathname)}`}>Accedi in una nuova scheda</a>
      {phase === "session_changed" && <a className="underline" href={pathname} target="_blank" rel="noopener noreferrer">Apri il percorso con l’account attuale</a>}
    </div>}
    </section>}
  </>;
}
