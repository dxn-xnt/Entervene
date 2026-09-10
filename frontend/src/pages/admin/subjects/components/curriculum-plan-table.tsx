import { Archive, Check, Ellipsis, Pencil, RotateCcw } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Table } from "@/components/retroui/Table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  minutes: number | null;
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
  pathway?: SubjectOfferingPathway | "all";
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
      {status === "active" ? "Active" : "Archived"}
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
        subjectGroup: (typeof primaryOffering.subject.subject_group === "object" ? (primaryOffering.subject.subject_group as any)?.name : primaryOffering.subject.subject_group) ?? null,
        minutes: primaryOffering.minutes ?? null,
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
  readOnly = false,
  readOnlyReason,
  onEdit,
  onArchive,
  onRestore,
}: CurriculumPlanTableProps) {
  const terms = displayPeriods(periods);
  const rows = groupOfferingsForCurriculumPlan(offerings, terms, catalogSubjects);

  return (
    <Card className="w-full overflow-hidden p-0 shadow-md">
      <Card.Header className="border-b-2 border-black bg-primary p-3 mb-0">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex flex-row gap-2 items-end">
              <h2 className="text-2xl font-bold">
                {gradeLabel}
              </h2>
              <p className="mb-0.5 text-base">
                ({academicYearLabel})
              </p>
            </div>
            <div className="flex gap-2">
              <Badge size="sm" variant="solid">
                {rows.length} subject{rows.length === 1 ? "" : "s"}
              </Badge>
              <Badge size="sm" variant="solid">
                {terms.length} term{terms.length === 1 ? "" : "s"}
              </Badge>
            </div>
          </div>
          <Badge size="sm" variant="outline">
            {pathwayLabel}
          </Badge>
        </div>
      </Card.Header>

      <Table wrapperClassName="border-0" className="border-0 shadow-none">
        <Table.Header className="bg-primary text-black font-sans border-b-2 border-border">
          <Table.Row className="border-b-2 border-black hover:bg-transparent">
            <Table.Head className="font-bold text-sm text-black">Subject</Table.Head>
            <Table.Head className="font-bold text-sm text-black">Code</Table.Head>
            <Table.Head className="font-bold text-sm text-black">Group</Table.Head>
            {terms.map((term) => (
              <Table.Head key={term.academic_period_id} className="text-center font-bold text-sm text-black">
                {formatPeriodLabel(term)}
              </Table.Head>
            ))}
            <Table.Head className="font-bold text-sm text-black">Minutes</Table.Head>
            <Table.Head className="font-bold text-sm text-black">Grading Template</Table.Head>
            <Table.Head className="w-10 text-center font-bold text-sm text-black">Status</Table.Head>
            <Table.Head className="w-8 text-right font-bold text-sm text-black">Actions</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((row) => (
            <Table.Row key={row.key} className="border-b border-border last:border-b-0">
              <Table.Cell className="font-semibold">{row.subjectName}</Table.Cell>
              <Table.Cell>{subjectCode(row.subjectCode)}</Table.Cell>
              <Table.Cell>{row.subjectGroup || "Ungrouped"}</Table.Cell>
              {terms.map((term) => {
                const termOffering = row.termOfferings.get(term.academic_period_id);
                return (
                  <Table.Cell key={term.academic_period_id} className="text-center">
                    {termOffering ? (
                      <span
                        className="inline-grid size-7 place-items-center rounded-full border-2 border-black bg-primary"
                        title={`${row.subjectName} is offered in ${formatPeriodLabel(term)}`}
                      >
                        <Check className="size-4" />
                      </span>
                    ) : (
                      <span className="text-black/50">-</span>
                    )}
                  </Table.Cell>
                );
              })}
              <Table.Cell>{row.minutes ? `${row.minutes} mins` : "—"}</Table.Cell>
              <Table.Cell>{row.gradingTemplate || "No template"}</Table.Cell>
              <Table.Cell className="w-10 text-center">{statusBadge(row.status)}</Table.Cell>
              <Table.Cell>
                <div className="flex w- justify-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 w-8 p-0"
                        disabled={readOnly}
                        title={readOnly ? readOnlyReason : "Actions"}
                        aria-label="Actions"
                      >
                        <Ellipsis className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="border-2 min-w-[140px]">
                      <DropdownMenuItem
                        onClick={() => onEdit(row.primaryOffering)}
                        disabled={readOnly}
                        className="gap-2 cursor-pointer"
                      >
                        <Pencil className="size-4" /> Edit
                      </DropdownMenuItem>
                      {row.primaryOffering.status === "active" ? (
                        <DropdownMenuItem
                          onClick={() => onArchive(row.primaryOffering)}
                          disabled={readOnly}
                          className="gap-2 cursor-pointer"
                        >
                          <Archive className="size-4" /> Archive
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onClick={() => onRestore(row.primaryOffering)}
                          disabled={readOnly}
                          className="gap-2 cursor-pointer"
                        >
                          <RotateCcw className="size-4" /> Restore
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </Card>
  );
}

