#!/usr/bin/env node
// Server MCP «unbundle-casi»: dossier dei casi di Unbundle in sola lettura.
// Gemello di unbundle-portfolio-server.mjs: stesso token Bearer
// (workspace_integration_tokens, scope cases:*), stesse variabili e timeout.
// Ogni token legge un solo caso. Nessuno strumento scrive: niente
// confirmedByUser né idempotencyKey. Ogni lettura resta nel registro del caso.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const API_URL = (process.env.UNBUNDLE_API_URL || "https://www.theunbundle.com")
  .trim()
  .replace(/\/+$/, "");
const MCP_TOKEN = (process.env.UNBUNDLE_MCP_TOKEN || "").trim();
const TIMEOUT_MS = Number(process.env.UNBUNDLE_MCP_TIMEOUT_MS || 15000);

// Tipi di voce del catalogo (src/lib/uc/vocab.ts, ITEM_KINDS; il test li confronta).
const ITEM_KINDS = [
  "entita",
  "campo",
  "kpi",
  "decisione",
  "parametro",
  "vincolo_rigido",
  "vincolo_morbido",
  "obiettivo",
  "incertezza",
  "uscita",
  "formula",
  "regola",
  "fonte",
  "controllo_qualita",
  "domanda",
  "documento",
];

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const caseIdSchema = z.uuid().describe("Case id (uuid) returned by list_cases.");

