import test from "node:test";
import assert from "node:assert/strict";
import { installAppModules, recordLogs } from "../ai/claude-test-kit.ts";

// La sonda della 0038 (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §2.5, §3.4.1): `contextStoreState` dice tre cose
// diverse, e chi filtra per visibilità le tratta in modo diverso. `assente` (la sonda risponde falso) vuol dire che
// nessun documento è «Solo Lateral Space»; `sconosciuto` (la sonda non risponde) vuol dire che non si sa, e chi filtra
// chiude. Se un errore diventasse `assente`, i documenti interni arriverebbero al cliente. Il modulo è quello vero; il
// database e il self-heal sono finti.

type Probe = { ensure: () => Promise<void>; execute: () => Promise<unknown> };
const probe: Probe = { ensure: async () => undefined, execute: async () => ({ rows: [] }) };
(globalThis as { __probe?: Probe }).__probe = probe;

await installAppModules({
  "@/lib/db": `export const db = { execute: async () => globalThis.__probe.execute() };`,
  "@/lib/db/ensure-schema": `export async function ensureDbSchema() { return globalThis.__probe.ensure(); }`,
});

/** Il modulo nuovo, con il suo stato da capo (lo stato `pronto` resta per processo). */
async function freshStore(tag: string) {
  return (await import(`../db/queries/context-store.ts?sonda=${tag}`)) as typeof import("../db/queries/context-store.ts");
}

const answers = (ready: unknown) => async () => ({ rows: [{ ready }] });

test("la sonda risponde falso: assente, e contextStoreReady è falso", async () => {
  probe.ensure = async () => undefined;
  probe.execute = answers(false);
  const store = await freshStore("assente");
  assert.equal(await store.contextStoreState(), "assente");
  assert.equal(await store.contextStoreReady(), false);
});

test("la sonda non risponde (errore del database o del self-heal): sconosciuto, mai assente; nel log solo il codice", async (t) => {
  const lines = recordLogs(t);
  probe.ensure = async () => undefined;
  probe.execute = async () => {
    throw new Error("connessione rifiutata da 10.0.0.1 per mario@esempio.test");
  };
  const store = await freshStore("errore-db");
  assert.equal(await store.contextStoreState(), "sconosciuto");
  assert.equal(await store.contextStoreReady(), false);
  probe.ensure = async () => {
    throw new Error("self-heal fermo a freddo");
  };
  probe.execute = answers(true);
  const cold = await freshStore("errore-self-heal");
  assert.equal(await cold.contextStoreState(), "sconosciuto", "senza il self-heal la sonda non si legge");
  assert.ok(lines.length >= 2);
  for (const line of lines) {
    assert.match(line, /^\[context\/store\] sonda_non_riuscita /);
    assert.equal(/mario@esempio|10\.0\.0\.1|self-heal fermo/.test(line), false, "nel log nessun testo dell'errore");
  }
});

test("la sonda risponde sì: pronto, e resta pronto nel processo anche se dopo non risponde", async () => {
  probe.ensure = async () => undefined;
  probe.execute = answers(true);
  const store = await freshStore("pronto");
  assert.equal(await store.contextStoreState(), "pronto");
  assert.equal(await store.contextStoreReady(), true);
  probe.execute = async () => {
    throw new Error("non dovrebbe servire");
  };
  assert.equal(await store.contextStoreState(), "pronto");
});
