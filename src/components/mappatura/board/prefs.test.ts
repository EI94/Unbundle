import test from "node:test";
import assert from "node:assert/strict";
import { ASSISTANT_KEY, createBoardPrefs, resolveTab, tabFromHash, type PrefsEnv } from "./prefs.ts";

/** La chiave con cui fino al rilascio 10 si ricordava la scheda di un'unità sul dispositivo: non si legge più. */
const OLD_TAB_KEY = (departmentId: string) => `unbundle-mapping-tab:${departmentId}`;

// Quello che la board ricorda sul dispositivo e nell'indirizzo (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.5, P4, P5):
// la scheda per unità, con l'ancora che vince; il pannello dell'assistente; niente sul server.

function fakeEnv(hash = "") {
  const store = new Map<string, string>();
  const listeners = new Set<() => void>();
  const replaced: string[] = [];
  const env: PrefsEnv & { hashValue: string; store: Map<string, string>; replaced: string[]; fireHashChange(next: string): void; listeners: Set<() => void> } = {
    hashValue: hash,
    store,
    replaced,
    listeners,
    hash: () => env.hashValue,
    read: (key) => store.get(key) ?? null,
    write: (key, value) => void store.set(key, value),
    replaceHash(next) {
      replaced.push(next);
      env.hashValue = `#${next}`;
    },
    onHashChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    fireHashChange(next) {
      env.hashValue = next;
      for (const listener of [...listeners]) listener();
    },
  };
  return env;
}

test("la scheda da aprire: l'ancora, poi il default (P4, P5); nessuna scheda ricordata (rilascio 10)", () => {
  assert.equal(tabFromHash("#classificazione"), "classificazione");
  assert.equal(tabFromHash("oggi"), "oggi");
  assert.equal(tabFromHash("#altro"), null);
  assert.equal(tabFromHash(null), null);
  assert.equal(resolveTab("#oggi", "classificazione"), "oggi");
  assert.equal(resolveTab("", "oggi"), "oggi");
  assert.equal(resolveTab("#x", "oggi"), "oggi");
  // Una scheda ricordata da prima del rilascio 10 non conta più: lo stesso link apre la stessa scheda a tutti.
  const env = fakeEnv();
  env.store.set(OLD_TAB_KEY("u1"), "classificazione");
  assert.equal(createBoardPrefs(env).tab("u1", "oggi"), "oggi");
});

test("scegliere una scheda la scrive nell'ancora, senza una voce in più nella cronologia, e niente sul dispositivo", () => {
  const env = fakeEnv();
  const prefs = createBoardPrefs(env);
  const seen: string[] = [];
  const off = prefs.subscribe(() => seen.push(prefs.tab("u1", "oggi")));
  assert.equal(prefs.tab("u1", "oggi"), "oggi");
  prefs.selectTab("u1", "classificazione");
  assert.equal(env.store.has(OLD_TAB_KEY("u1")), false, "niente sul dispositivo");
  assert.deepEqual(env.replaced, ["classificazione"]);
  assert.deepEqual(seen, ["classificazione"], "chi legge la scheda lo sa subito");
  // Senza ancora, ogni unità apre la prima scheda.
  env.hashValue = "";
  assert.equal(prefs.tab("u2", "oggi"), "oggi");
  assert.equal(prefs.tab("u1", "oggi"), "oggi");
  // Chi cambia l'ancora (il toast «Apri» dopo il completamento) è seguito.
  env.fireHashChange("#oggi");
  assert.equal(seen.at(-1), "oggi");
  // La stessa ancora non si riscrive.
  prefs.selectTab("u1", "oggi");
  assert.deepEqual(env.replaced, ["classificazione"]);
  off();
  assert.equal(env.listeners.size, 0, "staccato, nessuno ascolta più l'ancora");
});

test("il pannello dell'assistente: nessuna scelta, aperto, chiuso; una preferenza sola per tutte le unità", () => {
  const env = fakeEnv();
  const prefs = createBoardPrefs(env);
  let calls = 0;
  prefs.subscribe(() => calls++);
  assert.equal(prefs.assistant(), null);
  prefs.setAssistant(true);
  assert.equal(env.store.get(ASSISTANT_KEY), "1");
  assert.equal(prefs.assistant(), true);
  prefs.setAssistant(false);
  assert.equal(prefs.assistant(), false);
  assert.equal(calls, 2);
});

test("sul server (senza ambiente) valgono i default e niente si scrive", () => {
  const prefs = createBoardPrefs(null);
  assert.equal(prefs.tab("u1", "classificazione"), "classificazione");
  prefs.selectTab("u1", "oggi");
  prefs.setAssistant(true);
  assert.equal(prefs.assistant(), null);
  const off = prefs.subscribe(() => assert.fail("nessun evento"));
  off();
});
