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
  onSort: (column: string) => void;
  onPageChange: (newOffset: number) => void;
  onRowClick: (predictionId: number) => void;
}

const RISK_BADGE_VARIANTS: Record<string, { bg: string; text: string }> = {
  HIGH_RISK: { bg: "bg-red-500 text-white", text: "High Risk" },
  MODERATE_RISK: { bg: "bg-amber-500 text-white", text: "Moderate" },
  NEEDS_MONITORING: { bg: "bg-yellow-400 text-black", text: "Monitoring" },
  LOW_RISK: { bg: "bg-emerald-500 text-white", text: "Low Risk" },
  INSUFFICIENT_DATA: { bg: "bg-gray-400 text-white", text: "No Data" },
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
  onSort,
  onPageChange,
  onRowClick,
}: PredictionTableProps) {
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-white rounded-none relative flex flex-col overflow-hidden">
      <Table wrapperClassName="border-0">
        <Table.Header className="bg-yellow-300 text-black border-b-2 border-black">
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
            <Table.Head className="font-extrabold text-black whitespace-nowrap">LRN</Table.Head>
            <Table.Head className="font-extrabold text-black whitespace-nowrap">Class</Table.Head>
            <Table.Head className="font-extrabold text-black whitespace-nowrap">Subject</Table.Head>
            <Table.Head className="font-extrabold text-black whitespace-nowrap">Term</Table.Head>
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
            <Table.Head className="font-extrabold text-black text-right pr-4 whitespace-nowrap">
              Action
            </Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {items.length === 0 ? (
            <Table.Row>
              <Table.Cell
                colSpan={9}
                className="text-center py-12 text-gray-500 font-semibold text-base"
              >
                No predictions match the current filters.
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
                  <Table.Cell className="font-bold text-black whitespace-nowrap">
                    {item.student_name}
                  </Table.Cell>
                  <Table.Cell className="text-gray-700 text-xs font-mono font-bold whitespace-nowrap">
                    {item.student_lrn}
                  </Table.Cell>
                  <Table.Cell className="text-gray-800 font-medium whitespace-nowrap">{item.class_name}</Table.Cell>
                  <Table.Cell className="text-gray-800 font-medium whitespace-nowrap">{item.subject_name}</Table.Cell>
                  <Table.Cell className="text-gray-800 font-semibold whitespace-nowrap">{item.term_label}</Table.Cell>
                  <Table.Cell className="font-black text-base font-mono whitespace-nowrap">
                    {item.predicted_period_grade !== null
                      ? item.predicted_period_grade.toFixed(2)
                      : "—"}
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    <Badge
                      className={`border-2 border-black font-extrabold uppercase px-2.5 py-1 text-xs shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] whitespace-nowrap inline-flex items-center justify-center ${riskMeta.bg}`}
                    >
                      {riskMeta.text}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell className="font-mono font-bold text-gray-900 whitespace-nowrap">
                    {item.risk_score !== null ? item.risk_score.toFixed(1) : "—"}
                  </Table.Cell>
                  <Table.Cell className="text-right pr-4 whitespace-nowrap">
                    <Button
                      size="sm"
                      className="h-8 px-2 border-2 border-black bg-white hover:bg-yellow-300 text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRowClick(item.prediction_id);
                      }}
                    >
                      <Eye size={14} className="stroke-[2.5]" />
                    </Button>
                  </Table.Cell>
                </Table.Row>
              );
            })
          )}
        </Table.Body>
      </Table>

      {/* Bottom Sticky Pagination Footer */}
      {total > 0 && (
        <div className="sticky bottom-0 z-20 flex flex-col sm:flex-row items-center justify-between border-t-2 border-black px-4 py-3 bg-white gap-3 shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
          <p className="text-xs font-extrabold text-black uppercase tracking-wide">
            Showing <span className="font-mono font-black text-sm">{offset + 1}</span>–
            <span className="font-mono font-black text-sm">{Math.min(offset + limit, total)}</span> of{" "}
            <span className="font-mono font-black text-sm">{total}</span> predictions
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={offset === 0}
              onClick={() => onPageChange(Math.max(0, offset - limit))}
              className="h-8 px-3 border-2 border-black bg-white hover:bg-yellow-300 text-black disabled:opacity-40 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-bold text-xs cursor-pointer"
            >
              <ChevronLeft size={16} className="mr-1 stroke-[2.5]" />
              Previous
            </Button>
            <span className="text-xs font-black text-black px-2.5 py-1 bg-yellow-100 border-2 border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] whitespace-nowrap">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              size="sm"
              disabled={offset + limit >= total}
              onClick={() => onPageChange(offset + limit)}
              className="h-8 px-3 border-2 border-black bg-white hover:bg-yellow-300 text-black disabled:opacity-40 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-bold text-xs cursor-pointer"
            >
              Next
              <ChevronRight size={16} className="ml-1 stroke-[2.5]" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

