import { InvalidLinkCard, ReferentShell } from "@/components/uc/referente/link-card";

/**
 * Riserva: la pagina non chiama mai `notFound()`, ma se succedesse il
 * referente vede la stessa scheda di ogni link non valido, chiara e `noindex`
 * (layout di `/r`), invece del 404 della radice.
 */
export default function ReferentLinkNotFound() {
  return (
    <ReferentShell>
      <InvalidLinkCard />
    </ReferentShell>
  );
}
