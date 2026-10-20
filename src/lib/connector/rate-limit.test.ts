import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CONNECTOR_DEFAULT_LIMITS } from "../db/connector-ddl.ts";
import {
  CLEANUP_RATE_LIMITS_SQL,
  CONNECTOR_DAY_TIME_ZONE,
  CONSUME_RATE_LIMITS_SQL,
  consumeConnectorRateLimit,
  consumeRateLimits,
  consumeRateLimitsParams,
  connectorRateLimitRules,
  connectorToolRateKind,
  isRateLimitTimeZone,
  rateLimitBucket,
  rateLimitKindForMessage,
  rateLimitKindsForBody,
  type RateLimitRule,
  type SqlExecutor,
} from "./rate-limit.ts";

// Prompt WP4 (limite di richieste) e WP10. La logica SQL vera si prova sul database
// locale (`access.integration.test.ts`); qui un esecutore finto con la stessa forma
// di risposta controlla le decisioni.

const limits = { ...CONNECTOR_DEFAULT_LIMITS };

/** Esecutore finto: contatori in memoria, una finestra sola, stessa forma delle righe. */
function fakeDb(opts: { retryAfter?: number; retryAfterByBucket?: Record<string, number>; raceExtra?: number } = {}) {
  const counts = new Map<string, number>();
  const calls: string[] = [];
  const exec: SqlExecutor = async (text, params) => {
    if (text === CLEANUP_RATE_LIMITS_SQL) {
      calls.push("cleanup");
      return [];
    }
    assert.equal(text, CONSUME_RATE_LIMITS_SQL);
    calls.push("consume");
    const req = JSON.parse(String(params[0])) as Array<{ bucket: string; unit: string; lim: number; cost: number; secs: number }>;
    const cur = req.map((r) => ({ ...r, used: counts.get(r.bucket) ?? 0 }));
    const allowed = cur.every((r) => r.used + r.cost <= r.lim);
    return cur.map((r) => {
      let after: number | null = null;
      if (allowed) {
        after = (counts.get(r.bucket) ?? 0) + r.cost + (opts.raceExtra ?? 0);
        counts.set(r.bucket, after);
      }
      const retryAfter = opts.retryAfterByBucket?.[r.bucket] ?? opts.retryAfter ?? 1800;
      return { bucket: r.bucket, lim: r.lim, used: r.used, cost: r.cost, after_count: after, allowed, retry_after: retryAfter };
    });
  };
  return { exec, counts, calls };
}

const never = () => 0.99;

test("secchi: prefisso e parti validate, al massimo 120 caratteri", () => {
  const tokenId = randomUUID();
  assert.equal(rateLimitBucket("conn", tokenId, "submit"), `conn:${tokenId}:submit`);
  assert.equal(rateLimitBucket("team", "ws", tokenId, "create", "day"), `team:ws:${tokenId}:create:day`);
  for (const [prefix, parts] of [
    ["Conn", ["x"]],
    ["conn1", ["x"]],
    ["", ["x"]],
    ["averylongprefix", ["x"]],
    ["conn", []],
    ["conn", ["a:b"]],
    ["conn", ["con spazio"]],
    ["conn", ["x".repeat(65)]],
    ["conn", ["x".repeat(60), "y".repeat(60)]],
  ] as Array<[string, string[]]>) {
    assert.throws(() => rateLimitBucket(prefix, ...parts), Error, `${prefix} ${parts.join("|").slice(0, 20)}`);
  }
});

test("regole del connettore: letture e invii per token, giorno per workspace; fase 2 per persona", () => {
  const workspaceId = randomUUID();
  const tokenId = randomUUID();
  const identityId = randomUUID();
  const phase1 = { workspaceId, tokenId, identityId: null };
  assert.deepEqual(connectorRateLimitRules(phase1, "read", limits), [{ bucket: `conn:${tokenId}:read`, window: "hour", limit: 3000 }]);
  assert.deepEqual(connectorRateLimitRules(phase1, "submit", limits), [
    { bucket: `conn:${tokenId}:submit`, window: "hour", limit: 200 },
    { bucket: `conn:ws:${workspaceId}:submit:day`, window: "day", limit: 1000, timeZone: "Europe/Rome" },
  ]);
  assert.deepEqual(connectorRateLimitRules({ workspaceId, tokenId: null, identityId }, "submit", limits), [
    { bucket: `conn:user:${identityId}:submit`, window: "hour", limit: 10 },
    { bucket: `conn:ws:${workspaceId}:submit:day`, window: "day", limit: 1000, timeZone: "Europe/Rome" },
  ]);
  assert.deepEqual(connectorRateLimitRules(phase1, "read", limits, "team"), [{ bucket: `team:${tokenId}:read`, window: "hour", limit: 3000 }]);
  assert.throws(() => connectorRateLimitRules({ workspaceId, tokenId: null, identityId: null }, "read", limits));
});

