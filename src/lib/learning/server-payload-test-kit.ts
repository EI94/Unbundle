/**
 * Solo per i test (rilascio 10, ondata 7b): quello che Next scrive nella pagina per il browser (il «payload» dei
 * componenti server), senza Next. I componenti server si eseguono; di un componente client restano tutte le props, anche
 * quelle che il componente non mostra: è lì che un dato riservato a un ruolo finisce nella pagina di un altro, senza
 * che nessuno lo veda a schermo. Un componente è server se viene da un modulo `.tsx` dell'app senza `"use client"`;
 * tutto il resto (i moduli `"use client"`, le librerie come `next/link`) resta con le sue props, come nel payload vero.
 * `trackAppComponents()` va chiamato prima di importare la pagina. Non lo importa nessun file dell'applicazione.
 */
import * as nodeModule from "node:module";

type LoadResult = { format?: string; source?: string | Uint8Array | ArrayBuffer | null; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { load?(url: string, context: object, nextLoad: (url: string, context: object) => LoadResult): LoadResult }): void;
};

const serverComponents = new Set<unknown>();
const state = globalThis as { __serverPayloadKit?: (namespace: Record<string, unknown>) => void };
const USE_CLIENT = /^\s*(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*["']use client["']/;

/**
 * Una volta per processo, dopo `enableTsxImports()` e prima di importare la pagina: segna i componenti server, cioè le
 * funzioni esportate dai moduli `.tsx` dell'app senza `"use client"`.
 */
export function trackAppComponents(): void {
  if (state.__serverPayloadKit) return;
  state.__serverPayloadKit = (namespace) => {
    for (const value of Object.values(namespace)) if (typeof value === "function") serverComponents.add(value);
  };
  registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (!url.startsWith("file:") || !url.endsWith(".tsx") || url.includes("/node_modules/") || result.source == null) return result;
      const source = typeof result.source === "string" ? result.source : new TextDecoder().decode(result.source);
      if (USE_CLIENT.test(source)) return result;
      // A fine modulo ogni export ha il suo valore: il modulo importa sé stesso e consegna le sue funzioni.
      return { ...result, source: `${source}\nimport * as __serverPayloadModule from ${JSON.stringify(url)};\nglobalThis.__serverPayloadKit?.(__serverPayloadModule);\n` };
    },
  });
}

/** Quanti componenti server sono stati segnati: zero vuol dire che `trackAppComponents()` è arrivato tardi. */
export function trackedServerComponents(): number {
  return serverComponents.size;
}

const ELEMENTS = new Set([Symbol.for("react.transitional.element"), Symbol.for("react.element")]);

type Element = { $$typeof: symbol; type: unknown; props?: Record<string, unknown> };

function isElement(value: unknown): value is Element {
  return typeof value === "object" && value !== null && ELEMENTS.has((value as { $$typeof?: symbol }).$$typeof as symbol);
}

function typeName(type: unknown): string {
  if (typeof type === "string") return type;
  if (typeof type === "function") return type.name || "componente";
  if (typeof type === "symbol") return type.description ?? "simbolo";
  return (type as { displayName?: string } | null)?.displayName ?? "componente";
}

async function walk(node: unknown): Promise<unknown> {
  if (node === null || node === undefined) return null;
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") return node;
  if (typeof node === "bigint") return String(node);
  // Un'azione del server passa come riferimento; un gestore di eventi non passa: nessun dato in tutti e due i casi.
  if (typeof node === "function") return "[funzione]";
  if (Array.isArray(node)) return Promise.all(node.map(walk));
  if (node instanceof Date) return node.toISOString();
  if (isElement(node)) {
    const props = node.props ?? {};
    if (typeof node.type === "function" && serverComponents.has(node.type)) return walk(await (node.type as (p: unknown) => unknown)(props));
    return { type: typeName(node.type), props: await walk(props) };
  }
  if (typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) out[key] = await walk(value);
    return out;
  }
  return null;
}

/** Il payload di quello che rende la pagina, in JSON: i componenti server eseguiti, gli altri con tutte le loro props. */
export async function serverPayload(node: unknown): Promise<string> {
  return JSON.stringify(await walk(node));
}
