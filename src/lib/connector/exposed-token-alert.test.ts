import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { CONNECTOR_PROVIDER, CONNECTOR_TOKEN_PREFIX } from "./auth.ts";
import { alertExposedToken, exposedTokenAlertText, type ExposedTokenAlertDeps, type SlackAlertTarget } from "./exposed-token-alert.ts";

// Prompt WP4 (token nell'indirizzo): avviso a Lateral Space nel canale admin di Slack. Dati sintetici.

function fakeDeps(target: SlackAlertTarget | null, opts: { fail?: boolean; hang?: boolean; timeoutMs?: number } = {}) {
  const posts: Array<{ target: SlackAlertTarget; text: string }> = [];
  const errors: string[] = [];
  const asked: string[] = [];
  const deps: ExposedTokenAlertDeps = {
    async findAdminChannel(workspaceId) {
      asked.push(workspaceId);
      return target;
    },
    async post(t, text) {
      if (opts.hang) await new Promise(() => {});
      if (opts.fail) throw Object.assign(new Error(`rifiutato ${t.botToken}`), { name: "SlackError", code: "channel_not_found" });
      posts.push({ target: t, text });
    },
    timeoutMs: opts.timeoutMs,
    log: { error: (...args: unknown[]) => errors.push(args.map(String).join(" ")) },
  };
  return { deps, posts, errors, asked };
}

const target = { channelId: "C0PROVA01", botToken: `xoxb-${randomBytes(12).toString("hex")}` };

test("token del connettore: un messaggio nel canale admin del suo workspace, testo fisso", async () => {
  const workspaceId = randomUUID();
  const { deps, posts, asked } = fakeDeps(target);
  assert.equal(await alertExposedToken({ workspaceId, provider: CONNECTOR_PROVIDER }, deps), "sent");
  assert.deepEqual(asked, [workspaceId]);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].target, target);
  assert.equal(posts[0].text, exposedTokenAlertText(CONNECTOR_PROVIDER));
  assert.match(posts[0].text, /esposto, da revocare/);
  assert.match(posts[0].text, /ferma il connettore per tutta l'organizzazione/);
});

test("un altro token (REST v1): testo generico, senza il connettore", () => {
  const text = exposedTokenAlertText("claude_mcp");
  assert.match(text, /esposto, da revocare/);
  assert.doesNotMatch(text, /connettore/);
});

test("il testo non dipende da nulla di variabile: niente token, id, nomi", () => {
  const token = `${CONNECTOR_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  for (const provider of [CONNECTOR_PROVIDER, "claude_mcp", "altro"]) {
    const text = exposedTokenAlertText(provider);
    assert.equal(text.includes(token.slice(0, 14)), false);
    assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}/);
    assert.doesNotMatch(text, /<|@channel|@here/);
  }
});

test("senza Slack o senza canale non parte nulla", async () => {
  const { deps, posts } = fakeDeps(null);
  assert.equal(await alertExposedToken({ workspaceId: randomUUID(), provider: CONNECTOR_PROVIDER }, deps), "no_channel");
  assert.equal(posts.length, 0);
});

test("un errore di Slack finisce nel log senza il token del bot e non si propaga", async () => {
  const { deps, errors } = fakeDeps(target, { fail: true });
  assert.equal(await alertExposedToken({ workspaceId: randomUUID(), provider: CONNECTOR_PROVIDER }, deps), "failed");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /\[connector\] exposed_token_alert_failed/);
  assert.match(errors[0], /channel_not_found/);
  assert.equal(errors[0].includes(target.botToken), false);
});

test("Slack che non risponde non trattiene la risposta oltre l'attesa massima", async () => {
  const { deps, errors } = fakeDeps(target, { hang: true, timeoutMs: 20 });
  const started = Date.now();
  assert.equal(await alertExposedToken({ workspaceId: randomUUID(), provider: CONNECTOR_PROVIDER }, deps), "failed");
  assert.ok(Date.now() - started < 1_000);
  assert.match(errors[0], /TimeoutError/);
});
