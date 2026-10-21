// Test-only module hooks for the use case hub suites (docs/use-case/PIANO-LAVORI.md H0,
// docs/use-case/DESIGN.md §12.5 «Le suite d'integrazione sotto Node»).
//
// Loaded by scripts/use-case-test/run-db-tests.mjs with `node --import`:
// 1. `server-only` resolves to an empty module, as Next does for server code (the same
//    stub as scripts/learning-test/admin-concurrency.mjs:52). Under plain Node
//    `import "server-only"` fails with ERR_MODULE_NOT_FOUND: the package exists only
//    inside next/dist/compiled, and its default entry throws by design.
// 2. Extensionless `next/…` subpaths (`next/navigation`, `next/headers`…) resolve to
//    their `.js` file, as the bundler does.
// 3. scripts/connettore-test/app-resolve.mjs, unchanged, maps `@/…` and extensionless
//    relative paths under src/ to files.
// Nothing else changes: other package imports and explicit `.ts` paths resolve as usual.
import { existsSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const requireFromApp = createRequire(join(repoRoot, "package.json"));
// The file Next itself serves for `server-only` under the react-server condition: empty.
const emptyModule = join(dirname(requireFromApp.resolve("next/package.json")), "dist/compiled/server-only/empty.js");
if (!existsSync(emptyModule)) throw new Error(`Empty server-only stub not found: ${emptyModule}`);
const emptyModuleUrl = pathToFileURL(emptyModule).href;

// `next/navigation`, `next/headers`, `next/server`, `next/cache`…: Next has no "exports"
// map, so Node's ESM resolver wants the file name (`next/navigation.js`), as the bundler
// does not. Only extensionless subpaths of `next` are retried, and only after a miss.
const NEXT_SUBPATH = /^next\/[a-z0-9-]+(\/[a-z0-9-]+)*$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: emptyModuleUrl, shortCircuit: true };
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND" || !NEXT_SUBPATH.test(specifier)) throw error;
      return nextResolve(`${specifier}.js`, context);
    }
  },
});

await import("../connettore-test/app-resolve.mjs");
