/**
 * Solo per i test di unità dei componenti (`*.test.ts` sotto `src/components/use-cases/`): sotto
 * Node puro i `.tsx` e gli alias `@/…` non si caricano. Qui si registrano gli stessi hook delle suite
 * d'integrazione (`scripts/use-case-test/test-hooks.mjs`: `server-only`, `next/…`, `@/…`) e la
 * traduzione dei `.tsx` con TypeScript, così un test importa le funzioni pure di un componente.
 * Non lo importa nessun file dell'applicazione.
 */
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { fileURLToPath } from "node:url";

type LoadResult = { format?: string; source?: string | Uint8Array; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { load?(url: string, context: object, nextLoad: (url: string, context: object) => LoadResult): LoadResult }): void;
};

const state = globalThis as { __useCaseTsxLoader?: Promise<void> };

/** Una volta per processo: dopo, `await import("…/componente.tsx")` funziona. */
export function enableTsxImports(): Promise<void> {
  state.__useCaseTsxLoader ??= (async () => {
    await import(new URL("../../../../../scripts/use-case-test/test-hooks.mjs", import.meta.url).href);
    const { default: ts } = await import("typescript");
    registerHooks({
      load(url, context, nextLoad) {
        if (!url.startsWith("file:") || !url.endsWith(".tsx")) return nextLoad(url, context);
        const file = fileURLToPath(url);
        const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
          fileName: file,
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
        });
        return { format: "module", source: outputText, shortCircuit: true };
      },
    });
  })();
  return state.__useCaseTsxLoader;
}
