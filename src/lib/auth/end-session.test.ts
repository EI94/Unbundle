import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DRAFT_PREFIX, draftKey, onSignOut } from "../../components/mappatura/store/drafts.ts";
import { SESSION_URL, endAppSession } from "./end-session.ts";

// La fine della sessione dell'app (end-session.ts), la stessa da ogni strada: le board aperte mandano quello che resta
// finché la sessione c'è, poi nessuna bozza della board resta sul dispositivo, poi la sessione finisce. Nessuna strada
// chiude la sessione da sola: «Esci» e «Cambia account» passano di qui.

function deviceStorage(entries: Record<string, string>) {
  const stored = new Map(Object.entries(entries));
  return {
    stored,
    storage: {
      get length() {
        return stored.size;
      },
      key: (index: number) => [...stored.keys()][index] ?? null,
      removeItem: (key: string) => void stored.delete(key),
    },
  };
}

const UNIT = "d1d1d1d1-0000-4000-8000-000000000001";

test("prima le board aperte, poi via le bozze di tutti, poi la sessione; le altre memorie restano", async () => {
  const device = deviceStorage({
    [draftKey("persona-1", UNIT)]: "{}",
    [draftKey("persona-2", UNIT)]: "{}",
    "unbundle-mapping-assistant": "1",
  });
  const order: string[] = [];
  const stop = onSignOut(async () => {
    order.push(`board (bozze sul dispositivo: ${[...device.stored.keys()].filter((key) => key.startsWith(DRAFT_PREFIX)).length})`);
  });
  try {
    await endAppSession({
      storage: device.storage,
      fetch: async (input, init) => {
        order.push(`${init.method} ${input} (bozze sul dispositivo: ${[...device.stored.keys()].filter((key) => key.startsWith(DRAFT_PREFIX)).length})`);
      },
    });
  } finally {
    stop();
  }
  assert.deepEqual(order, ["board (bozze sul dispositivo: 2)", `DELETE ${SESSION_URL} (bozze sul dispositivo: 0)`]);
  assert.deepEqual([...device.stored.keys()], ["unbundle-mapping-assistant"]);
});

test("se la sessione non si chiude (la rete), le bozze sono già tolte e l'errore arriva a chi chiama", async () => {
  const device = deviceStorage({ [draftKey("persona-1", UNIT)]: "{}" });
  await assert.rejects(
    endAppSession({
      storage: device.storage,
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    }),
    TypeError,
  );
  assert.equal(device.stored.size, 0);
  // Senza memoria del dispositivo la sessione si chiude lo stesso.
  const calls: string[] = [];
  await endAppSession({ storage: null, fetch: async (input, init) => void calls.push(`${init.method} ${input}`) });
  assert.deepEqual(calls, [`DELETE ${SESSION_URL}`]);
});

const SRC = fileURLToPath(new URL("../..", import.meta.url));
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

test("ogni strada che chiude la sessione passa da endAppSession: «Esci» e «Cambia account», nessun DELETE da solo", () => {
  const closing = sources(SRC)
    .filter((path) => {
      const text = readFileSync(path, "utf8");
      return /["'`]\/api\/auth\/session["'`]/.test(text) && /method:\s*["']DELETE["']/.test(text);
    })
    .map((path) => relative(SRC, path));
  assert.deepEqual(closing, ["lib/auth/end-session.ts"], "solo end-session.ts chiude la sessione");
  const users = sources(SRC)
    .filter((path) => /\bendAppSession\(\)/.test(readFileSync(path, "utf8")))
    .map((path) => relative(SRC, path))
    .sort();
  assert.deepEqual(users, ["components/dashboard/app-sidebar.tsx", "components/workspace/switch-account-button.tsx"]);
});
