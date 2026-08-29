import { LoadingPanel } from "@/components/loading-panel";

export function LoadingCard({ label }: { label: string }) {
  return (
    <LoadingPanel label={label} className="w-full" />
  );
}
