"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Issue } from "@/lib/uc/answers/issues";
import type { ReferentItemView } from "@/lib/uc/public-view";
import {
  AUTOSAVE_DEBOUNCE_MS,
  decodeDeviceDraft,
  deviceDraftKey,
  draftBody,
  draftHardBlock,
  encodeDeviceDraft,
  isRetryableStatus,
  retryDelayMs,
  type ReferentForm,
  type SaveState,
} from "@/lib/uc/views/referente-form";
import { putDraft } from "./api";

/**
 * Salvataggio automatico delle bozze del referente (PIANO §5.4, DESIGN §4.2):
 * ogni risposta, «È così», correzione, «Non lo so» e «Non si applica» resta in
 * bozza finché non parte con l'invio dell'argomento.
 *
 * - 2 secondi dopo l'ultima modifica, `PUT …/items/[itemId]/draft`; subito con
 *   «Avanti» o un tocco su una scelta (`flush`);
 * - se la rete manca o il server non risponde, nuovi tentativi con attesa
 *   crescente (2, 4, 8… fino a 30 secondi) e di nuovo appena si torna online;
 * - sul dispositivo (`localStorage`) una copia della bozza finché il server non
 *   l'ha salvata, **mai per le voci personali** e mai con dati sanitari o
 *   preferenze discriminatorie (che non partono nemmeno verso il server);
 * - quando la pagina va in secondo piano o si chiude, salvataggio immediato.
 *
 * Il server ricontrolla tutto: un rifiuto (per esempio la domanda non è più nel
 * link) ferma i tentativi e arriva alla pagina con `onBlocked`.
 */

export interface AutosaveBlock {
  code: string;
  message: string;
  issues: Issue[];
}

export interface AutosaveOptions {
  token: string;
  /** Falso in sola lettura, prima dell'informativa o nell'anteprima. */
  enabled: boolean;
  /** Bozza rifiutata (o di nuovo a posto, con `null`). */
  onBlocked: (itemId: string, block: AutosaveBlock | null) => void;
  /** Il link non vale più: la pagina mostra la scheda generica. */
  onInvalidLink: () => void;
  /** Bozza salvata sul server (la pagina annuncia «Salvato» solo la prima volta). */
  onSaved?: (itemId: string) => void;
}

