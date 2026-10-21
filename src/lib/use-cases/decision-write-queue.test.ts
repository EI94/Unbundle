import test from "node:test";
import assert from "node:assert/strict";
import { createDecisionWriteQueue, type VersionedResult } from "./decision-ui.ts";

// La coda delle scritture delle decisioni (docs/use-case/DESIGN.md §6.4, §6.8; PIANO-LAVORI
// H3b): il servizio finto qui sotto accetta una scrittura solo con la versione attuale, come
// `prepare` di `service.ts`.

const UC = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000bb";

/** Uno use case alla versione `version`: ogni scrittura riuscita la alza di uno. */
function fakeService(version: number) {
  const state = { version, sent: [] as number[] };
  const write = (delayMs = 0) => async (expected: number): Promise<VersionedResult & { error?: string }> => {
    state.sent.push(expected);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (expected !== state.version) return { ok: false, error: "versione_superata" };
    state.version += 1;
    return { ok: true, version: state.version };
  };
  return { state, write };
}

test("nota all'uscita dal campo e poi subito «Quando»: la seconda scrittura aspetta e porta la versione nuova", async () => {
  const queue = createDecisionWriteQueue();
  const service = fakeService(3);
  // Tutte e due partono dalla pagina letta alla versione 3.
  const note = queue.send(UC, 3, service.write(20));
  const when = queue.send(UC, 3, service.write());
  assert.deepEqual(await note, { ok: true, version: 4 });
  assert.deepEqual(await when, { ok: true, version: 5 }, "senza la coda: versione_superata");
  assert.deepEqual(service.state.sent, [3, 4]);
  assert.equal(queue.versionFor(UC, 3), 5);
  // La pagina riletta (versione 5) e la coda dicono la stessa cosa.
  assert.equal(queue.versionFor(UC, 5), 5);
});

test("una modifica di un'altra persona resta una versione superata", async () => {
  const queue = createDecisionWriteQueue();
  const service = fakeService(3);
  assert.equal((await queue.send(UC, 3, service.write())).ok, true);
  // Qualcun altro scrive: 4 → 5. La pagina non lo sa ancora.
  service.state.version += 1;
  const stale = await queue.send(UC, 3, service.write());
  assert.deepEqual(stale, { ok: false, error: "versione_superata" });
  assert.deepEqual(service.state.sent, [3, 4], "la versione della propria scrittura, non una più nuova");
  // Dopo `router.refresh()` la pagina porta la versione 5: si riparte da lì.
  assert.equal(queue.versionFor(UC, 5), 5);
});

test("un'altra persona scrive tra la propria scrittura e la rilettura: la versione riletta non passa alla scrittura dopo", async () => {
  const queue = createDecisionWriteQueue();
  const service = fakeService(5);
  // Come `commitWrite` di `service.ts`: la scrittura alza la versione (5 → 6), poi un'altra
  // persona cambia «Quando» (6 → 7) prima della rilettura, e la risposta porta 7.
  const rereadAfterOther = async (expected: number): Promise<VersionedResult & { error?: string }> => {
    const result = await service.write()(expected);
    if (result.ok) service.state.version += 1;
    return result.ok ? { ok: true, version: service.state.version } : result;
  };
  const note = queue.send(UC, 5, rereadAfterOther);
  const when = queue.send(UC, 5, service.write());
  assert.deepEqual(await note, { ok: true, version: 7 });
  assert.equal(queue.versionFor(UC, 5), 6, "la versione della propria scrittura, non quella riletta");
  assert.deepEqual(await when, { ok: false, error: "versione_superata" }, "la modifica dell'altra persona non si sovrascrive");
  assert.deepEqual(service.state.sent, [5, 6]);
  // Una scrittura che non cambia niente lascia la versione com'era.
  const same = createDecisionWriteQueue();
  assert.deepEqual(await same.send(OTHER, 9, async () => ({ ok: true as const, version: 9 })), { ok: true, version: 9 });
  assert.equal(same.versionFor(OTHER, 9), 9);
});

test("una scrittura rifiutata non cambia la versione; un errore di rete non ferma la coda", async () => {
  const queue = createDecisionWriteQueue();
  const service = fakeService(7);
  const failed = queue.send(UC, 7, async () => ({ ok: false as const }));
  const thrown = queue.send(UC, 7, async () => {
    throw new Error("rete");
  });
  const next = queue.send(UC, 7, service.write());
  assert.deepEqual(await failed, { ok: false });
  await assert.rejects(thrown, /rete/);
  assert.deepEqual(await next, { ok: true, version: 8 });
});

test("le versioni si tengono per use case: un'altra scheda parte dalla sua pagina", async () => {
  const queue = createDecisionWriteQueue();
  const first = fakeService(10);
  const second = fakeService(2);
  await queue.send(UC, 10, first.write());
  assert.deepEqual(await queue.send(OTHER, 2, second.write()), { ok: true, version: 3 });
  assert.deepEqual(second.state.sent, [2]);
  assert.equal(queue.versionFor(UC.toUpperCase(), 10), 11, "id in maiuscolo: lo stesso use case");
  // Una pagina più nuova di quanto ha scritto la coda vince.
  assert.equal(queue.versionFor(UC, 14), 14);
});
