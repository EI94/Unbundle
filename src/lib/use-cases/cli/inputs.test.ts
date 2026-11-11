// Gli ingressi della CLI (rilascio 8.0b): la sintesi di una sessione è solo numeri e riferimenti; il repository ha la
// forma che il database accetta. Un ingresso sbagliato ha un messaggio, mai un errore del database.
import test from "node:test";
import assert from "node:assert/strict";
import { parseBuildSession, parseCaseRepo } from "./inputs.ts";

const NOW = new Date("2026-11-11T12:00:00.000Z");
const session = (over: Record<string, unknown> = {}) => ({
  chiaveSessione: "a".repeat(64),
  compito: "T-3",
  harness: "claude_code",
  modello: "claude-sonnet-4-5",
  tokenIngresso: 120_000,
  tokenUscita: 8_000,
  tokenCache: 400_000,
  durataSecondi: 1800,
  esito: "pr",
  pr: "https://github.com/Prova/repo-di-prova/pull/12",
  ramo: "px-0001/t-3-regole",
  finitaIl: "2026-11-11T11:30:00.000Z",
  ...over,
});

test("una sessione buona passa, con i nomi italiani della CLI tradotti; i campi facoltativi possono mancare", () => {
  const parsed = parseBuildSession(session(), NOW);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value, {
    sessionKey: "a".repeat(64),
    taskRef: "T-3",
    harness: "claude_code",
    model: "claude-sonnet-4-5",
    inputTokens: 120000,
    outputTokens: 8000,
    cacheTokens: 400000,
    costUsd: null,
    durationSeconds: 1800,
    outcome: "pr",
    prUrl: "https://github.com/Prova/repo-di-prova/pull/12",
    branch: "px-0001/t-3-regole",
    endedAt: "2026-11-11T11:30:00.000Z",
  });
  const bare = parseBuildSession({ chiaveSessione: "b".repeat(64), harness: "codex", durataSecondi: 5, esito: "nessuna_modifica", finitaIl: "2026-11-11T11:00:00Z" }, NOW);
  assert.ok(bare.ok && bare.value.inputTokens === 0 && bare.value.taskRef === null && bare.value.prUrl === null);
});

test("una sessione sbagliata ha il suo messaggio: chiave, compito, harness, token, PR, durata, data", () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ chiaveSessione: "id-vero-della-sessione" }, /chiaveSessione/],
    [{ compito: "compito 3" }, /compito/],
    [{ harness: "vim" }, /harness/],
    [{ tokenIngresso: -1 }, /tokenIngresso/],
    [{ tokenUscita: 1.5 }, /tokenUscita/],
    [{ pr: "https://example.test/pull/1" }, /pr:/],
    [{ pr: "https://github.com/Prova/repo/pull/1?x=1" }, /pr:/],
    [{ durataSecondi: 999_999 }, /durataSecondi/],
    [{ esito: "boh" }, /esito/],
    [{ ramo: "ramo con spazi" }, /ramo/],
    [{ finitaIl: "ieri" }, /finitaIl/],
    [{ finitaIl: "2026-11-12T12:00:00.000Z" }, /futuro/],
    [{ costoUsd: -2 }, /costoUsd/],
  ];
  for (const [over, message] of cases) {
    const parsed = parseBuildSession(session(over), NOW);
    assert.equal(parsed.ok, false, JSON.stringify(over));
    if (!parsed.ok) assert.match(parsed.message, message);
  }
});

test("il repository: owner/nome, casi/<id>, un profilo del catalogo, il progetto Vercel", () => {
  assert.deepEqual(parseCaseRepo({ repository: "Prova/repo-di-prova", cartella: "casi/px-0001", profilo: "codice", progettoVercel: "px-0001-agente" }), {
    ok: true,
    value: { repo: "Prova/repo-di-prova", folder: "casi/px-0001", profile: "codice", vercelProject: "px-0001-agente" },
  });
  for (const [over, message] of [
    [{ repository: "solo-nome" }, /repository/],
    [{ repository: "https://github.com/Prova/repo" }, /repository/],
    [{ cartella: "../fuori" }, /cartella/],
    [{ cartella: "casi/PX-0001" }, /cartella/],
    [{ profilo: "zapier" }, /profilo/],
    [{ progettoVercel: "Con Spazi" }, /progettoVercel/],
  ] as const) {
    const parsed = parseCaseRepo(Object.assign({ repository: "Prova/repo-di-prova", cartella: "casi/px-0001" }, over as Record<string, unknown>));
    assert.equal(parsed.ok, false, JSON.stringify(over));
    if (!parsed.ok) assert.match(parsed.message, message);
  }
});
