#!/usr/bin/env node
import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const API_URL = (process.env.UNBUNDLE_API_URL || "https://www.theunbundle.com")
  .trim()
  .replace(/\/+$/, "");
const MCP_TOKEN = (process.env.UNBUNDLE_MCP_TOKEN || "").trim();
const TIMEOUT_MS = Number(process.env.UNBUNDLE_MCP_TIMEOUT_MS || 15000);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stable(item)])
  );
}

function deterministicIdempotencyKey(payload) {
  const copy = { ...payload };
  delete copy.idempotencyKey;
  return `claude-${createHash("sha256")
    .update(JSON.stringify(stable(copy)), "utf8")
    .digest("hex")
    .slice(0, 40)}`;
}

function textResult(text, structuredContent, isError = false) {
  return {
    isError,
    content: [{ type: "text", text }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

function missingConfigResult() {
  return textResult(
    "UNBUNDLE_MCP_TOKEN non configurato. Crea un token in Unbundle > Integrazioni > Claude MCP e avvia il server con UNBUNDLE_MCP_TOKEN.",
    { ok: false, error: "missing_token" },
    true
  );
}

async function callUnbundle(path, init = {}) {
  if (!MCP_TOKEN) return { ok: false, status: 0, body: { error: "missing_token" } };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${MCP_TOKEN}`,
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: {
        error: error?.name === "AbortError" ? "timeout" : "network_error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

const server = new McpServer({
  name: "unbundle-portfolio",
  version: "1.0.0",
});

server.registerTool(
  "get_workspace_intake_requirements",
  {
    title: "Get Unbundle intake requirements",
    description:
      "Read the workspace intake contract before submitting a best practice or AI use case to Unbundle.",
    inputSchema: {},
  },
  async () => {
    if (!MCP_TOKEN) return missingConfigResult();
    const result = await callUnbundle("/api/mcp/portfolio/requirements", {
      method: "GET",
    });
    if (!result.ok) {
      return textResult(
        `Unbundle ha rifiutato la lettura requisiti (${result.status}): ${JSON.stringify(result.body)}`,
        { ok: false, status: result.status, response: result.body },
        true
      );
    }
    return textResult(
      "Requisiti intake Unbundle caricati.",
      result.body
    );
  }
);

server.registerTool(
  "submit_portfolio_contribution",
  {
    title: "Submit portfolio contribution to Unbundle",
    description:
      "Create a proposed best practice or AI use case in the connected Unbundle workspace after explicit user confirmation.",
    inputSchema: {
      idempotencyKey: z
        .string()
        .min(8)
        .max(128)
        .optional()
        .describe("Stable key for retries. If omitted, the MCP server derives one from the payload."),
      confirmedByUser: z
        .literal(true)
        .describe("Must be true only after the user explicitly confirms the final summary."),
      contributionKind: z
        .enum(["best_practice", "use_case_ai"])
        .describe("Use best_practice for something already working, use_case_ai for an idea/proposal."),
      submittedBy: z
        .object({
          name: z.string().min(2).max(120).optional(),
          email: z.string().email().max(255).optional(),
          externalUserId: z.string().min(2).max(120).optional(),
        })
        .describe("Person who is sharing the contribution. Provide at least one identifier."),
      title: z.string().min(3).max(500),
      problem: z.string().min(14).max(4000),
      flowDescription: z.string().min(14).max(6000),
      humanInTheLoop: z.string().min(8).max(4000),
      guardrails: z.string().min(8).max(4000).optional(),
      expectedImpact: z.string().min(10).max(4000),
      dataRequirements: z.string().min(8).max(4000),
      sustainabilityImpact: z.string().min(8).max(4000).optional(),
      urgency: z.string().min(2).max(255).optional(),
    },
  },
  async (args) => {
    if (!MCP_TOKEN) return missingConfigResult();

    const payload = {
      ...args,
      idempotencyKey: args.idempotencyKey || deterministicIdempotencyKey(args),
    };

    const result = await callUnbundle("/api/mcp/portfolio/submissions", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!result.ok) {
      return textResult(
        `Unbundle non ha salvato il contributo (${result.status}): ${JSON.stringify(result.body)}`,
        { ok: false, status: result.status, response: result.body },
        true
      );
    }

    const duplicate = result.body?.duplicate ? " Submission già ricevuta in precedenza: nessun duplicato creato." : "";
    return textResult(
      `Contributo salvato in Unbundle.${duplicate}`,
      result.body
    );
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Unbundle MCP server running against ${API_URL}`);
}

main().catch((error) => {
  console.error("Unbundle MCP server failed:", error);
  process.exit(1);
});