test("contano solo i tools/call: initialize, notifiche, tools/list e ping no", () => {
  assert.equal(connectorToolRateKind("submit_contribution"), "submit");
  for (const tool of ["get_intake_guide", "find_similar_contributions", "get_contribution_status", "sconosciuto", ""]) {
    assert.equal(connectorToolRateKind(tool), "read", tool);
  }
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "prova", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "ping" },
    { jsonrpc: "2.0", id: 4, result: {} },
    null,
    "tools/call",
    [{ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "submit_contribution" } }],
  ];
  for (const message of messages) assert.equal(rateLimitKindForMessage(message), null, JSON.stringify(message)?.slice(0, 40));
  assert.equal(rateLimitKindForMessage({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "submit_contribution", arguments: {} } }), "submit");
  assert.equal(rateLimitKindForMessage({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_intake_guide" } }), "read");
  assert.equal(rateLimitKindForMessage({ jsonrpc: "2.0", id: 8, method: "tools/call" }), "read");
  assert.deepEqual(rateLimitKindsForBody(messages[0]), []);
  assert.deepEqual(
    rateLimitKindsForBody([
      messages[1],
      { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "find_similar_contributions" } },
      { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "submit_contribution" } },
    ]),
    ["read", "submit"]
  );
});

test("parametri dello statement: regole valide, senza doppioni", () => {
  const rules: RateLimitRule[] = [
    { bucket: "conn:a:read", window: "hour", limit: 10 },
    { bucket: "team:ws:b:create:day", window: "day", limit: 300, cost: 25 },
    { bucket: "conn:ws:c:submit:day", window: "day", limit: 1000, timeZone: "Europe/Rome" },
  ];
  const params = consumeRateLimitsParams(rules);
  assert.deepEqual(JSON.parse(String(params[0])), [
    { bucket: "conn:a:read", unit: "hour", lim: 10, cost: 1, secs: 3600, tz: "UTC" },
    { bucket: "team:ws:b:create:day", unit: "day", lim: 300, cost: 25, secs: 86400, tz: "UTC" },
    { bucket: "conn:ws:c:submit:day", unit: "day", lim: 1000, cost: 1, secs: 86400, tz: "Europe/Rome" },
  ]);
  // Senza istante: l'orologio del database. Con un istante (solo test): quello.
  assert.equal(params[1], null);
  assert.equal(consumeRateLimitsParams(rules, new Date("2026-10-25T01:30:00.000Z"))[1], "2026-10-25T01:30:00.000Z");
  assert.throws(() => consumeRateLimitsParams(rules, new Date("non una data")));
  for (const bad of [
    [],
    [{ bucket: "conn:a", window: "hour", limit: 1 }, { bucket: "conn:a", window: "day", limit: 1 }],
    [{ bucket: "nessun-prefisso", window: "hour", limit: 1 }],
    [{ bucket: "conn:a", window: "week", limit: 1 }],
    [{ bucket: "conn:a", window: "toString", limit: 1 }],
    [{ bucket: "conn:a", window: "hour", limit: -1 }],
    [{ bucket: "conn:a", window: "hour", limit: 1.5 }],
    [{ bucket: "conn:a", window: "hour", limit: 1, cost: 0 }],
    [{ bucket: `conn:${"x".repeat(120)}`, window: "hour", limit: 1 }],
    [{ bucket: "conn:a", window: "day", limit: 1, timeZone: "Marte/Olimpo" }],
    [{ bucket: "conn:a", window: "day", limit: 1, timeZone: "Europe/Rome'; --" }],
    [{ bucket: "conn:a", window: "day", limit: 1, timeZone: "" }],
  ] as RateLimitRule[][]) {
    assert.throws(() => consumeRateLimitsParams(bad));
  }
});

test("fusi: solo nomi IANA che Node conosce; il giorno del connettore è in ora italiana", () => {
  for (const ok of ["UTC", "Europe/Rome", "America/Argentina/Buenos_Aires", "Etc/GMT+1"]) assert.equal(isRateLimitTimeZone(ok), true, ok);
  for (const bad of ["", "Europe/Roma", "Europe/Rome; DROP TABLE x", "../etc", "Europe//Rome", 7, null, undefined]) {
    assert.equal(isRateLimitTimeZone(bad), false, String(bad));
  }
  assert.equal(CONNECTOR_DAY_TIME_ZONE, "Europe/Rome");
  // Lo statement allinea la finestra al fuso della regola e chiude il giorno alla mezzanotte locale dopo.
  assert.match(CONSUME_RATE_LIMITS_SQL, /date_trunc\(x\.unit, clock\.at, x\.tz\)/);
  assert.match(CONSUME_RATE_LIMITS_SQL, /\(\(req\.window_start AT TIME ZONE req\.tz\) \+ interval '1 day'\) AT TIME ZONE req\.tz/);
  assert.match(CONSUME_RATE_LIMITS_SQL, /coalesce\(\$2::timestamptz, now\(\)\)/);
});

