import { proposeAgentQuestion } from "@/lib/db/queries/use-case-factory";
import { proposalsDenial, requireCliWrite, resolveCliCase, runCliWrite } from "@/lib/use-cases/cli/case";
import { cliError, openCli, readCliBody } from "@/lib/use-cases/cli/route-kit";

/**
 * `unbundle ask <ID> "…"` (rilascio 8.0b): una domanda per il referente proposta da un coding agent. Non parte mai
 * da sola: la decide in «Cosa serve» chi prepara le domande, che riceve la notifica.
 */
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const opened = await openCli(request, { method: "POST", write: true });
  if (!opened.ok) return opened.response;
  const body = await readCliBody(request);
  if (!body.ok) return body.response;
  const resolved = await resolveCliCase(opened.value, body.body.caso);
  if (!resolved.ok) return resolved.response;
  const c = resolved.value;
  const denied = requireCliWrite(c);
  if (denied) return denied;
  const off = proposalsDenial(c);
  if (off) return cliError(off.status, off.code, off.message);
  const b = body.body;
  return runCliWrite(
    request,
    opened.value,
    "domande",
    b,
    async (id) => {
      const r = await proposeAgentQuestion(opened.value.executor, c.actor, c.target, { question: b.domanda, reason: b.perche, channel: "cli", id });
      return r.ok ? { ok: true, value: { id: r.value.id } } : r;
    },
    { reserveId: true },
  );
}
