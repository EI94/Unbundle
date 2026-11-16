/**
 * Solo per i test delle viste della board: nessun file dell'app lo importa.
 *
 * I componenti delle viste che non hanno stato (`TodayContent`, `MapRows`, `StepDrawerBody`) si chiamano come funzioni:
 * restituiscono l'albero degli elementi React, senza disegnarlo. Qui lo si percorre (i figli e ogni prop che tiene
 * elementi), si trovano i controlli per la loro scritta o il loro `aria-label`, e si chiamano i loro gestori: così un
 * test con Node prova che un clic manda l'operazione giusta, senza un browser.
 */
import { isValidElement, type ReactElement } from "react";

export type AnyElement = ReactElement<Record<string, unknown>>;
type Component = (props: never) => unknown;

/**
 * Tutti gli elementi di un albero, in ordine. `expand`: i componenti senza stato da aprire (chiamati con le loro
 * props), per arrivare ai controlli che disegnano.
 */
export function elements(node: unknown, expand: ReadonlyArray<Component> = []): AnyElement[] {
  const out: AnyElement[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isValidElement(value)) return;
    const element = value as AnyElement;
    out.push(element);
    if (expand.includes(element.type as Component)) {
      visit((element.type as (props: unknown) => unknown)(element.props));
      return;
    }
    for (const prop of Object.values(element.props ?? {})) visit(prop);
  };
  visit(node);
  return out;
}

/** Il testo di un nodo: stringhe e numeri, a ogni profondità dei figli. */
export function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: unknown }).children);
  return "";
}

/** Gli elementi con quella scritta (o quel `aria-label`) e un gestore `onClick`. */
export function clickables(tree: unknown, label: string, expand: ReadonlyArray<Component> = []): AnyElement[] {
  return elements(tree, expand).filter((element) => typeof element.props.onClick === "function" && (textOf(element.props.children).trim() === label || element.props["aria-label"] === label));
}

/** L'unico controllo con quella scritta: lo trova o fallisce. */
export function clickable(tree: unknown, label: string, expand: ReadonlyArray<Component> = []): AnyElement {
  const found = clickables(tree, label, expand);
  if (found.length !== 1) throw new Error(`«${label}»: ${found.length} controlli`);
  return found[0];
}

/** Il clic sull'unico controllo con quella scritta. */
export function press(tree: unknown, label: string, expand: ReadonlyArray<Component> = []): void {
  (clickable(tree, label, expand).props.onClick as () => void)();
}

/** Gli elementi di un tipo (un componente o un tag). */
export function ofType(tree: unknown, type: unknown, expand: ReadonlyArray<Component> = []): AnyElement[] {
  return elements(tree, expand).filter((element) => element.type === type);
}

/** Un registro di chiamate: ogni azione finta scrive il suo nome e i suoi argomenti. */
export function recorder() {
  const calls: Array<[string, ...unknown[]]> = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  return { calls, record, named: (name: string) => calls.filter((call) => call[0] === name).map((call) => call.slice(1)) };
}
