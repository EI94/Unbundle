import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACCOUNT_PARTS,
  accountApiPath,
  accountPartForSettingsHash,
  accountPartOf,
  accountSectionId,
  claudeAiHeader,
  claudeCodeCommand,
  granolaRulesHref,
  referentEmailChoice,
  withAccount,
  withoutAccount,
} from "./account.ts";
import { contextAbilities } from "../context/visibility.ts";
import { canManageWorkspaceSettings } from "../workspace-permissions.ts";

// (Rilascio 10, docs/ui-10/PROPOSTA-10.md §2.3, §3.10) «Il tuo account»: l'indirizzo `?account=`, la regola di chi vede
// le email (spostata dalla campanella), i comandi per Claude. Id inventati.

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

test("?account= apre il foglio, in cima o sulla parte giusta; senza, è chiuso", () => {
  assert.deepEqual(ACCOUNT_PARTS, ["email", "claude", "granola", "tema"]);
  assert.equal(accountPartOf(null), null);
  assert.equal(accountPartOf(undefined), null);
  assert.equal(accountPartOf(""), "tutto");
  assert.equal(accountPartOf("1"), "tutto");
  assert.equal(accountPartOf("qualcosa"), "tutto");
  for (const part of ACCOUNT_PARTS) assert.equal(accountPartOf(part), part);
  assert.equal(accountSectionId("claude"), "account-claude");
});

test("aprire e chiudere tengono il resto dell'indirizzo, query e ancora comprese", () => {
  assert.equal(withAccount("/dashboard/w/use-cases"), "/dashboard/w/use-cases?account=1");
  assert.equal(withAccount("/dashboard/w/use-cases?vista=da-decidere&apri=x#cosa-serve", "claude"), "/dashboard/w/use-cases?vista=da-decidere&apri=x&account=claude#cosa-serve");
  assert.equal(withAccount("/dashboard/w?account=email", "tema"), "/dashboard/w?account=tema");
  assert.equal(withoutAccount("/dashboard/w/use-cases?vista=da-decidere&account=claude#cosa-serve"), "/dashboard/w/use-cases?vista=da-decidere#cosa-serve");
  assert.equal(withoutAccount("/dashboard/w?account=1"), "/dashboard/w");
  assert.equal(withoutAccount("/dashboard/w"), "/dashboard/w");
});

test("le email sulle richieste al referente: chi valuta, con l'area e le richieste accese, e dopo aver chiesto", () => {
  const all = { useCaseHub: true, reviewer: true, askEnabled: true, hasRequested: true, on: false };
  assert.deepEqual(referentEmailChoice(all), { shown: true, on: false });
  for (const key of ["useCaseHub", "reviewer", "askEnabled", "hasRequested"] as const) {
    assert.deepEqual(referentEmailChoice({ ...all, [key]: false }), { shown: false, on: false }, key);
  }
  // Una regola sola: la campanella la usa ancora per il suo payload.
  assert.match(read("src/lib/notifications/bell-data.ts"), /emailAlerts: referentEmailChoice\(\{ useCaseHub: i\.useCaseHub, reviewer, askEnabled: referentAskEnabled\(i\.workspaceId, env\), hasRequested: state\.hasRequested, on: state\.referentEmails \}\)/);
  // E nella campanella non c'è più l'interruttore.
  const bell = read("src/components/portfolio/notifications-bell.tsx");
  assert.doesNotMatch(bell, /setBellEmailAlertsAction|CheckboxItem|emailAlerts/);
});

test("i comandi per Claude con l'accesso appena creato", () => {
  const claude = { claudeCodeName: "unbundle-use-case", url: "https://esempio.test/api/mcp/team" };
  assert.equal(claudeCodeCommand(claude, "ub_prova"), 'claude mcp add --transport http unbundle-use-case https://esempio.test/api/mcp/team --header "Authorization: Bearer ub_prova"');
  assert.equal(claudeAiHeader("ub_prova"), "Authorization: Bearer ub_prova");
  assert.equal(accountApiPath("00000000-0000-4000-8000-0000000000f1"), "/api/workspaces/00000000-0000-4000-8000-0000000000f1/account");
});

