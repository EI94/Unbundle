/**
 * «Mappatura board»: quello che la board ricorda sul dispositivo e nell'indirizzo (docs/mappatura/MAPPATURA-BOARD-PIANO.md
 * §1.3, §1.5, P4, P5).
 *
 * - La scheda aperta: ricordata per unità (`localStorage`), e scritta nell'ancora dell'indirizzo (`#oggi`,
 *   `#classificazione`) senza una voce in più nella cronologia. L'ancora vince sulla scheda ricordata (P5): un link
 *   della campanella apre «Classificazione», e chi cambia l'ancora (il toast «Apri» dopo il completamento) la segue.
 * - Il pannello dell'assistente aperto o chiuso: una preferenza sola per tutte le unità.
 * - Se la finestra è larga abbastanza per tenere l'assistente accanto alla board (1280 px).
 *
 * I componenti leggono tutto con `useSyncExternalStore`: sul server (e al primo disegno) valgono i default, poi il
 * valore del browser. Niente stato copiato in un effetto. Il browser sta dietro `PrefsEnv`, così i test usano un
 * ambiente finto.
 */
import { BOARD_TABS, type BoardTab } from "../../../lib/mappatura/text.ts";

/** La scheda ricordata di un'unità. */
export const tabKey = (departmentId: string) => `unbundle-mapping-tab:${departmentId}`;
/** Il pannello dell'assistente: «1» aperto, «0» chiuso. */
export const ASSISTANT_KEY = "unbundle-mapping-assistant";
/** Da quanto è larga la finestra l'assistente sta accanto alla board, invece che sopra (§1.5). */
export const WIDE_QUERY = "(min-width: 1280px)";

/** La scheda che un'ancora nomina, o null. */
export function tabFromHash(hash: string | null | undefined): BoardTab | null {
  const id = (hash ?? "").replace(/^#/, "");
  return (BOARD_TABS as readonly string[]).includes(id) ? (id as BoardTab) : null;
}

/** La scheda da aprire: quella dell'ancora, poi quella ricordata, poi il default (P4, P5). */
export function resolveTab(hash: string, remembered: string | null, fallback: BoardTab): BoardTab {
  return tabFromHash(hash) ?? tabFromHash(remembered) ?? fallback;
}

export interface PrefsEnv {
  hash(): string;
  read(key: string): string | null;
  write(key: string, value: string): void;
  /** L'ancora nuova, senza una voce in più nella cronologia. */
  replaceHash(hash: string): void;
  onHashChange(listener: () => void): () => void;
}

export interface BoardPrefs {
  subscribe(listener: () => void): () => void;
  tab(departmentId: string, fallback: BoardTab): BoardTab;
  selectTab(departmentId: string, tab: BoardTab): void;
  /** La preferenza del pannello dell'assistente; null se nessuno l'ha mai scelta su questo dispositivo. */
  assistant(): boolean | null;
  setAssistant(open: boolean): void;
}

/** Le preferenze della board su un ambiente; senza ambiente (il server) valgono i default e niente si scrive. */
export function createBoardPrefs(env: PrefsEnv | null): BoardPrefs {
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      const off = env?.onHashChange(listener);
      return () => {
        listeners.delete(listener);
        off?.();
      };
    },
    tab: (departmentId, fallback) => (env ? resolveTab(env.hash(), env.read(tabKey(departmentId)), fallback) : fallback),
    selectTab(departmentId, tab) {
      if (!env) return;
      env.write(tabKey(departmentId), tab);
      if (tabFromHash(env.hash()) !== tab) env.replaceHash(tab);
      emit();
    },
    assistant() {
      const value = env?.read(ASSISTANT_KEY) ?? null;
      return value === "1" ? true : value === "0" ? false : null;
    },
    setAssistant(open) {
      if (!env) return;
      env.write(ASSISTANT_KEY, open ? "1" : "0");
      emit();
    },
  };
}

/** Il browser: l'ancora, `localStorage` (spento o pieno non rompe niente), la cronologia senza voci in più. */
export function browserPrefsEnv(): PrefsEnv | null {
  if (typeof window === "undefined") return null;
  let storage: Pick<Storage, "getItem" | "setItem"> | null = null;
  try {
    storage = window.localStorage;
  } catch {
    // La memoria del dispositivo è spenta: la board ricorda solo l'ancora.
    storage = null;
  }
  return {
    hash: () => window.location.hash,
    read(key) {
      try {
        return storage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    write(key, value) {
      try {
        storage?.setItem(key, value);
      } catch {
        // Memoria piena o spenta: la scelta vale per questa visita.
      }
    },
    // `null` come fa la guida di Next: il router copia il suo stato nella voce e tiene l'indirizzo nuovo.
    replaceHash: (hash) => window.history.replaceState(null, "", `#${hash}`),
    onHashChange(listener) {
      window.addEventListener("hashchange", listener);
      return () => window.removeEventListener("hashchange", listener);
    },
  };
}

/** Le preferenze della pagina: una per finestra (sul server, quelle senza ambiente). */
let shared: BoardPrefs | null = null;
export function boardPrefs(): BoardPrefs {
  if (typeof window === "undefined") return createBoardPrefs(null);
  shared ??= createBoardPrefs(browserPrefsEnv());
  return shared;
}

/** La finestra è larga abbastanza per l'assistente accanto alla board. Sul server sì: il foglio decide il primo disegno. */
export function subscribeWide(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
export const wideNow = (): boolean => (typeof window === "undefined" || typeof window.matchMedia !== "function" ? true : window.matchMedia(WIDE_QUERY).matches);
export const wideOnServer = (): boolean => true;
