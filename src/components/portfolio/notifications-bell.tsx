"use client";

import { useCallback, useEffect, useReducer, useRef, useState, type MouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu } from "@base-ui/react/menu";
import { Bell, Check } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { markAllBellReadAction, setBellEmailAlertsAction } from "@/lib/actions/notifications";
import {
  BELL_TEXT,
  bellApiPath,
  bellAriaLabel,
  bellBadgeText,
  type BellPayload,
  type BellReadRef,
  type BellWriteBody,
  type BellWriteResult,
} from "@/lib/notifications/bell";
import { cn } from "@/lib/utils";
import { bellMenuModel, bellReducer, initialBellState, runRowClick, visibleEntries, visibleNewCount } from "./notifications-bell-state";

export interface NotificationsBellProps {
  workspaceId: string;
  /** Il payload della persona letto dalla barra in alto (`loadBellPayload`). */
  initial: BellPayload;
}

/** Dopo una navigazione o una scrittura la campanella si rilegge una volta, poco dopo. */
const REFETCH_DELAY_MS = 300;
/** Al ritorno sulla scheda del browser al massimo una rilettura al minuto. */
const VISIBLE_REFETCH_MS = 60_000;

const ROW =
  "flex w-full min-h-11 flex-col items-stretch gap-0.5 rounded-md px-2 py-2 text-left outline-hidden select-none sm:min-h-0 data-highlighted:bg-accent data-highlighted:text-accent-foreground";

async function postBell(workspaceId: string, body: BellWriteBody): Promise<BellWriteResult> {
  try {
    const response = await fetch(bellApiPath(workspaceId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      // La scrittura arriva anche se la persona cambia pagina subito dopo (un clic su una riga, un'apertura breve).
      keepalive: true,
    });
    const json = (await response.json().catch(() => null)) as BellWriteResult | null;
    if (json && typeof json === "object" && "ok" in json) return json;
  } catch {
    // rete assente: come un errore del server
  }
  return { ok: false, code: "riprova", message: body.op === "read" ? BELL_TEXT.errors.readOne : BELL_TEXT.errors.unavailable };
}

