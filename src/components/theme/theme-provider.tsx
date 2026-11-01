"use client";

import type { ReactNode } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { THEME_PROVIDER_PROPS } from "./theme-config";

/**
 * Il tema scelto, per tutta l'app (vedi theme-config.ts). Lo script in linea di next-themes ha
 * `type="text/javascript"` nell'HTML del server, dove gira mentre il browser legge la pagina, e
 * `text/plain` nel render del client, dove React non lo esegue e non avvisa (guida di Next
 * «preventing-flash-before-hydration»).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      {...THEME_PROVIDER_PROPS}
      scriptProps={{ type: typeof window === "undefined" ? "text/javascript" : "text/plain" }}
    >
      {children}
    </NextThemesProvider>
  );
}
