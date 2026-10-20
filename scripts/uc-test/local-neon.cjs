// Test transport only (Casi d'uso harness, PIANO §9.2). The production Neon/Drizzle
// SQL and result parsers still run; this preload executes each Neon HTTP request
// with `pg` against the isolated local database and nothing else:
// uc_test@127.0.0.1:55449/unbundle_uc_test, port included. The optional
// UC_TEST_PG_PORT / UC_TEST_PG_DB overrides (see config.mjs) pin another loopback
// test cluster instead; user, host and passwordless trust auth never change.
/* eslint-disable @typescript-eslint/no-require-imports -- Node --require preloads execute as CommonJS before Next starts. */
const { createRequire } = require("node:module");
const path = require("node:path");
const requireFromApp = createRequire(path.join(process.cwd(), "package.json"));
const { Pool } = requireFromApp("pg");

const databaseUrl = process.env.UC_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("UC_TEST_DATABASE_URL is required");
const url = new URL(databaseUrl);
const expectedPort = process.env.UC_TEST_PG_PORT?.trim() || "55449";
const expectedDb = process.env.UC_TEST_PG_DB?.trim() || "unbundle_uc_test";
if (
  url.protocol !== "postgresql:" ||
  url.hostname !== "127.0.0.1" ||
  url.port !== expectedPort ||
  url.username !== "uc_test" ||
  url.password !== "" ||
  url.pathname !== `/${expectedDb}`
) {
  throw new Error("Local uc test adapter refuses a non-test database");
}
const pool = new Pool({ connectionString: databaseUrl, max: 40, allowExitOnIdle: true });

function wrapFetch(delegate) {
  return async function localNeonFetch(input, init) {
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const connection = headers.get("Neon-Connection-String");
    if (!connection) return delegate(input, init);
    if (connection !== databaseUrl) throw new Error("Local uc test adapter rejected another database");
    const body = JSON.parse(init?.body || (await input.text()));
    const client = await pool.connect();
    const run = async (query) => {
      const result = await client.query({
        text: query.query,
        values: query.params,
        rowMode: "array",
        types: { getTypeParser: () => (value) => value },
      });
      const row = Array.isArray(result) ? result[result.length - 1] : result;
      return {
        command: row.command,
        rowCount: row.rowCount,
        rows: row.rows,
        fields: (row.fields ?? []).map((field) => ({ name: field.name, dataTypeID: field.dataTypeID })),
      };
    };
    try {
      let result;
      if (body.queries) {
        await client.query("BEGIN");
        result = { results: [] };
        for (const query of body.queries) result.results.push(await run(query));
        await client.query("COMMIT");
      } else {
        result = await run(body);
      }
      return Response.json(result);
    } catch (error) {
      if (body.queries) await client.query("ROLLBACK").catch(() => {});
      return Response.json(
        { message: error.message, code: error.code, severity: error.severity, detail: error.detail, constraint: error.constraint },
        { status: 400 },
      );
    } finally {
      client.release();
    }
  };
}

// Next installs its own fetch wrapper during startup and HMR: keep the local
// transport around each replacement, preserving other fetches.
let activeFetch = wrapFetch(globalThis.fetch);
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  get: () => activeFetch,
  set: (nextFetch) => {
    activeFetch = wrapFetch(nextFetch);
  },
});
