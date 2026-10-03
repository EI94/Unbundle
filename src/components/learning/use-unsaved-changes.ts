"use client";

import { useEffect, useRef } from "react";

type Guard = { dirty: boolean; pending?: boolean; onDiscard?: () => void };
// Only mounted Learning forms register here. No answers or identifiers are stored.
const guards = new Map<object, Guard>();
let allowUnloadUntil = 0;

export function confirmLearningNavigation(): boolean {
  const active = [...guards.values()];
  if (active.some(guard => guard.pending)) {
    window.alert("Operazione in corso. Attendi la conferma prima di lasciare questa pagina.");
    return false;
  }
  const dirty = active.filter(guard => guard.dirty);
  if (!dirty.length) return true;
  if (!window.confirm("Ci sono modifiche non salvate. Premi Annulla per restare e salvarle, oppure OK per scartarle e continuare.")) return false;
  for (const guard of dirty) guard.onDiscard?.();
  // A confirmed ordinary link must not cause a second native unload prompt.
  // The short grace period expires even if navigation fails.
  allowUnloadUntil = Date.now() + 500;
  return true;
}

function beforeUnload(event: BeforeUnloadEvent) {
  if (Date.now() < allowUnloadUntil) return;
  if ([...guards.values()].some(guard => guard.dirty || guard.pending)) {
    event.preventDefault();
    event.returnValue = "";
  }
}
function linkClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!target || target.hasAttribute("download") || (target.target && target.target !== "_self")) return;
  const url = new URL(target.href, window.location.href);
  if (!["http:", "https:"].includes(url.protocol)) return;
  if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
  if (!confirmLearningNavigation()) {
    event.preventDefault();
    event.stopPropagation();
  }
}

export function useLearningUnsavedChanges({ dirty, pending, onDiscard }: Guard) {
  const id = useRef<object>({});
  // Register committed state before the browser can handle a navigation event.
  useEffect(() => {
    const key = id.current;
    guards.set(key, { dirty, pending, onDiscard });
    if (guards.size === 1) {
      document.addEventListener("click", linkClick, true);
      window.addEventListener("beforeunload", beforeUnload);
    }
    return () => {
      guards.delete(key);
      if (guards.size === 0) {
        document.removeEventListener("click", linkClick, true);
        window.removeEventListener("beforeunload", beforeUnload);
        allowUnloadUntil = 0;
      }
    };
  }, [dirty, pending, onDiscard]);
  return { confirmDiscard: confirmLearningNavigation };
}
