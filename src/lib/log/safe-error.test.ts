import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { logSafeError, summarizeError } from "./safe-error.ts";

const SECRET_TEXT = "Persona Inventata persona.inventata@example.test ub_mcp_tokenfinto";

test("errore del database: nome, SQLSTATE e vincolo, mai messaggio o detail", () => {
  const error = Object.assign(new Error(`duplicate key value: ${SECRET_TEXT}`), {
    name: "NeonDbError",
    code: "23505",
    constraint: "use_cases_workspace_code_idx",
    detail: `Key (title)=(${SECRET_TEXT}) already exists.`,
  });
  const summary = summarizeError(error);
  assert.deepEqual(summary, { name: "NeonDbError", code: "23505", constraint: "use_cases_workspace_code_idx" });
  assert.equal(JSON.stringify(summary).includes("Inventata"), false);
});

test("errore zod: solo i percorsi dei campi", () => {
  const parsed = z.object({ title: z.string().max(3), submittedBy: z.object({ email: z.string().email() }) }).safeParse({
    title: SECRET_TEXT,
    submittedBy: { email: SECRET_TEXT },
  });
  assert.equal(parsed.success, false);
  const summary = summarizeError(parsed.error);
  assert.equal(summary.name, "ZodError");
  assert.deepEqual(summary.fields?.sort(), ["submittedBy.email", "title"]);
  assert.equal(JSON.stringify(summary).includes("Inventata"), false);
});

test("valori strani: nessuna eccezione, nessun contenuto", () => {
  assert.deepEqual(summarizeError(null), { name: "object" });
  assert.deepEqual(summarizeError(SECRET_TEXT), { name: "string" });
  assert.deepEqual(summarizeError({ name: SECRET_TEXT, code: SECRET_TEXT }), { name: "Error" });
});

test("logSafeError scrive una riga senza il payload", () => {
  const lines: unknown[][] = [];
  logSafeError("portfolio/submit", "submit_failed", new Error(SECRET_TEXT), { workspaceId: "ws-1" }, { error: (...args: unknown[]) => lines.push(args) });
  assert.equal(lines.length, 1);
  const text = lines[0].join(" ");
  assert.match(text, /\[portfolio\/submit\] submit_failed/);
  assert.match(text, /"workspaceId":"ws-1"/);
  assert.equal(text.includes("Inventata") || text.includes("ub_mcp_") || text.includes("@example.test"), false);
});
