import { Instrument_Serif } from "next/font/google";
import "@/components/mappatura/board.css";
import "@/components/mappatura/board-views.css";
import "@/components/mappatura/board-companion.css";

/**
 * La radice della board per l'«Intervista iniziale» (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7): la stessa chat
 * dell'assistente della board, con la sua grafica. Come il layout della mappatura (`mapping/layout.tsx`): i tre fogli
 * della board, che valgono solo sotto `data-board-root`, e il serif dei titoli, Instrument Serif. Il font si chiama solo
 * nei layout, mai in un componente: i test dei componenti li caricano con Node.
 */
const boardSerif = Instrument_Serif({ weight: "400", style: ["normal", "italic"], subsets: ["latin"], display: "swap", variable: "--font-board-serif" });

export default function InterviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-board-root="" className={boardSerif.variable}>
      {children}
    </div>
  );
}