function textResult(text, structuredContent, isError = false) {
  return {
    isError,
    content: [
      {
        type: "text",
        // Il JSON va anche nel testo: non tutti i client leggono structuredContent.
        text: structuredContent ? `${text}\n\n${JSON.stringify(structuredContent)}` : text,
      },
    ],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

function missingConfigResult() {
  return textResult(
    "UNBUNDLE_MCP_TOKEN non configurato. Crea un accesso nel caso in Unbundle (menu ⋯ > Sviluppo con Claude) e avvia il server con UNBUNDLE_MCP_TOKEN.",
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
      method: "GET",
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${MCP_TOKEN}`,
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 500) };
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

/** Messaggio leggibile per un rifiuto dell'API. */
function failureText(result) {
  const body = result.body || {};
  if (body.error === "timeout") return `Unbundle non ha risposto entro ${TIMEOUT_MS} ms. Riprova tra poco.`;
  if (body.error === "network_error") return "Unbundle non è raggiungibile. Controlla la connessione e UNBUNDLE_API_URL.";
  if (typeof body.message === "string" && body.message) return `Unbundle ha rifiutato la lettura (${result.status}): ${body.message}`;
  if (result.status === 401) return "Unbundle ha rifiutato il token: è mancante, scaduto o revocato. Creane uno nuovo dal caso.";
  if (result.status === 403) return "Il token non ha il permesso per questa lettura.";
  if (result.status === 404) return "Caso non trovato, chiuso, oppure il token è per un altro caso.";
  return `Unbundle ha rifiutato la lettura (${result.status}).`;
}

async function readTool(path, successText) {
  if (!MCP_TOKEN) return missingConfigResult();
  const result = await callUnbundle(path);
  if (!result.ok) {
    return textResult(failureText(result), { ok: false, status: result.status, response: result.body }, true);
  }
  return textResult(typeof successText === "function" ? successText(result.body || {}) : successText, result.body || {});
}

function hiddenNote(body) {
  return body && body.text_hidden === "ambiente_non_approvato"
    ? " Testi del cliente nascosti: l'ambiente AI del caso non è ancora approvato."
    : "";
}

const casePath = (caseId, tail) => `/api/mcp/casi/cases/${encodeURIComponent(caseId)}/${tail}`;

const server = new McpServer({
  name: "unbundle-casi",
  version: "1.0.0",
});

// list_cases elenca dossier (casi), non use case. Il nome di prima, list_use_cases,
// resta come alias per una release e poi si toglie (DESIGN §2.1 punto 7).
const listCases = () =>
  readTool("/api/mcp/casi/cases", (body) => {
    const n = Array.isArray(body.cases) ? body.cases.length : 0;
    return n === 1 ? "1 caso leggibile con questo token." : `${n} casi leggibili con questo token.`;
  });

server.registerTool(
  "list_cases",
  {
    title: "List Unbundle cases",
    description:
      "List the case (dossier) this token can read, with status, catalog version and G1 readiness. Call it first to get the caseId.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  listCases
);

server.registerTool(
  "list_use_cases",
  {
    title: "List Unbundle cases (old name)",
    description: "Deprecated alias of list_cases, kept for one release. Use list_cases.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  listCases
);

server.registerTool(
  "get_validated_catalog",
  {
    title: "Get the validated catalog",
    description:
      "Read only the validated (green) or approved not-applicable (blue) items of the frozen catalog version, with values, units, sources, answer versions and links. Never returns the draft. Use it as the only source of truth to develop the model.",
    inputSchema: {
      caseId: caseIdSchema,
      version: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Frozen catalog version. Omit to read the latest frozen version."),
      kinds: z
        .array(z.enum(ITEM_KINDS))
        .max(ITEM_KINDS.length)
        .optional()
        .describe("Only these item kinds, e.g. [\"campo\", \"regola\"]."),
    },
    annotations: READ_ONLY,
  },
  async ({ caseId, version, kinds }) => {
    const query = new URLSearchParams();
    if (version !== undefined) query.set("version", String(version));
    if (kinds && kinds.length > 0) query.set("kinds", kinds.join(","));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return readTool(casePath(caseId, `catalog${suffix}`), (body) => {
      const items = Array.isArray(body.items) ? body.items.length : 0;
      const excluded = Array.isArray(body.excluded) ? body.excluded.length : 0;
      return `Catalogo v${body.version}: ${items} voci validate, ${excluded} escluse perché non validate.${hiddenNote(body)}`;
    });
  }
);

server.registerTool(
  "get_open_items",
  {
    title: "Get open items for the G1 gate",
    description:
      "List the required items of gate G1 that are not ready yet, with module, the role that must provide them and the due date. No names or emails.",
    inputSchema: { caseId: caseIdSchema },
    annotations: READ_ONLY,
  },
  async ({ caseId }) =>
    readTool(casePath(caseId, "open-items"), (body) => `${body.count ?? 0} voci mancano al gate G1.${hiddenNote(body)}`)
);

server.registerTool(
  "get_data_dictionary",
  {
    title: "Get the data dictionary",
    description:
      "Read entities and fields with data type, unit, required flag and privacy class, to generate SQL schemas or classes. Structure only, never values.",
    inputSchema: { caseId: caseIdSchema },
    annotations: READ_ONLY,
  },
  async ({ caseId }) =>
    readTool(casePath(caseId, "dictionary"), (body) => {
      const entities = Array.isArray(body.entities) ? body.entities.length : 0;
      return `Dizionario dati: ${entities} entità.${hiddenNote(body)}`;
    })
);

server.registerTool(
  "get_gate_status",
  {
    title: "Get the G1 gate status",
    description:
      "Read the live G1 computation (required, ready, conditions, missing keys) and the history of gate decisions (dates and roles only).",
    inputSchema: { caseId: caseIdSchema },
    annotations: READ_ONLY,
  },
  async ({ caseId }) =>
    readTool(casePath(caseId, "gate"), (body) => {
      const g = body.gate_status || {};
      const reconfirm = body.gate_reconfirm ? " Gate da riconfermare." : "";
      return `Gate G1: ${g.ok ?? 0} di ${g.required ?? 0} voci a posto, ${g.ready ? "pronto" : "non pronto"}.${reconfirm}${hiddenNote(body)}`;
    })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Unbundle casi MCP server running against ${API_URL}`);
}

main().catch((error) => {
  console.error("Unbundle casi MCP server failed:", error);
  process.exit(1);
});
