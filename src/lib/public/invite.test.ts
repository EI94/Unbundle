import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findHubForbiddenIn } from "../use-cases/copy-guard.ts";
import { ROLE_INFO_OUTSIDE } from "../workspace-roles.ts";
import { INVITE_TEXT, fillInvite, inviteDay } from "./invite.ts";

// (Rilascio 10, ondata 4 «Fuori», docs/ui-10/PROPOSTA-10.md §3.11 «Invito», audit Fuori §3.2 e §8.1) L'invito: H1
// «{Organizzazione} ti invita in {workspace}», «Ruolo: … · valido fino al 25 novembre», «Cosa potrai fare ▸» chiusa, i
// ruoli con «caso d'uso», niente «Firebase», testi corti per «già dentro» e «non disponibile». Restano: crea account,
// accedi, accetta; account sbagliato e cambio d'account; la conferma dell'email. Dati inventati.

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const code = (path: string) =>
  read(path)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

test("the header: «{Organizzazione} ti invita in {workspace}» and «Ruolo: … · valido fino al 25 novembre»", () => {
  assert.equal(fillInvite(INVITE_TEXT.title, { Organizzazione: "Cliente Demo", Workspace: "Progetto AI" }), "Cliente Demo ti invita in Progetto AI");
  assert.equal(inviteDay(new Date("2026-11-25T10:00:00Z")), "25 novembre");
  assert.equal(
    fillInvite(INVITE_TEXT.roleLine, { Ruolo: ROLE_INFO_OUTSIDE.function_lead.label, Data: inviteDay(new Date("2026-11-25T10:00:00Z")) }),
    "Ruolo: Responsabile di funzione · valido fino al 25 novembre",
  );
  assert.equal(fillInvite("{Workspace} e {Altro}", { Workspace: "Progetto AI" }), "Progetto AI e {Altro}");
});

test("the texts: «caso d'uso» in the roles, no «Firebase», no code, neutral gender", () => {
  const texts = [...strings(INVITE_TEXT), ...strings(ROLE_INFO_OUTSIDE)];
  assert.deepEqual(findHubForbiddenIn(texts, "esterno"), []);
  assert.ok(strings(ROLE_INFO_OUTSIDE).some((t) => t.includes("casi d'uso")));
  for (const text of strings(INVITE_TEXT)) {
    assert.doesNotMatch(text, /Firebase|\b(?:conness[oa]|entrat[oa]|invitat[oa]|benvenut[oa])\b/i, text);
  }
});

test("the page: the public shell, one filled button per state, «Cosa potrai fare ▸» closed, the single card when the invite cannot be used", () => {
  const page = code("src/app/invite/[token]/page.tsx");
  assert.match(page, /\{fillInvite\(T\.title, \{ Organizzazione: organization\.name, Workspace: workspace\.name \}\)\}/);
  assert.match(page, /\{fillInvite\(T\.roleLine, \{ Ruolo: role\?\.label \?\? invitation\.role, Data: inviteDay\(invitation\.expiresAt\) \}\)\}/);
  assert.match(page, /<Fold id="cosa-potrai-fare" title=\{T\.canDo\}/);
  assert.match(page, /const role = ROLE_INFO_OUTSIDE\[invitation\.role\];/);
  assert.match(page, /<PublicStateCard kind="link" body=\{T\.gone\[reason\]\}>/);
  assert.match(page, /data-testid=\{`invite-unavailable-\$\{reason\}`\}/);
  // Non connesso: «Crea il tuo account» pieno, «Ho già un account» bordato, a 48 px.
  assert.match(page, /<Button render=\{<Link href=\{registerHref\} \/>\} nativeButton=\{false\} className=\{PUBLIC_PRIMARY\} data-testid="invite-register">/);
  assert.match(page, /<Button render=\{<Link href=\{loginHref\} \/>\} nativeButton=\{false\} variant="outline" className=\{PUBLIC_SECONDARY\} data-testid="invite-login">/);
  // Tutto resta: già dentro, account sbagliato, cambio d'account, conferma dell'email, accetta.
  for (const kept of ['data-testid="invite-already"', 'data-testid="invite-wrong-account"', "<SwitchAccountButton loginHref={switchHref} />", "<VerifyInviteEmail email={session.user.email} loginHref={loginHref} />", "<WorkspaceInviteAcceptForm token={token} workspaceName={workspace.name} />", "&mode=register"]) {
    assert.ok(page.includes(kept), kept);
  }
  for (const gone of ['href="/"', "<Badge", "amber", "text-xs", "Invito a collaborare", "Entra in {", "h-10"]) assert.ok(!page.includes(gone), gone);
  assert.match(code("src/app/invite/layout.tsx"), /return <PublicRoot>\{children\}<\/PublicRoot>;/);
  assert.match(code("src/app/invite/[token]/error.tsx"), /return <PublicErrorScreen retry=\{retry\} \/>;/);
});

test("the pieces: accept at 48 px, the e-mail check without «Firebase» and without fixed colours", () => {
  const accept = code("src/components/workspace/workspace-invite-accept-form.tsx");
  assert.match(accept, /<Button type="submit" className=\{PUBLIC_PRIMARY\} disabled=\{pending\}>/);
  assert.doesNotMatch(accept, /red-\d|text-red/);
  const verify = code("src/components/workspace/verify-invite-email.tsx");
  assert.doesNotMatch(verify, /amber|red-\d|text-red|text-xs/);
  assert.doesNotMatch(verify.replace(/firebase\w*|Firebase\w*(?=\W)/g, (m) => (/^[a-z]/.test(m) ? m : "")), /"[^"]*Firebase[^"]*"/, "nessun «Firebase» in un testo");
  assert.equal(verify.match(/className=\{PUBLIC_PRIMARY\}/g)?.length, 2, "uno per stato: «Mandami il link» o «Ho confermato»");
  assert.doesNotMatch(verify, /"[A-ZÈ][a-zàèéìòù']+\s[^"\n]*"/, "nessuna frase scritta a mano");
});
