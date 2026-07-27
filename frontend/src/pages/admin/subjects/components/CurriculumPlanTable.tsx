import { Archive, Check, Pencil, RotateCcw } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card as RetroCard } from "@/components/retroui/Card";
import { formatPeriodLabel } from "@/lib/academic-periods";
import type {
  SubjectListItem,
  SubjectOfferingAcademicPeriod,
  SubjectOfferingListItem,
  SubjectOfferingPathway,
  SubjectStatus,
} from "@/lib/api";

const FALLBACK_TERMS: SubjectOfferingAcademicPeriod[] = [
  {
    academic_period_id: -1,
    period_name: "Term 1",
    period_type: "TERM",
    period_sequence: 1,
    academic_year_id: -1,
  },
  {
    academic_period_id: -2,
    period_name: "Term 2",
    period_type: "TERM",
    period_sequence: 2,
    academic_year_id: -1,
  },
  {
    academic_period_id: -3,
    period_name: "Term 3",
    period_type: "TERM",
    period_sequence: 3,
    academic_year_id: -1,
  },
];

export type CurriculumPlanRow = {
  key: string;
  subjectId: number;
  subjectName: string;
  subjectCode: string | null;
  subjectGroup: string | null;
  hours: number | null;
  gradingTemplate: string | null;
  status: SubjectStatus;
  primaryOffering: SubjectOfferingListItem;
  termOfferings: Map<number, SubjectOfferingListItem>;
};

type CurriculumPlanTableProps = {
  offerings: SubjectOfferingListItem[];
  periods: SubjectOfferingAcademicPeriod[];
  catalogSubjects: SubjectListItem[];
  academicYearLabel: string;
  gradeLabel: string;
  pathwayLabel: string;
  pathway: SubjectOfferingPathway | "all";
  readOnly?: boolean;
  readOnlyReason?: string;
  onEdit: (offering: SubjectOfferingListItem) => void;
  onArchive: (offering: SubjectOfferingListItem) => void;
  onRestore: (offering: SubjectOfferingListItem) => void;
};

function subjectCode(value: string | null) {
  return value || "No code";
}

function statusBadge(status: SubjectStatus) {
  return (
    <Badge size="sm" variant={status === "active" ? "surface" : "outline"}>
      {status}
    </Badge>
  );
}

function displayPeriods(periods: SubjectOfferingAcademicPeriod[]) {
  const sorted = [...periods].sort((a, b) => a.period_sequence - b.period_sequence);
  return (sorted.length ? sorted : FALLBACK_TERMS).slice(0, 3);
}

function choosePrimaryOffering(
  offerings: SubjectOfferingListItem[],
  periods: SubjectOfferingAcademicPeriod[]
) {
  const periodIds = new Set(periods.map((period) => period.academic_period_id));
  const currentTermOffering = offerings.find((offering) =>
    periodIds.has(offering.academic_period.academic_period_id)
  );
  return currentTermOffering ?? offerings[0];
}

export function groupOfferingsForCurriculumPlan(
  offerings: SubjectOfferingListItem[],
  periods: SubjectOfferingAcademicPeriod[],
  catalogSubjects: SubjectListItem[]
): CurriculumPlanRow[] {
  const catalogById = new Map(catalogSubjects.map((subject) => [subject.subject_id, subject]));
  const grouped = new Map<string, SubjectOfferingListItem[]>();

  for (const offering of offerings) {
    const key = [
      offering.academic_year.academic_year_id,
      offering.academic_level.academic_level_id,
      offering.pathway,
      offering.subject.subject_id,
    ].join(":");
    grouped.set(key, [...(grouped.get(key) ?? []), offering]);
  }

  return [...grouped.entries()]
    .map(([key, groupedOfferings]) => {
      const primaryOffering = choosePrimaryOffering(groupedOfferings, periods);
      const catalogSubject = catalogById.get(primaryOffering.subject.subject_id);
      const termOfferings = new Map<number, SubjectOfferingListItem>();
      const rowStatus: SubjectStatus = groupedOfferings.some((offering) => offering.status === "active")
        ? "active"
        : "archived";

      for (const offering of groupedOfferings) {
        termOfferings.set(offering.academic_period.academic_period_id, offering);
      }

      return {
        key,
        subjectId: primaryOffering.subject.subject_id,
        subjectName: primaryOffering.subject.subject_name,
        subjectCode: primaryOffering.subject.subject_codename,
        subjectGroup: primaryOffering.subject.subject_group,
        hours: catalogSubject?.hours ?? null,
        gradingTemplate: catalogSubject?.default_grading_template ?? null,
        status: rowStatus,
        primaryOffering,
        termOfferings,
      };
    })
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
}

