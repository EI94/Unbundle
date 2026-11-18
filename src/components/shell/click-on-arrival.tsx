"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Un tocco al primo disegno sul controllo che avvolge (rilascio 10): «Nuovo workspace» dal selettore della barra porta a
 * `/dashboard?nuovo=1`, dove il dialogo di creazione si apre da solo, come se la persona avesse toccato il pulsante.
 * Il dialogo resta quello di sempre (`CreateWorkspaceDialog`, che si apre al tocco su ciò che contiene).
 */
export function ClickOnArrival({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.click();
  }, []);
  return (
    <span ref={ref} className="contents">
      {children}
    </span>
  );
}