async function getBell(workspaceId: string): Promise<BellPayload | null> {
  try {
    const response = await fetch(bellApiPath(workspaceId), { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return null;
    const json = (await response.json().catch(() => null)) as { ok?: boolean; payload?: BellPayload } | null;
    return json?.ok === true && json.payload ? json.payload : null;
  } catch {
    return null;
  }
}

/** Un clic semplice (sinistro, senza modificatori): naviga la campanella; gli altri restano del link. */
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * La campanella della barra in alto, per persona (SPEC §P2.5, R10): il numero rosso conta le righe
 * nuove dall'ultima apertura e si azzera aprendola; ogni riga resta evidenziata finché la persona non
 * la apre; aprire una riga la segna letta prima di navigare; «Segna tutte come lette» vale per tutte
 * le fonti che la persona vede, solo per lei. Si rilegge dopo ogni navigazione e ogni scrittura, e
 * adotta il payload nuovo che arriva dal server con la pagina.
 */
export function NotificationsBell({ workspaceId, initial }: NotificationsBellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, dispatch] = useReducer(bellReducer, initial, initialBellState);
  const [emailOverride, setEmailOverride] = useState<boolean | null>(null);
  const stateRef = useRef(state);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastVisibleFetch = useRef(0);
  const firstPath = useRef(true);

  useEffect(() => {
    stateRef.current = state;
  });

  const fetchNow = useCallback(async () => {
    const payload = await getBell(workspaceId);
    if (payload) dispatch({ type: "payload", payload });
    else dispatch({ type: "refreshFailed" });
  }, [workspaceId]);

  const refetch = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void fetchNow();
    }, REFETCH_DELAY_MS);
  }, [fetchNow]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Il payload che arriva con la pagina (refresh() dalle action, router.refresh()): adottato se più nuovo.
  useEffect(() => {
    dispatch({ type: "payload", payload: initial });
  }, [initial]);

  // Navigazione: il menu si chiude e la campanella si rilegge.
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    dispatch({ type: "close" });
    refetch();
  }, [pathname, refetch]);

  // Ritorno sulla scheda del browser: al massimo una rilettura al minuto.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastVisibleFetch.current < VISIBLE_REFETCH_MS) return;
      lastVisibleFetch.current = now;
      void fetchNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchNow]);

  function onOpenChange(open: boolean) {
    if (!open) {
      dispatch({ type: "close" });
      return;
    }
    dispatch({ type: "open" });
    // In parallelo, senza aspettare per mostrare il menu: «visto fino a» lo decide il server.
    void postBell(workspaceId, { op: "seen" }).then((result) => {
      if (result.ok && result.seenAt) dispatch({ type: "seen", seenAt: result.seenAt });
    });
    void fetchNow();
  }

  const deps = {
    markRead: (ref: BellReadRef) => postBell(workspaceId, { op: "read", ref }),
    push: (href: string) => router.push(href),
    toast: (message: string) => toast.error(message),
    dispatch,
    timeout: (ms: number) => new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms)),
    refetch,
  };

  function onRow(event: MouseEvent, key: string) {
    const entry = visibleEntries(stateRef.current).find((e) => e.key === key);
    if (!entry) return;
    const plain = !entry.href || isPlainClick(event);
    if (plain) event.preventDefault();
    void runRowClick(entry, { plain }, deps);
  }

  async function onReadAll() {
    const previous = stateRef.current;
    dispatch({ type: "optimisticReadAll" });
    let result: Awaited<ReturnType<typeof markAllBellReadAction>>;
    try {
      result = await markAllBellReadAction(workspaceId, previous.payload.latestAt);
    } catch {
      result = { ok: false, code: "riprova", message: BELL_TEXT.errors.readAll };
    }
    if (result.ok) dispatch({ type: "payload", payload: result.payload });
    else {
      dispatch({ type: "revertReadAll", previous });
      toast.error(result.message || BELL_TEXT.errors.readAll);
    }
  }

  async function onEmailAlerts(on: boolean) {
    setEmailOverride(on);
    let result: Awaited<ReturnType<typeof setBellEmailAlertsAction>>;
    try {
      result = await setBellEmailAlertsAction(workspaceId, on);
    } catch {
      result = { ok: false, code: "riprova", message: BELL_TEXT.errors.preference };
    }
    if (result.ok) dispatch({ type: "payload", payload: result.payload });
    else toast.error(result.message || BELL_TEXT.errors.preference);
    setEmailOverride(null);
  }

  const model = bellMenuModel(state);
  const count = visibleNewCount(state);
  const badge = bellBadgeText(count);
  const emailChecked = emailOverride ?? model.emailChecked;

  return (
    <DropdownMenu open={state.open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        data-slot="notifications-bell"
        className="relative inline-flex size-11 items-center justify-center rounded-md border outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 sm:size-9"
        aria-label={bellAriaLabel(count)}
      >
        <Bell aria-hidden className="size-4" />
        {badge ? (
          <span
            aria-hidden
            data-slot="notifications-badge"
            className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white"
          >
            {badge}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(24rem,calc(100vw-2rem))] max-h-[70vh] overflow-auto p-2">
        <div className="sticky -top-2 z-10 -mx-2 -mt-2 flex min-h-11 items-center justify-between gap-2 border-b bg-popover px-4 py-1.5 sm:min-h-9">
          <span className="text-xs font-medium text-muted-foreground">{BELL_TEXT.title}</span>
          {model.showReadAll ? (
            <Menu.Item
              closeOnClick={false}
              onClick={() => void onReadAll()}
              className="inline-flex min-h-11 cursor-default items-center rounded-md px-2 text-xs font-medium text-primary outline-hidden select-none data-highlighted:bg-accent sm:min-h-7"
            >
              {BELL_TEXT.readAll}
            </Menu.Item>
          ) : null}
        </div>
        {model.refreshText ? (
          <p role="status" className="px-2 pt-2 text-xs text-muted-foreground">
            {model.refreshText}
          </p>
        ) : null}
        {model.emptyText ? (
          <p className="p-3 text-sm text-muted-foreground">{model.emptyText}</p>
        ) : (
          <div className="mt-1 space-y-1">
            {model.rows.map((row) => {
              const content = (
                <>
                  {row.context ? <span className="truncate text-xs text-muted-foreground">{row.context}</span> : null}
                  <span className="line-clamp-2 text-sm font-medium">{row.title}</span>
                  {row.description ? <span className="line-clamp-2 text-xs text-muted-foreground">{row.description}</span> : null}
                  <span className="text-[10px] text-muted-foreground">
                    {row.when}
                    {row.unread ? <span className="sr-only">{` · ${BELL_TEXT.unreadSr}`}</span> : null}
                  </span>
                </>
              );
              const className = cn(ROW, row.unread && "bg-accent/50");
              return row.href ? (
                <Menu.LinkItem
                  key={row.key}
                  href={row.href}
                  closeOnClick={false}
                  data-unread={row.unread || undefined}
                  className={className}
                  onClick={(event) => onRow(event, row.key)}
                  onAuxClick={(event) => {
                    if (event.button === 1) onRow(event, row.key);
                  }}
                >
                  {content}
                </Menu.LinkItem>
              ) : (
                <Menu.Item key={row.key} closeOnClick={false} data-unread={row.unread || undefined} className={className} onClick={(event) => onRow(event, row.key)}>
                  {content}
                </Menu.Item>
              );
            })}
          </div>
        )}
        {model.showEmailToggle ? (
          <div className="sticky -bottom-2 -mx-2 -mb-2 mt-2 border-t bg-popover px-2 py-1.5">
            <Menu.CheckboxItem
              checked={emailChecked}
              closeOnClick={false}
              onCheckedChange={(checked) => void onEmailAlerts(checked)}
              className="flex min-h-11 w-full cursor-default items-start gap-2 rounded-md px-2 py-2 text-xs outline-hidden select-none data-highlighted:bg-accent sm:min-h-0"
            >
              <span aria-hidden className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border">
                <Menu.CheckboxItemIndicator>
                  <Check className="size-3" />
                </Menu.CheckboxItemIndicator>
              </span>
              <span>{BELL_TEXT.emailAlerts}</span>
            </Menu.CheckboxItem>
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
