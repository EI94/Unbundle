"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Fold } from "@/components/ui-10/fold";
import { Button } from "@/components/ui/button";
import { assignGranolaMeetingAction, leaveOutGranolaMeetingsAction } from "@/lib/actions/context-granola";
import { granolaCompactLine, granolaSyncLine, granolaUpdatedLine, type Line } from "@/lib/context/granola/view";
import { dayLabel } from "@/lib/context/labels";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { GranolaRulesView, GranolaSyncResult, UnsortedMeeting } from "@/lib/db/queries/context-granola";
import { cn } from "@/lib/utils";
import { GranolaRulesFields } from "./granola-rules";

const T = CONTEXT_TEXT.granola;
const LINE_TONE: Record<Line["tone"], string> = { ok: "text-uc-verde", info: "text-muted-foreground", error: "text-destructive" };

/** Il messaggio di una risposta non riuscita delle rotte di «Contesto» (`{ error, message }`), o quello di riserva. */
async function failureMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    return typeof body?.message === "string" && body.message ? body.message : fallback;
  } catch {
    return fallback;
  }
}

/**
 * La riga e il pannello di Granola nella pagina «Contesto» (componente client di `GranolaInbox`). Il giro parte da solo
 * se l'ultimo ha più di 30 minuti; «Aggiorna da Granola» lo fa partire subito. «Da smistare» si legge dal vivo quando
 * si apre, e niente si salva finché la persona non sceglie «Assegna» o «Lascia fuori».
 */
