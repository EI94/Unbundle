import { revokeCliTokenById } from "@/lib/db/queries/use-case-cli-auth";
import { cliJson, openCli } from "@/lib/use-cases/cli/route-kit";

/** `unbundle logout` (rilascio 8.0b): revoca il token con cui si chiama. La CLI poi lo toglie dal portachiavi. */
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const opened = await openCli(request, { method: "POST", write: true });
  if (!opened.ok) return opened.response;
  const revoked = await revokeCliTokenById(opened.value.executor, opened.value.principal);
  return cliJson({ revocato: revoked });
}