export function CurriculumPlanTable({
  offerings,
  periods,
  catalogSubjects,
  academicYearLabel,
  gradeLabel,
  pathwayLabel,
  pathway,
  readOnly = false,
  readOnlyReason,
  onEdit,
  onArchive,
  onRestore,
}: CurriculumPlanTableProps) {
  const terms = displayPeriods(periods);
  const rows = groupOfferingsForCurriculumPlan(offerings, terms, catalogSubjects);

  return (
    <RetroCard className="w-full overflow-hidden p-0">
      <div className="border-b-2 border-black bg-[#fff1b8] p-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-xl font-bold">
              {gradeLabel} • {pathwayLabel} • {academicYearLabel}
            </h2>
            <p className="text-sm font-semibold">
              {rows.length} subject{rows.length === 1 ? "" : "s"} • {terms.length} term{terms.length === 1 ? "" : "s"}
            </p>
          </div>
          <Badge size="sm" variant="outline">
            {pathway === "all" ? "Mixed pathway" : "Curriculum Plan"}
          </Badge>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="border-b-2 border-black bg-[#fff7d6]">
            <tr>
              <th className="px-3 py-2 font-bold">Subject</th>
              <th className="px-3 py-2 font-bold">Code</th>
              <th className="px-3 py-2 font-bold">Group</th>
              {terms.map((term) => (
                <th key={term.academic_period_id} className="px-3 py-2 text-center font-bold">
                  {formatPeriodLabel(term)}
                </th>
              ))}
              <th className="px-3 py-2 font-bold">Hours</th>
              <th className="px-3 py-2 font-bold">Grading Template</th>
              <th className="px-3 py-2 font-bold">Status</th>
              <th className="px-3 py-2 text-right font-bold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-black/20 last:border-b-0">
                <td className="px-3 py-2 font-semibold">{row.subjectName}</td>
                <td className="px-3 py-2">{subjectCode(row.subjectCode)}</td>
                <td className="px-3 py-2">{row.subjectGroup || "Ungrouped"}</td>
                {terms.map((term) => {
                  const termOffering = row.termOfferings.get(term.academic_period_id);
                  return (
                    <td key={term.academic_period_id} className="px-3 py-2 text-center">
                      {termOffering ? (
                        <span
                          className="inline-grid size-7 place-items-center rounded-full border-2 border-black bg-[#bbf7d0]"
                          title={`${row.subjectName} is offered in ${formatPeriodLabel(term)}`}
                        >
                          <Check className="size-4" />
                        </span>
                      ) : (
                        <span className="text-black/50">-</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-2">{row.hours ?? "-"}</td>
                <td className="px-3 py-2">{row.gradingTemplate || "No template"}</td>
                <td className="px-3 py-2">{statusBadge(row.status)}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => onEdit(row.primaryOffering)}
                      disabled={readOnly}
                      title={readOnly ? readOnlyReason : "Edit offering"}
                    >
                      <Pencil className="mr-1 size-4" /> Edit
                    </Button>
                    {row.primaryOffering.status === "active" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => onArchive(row.primaryOffering)}
                        disabled={readOnly}
                        title={readOnly ? readOnlyReason : "Archive offering"}
                      >
                        <Archive className="mr-1 size-4" /> Archive
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => onRestore(row.primaryOffering)}
                        disabled={readOnly}
                        title={readOnly ? readOnlyReason : "Restore offering"}
                      >
                        <RotateCcw className="mr-1 size-4" /> Restore
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RetroCard>
  );
}
