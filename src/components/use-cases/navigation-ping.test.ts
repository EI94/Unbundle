import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Il clic su una card della Panoramica (il pannello `?apri=`) e i ritorni alla Panoramica intera
// restavano fermi nella build di produzione: la risposta RSC arrivava intera, ma React non
// confermava mai il rendering. Il React di Next 16.2.3 perde un «ping» che arriva mentre rende (un
// pezzo del flusso RSC risolto durante una pausa del rendering, con lo stato «in attesa con
// ritardo»): le corsie restavano sospese per sempre. patches/next+16.2.3.patch porta la correzione
// di React che c'è da Next 16.4 (il ping si conta in `workInProgressRootPingedLanes`), applicata da
// patch-package a ogni `npm install`. Qui si controlla che la patch ci sia e valga per la versione di
// Next installata: con un'altra versione va tolta o rifatta.
const PATCH = new URL("../../../patches/next+16.2.3.patch", import.meta.url);
const FILES = ["react-dom-client.production.js", "react-dom-client.development.js", "react-dom-profiling.profiling.js", "react-dom-profiling.development.js"];

test("la correzione del ping di React per le navigazioni della Panoramica: per Next 16.2.3, in ogni build di react-dom", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string>; scripts: Record<string, string> };
  assert.equal(pkg.dependencies.next, "16.2.3", "la patch è per Next 16.2.3: con un'altra versione va tolta o rifatta");
  assert.equal(pkg.scripts.postinstall, "patch-package", "patch-package la applica a ogni installazione");
  const patch = readFileSync(PATCH, "utf8");
  const files = [...patch.matchAll(/^diff --git a\/node_modules\/next\/dist\/compiled\/react-dom\/cjs\/(\S+) /gm)].map((match) => match[1]);
  assert.deepEqual(files.sort(), [...FILES].sort(), "solo il ramo stabile di react-dom, le quattro build");
  // Ogni file cambia solo il ramo del ping durante il rendering: niente `prepareFreshStack`, il ping si conta.
  for (const file of FILES) {
    const start = patch.indexOf(`diff --git a/node_modules/next/dist/compiled/react-dom/cjs/${file} `);
    const end = patch.indexOf("\ndiff --git", start + 1);
    const body = patch.slice(start, end < 0 ? undefined : end);
    const added = body.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
    const removed = body.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---"));
    assert.ok(added.some((line) => line.includes(": (workInProgressRootPingedLanes |= pingedLanes)")), file);
    assert.ok(added.some((line) => line.includes("? prepareFreshStack(root, 0)")), file);
    assert.ok(removed.every((line) => line.includes("prepareFreshStack(root, 0)") || line.includes("executionContext")), file);
  }
});
