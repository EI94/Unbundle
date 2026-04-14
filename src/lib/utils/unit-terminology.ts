import type { Workspace } from "@/lib/db/schema";

export interface UnitTerm {
  singular: string;
  plural: string;
}

const DEFAULT_TERM: UnitTerm = {
  singular: "funzione",
  plural: "funzioni",
};

export function getUnitTerm(
  workspace: Pick<Workspace, "unitTerminology"> | null | undefined
): UnitTerm {
  const t = workspace?.unitTerminology as UnitTerm | null | undefined;
  if (t?.singular && t?.plural) return t;
  return DEFAULT_TERM;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
