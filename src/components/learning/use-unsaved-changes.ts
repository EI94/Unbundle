"use client";

import { useEffect, useRef } from "react";
import { createLearningLeaveGuard, type LearningGuard } from "@/lib/learning/leave-guard";

// Only mounted Learning forms register here. No answers or identifiers are stored.
// The in-app dialog that answers is `LearningLeaveDialog`, mounted by `LearningSessionBoundary`.
export const learningLeave = createLearningLeaveGuard();

/**
 * Before an in-app step that would drop unsaved edits (refresh, another section, sign-out): true when nothing would be
 * lost and the caller goes ahead now. Otherwise the in-app dialog opens and the call returns false; after the
 * confirmation the edits are discarded and `proceed` runs the step. Without `proceed` the dialog only discards and the
 * person repeats the step, which then passes once (also when the session boundary still holds hidden edits).
 */
export function confirmLearningNavigation(proceed?: () => void): boolean {
  return learningLeave.request(proceed ? "continue" : "discard", proceed ?? learningLeave.passNext);
}

/** «Scarta modifiche»: asks in the dialog, then discards. */
export function confirmLearningDiscard(): boolean {
  return learningLeave.request("discard");
}

function beforeUnload(event: BeforeUnloadEvent) {
  if (!learningLeave.blocksUnload()) return;
  event.preventDefault();
  event.returnValue = "";
}

/**
 * After «Esci senza salvare»: the same link again once the dialog has closed (the grace period lets it through, so a
 * Next link keeps its own navigation); a link no longer on the page opens its address.
 */
function follow(anchor: HTMLAnchorElement, href: string) {
  window.setTimeout(() => {
    if (anchor.isConnected) anchor.click();
    else window.location.assign(href);
  }, 0);
}

function linkClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!target || target.hasAttribute("download") || (target.target && target.target !== "_self")) return;
  const url = new URL(target.href, window.location.href);
  if (!["http:", "https:"].includes(url.protocol)) return;
  if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
  if (!learningLeave.request("leave", () => follow(target, url.href))) {
    event.preventDefault();
    event.stopPropagation();
  }
}

export function useLearningUnsavedChanges({ dirty, pending, onDiscard }: LearningGuard) {
  const id = useRef<object>({});
  // Register committed state before the browser can handle a navigation event.
  useEffect(() => {
    const key = id.current;
    learningLeave.register(key, { dirty, pending, onDiscard });
    if (learningLeave.size() === 1) {
      document.addEventListener("click", linkClick, true);
      window.addEventListener("beforeunload", beforeUnload);
    }
    return () => {
      learningLeave.unregister(key);
      if (learningLeave.size() === 0) {
        document.removeEventListener("click", linkClick, true);
        window.removeEventListener("beforeunload", beforeUnload);
      }
    };
  }, [dirty, pending, onDiscard]);
  return { confirmDiscard: confirmLearningDiscard };
}