test("decisione: passa finché tutti i secchi hanno spazio; respinto senza consumare; costo per regola", async () => {
  const db = fakeDb({ retryAfter: 1234 });
  const rules: RateLimitRule[] = [
    { bucket: "conn:t:submit", window: "hour", limit: 3 },
    { bucket: "conn:ws:w:submit:day", window: "day", limit: 100 },
  ];
  for (let i = 0; i < 3; i += 1) assert.deepEqual(await consumeRateLimits(db.exec, rules, { random: never }), { ok: true });
  assert.deepEqual(await consumeRateLimits(db.exec, rules, { random: never }), {
    ok: false,
    bucket: "conn:t:submit",
    limit: 3,
    retryAfterSeconds: 1234,
  });
  // La richiesta respinta non ha consumato nemmeno il secchio del giorno.
  assert.equal(db.counts.get("conn:ws:w:submit:day"), 3);

  const team = fakeDb();
  const create = (cost: number): RateLimitRule[] => [{ bucket: "team:ws:w:create:day", window: "day", limit: 30, cost }];
  assert.deepEqual(await consumeRateLimits(team.exec, create(25), { random: never }), { ok: true });
  assert.equal((await consumeRateLimits(team.exec, create(6), { random: never })).ok, false);
  assert.deepEqual(await consumeRateLimits(team.exec, create(5), { random: never }), { ok: true });
  assert.equal(team.counts.get("team:ws:w:create:day"), 30);

  const zero = fakeDb();
  assert.equal((await consumeRateLimits(zero.exec, [{ bucket: "conn:z:read", window: "hour", limit: 0 }], { random: never })).ok, false);
});

test("decisione: chi supera il limite in una corsa si respinge lo stesso", async () => {
  const db = fakeDb({ raceExtra: 1 });
  const rules: RateLimitRule[] = [{ bucket: "conn:t:read", window: "hour", limit: 2 }];
  assert.deepEqual(await consumeRateLimits(db.exec, rules, { random: never }), { ok: true });
  const raced = await consumeRateLimits(db.exec, rules, { random: never });
  assert.equal(raced.ok, false);
});

test("decisione: con più secchi pieni vale quello che si libera per ultimo, anche in una corsa", async () => {
  const rules: RateLimitRule[] = [
    { bucket: "conn:t:submit", window: "hour", limit: 1 },
    { bucket: "conn:ws:w:submit:day", window: "day", limit: 1, timeZone: CONNECTOR_DAY_TIME_ZONE },
  ];
  const retryAfterByBucket = { "conn:t:submit": 600, "conn:ws:w:submit:day": 40_000 };
  const db = fakeDb({ retryAfterByBucket });
  assert.deepEqual(await consumeRateLimits(db.exec, rules, { random: never }), { ok: true });
  // Ora e giorno pieni: alla fine dell'ora il giorno di Roma sarebbe ancora pieno.
  assert.deepEqual(await consumeRateLimits(db.exec, rules, { random: never }), {
    ok: false,
    bucket: "conn:ws:w:submit:day",
    limit: 1,
    retryAfterSeconds: 40_000,
  });
  // Nell'ordine opposto delle attese vale l'ora.
  const later = fakeDb({ retryAfterByBucket: { "conn:t:submit": 3_000, "conn:ws:w:submit:day": 900 } });
  await consumeRateLimits(later.exec, rules, { random: never });
  assert.deepEqual(await consumeRateLimits(later.exec, rules, { random: never }), {
    ok: false,
    bucket: "conn:t:submit",
    limit: 1,
    retryAfterSeconds: 3_000,
  });
  // A pari attesa, il primo nell'ordine delle regole.
  const tie = fakeDb({ retryAfter: 900 });
  await consumeRateLimits(tie.exec, rules, { random: never });
  const tied = await consumeRateLimits(tie.exec, rules, { random: never });
  assert.equal(!tied.ok && tied.bucket, "conn:t:submit");
  // Solo l'ora piena: vale l'ora anche se il giorno finirebbe dopo.
  const hourOnly = fakeDb({ retryAfterByBucket });
  const wide: RateLimitRule[] = [rules[0], { ...rules[1], limit: 100 }];
  await consumeRateLimits(hourOnly.exec, wide, { random: never });
  assert.deepEqual(await consumeRateLimits(hourOnly.exec, wide, { random: never }), {
    ok: false,
    bucket: "conn:t:submit",
    limit: 1,
    retryAfterSeconds: 600,
  });

  // Corsa: la richiesta che porta entrambi i contatori oltre il limite riprova a fine giornata.
  const raced = fakeDb({ retryAfterByBucket, raceExtra: 1 });
  const result = await consumeRateLimits(raced.exec, rules, { random: never });
  assert.deepEqual(result, { ok: false, bucket: "conn:ws:w:submit:day", limit: 1, retryAfterSeconds: 40_000 });
});

