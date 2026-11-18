import { Suspense, type ReactNode } from "react";

/**
 * Il posto della campanella nella cornice (rilascio 10): la campanella arriva dal server insieme alla pagina, e finché
 * non c'è il suo posto resta vuoto, della stessa misura (44 px al telefono, 36 px da 640 px): la cornice non la aspetta
 * e niente si sposta quando arriva.
 */
export function BellSlot({ bell }: { bell: ReactNode }) {
  return <Suspense fallback={<span aria-hidden className="size-11 shrink-0 sm:size-9" />}>{bell}</Suspense>;
}
