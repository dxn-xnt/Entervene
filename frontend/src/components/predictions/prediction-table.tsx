import type { DashboardPredictionItem } from "@/lib/prediction-api";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/teacher/button";
import { Table } from "@/components/retroui/Table";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import { ArrowUpDown, ChevronLeft, ChevronRight, Eye } from "lucide-react";

interface PredictionTableProps {
  items: DashboardPredictionItem[];
  total: number;
  limit: number;
  offset: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  hideClass?: boolean;
  hideSubject?: boolean;
  hidePagination?: boolean;
  onSort: (column: string) => void;
  onPageChange: (newOffset: number) => void;
  onRowClick: (predictionId: number) => void;
  currentTerm?: boolean;
  onClearFilters?: () => void;
}

const RISK_BADGE_VARIANTS: Record<string, { bg: string; text: string }> = {
  HIGH_RISK: { bg: "bg-red-500 text-white border-2 border-black font-extrabold", text: "High Risk" },
  MODERATE_RISK: { bg: "bg-amber-500 text-white border-2 border-black font-extrabold", text: "Moderate" },
  NEEDS_MONITORING: { bg: "bg-yellow-400 text-black border-2 border-black font-extrabold", text: "Needs Monitoring" },
  LOW_RISK: { bg: "bg-emerald-500 text-white border-2 border-black font-extrabold", text: "Low Risk" },
  INSUFFICIENT_DATA: { bg: "bg-gray-300 text-black border-2 border-black font-extrabold", text: "Insufficient Data" },
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
      className="inline-flex items-center gap-1.5 font-bold cursor-pointer"
    >
      {label}
      <ArrowUpDown
        size={14}
        className={isActive ? "text-primary-foreground stroke-[2.5]" : "text-primary-foreground/60"}
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
  hideSubject = false,
  hidePagination = false,
  onSort,
  onPageChange,
  onRowClick,
  currentTerm = false,
  onClearFilters,
}: PredictionTableProps) {
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit) || 1;
  const colSpanCount = (currentTerm ? 3 : 4) + (!hideClass ? 1 : 0) + (!hideSubject ? 1 : 0);

  return (
    <div className="flex flex-col">
      <Table wrapperClassName="mb-2 hover:shadow-none transition-all">
        <Table.Header className="bg-primary text-primary-foreground">
          <Table.Row className="border-b-2 border-black bg-primary hover:bg-primary">
            <Table.Head className="font-extrabold text-primary-foreground whitespace-nowrap">
              <SortableHeader
                label="Student"
                column="student_name"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
            </Table.Head>
            {/* <Table.Head className="font-extrabold text-black whitespace-nowrap">LRN</Table.Head> */}
            {!hideClass && <Table.Head className="font-extrabold text-primary-foreground whitespace-nowrap">Class</Table.Head>}
            {!hideSubject && <Table.Head className="font-extrabold text-primary-foreground whitespace-nowrap">Subject</Table.Head>}
            <Table.Head className="font-extrabold text-primary-foreground whitespace-nowrap text-center">Risk Level</Table.Head>
            {!currentTerm && <Table.Head className="font-extrabold text-foreground text-right">
              <SortableHeader
                label="Risk Score"
                column="risk_score"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
            </Table.Head>}
            {/* <Table.Head className="font-extrabold text-black whitespace-nowrap">Term</Table.Head> */}
            <Table.Head className="font-extrabold text-primary-foreground whitespace-nowrap text-right">
              <SortableHeader
                label={currentTerm ? "Projected Grade" : "Predicted Grade"}
                column="predicted_period_grade"
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
                colSpan={colSpanCount}
                className="p-0"
              >
                <TeacherEmptyState
                  icon={<Eye />}
                  title={onClearFilters ? "No predictions match your filters" : "No prediction results available"}
                  description={onClearFilters ? "Try another search term or clear your filters." : "No current-term projections are available for this scope."}
                  action={onClearFilters ? { label: "Clear Filters", onClick: onClearFilters } : undefined}
                  compact
                  className="rounded-none border-0 bg-transparent shadow-none hover:shadow-none"
                />
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
                  {!hideSubject && <Table.Cell className="font-normal whitespace-nowrap">{item.subject_name}</Table.Cell>}
                  <Table.Cell className="whitespace-nowrap text-center">
                    <Badge
                      size="sm"
                      variant="surface"
                      className="whitespace-nowrap"
                    >
                      {currentTerm && item.historical_projection ? "Historical projection" : riskMeta.text}
                    </Badge>
                  </Table.Cell>
                  {/* <Table.Cell className="font-normal whitespace-nowrap">{item.term_label}</Table.Cell> */}
                  <Table.Cell className="font-black text-base whitespace-nowrap text-right">
                    {currentTerm && item.historical_projection ? <div>
                      {item.official_final_grade != null && <p>Final Grade: {item.official_final_grade.toFixed(2)}</p>}
                      <p className="text-xs font-normal">Earlier projection: {item.predicted_period_grade?.toFixed(2) ?? "Not available"}</p>
                    </div> : item.risk_level === "INSUFFICIENT_DATA" || item.predicted_period_grade === null
                      ? "—"
                      : item.predicted_period_grade.toFixed(2)}
                  </Table.Cell>

                  {!currentTerm && <Table.Cell className="font-bold text-gray-900 whitespace-nowrap">
                    {item.risk_level === "INSUFFICIENT_DATA" || item.risk_score === null
                      ? "—"
                      : item.risk_score.toFixed(1)}
                  </Table.Cell>}
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
      {!hidePagination && total > 0 && (
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
              <ChevronLeft size={12} className="stroke-[2.5]" />
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
              <ChevronRight size={12} className="stroke-[2.5]" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