test("pulizia: solo dopo una scrittura riuscita, con la probabilità data; un errore non blocca", async () => {
  const db = fakeDb();
  const rules: RateLimitRule[] = [{ bucket: "conn:t:read", window: "hour", limit: 1 }];
  await consumeRateLimits(db.exec, rules, { random: () => 0 });
  assert.deepEqual(db.calls, ["consume", "cleanup"]);
  await consumeRateLimits(db.exec, rules, { random: () => 0 });
  assert.deepEqual(db.calls, ["consume", "cleanup", "consume"], "respinta: niente pulizia");

  const logs: string[] = [];
  const failing = fakeDb();
  const exec: SqlExecutor = async (text, params) => {
    if (text === CLEANUP_RATE_LIMITS_SQL) throw Object.assign(new Error("valore segreto nel messaggio"), { code: "57014" });
    return failing.exec(text, params);
  };
  const result = await consumeRateLimits(exec, [{ bucket: "conn:u:read", window: "hour", limit: 5 }], {
    random: () => 0,
    log: { error: (...args: unknown[]) => logs.push(args.map(String).join(" ")) },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /\[rate-limit\] cleanup_failed/);
  assert.equal(logs[0].includes("segreto"), false);
});

test("connettore: rate_limited con retryAfterSeconds; errore del database → internal_error senza dati", async () => {
  const workspaceId = randomUUID();
  const tokenId = randomUUID();
  const principal = { workspaceId, tokenId, identityId: null };
  const db = fakeDb({ retryAfter: 600 });
  const small = { ...limits, submitsPerHour: 1 };
  assert.deepEqual(await consumeConnectorRateLimit(db.exec, { principal, tool: "submit_contribution", limits: small }, { random: never }), { ok: true });
  const limited = await consumeConnectorRateLimit(db.exec, { principal, tool: "submit_contribution", limits: small }, { random: never });
  assert.equal(limited.ok, false);
  if (!limited.ok) {
    assert.equal(limited.error.error, "rate_limited");
    assert.equal(limited.error.retryAfterSeconds, 600);
    assert.match(limited.error.message, /riprova/);
  }
  // Le letture hanno un secchio loro.
  assert.deepEqual(await consumeConnectorRateLimit(db.exec, { principal, tool: "get_contribution_status", limits: small }, { random: never }), { ok: true });

  // Secchio dell'ora del token e secchio del giorno del workspace pieni insieme:
  // si riprova alla mezzanotte di Roma, non alla fine dell'ora.
  const both = { ...limits, submitsPerHour: 1, submitsPerDayWorkspace: 1 };
  const [hourRule, dayRule] = connectorRateLimitRules(principal, "submit", both);
  const full = fakeDb({ retryAfterByBucket: { [hourRule.bucket]: 600, [dayRule.bucket]: 40_000 } });
  assert.deepEqual(await consumeConnectorRateLimit(full.exec, { principal, tool: "submit_contribution", limits: both }, { random: never }), { ok: true });
  const dayFull = await consumeConnectorRateLimit(full.exec, { principal, tool: "submit_contribution", limits: both }, { random: never });
  assert.equal(!dayFull.ok && dayFull.error.error, "rate_limited");
  assert.equal(!dayFull.ok && dayFull.error.retryAfterSeconds, 40_000);

  const logs: string[] = [];
  const broken: SqlExecutor = async () => {
    throw Object.assign(new Error(`connessione rifiutata per ${tokenId}`), { name: "NeonDbError", code: "08006" });
  };
  const failed = await consumeConnectorRateLimit(broken, { principal, tool: "get_intake_guide", limits }, {
    log: { error: (...args: unknown[]) => logs.push(args.map(String).join(" ")) },
  });
  assert.deepEqual(failed, { ok: false, error: { error: "internal_error", message: "Errore del server: riprova una volta." } });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /\[connector\] rate_limit_failed/);
  assert.equal(logs[0].includes(tokenId), false);
});
