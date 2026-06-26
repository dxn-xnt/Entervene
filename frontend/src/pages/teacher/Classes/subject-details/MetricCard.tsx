type MetricCardProps = {
  title: string;
  value: string;
  note: string;
};

export default function MetricCard({ title, value, note }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-black bg-[#F6E9B2] p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <p className="font-semibold text-gray-900">{title}</p>
      <p className="mt-2 text-4xl font-bold">{value}</p>
      <p className="mt-1 text-xs font-medium text-gray-700">{note}</p>
    </div>
  );
}
