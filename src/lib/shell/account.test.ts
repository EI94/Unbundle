import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACCOUNT_PARTS,
  accountApiPath,
  accountPartOf,
  accountSectionId,
  claudeAiHeader,
  claudeCodeCommand,
  referentEmailChoice,
  withAccount,
  withoutAccount,
} from "./account.ts";

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
