import { Instrument_Serif } from "next/font/google";
import "@/components/mappatura/board.css";
import "@/components/mappatura/board-views.css";
import "@/components/mappatura/board-companion.css";

/**
 * La radice della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.8): avvolge l'elenco delle unità e la board di
 * un'unità. Porta i tre fogli della board, che valgono solo sotto `data-board-root` (un foglio globale non si toglie
 * quando si cambia pagina), e il serif dei titoli e dei numeri: Instrument Serif, 400, tondo e corsivo, come sulla board
 * di riferimento. Geist e Geist Mono sono già su `<html>`.
 * Il font si chiama solo qui, mai in un componente: i test dei componenti li caricano con Node.
 */
const boardSerif = Instrument_Serif({ weight: "400", style: ["normal", "italic"], subsets: ["latin"], display: "swap", variable: "--font-board-serif" });

export default function MappingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-board-root="" className={boardSerif.variable}>
      {children}
    </div>
  );
}
