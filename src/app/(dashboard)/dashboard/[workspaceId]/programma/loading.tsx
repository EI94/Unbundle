import { Skeleton } from "@/components/ui/skeleton";

/** «Programma» si carica: lo scheletro riserva la testata, i quattro risultati, il grafico e le iniziative. */
export default function ProgramLoading() {
  return (
    <div className="flex-1 space-y-8 p-4 sm:p-6 lg:p-8">
      <p role="status" className="sr-only">
        Caricamento…
      </p>
      <div className="space-y-2" aria-hidden>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-xl" aria-hidden />
      <Skeleton className="h-48 w-full rounded-xl" aria-hidden />
    </div>
  );
}