test("le ancore personali delle Impostazioni aprono il foglio sulla parte giusta (§2.4); le altre restano della pagina", () => {
  const ws = "00000000-0000-4000-8000-0000000000f1";
  const settings = `/dashboard/${ws}/settings`;
  assert.equal(accountPartForSettingsHash(settings, "#cli", ws), "claude");
  assert.equal(accountPartForSettingsHash(`${settings}/`, "#granola", ws), "granola");
  for (const hash of ["", "#integrazioni", "#persone", "#sub-responsabili", "#zona-pericolosa", "#valutazione-use-case"]) {
    assert.equal(accountPartForSettingsHash(settings, hash, ws), null, hash);
  }
  // Solo la pagina delle Impostazioni di questo workspace.
  assert.equal(accountPartForSettingsHash(`/dashboard/${ws}/agent-factory`, "#cli", ws), null);
  assert.equal(accountPartForSettingsHash("/dashboard/00000000-0000-4000-8000-0000000000f2/settings", "#cli", ws), null);
});

test("«Regole delle call ›» porta alle regole di Impostazioni, a un'ancora che il foglio non intercetta", () => {
  const ws = "00000000-0000-4000-8000-0000000000f1";
  const href = granolaRulesHref(ws);
  assert.equal(href, `/dashboard/${ws}/settings#granola-regole`);
  const url = new URL(href, "http://unbundle.test");
  assert.equal(accountPartForSettingsHash(url.pathname, url.hash, ws), null, "non riapre il foglio");
  assert.equal(url.searchParams.has("account"), false, "e lo chiude");
  // L'ancora è quella del blocco delle regole in Impostazioni.
  const panel = read("src/components/context/granola/granola-card-panel.tsx");
  const rules = panel.slice(panel.indexOf("function GranolaRulesForm("));
  assert.match(rules, /return \(\s*<div id="granola-regole" className="scroll-mt-28 [^"]*">\s*<h3 className="text-sm font-semibold">\{T\.rulesTitle\(workspaceName\)\}<\/h3>/);
  assert.match(read("src/lib/context/granola/view.ts"), /export const GRANOLA_RULES_ANCHOR = "granola-regole";/);
  assert.equal(panel.match(/id="granola-regole"/g)?.length, 1);
});

test("le regole delle call restano aperte, come prima, a chi è di Lateral Space e non gestisce il workspace", () => {
  // Senza «Impostazioni» nella barra (solo chi gestisce), il foglio è la loro strada: Granola lo usa ogni ruolo di
  // Lateral Space, e la pagina delle Impostazioni si apre a chiunque sia nel workspace, senza un controllo di ruolo.
  for (const role of ["function_lead", "analyst", "contributor"]) {
    assert.equal(canManageWorkspaceSettings(role), false, role);
    assert.equal(contextAbilities({ role, isLateralSpace: true }).canUseGranola, true, role);
    assert.equal(contextAbilities({ role, isLateralSpace: false }).canUseGranola, false, role);
  }
  const page = read("src/app/(dashboard)/dashboard/[workspaceId]/settings/page.tsx");
  assert.match(page, /const \{ session, access \} = await requireWorkspacePage\(workspaceId\);/);
  assert.doesNotMatch(page, /if \(!can[A-Za-z]+\) (?:notFound|redirect)\(/, "nessun ruolo chiude la pagina");
  // Il blocco di Granola sta fuori da ogni condizione sul ruolo: decide da sé (solo Lateral Space).
  assert.match(page, /<div id="granola" className="scroll-mt-28 empty:hidden">\s*<GranolaCard workspaceId=\{workspaceId\} workspaceName=\{workspace\.name\} userId=\{session\.user\.id\} role=\{access\.role\} flash=\{search\.granola\} \/>/);
  assert.doesNotMatch(page, /can[A-Za-z]+ && \(?\s*<div id="granola"/);
});
