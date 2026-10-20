// Test-only module resolution for the connector suites (docs/connettore/README.md).
//
// The app imports `@/…` aliases and extensionless relative paths that Next resolves
// and plain Node does not. Registered with `node --import`, this hook maps them to
// the files under src/ so that integration tests and schema checks can run the real
// app modules (queries, self-heal, REST handler, the connector route) against the local
// test database. Package subpaths without an `exports` map that Next resolves on its own
// (`next/server`) get a second try with `.js`. `server-only` has no package in
// node_modules: Next resolves it to an empty module in its server build, and so does this
// hook (the K6 suite loads `uc-nav.ts`, which guards itself with it). Everything else
// resolves as usual.
import { createRequire, registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const srcRoot = join(repoRoot, "src");
const CANDIDATES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
// The file Next itself serves for `server-only` on the server: empty. A file URL (not a
// data: URL) also works for CommonJS `require`, and matches scripts/use-case-test/test-hooks.mjs.
const requireFromApp = createRequire(join(repoRoot, "package.json"));
const EMPTY_MODULE = pathToFileURL(join(dirname(requireFromApp.resolve("next/package.json")), "dist/compiled/server-only/empty.js")).href;

function findFile(base) {
  for (const suffix of CANDIDATES) {
    const path = `${base}${suffix}`;
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: EMPTY_MODULE, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const file = findFile(join(srcRoot, specifier.slice(2)));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    const relative = specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");
    if (relative && context.parentURL?.startsWith("file:")) {
      const parent = fileURLToPath(context.parentURL);
      if (parent.startsWith(srcRoot)) {
        const file = findFile(resolve(dirname(parent), specifier));
        if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
      }
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      // `next/server` and similar: CommonJS subpath files that ESM does not complete with `.js`.
      const bareSubpath = /^(@[^/]+\/)?[^./@][^/]*\/[^.]+$/.test(specifier);
      if (bareSubpath && error?.code === "ERR_MODULE_NOT_FOUND") return nextResolve(`${specifier}.js`, context);
      throw error;
    }
  },
});
