// Shared constants for the Casi d'uso isolated harness (PIANO §9.2).
// Ports are reserved for this harness: 55439, 59099, 53100 and 53102 belong to the
// Learning harness and must not be touched.
//
// Optional overrides (defaults unchanged) let another suite use its own disposable
// cluster, e.g. the Claude connector (docs/connettore/README.md) or the use case hub
// (ports 55479, 59119, 53120, 53122):
//   UC_TEST_PG_PORT     PostgreSQL port on 127.0.0.1 (default 55449)
//   UC_TEST_PG_DB       database name (default unbundle_uc_test)
//   UC_TEST_AUTH_PORT   Firebase Auth emulator port (default 59109)
//   UC_TEST_APP_PORT    Next app port (default 53110)
//   UC_TEST_LOGIN_PORT  synthetic login helper port (default 53112)
// The user (uc_test), host (127.0.0.1) and trust auth never change.
//
// Known gap: with UC_TEST_PG_PORT/UC_TEST_PG_DB set, db-init.mjs, seed-fixtures.mjs and
// the hub's scripts/use-case-test/*.mjs reach the other cluster, but the app does not.
// start-app.mjs builds the Next environment from a closed list without these two
// variables, so the preload local-neon.cjs falls back to 55449/unbundle_uc_test and
// refuses the app's DATABASE_URL at startup. Until start-app.mjs (owned by C0,
// PIANO-LAVORI §4) forwards them, the Next app, and so the login helper and the
// screenshots, run only on the default Casi d'uso cluster.

/** Ports of the Learning harness: an override may never point at them. */
const LEARNING_PORTS = new Set([55439, 59099, 53100, 53102, 53103]);

/** A port from the environment variable `name`, or `fallback` when it is unset. */
function portFromEnv(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1024 || port > 65535) throw new Error(`${name} must be a port between 1024 and 65535`);
  if (LEARNING_PORTS.has(port)) throw new Error(`${name}=${port} belongs to the Learning harness`);
  return port;
}

function pgPort() {
  return portFromEnv("UC_TEST_PG_PORT", 55449);
}

function pgDb() {
  const raw = process.env.UC_TEST_PG_DB?.trim();
  if (!raw) return "unbundle_uc_test";
  if (!/^[a-z_][a-z0-9_]{2,62}$/.test(raw)) throw new Error("UC_TEST_PG_DB must be a plain lowercase database name");
  return raw;
}

export const UC_TEST_HOST = "127.0.0.1";
export const UC_TEST_PORT = pgPort();
export const UC_TEST_USER = "uc_test";
export const UC_TEST_DB = pgDb();
export const UC_TEST_DATABASE_URL = `postgresql://${UC_TEST_USER}@${UC_TEST_HOST}:${UC_TEST_PORT}/${UC_TEST_DB}`;
export const UC_TEST_AUTH_PORT = portFromEnv("UC_TEST_AUTH_PORT", 59109);
export const UC_TEST_AUTH_PROJECT = "demo-unbundle-uc";
export const UC_TEST_APP_PORT = portFromEnv("UC_TEST_APP_PORT", 53110);
export const UC_TEST_LOGIN_PORT = portFromEnv("UC_TEST_LOGIN_PORT", 53112);
export const UC_TEST_LS_DOMAIN = "ls.test";

/** Temporary root outside Git for data, fixtures, blobs and evidence. */
export function ucTestRoot() {
  const root = process.env.UC_TEST_ROOT;
  if (!root || !(root.startsWith("/private/tmp/") || root.startsWith("/tmp/"))) {
    throw new Error("Set UC_TEST_ROOT to a temporary directory outside Git (/private/tmp/… or /tmp/…)");
  }
  return root.replace(/\/+$/, "");
}
