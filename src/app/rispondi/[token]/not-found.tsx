import { StateScreen } from "@/components/use-cases/referent-public/state-card";

/**
 * Riserva: la pagina non chiama mai `notFound()`, ma se succedesse il referente vede la scheda di ogni
 * link non valido, chiara e `noindex` (layout di `/rispondi`), invece del 404 della radice.
 */
export default function ReferentAskNotFound() {
  return <StateScreen kind="invalid" />;
}
