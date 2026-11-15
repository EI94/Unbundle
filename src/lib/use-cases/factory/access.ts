import "server-only";
/**
 * I ruoli della fabbrica di chi guarda o scrive (rilascio 8.0c, RILASCIO-8.0c-ESTERNI.md §7): le porte della CLI,
 * dell'MCP del caso, delle azioni di chi costruisce e di «Progetto dell'agente» passano tutte da qui.
 *
 * Prima il filtro senza database (`mayBeExternalBuilder`): per una persona di Lateral Space, o per chi nel caso ha un
 * altro ruolo, il predicato non si legge e i ruoli restano quelli di oggi. Poi il predicato unico
 * (`externalBuilderGate`), riletto a ogni richiesta, con il perché quando le porte lo devono dire (`blocked`: la 0037
 * non pronta a chi ha una concessione è «riprova», non «non hai un ruolo»).
 */
import { ucLsDomains, type CaseAccess } from "@/lib/db/queries/uc-access";
import { externalBuilderGate } from "@/lib/db/queries/use-case-builders";
import type { UcExecutor } from "@/lib/db/uc-executor";
import { factoryAccessOf, mayBeExternalBuilder, type FactoryAccess } from "./builders";

export async function loadFactoryAccess(executor: UcExecutor, caseAccess: CaseAccess): Promise<FactoryAccess> {
  if (!mayBeExternalBuilder(caseAccess)) return factoryAccessOf(caseAccess, false);
  const gate = await externalBuilderGate(executor, { caseId: caseAccess.caseId, userId: caseAccess.user.userId, lsDomains: ucLsDomains() });
  return factoryAccessOf(caseAccess, gate.builds, gate.blocked);
}
