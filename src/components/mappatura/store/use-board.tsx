"use client";

/**
 * «Mappatura board»: la board nel browser, per React (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.7).
 *
 * `BoardProvider` crea lo store di `board-client.ts` una volta per unità, con fetch, orologio, timer e memoria del
 * browser, e lo collega alla pagina (`connectBrowser`): rimette la bozza del dispositivo sopra la board dopo il primo
 * disegno, salva subito quando la pagina si nasconde o si chiude (`keepalive` se il corpo ci sta), rilegge la board
 * quando la pagina torna visibile senza niente da salvare, sa se il browser è in linea. Nessun timer rilegge la board.
 *
 * `useBoard(select)` legge lo stato con `useSyncExternalStore`: `select` riceve lo stato intero e può restituire
 * qualsiasi cosa (si ricalcola a ogni cambio). `useBoardClient()` dà lo store, per `dispatch`, «Salva ora», `pull`.
 *
 * Il toast della board ha un posto solo alla volta: in fondo alla pagina, oppure dentro il drawer aperto più in alto
 * (un drawer è modale: fuori da lui niente si raggiunge, e «Annulla» deve restare a portata). Lo decide la pila dei
 * posti (`toastHosts`).
 */
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type JSX, type ReactNode } from "react";
import type { MappingBoard } from "../../../lib/mappatura/board-model.ts";
import { createBoardClient, type BoardClient, type BoardClientDeps, type BoardClientState } from "./board-client.ts";
import { onSignOut } from "./drafts.ts";

// ─── Il posto del toast ──────────────────────────────────────────────

/** Il posto del toast in fondo alla pagina: vale quando nessun drawer ne ha preso uno. */
export const PAGE_TOAST_HOST = "pagina";

export interface ToastHosts {
  subscribe(listener: () => void): () => void;
  /** Il posto che mostra il toast adesso. */
  current(): string;
  /** Un drawer aperto prende il posto finché non chiama la funzione che riceve. */
  claim(host: string): () => void;
}

export function createToastHosts(): ToastHosts {
  let stack: string[] = [];
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    current: () => stack[stack.length - 1] ?? PAGE_TOAST_HOST,
    claim(host) {
      stack = [...stack.filter((item) => item !== host), host];
      emit();
      return () => {
        if (!stack.includes(host)) return;
        stack = stack.filter((item) => item !== host);
        emit();
      };
    },
  };
}

// ─── Il collegamento con la pagina ───────────────────────────────────

type Listened = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * Collega lo store alla pagina e restituisce la funzione che lo stacca. Alla partenza la bozza del dispositivo torna
 * sopra la board; la pagina che si nasconde (`visibilitychange`) o si chiude (`pagehide`) salva subito, anche le
 * eliminazioni che aspettano il loro toast, con `keepalive` quando il corpo sta sotto i 60 KB e con una richiesta
 * normale altrimenti (`saveNow({ hidden })`): sul telefono una pagina in secondo piano può essere fermata senza
 * `pagehide`, e la bozza resta finché il server non risponde. La pagina che torna visibile, senza niente da salvare,
 * rilegge la board; il browser che torna in linea riprova il salvataggio non riuscito; la persona che esce dall'app
 * (`signOutBoards`) manda quello che resta e la board lascia la sua bozza. Staccarlo (la pagina lascia la board, l'app
 * resta aperta) salva quello che resta con una richiesta normale.
 */
export function connectBrowser(
  client: Pick<BoardClient, "start" | "setOnline" | "saveNow" | "pull" | "getState" | "signOut">,
  win: Listened & { navigator: { onLine?: boolean } },
  doc: Listened & { visibilityState: DocumentVisibilityState },
): () => void {
  const flush = (hidden: boolean) => {
    if (client.getState().pending > 0) void client.saveNow(hidden ? { hidden: true } : undefined);
  };
  const closing = () => flush(true);
  const online = () => client.setOnline(win.navigator.onLine !== false);
  const visibility = () => {
    if (doc.visibilityState === "hidden") flush(true);
    else if (client.getState().pending === 0) void client.pull();
  };
  client.start();
  online();
  win.addEventListener("online", online);
  win.addEventListener("offline", online);
  win.addEventListener("pagehide", closing);
  doc.addEventListener("visibilitychange", visibility);
  const stopLeaving = onSignOut(() => client.signOut());
  return () => {
    win.removeEventListener("online", online);
    win.removeEventListener("offline", online);
    win.removeEventListener("pagehide", closing);
    doc.removeEventListener("visibilitychange", visibility);
    stopLeaving();
    // La pagina lascia la board ma resta viva (un'altra pagina dell'app): una richiesta normale.
    flush(false);
  };
}