export interface AutosaveTarget {
  item: ReferentItemView;
  form: ReferentForm;
  fileIds: readonly string[];
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function useAutosave({ token, enabled, onBlocked, onInvalidLink, onSaved }: AutosaveOptions) {
  const [states, setStates] = useState<Record<string, SaveState>>({});
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine !== false,
    () => true,
  );
  const pending = useRef(new Map<string, string>());
  const lastSaved = useRef(new Map<string, string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inflight = useRef(new Set<string>());
  const attempts = useRef(new Map<string, number>());
  const callbacks = useRef({ onBlocked, onInvalidLink, onSaved });
  useEffect(() => {
    callbacks.current = { onBlocked, onInvalidLink, onSaved };
  }, [onBlocked, onInvalidLink, onSaved]);

  const setState = useCallback((itemId: string, state: SaveState) => {
    setStates((s) => (s[itemId] === state ? s : { ...s, [itemId]: state }));
  }, []);

  const clearTimer = useCallback((itemId: string) => {
    const t = timers.current.get(itemId);
    if (t) clearTimeout(t);
    timers.current.delete(itemId);
  }, []);

  const removeDevice = useCallback(
    (itemId: string) => {
      try {
        storage()?.removeItem(deviceDraftKey(token, itemId));
      } catch {
        // Spazio bloccato: la copia sul dispositivo è solo una rete di sicurezza.
      }
    },
    [token],
  );

  const writeDevice = useCallback(
    (item: ReferentItemView, form: ReferentForm) => {
      const text = encodeDeviceDraft(item, form, new Date());
      if (!text) return;
      try {
        storage()?.setItem(deviceDraftKey(token, item.id), text);
      } catch {
        // Spazio pieno o bloccato: resta il salvataggio sul server.
      }
    },
    [token],
  );

  const saveRef = useRef<(itemId: string, keepalive?: boolean) => Promise<void>>(async () => undefined);

  const save = useCallback(
    async (itemId: string, keepalive = false) => {
      const body = pending.current.get(itemId);
      if (body === undefined || inflight.current.has(itemId)) return;
      clearTimer(itemId);
      inflight.current.add(itemId);
      setState(itemId, "saving");
      const res = await putDraft<{ saved: true }>(token, itemId, JSON.parse(body), keepalive);
      inflight.current.delete(itemId);
      const latest = pending.current.get(itemId);
      if (res.ok) lastSaved.current.set(itemId, body);
      if (latest !== undefined && latest !== body) {
        // Cambiata durante il salvataggio: si salva di nuovo la versione nuova.
        timers.current.set(itemId, setTimeout(() => void saveRef.current(itemId), AUTOSAVE_DEBOUNCE_MS));
        setState(itemId, "pending");
        return;
      }
      if (res.ok) {
        pending.current.delete(itemId);
        attempts.current.delete(itemId);
        removeDevice(itemId);
        setState(itemId, "saved");
        callbacks.current.onBlocked(itemId, null);
        callbacks.current.onSaved?.(itemId);
        return;
      }
      if (res.code === "link_non_valido") {
        pending.current.clear();
        callbacks.current.onInvalidLink();
        return;
      }
      if (isRetryableStatus(res.status)) {
        const attempt = attempts.current.get(itemId) ?? 0;
        attempts.current.set(itemId, attempt + 1);
        const offline = res.status === 0 && typeof navigator !== "undefined" && navigator.onLine === false;
        setState(itemId, offline ? "offline" : "error");
        timers.current.set(itemId, setTimeout(() => void saveRef.current(itemId), retryDelayMs(attempt)));
        return;
      }
      // Rifiuto del server (testo bloccato, domanda cambiata…): niente nuovi tentativi finché non cambia.
      pending.current.delete(itemId);
      attempts.current.delete(itemId);
      removeDevice(itemId);
      setState(itemId, "blocked");
      callbacks.current.onBlocked(itemId, { code: res.code, message: res.message, issues: res.issues });
    },
    [clearTimer, removeDevice, setState, token],
  );
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  /** Dopo una modifica: copia sul dispositivo e salvataggio tra 2 secondi. */
  const schedule = useCallback(
    ({ item, form, fileIds }: AutosaveTarget) => {
      if (!enabled || !item.can.draft) return;
      const body = draftBody(item, form, fileIds);
      const block = draftHardBlock(item, body);
      clearTimer(item.id);
      if (block) {
        pending.current.delete(item.id);
        removeDevice(item.id);
        setState(item.id, "blocked");
        callbacks.current.onBlocked(item.id, { code: block.code, message: block.message, issues: [block] });
        return;
      }
      const serialized = JSON.stringify(body);
      if (serialized === lastSaved.current.get(item.id) && !inflight.current.has(item.id)) {
        pending.current.delete(item.id);
        removeDevice(item.id);
        setState(item.id, "saved");
        callbacks.current.onBlocked(item.id, null);
        return;
      }
      pending.current.set(item.id, serialized);
      writeDevice(item, form);
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      setState(item.id, offline ? "offline" : "pending");
      callbacks.current.onBlocked(item.id, null);
      timers.current.set(item.id, setTimeout(() => void saveRef.current(item.id), AUTOSAVE_DEBOUNCE_MS));
    },
    [clearTimer, enabled, removeDevice, setState, writeDevice],
  );

  /** La risposta è partita (o la voce è uscita dal link): niente più bozza da salvare. */
  const forget = useCallback(
    (itemId: string) => {
      clearTimer(itemId);
      pending.current.delete(itemId);
      attempts.current.delete(itemId);
      lastSaved.current.delete(itemId);
      removeDevice(itemId);
      setStates((s) => {
        if (!(itemId in s)) return s;
        const next = { ...s };
        delete next[itemId];
        return next;
      });
    },
    [clearTimer, removeDevice],
  );

  /** Salva subito tutto quello che aspetta (pagina in secondo piano, chiusura). */
  const flushAll = useCallback((keepalive: boolean) => {
    for (const itemId of [...pending.current.keys()]) void saveRef.current(itemId, keepalive);
  }, []);

  /** Salva subito la bozza di una domanda («Avanti», «È così», un tocco su una scelta). */
  const flush = useCallback((itemId: string) => {
    if (pending.current.has(itemId)) void saveRef.current(itemId);
  }, []);

  /** Bozza rimasta sul dispositivo (non arrivata al server l'ultima volta). */
  const readDevice = useCallback(
    (item: ReferentItemView): ReferentForm | null => {
      if (!item.can.draft) return null;
      try {
        return decodeDeviceDraft(item, storage()?.getItem(deviceDraftKey(token, item.id)) ?? null, new Date());
      } catch {
        return null;
      }
    },
    [token],
  );

  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushAll(true);
    };
    const onPageHide = () => flushAll(true);
    const onOnline = () => {
      for (const itemId of [...pending.current.keys()]) {
        attempts.current.delete(itemId);
        void saveRef.current(itemId);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
    const pendingTimers = timers.current;
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
      for (const t of pendingTimers.values()) clearTimeout(t);
    };
  }, [enabled, flushAll]);

  return { states, online, schedule, forget, flush, flushAll, readDevice };
}
