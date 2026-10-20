// Shared constants for the Casi d'uso isolated harness (PIANO §9.2).
// Ports are reserved for this harness: 55439, 59099, 53100 and 53102 belong to the
// Learning harness and must not be touched.
//
// Optional overrides (defaults unchanged) let another suite run its own disposable
// cluster with the same scripts, e.g. the Claude connector (docs/connettore/README.md):
//   UC_TEST_PG_PORT  PostgreSQL port on 127.0.0.1 (default 55449)
//   UC_TEST_PG_DB    database name (default unbundle_uc_test)
// The user (uc_test), host (127.0.0.1) and trust auth never change.

function pgPort() {
  const raw = process.env.UC_TEST_PG_PORT?.trim();
  if (!raw) return 55449;
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1024 || port > 65535) throw new Error("UC_TEST_PG_PORT must be a port between 1024 and 65535");
  return port;
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
export const UC_TEST_AUTH_PORT = 59109;
export const UC_TEST_AUTH_PROJECT = "demo-unbundle-uc";
export const UC_TEST_APP_PORT = 53110;
export const UC_TEST_LOGIN_PORT = 53112;
export const UC_TEST_LS_DOMAIN = "ls.test";

/** Temporary root outside Git for data, fixtures, blobs and evidence. */
export function ucTestRoot() {
  const root = process.env.UC_TEST_ROOT;
  if (!root || !(root.startsWith("/private/tmp/") || root.startsWith("/tmp/"))) {
    throw new Error("Set UC_TEST_ROOT to a temporary directory outside Git (/private/tmp/… or /tmp/…)");
  }
  return root.replace(/\/+$/, "");
}