/** Fetch, memoria, orologio, timer e id del browser. Sul server (il primo disegno) niente memoria. */
export function browserDeps(): Omit<BoardClientDeps, "workspaceId" | "departmentId" | "userId" | "initial"> {
  let storage: BoardClientDeps["storage"] = null;
  try {
    storage = typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // La memoria del dispositivo è spenta: la board funziona senza bozza.
    storage = null;
  }
  return {
    fetch: (input, init) => fetch(input, init),
    storage,
    now: () => Date.now(),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    newId: () => crypto.randomUUID(),
  };
}

// ─── React ───────────────────────────────────────────────────────────

interface BoardContextValue {
  client: BoardClient;
  hosts: ToastHosts;
}

const BoardContext = createContext<BoardContextValue | null>(null);

/** `userId`: chi ha la board aperta; la bozza sul dispositivo è sua. */
export function BoardProvider(props: { workspaceId: string; departmentId: string; userId: string; initial: MappingBoard; children: ReactNode }): JSX.Element {
  const { workspaceId, departmentId, userId, initial, children } = props;
  const [value] = useState<BoardContextValue>(() => ({
    client: createBoardClient({ ...browserDeps(), workspaceId, departmentId, userId, initial }),
    hosts: createToastHosts(),
  }));
  const client = value.client;
  useEffect(() => connectBrowser(client, window, document), [client]);
  // Una board più nuova dalla pagina (un aggiornamento del server) diventa la base; una più vecchia no (`replace`).
  const shown = useRef(initial);
  useEffect(() => {
    if (shown.current === initial) return;
    shown.current = initial;
    client.replace(initial, { linked: true });
  }, [client, initial]);
  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}

/** Lo store della board: `dispatch`, «Salva ora», `pull`, `replace`, `notify`. Solo dentro `BoardProvider`. */
export function useBoardClient(): BoardClient {
  const value = useContext(BoardContext);
  if (!value) throw new Error("useBoardClient: manca BoardProvider");
  return value.client;
}

/** Una parte dello stato della board; si ricalcola a ogni cambio. Solo dentro `BoardProvider`. */
export function useBoard<T>(select: (state: BoardClientState) => T): T {
  const client = useBoardClient();
  return select(useSyncExternalStore(client.subscribe, client.getState, client.getState));
}

const noSubscription = () => () => {};
const noState = () => null;
const pageHost = () => PAGE_TOAST_HOST;

/** Lo stato della board, o null fuori da `BoardProvider` (una vetrina statica, un test). */
export function useOptionalBoardState(): BoardClientState | null {
  const value = useContext(BoardContext);
  return useSyncExternalStore(value ? value.client.subscribe : noSubscription, value ? value.client.getState : noState, value ? value.client.getState : noState);
}

/** Lo store della board, o null fuori da `BoardProvider`. */
export function useOptionalBoardClient(): BoardClient | null {
  return useContext(BoardContext)?.client ?? null;
}

/** Il posto del toast adesso (`PAGE_TOAST_HOST` fuori da `BoardProvider`). */
export function useToastHost(): string {
  const hosts = useContext(BoardContext)?.hosts ?? null;
  return useSyncExternalStore(hosts ? hosts.subscribe : noSubscription, hosts ? hosts.current : pageHost, pageHost);
}

/** Un drawer aperto prende il posto del toast; chiuso, lo lascia. */
export function useClaimToastHost(host: string, active: boolean): void {
  const hosts = useContext(BoardContext)?.hosts ?? null;
  useEffect(() => (hosts && active ? hosts.claim(host) : undefined), [hosts, host, active]);
}