export function GranolaInboxPanel({
  workspaceId,
  workspaceName,
  compact,
  connected,
  expired,
  lastSyncAt,
  stale,
  unsortedCount,
  blockedCount,
  renderedAt,
  rules = null,
}: {
  workspaceId: string;
  workspaceName: string;
  compact: boolean;
  connected: boolean;
  expired: boolean;
  lastSyncAt: string | null;
  stale: boolean;
  unsortedCount: number;
  blockedCount: number;
  renderedAt: string;
  /** (Rilascio 10, §3.7) Le regole delle call di questo cliente: nel blocco intero, con un collegamento attivo. */
  rules?: GranolaRulesView | null;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [last, setLast] = useState<GranolaSyncResult | null>(null);
  const started = useRef(false);
  const active = connected && !expired;

  const runSync = useCallback(
    async (force: boolean) => {
      setSyncing(true);
      try {
        const response = await fetch(`/api/context/${workspaceId}/granola/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force }),
        });
        if (!response.ok) {
          setLast({ status: "non_riuscito", imported: 0, updated: 0, blocked: 0, unsorted: 0 });
          return;
        }
        const result = (await response.json()) as GranolaSyncResult;
        setLast(result);
        if (result.imported + result.updated + result.blocked > 0 || result.status === "da_ricollegare") router.refresh();
      } catch {
        setLast({ status: "non_riuscito", imported: 0, updated: 0, blocked: 0, unsorted: 0 });
      } finally {
        setSyncing(false);
      }
    },
    [router, workspaceId],
  );

  useEffect(() => {
    // Una visita di Lateral Space con l'ultimo giro di più di 30 minuti fa: il giro parte da solo, una volta.
    if (!active || !stale || started.current) return;
    started.current = true;
    void runSync(false);
  }, [active, stale, runSync]);

  const settingsHref = `/dashboard/${workspaceId}/settings#granola`;

  if (compact) {
    const line = granolaCompactLine({ syncing, last, unsortedCount: active ? unsortedCount : 0 });
    if (!line) return null;
    return (
      <p role="status" className="flex min-h-11 items-center text-sm text-muted-foreground">
        {line.toNotes ? (
          <Link className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline" href={`/dashboard/${workspaceId}/contesto?vista=fonti`}>
            {line.text}
          </Link>
        ) : (
          line.text
        )}
      </p>
    );
  }

  if (!connected || expired) {
    return (
      <p className="flex min-h-11 flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
        <span>{expired ? T.expired : T.notConnectedLine}</span>
        <Link className="text-foreground underline underline-offset-4" href={settingsHref}>
          {expired ? T.reconnect : T.accountLink}
        </Link>
      </p>
    );
  }

  const updated = granolaUpdatedLine(lastSyncAt, new Date(renderedAt));
  const after = last ? granolaSyncLine(last) : null;
  return (
    <section aria-label={T.cardTitle} className="space-y-3 rounded-xl p-4 ring-1 ring-foreground/10">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground" role="status">
          {syncing ? T.refreshing : updated}
        </p>
        <Button variant="outline" className="h-11 shrink-0 sm:h-8" disabled={syncing} onClick={() => void runSync(true)}>
          {T.refresh}
        </Button>
      </div>
      {after && !syncing && <p className={cn("text-sm", LINE_TONE[after.tone])}>{after.text}</p>}
      {blockedCount > 0 && <p className="text-sm text-muted-foreground">{T.blocked(blockedCount)}</p>}
      {unsortedCount > 0 && <UnsortedMeetings workspaceId={workspaceId} workspaceName={workspaceName} count={unsortedCount} renderedAt={renderedAt} />}
      {rules ? (
        <Fold id="granola-regole-cliente" title={T.rulesTitle(workspaceName)} className="last:border-b-0">
          <GranolaRulesFields workspaceId={workspaceId} rules={rules} />
        </Fold>
      ) : null}
    </section>
  );
}

/** «Da smistare (n)»: chiuso; aperto, le call lette dal vivo da Granola, con «Assegna a {cliente}» e «Lascia fuori». */
function UnsortedMeetings({ workspaceId, workspaceName, count, renderedAt }: { workspaceId: string; workspaceName: string; count: number; renderedAt: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [meetings, setMeetings] = useState<UnsortedMeeting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, start] = useTransition();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/context/${workspaceId}/granola/unsorted`, { cache: "no-store" });
      if (!response.ok) {
        setError(await failureMessage(response, T.loadFailed));
        return;
      }
      setMeetings(((await response.json()) as { meetings: UnsortedMeeting[] }).meetings);
    } catch {
      setError(T.loadFailed);
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && meetings === null && !loading) void load();
  };

  const drop = (ids: readonly string[]) => setMeetings((current) => (current ?? []).filter((m) => !ids.includes(m.id)));

  const assign = (meeting: UnsortedMeeting) =>
    start(async () => {
      const result = await assignGranolaMeetingAction(workspaceId, meeting.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      drop([meeting.id]);
      toast.success(T.assigned);
      // La lettura con il modello la fa la rotta di «Contesto»; finita, la pagina si aggiorna.
      void fetch(`/api/context/${workspaceId}/sources/${result.value.sourceId}/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .catch(() => undefined)
        .finally(() => router.refresh());
    });

  const leaveOut = (ids: string[]) =>
    start(async () => {
      const result = await leaveOutGranolaMeetingsAction(workspaceId, ids);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      drop(ids);
      toast.success(T.leftOut);
      router.refresh();
    });

  const today = new Date(renderedAt);
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium"
        aria-expanded={open}
        aria-controls="granola-da-smistare"
        onClick={toggle}
      >
        {T.unsorted(count)}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div id="granola-da-smistare" className="space-y-2">
          <p className="text-xs text-muted-foreground">{T.unsortedHint}</p>
          {loading && <p className="text-sm text-muted-foreground">{T.unsortedLoading}</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {meetings && meetings.length === 0 && <p className="text-sm text-muted-foreground">{T.unsortedEmpty}</p>}
          {meetings && meetings.length > 0 && (
            <>
              <ul className="divide-y rounded-lg border">
                {meetings.map((meeting) => (
                  <li key={meeting.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{meeting.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[meeting.date ? dayLabel(meeting.date, today) : "", meeting.participants].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-2 sm:shrink-0">
                      <Button variant="outline" className="h-auto min-h-11 max-w-full py-2 whitespace-normal sm:min-h-8 sm:py-1" disabled={pending} onClick={() => assign(meeting)}>
                        {T.assign(workspaceName)}
                      </Button>
                      <Button variant="ghost" className="h-11 sm:h-8" disabled={pending} onClick={() => leaveOut([meeting.id])}>
                        {T.leaveOut}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              {meetings.length > 1 && (
                <Button variant="ghost" className="h-11 sm:h-8" disabled={pending} onClick={() => leaveOut(meetings.map((m) => m.id))}>
                  {T.leaveOutAll}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
