import { Card as RetroCard } from "@/components/retroui/Card";
import { Loader } from "@/components/retroui/Loader";

export function LoadingCard({ label }: { label: string }) {
  return (
    <RetroCard className="flex w-full items-center gap-3 p-4 text-sm">
      <Loader size="sm" />
      <span>{label}</span>
    </RetroCard>
  );
}
