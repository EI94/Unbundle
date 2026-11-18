import { toast } from "sonner";
import { UI10_TEXT } from "./text";

/**
 * Gli avvisi brevi (rilascio 10, docs/ui-10/PROPOSTA-10.md §5.4): un motore solo, `sonner`, con la regione «Avvisi»
 * del `Toaster` di `src/app/layout.tsx`. Quattro secondi; con «Annulla» dieci, per chi deve fare in tempo a toccarlo.
 * Mai per un errore che chiede di fare qualcosa: quello sta nella pagina, vicino a dove si agisce.
 */
export const TOAST_MS = 4_000;
export const TOAST_UNDO_MS = 10_000;

export interface ToastOptions {
  duration: number;
  action?: { label: string; onClick: () => void };
}

/** Le opzioni di un avviso: con `undo`, «Annulla» e dieci secondi. */
export function toastOptions(undo?: (() => void) | null): ToastOptions {
  return undo ? { duration: TOAST_UNDO_MS, action: { label: UI10_TEXT.toast.undo, onClick: undo } } : { duration: TOAST_MS };
}

/** Un avviso che conferma ciò che è appena successo («SAL del 18 novembre 2026 chiuso.»). */
export function notifyDone(message: string): void {
  toast.success(message, toastOptions());
}

/** Un avviso con «Annulla» per dieci secondi. */
export function notifyWithUndo(message: string, undo: () => void): void {
  toast(message, toastOptions(undo));
}
