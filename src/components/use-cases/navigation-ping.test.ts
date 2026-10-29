import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Il clic su una card della Panoramica (il pannello `?apri=`) e i ritorni alla Panoramica intera
// restavano fermi nella build di produzione: la risposta RSC arrivava intera, ma React non
// confermava mai il rendering. Il React di Next 16.2.3 perdeva un «ping» arrivato mentre rendeva (un
// pezzo del flusso RSC risolto durante una pausa del rendering, con lo stato «in attesa con
// ritardo»): `pingSuspendedRoot` non ricominciava da capo (si è nel rendering) e non contava il ping,
// così le corsie restavano sospese per sempre (React #37805). La correzione di React (#36134) conta
// il ping in `workInProgressRootPingedLanes`; con Next 16.2.3 la portava patches/next+16.2.3.patch,
// da Next 16.3 c'è nel React che Next porta con sé e la patch non serve più. Qui si controlla che
// nessuna patch di Next sia rimasta, che `next` ed `eslint-config-next` siano fissati alla stessa
// versione, e che le quattro build di react-dom installate contino il ping.
//
// Per i prossimi aggiornamenti di Next: React #38035 (aperto) dice che dal React di Next 16.4
// `markRootSuspended` comincia con `suspendedLanes = getEntangledLanes(root, suspendedLanes);`, che
// può cancellare un ping in attesa. Il caso noto sono Cache Components e il prefetch parziale, che
// qui non ci sono; a ogni salto di versione va rifatta la prova delle navigazioni della Panoramica
// sulla build di produzione.
const ROOT = new URL("../../../", import.meta.url);
const FILES = ["react-dom-client.production.js", "react-dom-client.development.js", "react-dom-profiling.profiling.js", "react-dom-profiling.development.js"];

/** Il corpo di una funzione della build (dalla firma alla graffa che la chiude). */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} non c'è`);
  let depth = 0;
  for (let at = source.indexOf("{", start); at < source.length; at++) {
    if (source[at] === "{") depth++;
    else if (source[at] === "}" && --depth === 0) return source.slice(start, at + 1);
  }
  throw new Error(`${name} non si chiude`);
}

test("nessuna patch di Next: `next` ed `eslint-config-next` fissati alla stessa versione, patch-package resta per le altre", () => {
  const pkg = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    scripts: Record<string, string>;
  };
  const patches = readdirSync(new URL("patches/", ROOT));
  assert.deepEqual(patches.filter((file) => /^next\+.*\.patch$/.test(file)), [], "la correzione del ping è nel React di Next: nessuna patch");
  assert.match(pkg.dependencies.next, /^\d+\.\d+\.\d+$/, "`next` fissato a una versione esatta");
  assert.equal(pkg.devDependencies["eslint-config-next"], pkg.dependencies.next, "`eslint-config-next` alla stessa versione di `next`");
  assert.equal(pkg.scripts.postinstall, "patch-package", "patch-package applica le altre patch (Slack) a ogni installazione");
});

test("il ping arrivato durante il rendering si conta, in ogni build di react-dom di Next installata", () => {
  const pkg = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8")) as { dependencies: Record<string, string> };
  const nextPackage = createRequire(new URL("package.json", ROOT)).resolve("next/package.json");
  assert.equal((JSON.parse(readFileSync(nextPackage, "utf8")) as { version: string }).version, pkg.dependencies.next, "il Next installato è quello fissato");
  for (const file of FILES) {
    const path = join(dirname(nextPackage), "dist/compiled/react-dom/cjs", file);
    assert.ok(existsSync(path), file);
    const ping = functionBody(readFileSync(path, "utf8"), "pingSuspendedRoot");
    // Fuori dal rendering si ricomincia da capo; durante il rendering il ping si conta, non si perde.
    assert.match(ping, /\?\s*prepareFreshStack\(root, 0\)\s*:\s*\(workInProgressRootPingedLanes \|= pingedLanes\)/, file);
    assert.doesNotMatch(ping, /&&\s*prepareFreshStack\(root, 0\)/, `${file}: la forma che perde il ping`);
  }
});
