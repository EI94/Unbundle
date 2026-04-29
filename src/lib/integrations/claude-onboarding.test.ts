import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClaudeColleagueGuide,
  buildClaudeInstallCommand,
  buildClaudeStarterPrompt,
} from "./claude-onboarding.ts";

test("Claude install command downloads server and skill without local repo paths", () => {
  const command = buildClaudeInstallCommand({
    apiUrl: "https://www.theunbundle.com/",
    token: "ub_mcp_test",
  });

  assert.match(command, /\/api\/mcp\/portfolio\/server/);
  assert.match(command, /\/api\/mcp\/portfolio\/skill/);
  assert.match(command, /npm install --silent --prefix/);
  assert.match(command, /@modelcontextprotocol\/sdk@\^1\.29\.0/);
  assert.match(command, /claude mcp add/);
  assert.match(command, /UNBUNDLE_MCP_TOKEN='ub_mcp_test'/);
  assert.doesNotMatch(command, /\/path\/to\/unbundle/);
});

test("Claude starter prompt activates Unbundle flow with confirmation guardrail", () => {
  const prompt = buildClaudeStarterPrompt("NATIVAI");

  assert.match(prompt, /Unbundle/);
  assert.match(prompt, /NATIVAI/);
  assert.match(prompt, /non inventare numeri economici/);
  assert.match(prompt, /riepilogo finale/);
});

test("Claude colleague guide contains setup and usage in one copyable message", () => {
  const guide = buildClaudeColleagueGuide({
    apiUrl: "https://www.theunbundle.com",
    token: "ub_mcp_team",
    workspaceName: "NATIVAI",
  });

  assert.match(guide, /Setup una tantum/);
  assert.match(guide, /ub_mcp_team/);
  assert.match(guide, /workspace NATIVAI/);
  assert.match(guide, /conferma esplicita/);
});
