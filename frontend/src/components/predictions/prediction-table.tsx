import type { DashboardPredictionItem } from "@/lib/prediction-api";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Table } from "@/components/retroui/Table";
import { ArrowUpDown, ChevronLeft, ChevronRight, Eye } from "lucide-react";

interface PredictionTableProps {
  items: DashboardPredictionItem[];
  total: number;
  limit: number;
  offset: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  hideClass?: boolean;
  onSort: (column: string) => void;
  onPageChange: (newOffset: number) => void;
  onRowClick: (predictionId: number) => void;
}

const RISK_BADGE_VARIANTS: Record<string, { bg: string; text: string }> = {
  HIGH_RISK: { bg: "bg-red-500 text-white border-2 border-black font-extrabold", text: "High Risk" },
  MODERATE_RISK: { bg: "bg-amber-500 text-white border-2 border-black font-extrabold", text: "Moderate" },
  NEEDS_MONITORING: { bg: "bg-yellow-400 text-black border-2 border-black font-extrabold", text: "Monitoring" },
  LOW_RISK: { bg: "bg-emerald-500 text-white border-2 border-black font-extrabold", text: "Low Risk" },
  INSUFFICIENT_DATA: { bg: "bg-gray-300 text-black border-2 border-black font-extrabold", text: "No Data" },
};

function SortableHeader({
  label,
  column,
  sortBy,
  sortOrder,
  onSort,
}: {
  label: string;
  column: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  onSort: (col: string) => void;
}) {
  const isActive = sortBy === column;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className="inline-flex items-center gap-1.5 font-bold hover:underline cursor-pointer"
    >
      {label}
      <ArrowUpDown
        size={14}
        className={isActive ? "text-black stroke-[2.5]" : "text-black/60"}
      />
      {isActive && (
        <span className="text-xs font-black">
          {sortOrder === "asc" ? "↑" : "↓"}
        </span>
      )}
    </button>
  );
}

export default function PredictionTable({
  items,
  total,
  limit,
  offset,
  sortBy,
  sortOrder,
  hideClass = false,
  onSort,
  onPageChange,
  onRowClick,
}: PredictionTableProps) {
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="flex flex-col">
      <Table wrapperClassName="border-0 shadow-md mb-2">
        <Table.Header className="text-black">
          <Table.Row className="border-b-2 border-black hover:bg-yellow-300">
            <Table.Head className="font-extrabold text-black whitespace-nowrap">
              <SortableHeader
                label="Student"
                column="student_name"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
            </Table.Head>
            {/* <Table.Head className="font-extrabold text-black whitespace-nowrap">LRN</Table.Head> */}
            {!hideClass && <Table.Head className="font-extrabold text-black whitespace-nowrap">Class</Table.Head>}
            <Table.Head className="font-extrabold text-black whitespace-nowrap">Subject</Table.Head>
            {/* <Table.Head className="font-extrabold text-black whitespace-nowrap">Term</Table.Head> */}
            <Table.Head className="font-extrabold text-black whitespace-nowrap">
              <SortableHeader
                label="Predicted Grade"
                column="predicted_period_grade"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
            </Table.Head>
            <Table.Head className="font-extrabold text-black whitespace-nowrap">Risk Level</Table.Head>
            <Table.Head className="font-extrabold text-black whitespace-nowrap">
              <SortableHeader
                label="Risk Score"
                column="risk_score"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
            </Table.Head>
            {/* <Table.Head className="w-16">

            </Table.Head> */}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {items.length === 0 ? (
            <Table.Row>
              <Table.Cell
                colSpan={hideClass ? 6 : 7}
                className="text-center py-12"
              >
                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="size-12 rounded-full bg-yellow-300 border-2 border-black flex items-center justify-center shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                    <Eye className="size-6 text-black" />
                  </div>
                  <span className="font-extrabold text-sm text-black uppercase">No At-Risk Students Found</span>
                  <span className="text-xs text-gray-600 font-semibold max-w-sm">
                    No predictions match the selected filters. All students in this query scope are currently on track.
                  </span>
                </div>
              </Table.Cell>
            </Table.Row>
          ) : (
            items.map((item) => {
              const riskMeta = RISK_BADGE_VARIANTS[item.risk_level] ?? {
                bg: "bg-gray-300 text-black",
                text: item.risk_level,
              };

              return (
                <Table.Row
                  key={item.prediction_id}
                  className="cursor-pointer border-b border-black/20 hover:bg-yellow-50/80 transition-colors"
                  onClick={() => onRowClick(item.prediction_id)}
                >
                  <Table.Cell className="font-semibold text-md whitespace-nowrap">
                    {item.student_name}
                  </Table.Cell>
                  {/* <Table.Cell className="text-gray-700 text-xs font-bold whitespace-nowrap">
                    {item.student_lrn}
                  </Table.Cell> */}
                  {!hideClass && <Table.Cell className="font-normal whitespace-nowrap">{item.class_name}</Table.Cell>}
                  <Table.Cell className="font-normal whitespace-nowrap">{item.subject_name}</Table.Cell>
                  {/* <Table.Cell className="font-normal whitespace-nowrap">{item.term_label}</Table.Cell> */}
                  <Table.Cell className="font-black text-base whitespace-nowrap">
                    {item.predicted_period_grade !== null
                      ? item.predicted_period_grade.toFixed(2)
                      : "—"}
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    <Badge
                      size="sm"
                      variant="surface"
                      className="whitespace-nowrap"
                    >
                      {riskMeta.text}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell className="font-bold text-gray-900 whitespace-nowrap">
                    {item.risk_score !== null ? item.risk_score.toFixed(1) : "—"}
                  </Table.Cell>
                  {/* <Table.Cell className="text-right whitespace-nowrap">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 w-8 p-1.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRowClick(item.prediction_id);
                      }}
                    >
                      <ArrowUpRight className="w-12 h-12" />
                    </Button>
                  </Table.Cell> */}
                </Table.Row>
              );
            })
          )}
        </Table.Body>
      </Table>

      {/* Bottom Sticky Pagination Footer */}
      {total > 0 && (
        <div className="sticky bottom-0 z-20 flex flex-col sm:flex-row items-center justify-between px-1 py-3 bg-white gap-3 shrink-0">
          <p className="text-md font-normal tracking-wide">
            Showing <span className="font-bold text-md">{offset + 1} </span>–
            <span className="font-bold text-md"> {Math.min(offset + limit, total)}</span> of{" "}
            <span className="font-bold text-md">{total} Predictions</span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              disabled={offset === 0}
              onClick={() => onPageChange(Math.max(0, offset - limit))}
              className="disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft size={12} className="mr-2 stroke-[2.5]" />
              Previous
            </Button>
            <span className="text-sm font-semibold text-black px-2.5 py-1 whitespace-nowrap">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              size="sm"
              variant="default"
              disabled={offset + limit >= total}
              onClick={() => onPageChange(offset + limit)}
              className="disabled:opacity-40 cursor-pointer"
            >
              Next
              <ChevronRight size={12} className="ml-2 stroke-[2.5]" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

