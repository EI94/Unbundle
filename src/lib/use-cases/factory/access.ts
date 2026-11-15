import "server-only";
/**
 * I ruoli della fabbrica di chi guarda o scrive (rilascio 8.0c, RILASCIO-8.0c-ESTERNI.md §7): le porte della CLI,
 * dell'MCP del caso, delle azioni di chi costruisce e di «Progetto dell'agente» passano tutte da qui.
 *
 * Prima il filtro senza database (`mayBeExternalBuilder`): per una persona di Lateral Space, o per chi nel caso ha un
 * altro ruolo, il predicato non si legge e i ruoli restano quelli di oggi. Poi il predicato unico
 * (`isExternalBuilderOfCase`), riletto a ogni richiesta.
 */
import { ucLsDomains, type CaseAccess } from "@/lib/db/queries/uc-access";
import { isExternalBuilderOfCase } from "@/lib/db/queries/use-case-builders";
import type { UcExecutor } from "@/lib/db/uc-executor";
import { factoryAccessOf, mayBeExternalBuilder, type FactoryAccess } from "./builders";

export async function loadFactoryAccess(executor: UcExecutor, caseAccess: CaseAccess): Promise<FactoryAccess> {
  const external =
    mayBeExternalBuilder(caseAccess) && (await isExternalBuilderOfCase(executor, { caseId: caseAccess.caseId, userId: caseAccess.user.userId, lsDomains: ucLsDomains() }));
  return factoryAccessOf(caseAccess, external);
}
