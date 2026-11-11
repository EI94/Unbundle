import { addTeamDecision } from "@/lib/db/queries/use-case-factory";
import { requireCliWrite, resolveCliCase, runCliWrite } from "@/lib/use-cases/cli/case";
import { openCli, readCliBody } from "@/lib/use-cases/cli/route-kit";

/** `unbundle decide <ID> …` (rilascio 8.0b): una decisione del team, che entra nel brief di ogni coding agent. */
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
  const b = body.body;
  return runCliWrite(
    request,
    opened.value,
    "decisioni",
    b,
    async (id) => {
      const r = await addTeamDecision(opened.value.executor, c.actor, c.target, { topic: b.argomento, choice: b.decisione, reason: b.perche, rejected: b.scartata, topicKey: b.chiaveArgomento ?? null, id });
      return r.ok ? { ok: true, value: { id: r.value.id } } : r;
    },
    { reserveId: true },
  );
}
