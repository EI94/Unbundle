"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  decodeIdList,
  decodeLast,
  encodeIdList,
  encodeLast,
  parseReferentHash,
  referentHash,
  storageKey,
  type LastPosition,
  type ReferentRoute,
} from "@/lib/uc/views/referente-plan";

/**
 * Pezzi del browser per la pagina del referente (DESIGN §4.1, §4.4, §4.7):
 * l'hash del passo (il tasto indietro torna alla domanda di prima), la
 * larghezza del telefono, il movimento ridotto, la tastiera aperta e le
 * memorie del dispositivo (`uc-skip:`, `uc-last:`, `uc-intro:`). Ogni accesso a
 * `localStorage` sta dentro try/catch: con la memoria bloccata la pagina
 * funziona lo stesso, solo senza ricordare.
 */

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** Il passo dall'hash. Sul server, e prima dell'idratazione, è sempre la Home. */
export function useHashRoute(): [ReferentRoute, (route: ReferentRoute, opts?: { replace?: boolean }) => void] {
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => "",
  );
  const route = parseReferentHash(hash);
  const go = useCallback((next: ReferentRoute, opts: { replace?: boolean } = {}) => {
    const target = referentHash(next);
    if (opts.replace) {
      const url = `${window.location.pathname}${window.location.search}${target}`;
      window.history.replaceState(window.history.state, "", url);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } else if (window.location.hash !== target) {
      window.location.hash = target;
    }
  }, []);
  return [route, go];
}

function mediaStore(query: string) {
  return {
    subscribe(onChange: () => void) {
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    get: () => window.matchMedia(query).matches,
  };
}

const NARROW = mediaStore("(max-width: 767px)");
const REDUCED = mediaStore("(prefers-reduced-motion: reduce)");
const PHONE = mediaStore("(max-width: 639px)");

/** Sotto i 768 px (DESIGN §4.4 punto 3). */
export function useNarrow(): boolean {
  return useSyncExternalStore(NARROW.subscribe, NARROW.get, () => false);
}

/** Sotto i 640 px: la barra delle azioni sta fissa in basso. */
export function usePhone(): boolean {
  return useSyncExternalStore(PHONE.subscribe, PHONE.get, () => false);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(REDUCED.subscribe, REDUCED.get, () => false);
}

/**
 * La tastiera del telefono è aperta (`visualViewport` molto più basso della
 * finestra): la barra fissa torna nel flusso e non copre il campo (DESIGN §4.7).
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setOpen(window.innerHeight - vv.height > 150);
    vv.addEventListener("resize", update);
    update();
    return () => vv.removeEventListener("resize", update);
  }, []);
  return open;
}

// ── Memorie del dispositivo ───────────────────────────────────────────

/** Copia in memoria: vale per la visita anche con `localStorage` bloccato. */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    if (value !== null) return value;
  } catch {
    // Memoria bloccata (navigazione privata, dati del sito cancellati).
  }
  return memory.get(key) ?? null;
}

function write(key: string, value: string): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Memoria piena o bloccata: resta la copia in memoria per questa visita.
  }
  for (const l of listeners) l();
}

function subscribeMemory(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Il testo salvato sotto `key`; sul server e prima dell'idratazione, niente. */
function useStored(key: string): string | null {
  return useSyncExternalStore(
    subscribeMemory,
    () => read(key),
    () => null,
  );
}

export interface DeviceMemory {
  skipped: ReadonlySet<string>;
  introSeen: ReadonlySet<string>;
  last: LastPosition | null;
  skip: (itemId: string) => void;
  unskip: (itemIds: readonly string[]) => void;
  seeIntro: (topic: string) => void;
  remember: (last: LastPosition) => void;
}

/**
 * «Rispondi dopo» (`uc-skip:`), l'ultima posizione (`uc-last:`) e gli argomenti
 * di cui si è già visto l'inizio (`uc-intro:`), con il prefisso del link. Mai
 * scritti sul server: «Rispondi dopo» non conta come fatta.
 */
export function useDeviceMemory(token: string): DeviceMemory {
  const skipKey = storageKey("skip", token);
  const introKey = storageKey("intro", token);
  const lastKey = storageKey("last", token);
  const skippedText = useStored(skipKey);
  const introText = useStored(introKey);
  const lastText = useStored(lastKey);
  const skipped = useMemo<ReadonlySet<string>>(() => new Set(decodeIdList(skippedText, "item")), [skippedText]);
  const introSeen = useMemo<ReadonlySet<string>>(() => new Set(decodeIdList(introText, "topic")), [introText]);
  const last = useMemo(() => decodeLast(lastText), [lastText]);
  const skip = useCallback(
    (itemId: string) => {
      const current = decodeIdList(read(skipKey), "item");
      if (!current.includes(itemId)) write(skipKey, encodeIdList([...current, itemId]));
    },
    [skipKey],
  );
  const unskip = useCallback(
    (itemIds: readonly string[]) => {
      const current = decodeIdList(read(skipKey), "item");
      if (current.some((id) => itemIds.includes(id))) write(skipKey, encodeIdList(current.filter((id) => !itemIds.includes(id))));
    },
    [skipKey],
  );
  const seeIntro = useCallback(
    (topic: string) => {
      const current = decodeIdList(read(introKey), "topic");
      if (!current.includes(topic)) write(introKey, encodeIdList([...current, topic]));
    },
    [introKey],
  );
  const remember = useCallback(
    (position: LastPosition) => {
      const current = decodeLast(read(lastKey));
      if (!current || current.topic !== position.topic || current.n !== position.n) write(lastKey, encodeLast(position));
    },
    [lastKey],
  );
  return { skipped, introSeen, last, skip, unskip, seeIntro, remember };
}
