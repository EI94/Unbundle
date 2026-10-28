import type { ReactNode } from "react";

/**
 * Guscio dell'area «Use case» (pagina, scheda, «Nuovo use case», caricamento, errori, «non
 * trovato»): solo il segno `data-use-case-root`, che in globals.css alza il contrasto dei testi
 * secondari, dei bordi dei campi e del fuoco, come `data-uc-case-root` nel dossier. Nessuna
 * lettura: ogni pagina controlla l'accesso da sé. `contents`: nessun riquadro in più, la pagina
 * resta figlia diretta di `SidebarInset`.
 */
export default function UseCasesLayout({ children }: { children: ReactNode }) {
  return (
    <div data-use-case-root="" className="contents">
      {children}
    </div>
  );
}
