import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "unbundle-portfolio-server.mjs");

function startServer(env = {}) {
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      UNBUNDLE_MCP_TOKEN: "",
      ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    for (const line of chunk.split("\n")) {
      if (line.trim()) lines.push(JSON.parse(line));
    }
  });
  return { child, lines };
}

function send(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

async function waitFor(lines, predicate) {
  const started = Date.now();
  while (Date.now() - started < 2500) {
    const found = lines.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for MCP response. Got: ${JSON.stringify(lines)}`);
}

async function initialize(child, lines) {
  send(child, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "unbundle-test", version: "1.0.0" },
    },
  });
  await waitFor(lines, (line) => line.id === 1);
  send(child, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  });
}

test("MCP server espone i tool Unbundle e fallisce in modo leggibile senza token", async () => {
  const { child, lines } = startServer();
  try {
    await initialize(child, lines);
    send(child, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const list = await waitFor(lines, (line) => line.id === 2);
    const names = list.result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "get_workspace_intake_requirements",
      "submit_portfolio_contribution",
    ]);

    send(child, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get_workspace_intake_requirements",
        arguments: {},
      },
    });
    const call = await waitFor(lines, (line) => line.id === 3);
    assert.equal(call.result.isError, true);
    assert.match(call.result.content[0].text, /UNBUNDLE_MCP_TOKEN/);
  } finally {
    child.kill();
    await once(child, "close").catch(() => {});
  }
});

test("MCP submit invia bearer token e idempotency key deterministica all'API Unbundle", async () => {
  let captured = null;
  const api = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      captured = {
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: JSON.parse(body || "{}"),
      };
      res.writeHead(201, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          duplicate: false,
          useCase: {
            id: "11111111-1111-4111-8111-111111111111",
            workspaceId: "22222222-2222-4222-8222-222222222222",
            title: "Automated project tracking",
            portfolioKind: "use_case_ai",
            status: "proposed",
            portfolioReviewStatus: "in_review",
            overallScore: 3.5,
            createdAt: new Date("2026-04-29T08:00:00.000Z").toISOString(),
          },
        })
      );
    });
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const port = api.address().port;

  const { child, lines } = startServer({
    UNBUNDLE_API_URL: `http://127.0.0.1:${port}`,
    UNBUNDLE_MCP_TOKEN: "test-token",
  });
  try {
    await initialize(child, lines);
    send(child, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "submit_portfolio_contribution",
        arguments: {
          confirmedByUser: true,
          contributionKind: "use_case_ai",
          submittedBy: { email: "luca@nativalab.com", name: "Luca" },
          title: "Automated project tracking",
          problem:
            "Oggi il project tracking viene aggiornato manualmente e si perde contesto.",
          flowDescription:
            "Un agente raccoglie aggiornamenti dai tool di progetto e prepara una sintesi.",
          humanInTheLoop:
            "Il project manager valida la sintesi prima di condividerla.",
          guardrails:
            "L'agente non modifica date, budget o decisioni senza approvazione.",
          expectedImpact:
            "Meno tempo speso in coordinamento e aggiornamenti piu tempestivi.",
          dataRequirements:
            "Accesso a task tracker, project plan e note di avanzamento.",
        },
      },
    });
    const call = await waitFor(lines, (line) => line.id === 4);
    assert.notEqual(call.result.isError, true);
    assert.match(call.result.content[0].text, /Contributo salvato/);
    assert.equal(captured.method, "POST");
    assert.equal(captured.url, "/api/mcp/portfolio/submissions");
    assert.equal(captured.authorization, "Bearer test-token");
    assert.match(captured.body.idempotencyKey, /^claude-[a-f0-9]{40}$/);
    assert.equal(captured.body.confirmedByUser, true);
  } finally {
    child.kill();
    await once(child, "close").catch(() => {});
    api.close();
  }
});
