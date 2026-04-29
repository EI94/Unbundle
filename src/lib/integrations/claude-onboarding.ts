export type ClaudeOnboardingInput = {
  apiUrl: string;
  token: string;
  workspaceName: string;
};

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildClaudeInstallCommand({
  apiUrl,
  token,
}: Pick<ClaudeOnboardingInput, "apiUrl" | "token">) {
  const baseUrl = normalizeBaseUrl(apiUrl);
  return [
    'mkdir -p "$HOME/.unbundle/claude"',
    `curl -fsSL ${shellQuote(`${baseUrl}/api/mcp/portfolio/server`)} -o "$HOME/.unbundle/claude/unbundle-portfolio-server.mjs"`,
    `curl -fsSL ${shellQuote(`${baseUrl}/api/mcp/portfolio/skill`)} -o "$HOME/.unbundle/claude/SKILL.md"`,
    'npm install --silent --prefix "$HOME/.unbundle/claude" @modelcontextprotocol/sdk@^1.29.0 zod@^4.3.6',
    [
      "claude mcp add",
      "--transport stdio",
      "--env",
      `UNBUNDLE_API_URL=${shellQuote(baseUrl)}`,
      "--env",
      `UNBUNDLE_MCP_TOKEN=${shellQuote(token)}`,
      "unbundle",
      "--",
      "node",
      '"$HOME/.unbundle/claude/unbundle-portfolio-server.mjs"',
    ].join(" "),
  ].join(" && \\\n");
}

export function buildClaudeStarterPrompt(workspaceName: string) {
  return [
    `Voglio segnalare a Unbundle un use case AI o una best practice per il workspace ${workspaceName}.`,
    "Guidami tu con le domande mancanti, non inventare numeri economici e prima di inviare fammi vedere il riepilogo finale.",
  ].join(" ");
}

export function buildClaudeColleagueGuide({
  apiUrl,
  token,
  workspaceName,
}: ClaudeOnboardingInput) {
  return [
    `Ciao, ho preparato Unbundle per Claude sul workspace ${workspaceName}.`,
    "",
    "Setup una tantum:",
    buildClaudeInstallCommand({ apiUrl, token }),
    "",
    "Dopo il setup puoi scrivere a Claude:",
    buildClaudeStarterPrompt(workspaceName),
    "",
    "Claude raccoglie i campi mancanti, mostra un riepilogo e salva su Unbundle solo dopo la tua conferma esplicita.",
  ].join("\n");
}
