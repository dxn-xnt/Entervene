import { useEffect, useMemo, useState } from "react";
import { Check, Pencil } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card, Card as RetroCard } from "@/components/retroui/Card";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Table } from "@/components/retroui/Table";
import { Checkbox } from "@/components/retroui/Checkbox";
import {
  CANONICAL_PATHWAYS,
  canonicalizePathway,
  getPathwayDisplayName,
} from "@/lib/pathways";
import type {
  GradingTemplateListItem,
  SubjectListItem,
  SubjectOfferingAcademicPeriod,
  SubjectOfferingFormOptions,
} from "@/lib/api";
import { TARGET_GRADES } from "../subjects/components/subject-utils";

type CatalogImportDraftRow = {
  subject_code: string;
  subject_name: string;
  grade_level: string;
  grading_template: string;
  description: string;
};

export type OfferingImportDraftRow = {
  academic_year: string;
  grade_level: string;
  pathway: string;
  term: string;
  subject_code: string;
  minutes: string;
};

const CATALOG_CSV_HEADERS = [
  "subject_code",
  "subject_name",
  "grade_level",
  "grading_template",
  "description",
] as const;

const OFFERING_CSV_HEADERS = [
  "academic_year",
  "grade_level",
  "pathway",
  "term",
  "subject_code",
  "minutes",
] as const;

function parseCsvMatrix(text: string): string[][] {
  const normalized = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        currentCell += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentCell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      currentRow.push(currentCell.trim());
      currentCell = "";
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && next === "\n") i++;
      currentRow.push(currentCell.trim());
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
    } else {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  return rows;
}

function parseCatalogImportRows(text: string): CatalogImportDraftRow[] | null {
  const matrix = parseCsvMatrix(text);
  if (matrix.length < 2) return null;
  const header = matrix[0].map((h) => h.trim());
  const isMatchingHeader =
    header.length === CATALOG_CSV_HEADERS.length &&
    CATALOG_CSV_HEADERS.every((expected, idx) => header[idx] === expected);
  if (!isMatchingHeader) return null;

  const parsed: CatalogImportDraftRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || row.every((cell) => !cell)) continue;
    parsed.push({
      subject_code: row[0] ?? "",
      subject_name: row[1] ?? "",
      grade_level: row[2] ?? "",
      grading_template: row[3] ?? "",
      description: row[4] ?? "",
    });
  }
  return parsed.length > 0 ? parsed : null;
}

function parseOfferingImportRows(text: string): OfferingImportDraftRow[] | null {
  const matrix = parseCsvMatrix(text);
  if (matrix.length < 2) return null;
  const header = matrix[0].map((h) => h.trim().toLowerCase());
  const hasAllHeaders = OFFERING_CSV_HEADERS.every((exp) => header.includes(exp));
  if (!hasAllHeaders) return null;

  const idxYear = header.indexOf("academic_year");
  const idxGrade = header.indexOf("grade_level");
  const idxPathway = header.indexOf("pathway");
  const idxTerm = header.indexOf("term");
  const idxCode = header.indexOf("subject_code");
  const idxMinutes = header.indexOf("minutes");

  const parsed: OfferingImportDraftRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || row.every((cell) => !cell)) continue;
    parsed.push({
      academic_year: row[idxYear] ?? "",
      grade_level: row[idxGrade] ?? "",
      pathway: row[idxPathway] ?? "general",
      term: row[idxTerm] ?? "",
      subject_code: row[idxCode] ?? "",
      minutes: row[idxMinutes] ?? "60",
    });
  }
  return parsed.length > 0 ? parsed : null;
}

function escapeCsvCell(value: string): string {
  const trimmed = value.trim();
  if (/[",\r\n]/.test(trimmed)) {
    return `"${trimmed.replace(/"/g, '""')}"`;
  }
  return trimmed;
}

function buildCatalogCsvFile(rows: CatalogImportDraftRow[], originalName: string): File {
  const lines = [
    CATALOG_CSV_HEADERS.join(","),
    ...rows.map((row) =>
      [
        escapeCsvCell(row.subject_code),
        escapeCsvCell(row.subject_name),
        escapeCsvCell(row.grade_level),
        escapeCsvCell(row.grading_template),
        escapeCsvCell(row.description),
      ].join(","),
    ),
  ];
  return new File([lines.join("\n") + "\n"], originalName || "subject_catalog_import.csv", {
    type: "text/csv",
  });
}

function buildOfferingCsvFile(rows: OfferingImportDraftRow[], originalName: string): File {
  const lines = [
    OFFERING_CSV_HEADERS.join(","),
    ...rows.map((row) =>
      [
        escapeCsvCell(row.academic_year),
        escapeCsvCell(row.grade_level),
        escapeCsvCell(row.pathway),
        escapeCsvCell(row.term),
        escapeCsvCell(row.subject_code),
        escapeCsvCell(row.minutes),
      ].join(","),
    ),
  ];
  return new File([lines.join("\n") + "\n"], originalName || "subject_offering_import.csv", {
    type: "text/csv",
  });
}

type GroupedOfferingRow = {
  key: string;
  gradeLabel: string;
  gradeNumber: number;
  academicYear: string;
  subjectCode: string;
  subjectName: string;
  gradingTemplate: string;
  pathway: string;
  canonicalPathway: string;
  isShared: boolean;
  minutes: string;
  terms: Set<string>;
  allTerms: string[];
};

export function ImportCatalogSubjectsDialog({
  pendingImport,
  isImportingCatalog,
  isImportingOfferings,
  gradingTemplates,
  academicLevels = [],
  catalogSubjects = [],
  periods = [],
  onClose,
  onConfirmCatalog,
  onConfirmOfferings,
}: {
  pendingImport: { kind: "catalog" | "offerings"; file: File } | null;
  isImportingCatalog: boolean;
  isImportingOfferings: boolean;
  gradingTemplates: GradingTemplateListItem[];
  academicLevels?: SubjectOfferingFormOptions["academic_levels"];
  catalogSubjects?: SubjectListItem[];
  periods?: SubjectOfferingAcademicPeriod[];
  onClose: () => void;
  onConfirmCatalog: (file: File) => Promise<void>;
  onConfirmOfferings: (file: File) => Promise<void>;
}) {
  const [catalogRows, setCatalogRows] = useState<CatalogImportDraftRow[] | null>(null);
  const [editingCatalogIndex, setEditingCatalogIndex] = useState<number | null>(null);

  const [offeringRows, setOfferingRows] = useState<OfferingImportDraftRow[] | null>(null);
  const [isOfferingEdited, setIsOfferingEdited] = useState(false);
  const [editingOffering, setEditingOffering] = useState<GroupedOfferingRow | null>(null);
  const [editMinutes, setEditMinutes] = useState("60");
  const [editPathway, setEditPathway] = useState("general");
  const [editTerms, setEditTerms] = useState<Set<string>>(new Set());

  const catalogMap = useMemo(() => {
    const map = new Map<string, SubjectListItem>();
    for (const s of catalogSubjects) {
      if (s.subject_codename) {
        map.set(s.subject_codename.trim().toLowerCase(), s);
      }
    }
    return map;
  }, [catalogSubjects]);

  const availableGradeOptions = useMemo(() => {
    const optionsMap = new Map<string, string>();
    for (const grade of TARGET_GRADES) {
      optionsMap.set(String(grade), `Grade ${grade}`);
    }
    for (const lvl of academicLevels) {
      optionsMap.set(String(lvl.grade_level), lvl.level_name);
    }
    return [...optionsMap.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => Number(a.value) - Number(b.value));
  }, [academicLevels]);

  useEffect(() => {
    if (!pendingImport) return;
    let active = true;

    if (pendingImport.kind === "catalog") {
      pendingImport.file
        .text()
        .then((text) => {
          if (!active) return;
          const parsed = parseCatalogImportRows(text);
          if (!parsed) {
            setCatalogRows(null);
            return;
          }
          const defaultGrade = academicLevels[0] ? String(academicLevels[0].grade_level) : "";
          const validTemplates = new Map(
            gradingTemplates.map((t) => [t.template_name.toLowerCase(), t.template_name]),
          );
          const defaultTemplate =
            gradingTemplates.find((t) => t.template_name.toLowerCase().includes("core"))?.template_name ??
            gradingTemplates[0]?.template_name ??
            "";

          setCatalogRows(
            parsed.map((row) => {
              const digits = row.grade_level.replace(/\D/g, "");
              const normalizedGrade = digits || row.grade_level.trim() || defaultGrade;
              const matchedTpl = validTemplates.get(row.grading_template.toLowerCase());
              const normalizedTemplate =
                validTemplates.size > 0
                  ? matchedTpl || defaultTemplate || row.grading_template
                  : row.grading_template;
              return {
                ...row,
                grade_level: normalizedGrade,
                grading_template: normalizedTemplate,
              };
            }),
          );
        })
        .catch(() => {
          if (!active) return;
          setCatalogRows(null);
        });
    } else if (pendingImport.kind === "offerings") {
      pendingImport.file
        .text()
        .then((text) => {
          if (!active) return;
          const parsed = parseOfferingImportRows(text);
          setOfferingRows(parsed);
          setIsOfferingEdited(false);
        })
        .catch(() => {
          if (!active) return;
          setOfferingRows(null);
        });
    }

    return () => {
      active = false;
    };
  }, [pendingImport, academicLevels, gradingTemplates]);

  const allTerms = useMemo(() => {
    if (!offeringRows || offeringRows.length === 0) return ["Term 1", "Term 2", "Term 3"];
    const termSet = new Set<string>();
    for (const r of offeringRows) {
      const norm = r.term.trim();
      if (norm) termSet.add(norm);
    }
    const periodSeqMap = new Map(
      periods.map((p) => [p.period_name.trim().toLowerCase(), p.period_sequence]),
    );
    const sorted = [...termSet].sort((a, b) => {
      const seqA = periodSeqMap.get(a.toLowerCase());
      const seqB = periodSeqMap.get(b.toLowerCase());
      if (seqA !== undefined && seqB !== undefined) return seqA - seqB;
      const numA = Number(a.replace(/\D/g, "") || "0");
      const numB = Number(b.replace(/\D/g, "") || "0");
      return numA - numB;
    });
    return sorted.length > 0 ? sorted : ["Term 1", "Term 2", "Term 3"];
  }, [offeringRows, periods]);

  const singleTableOfferingRows = useMemo(() => {
    if (!offeringRows || offeringRows.length === 0) return [];

    const subjectGroupMap = new Map<
      string,
      {
        gradeLabel: string;
        gradeNum: number;
        academicYear: string;
        subjectCode: string;
        pathway: string;
        minutes: string;
        terms: Set<string>;
      }
    >();

    for (const r of offeringRows) {
      const code = r.subject_code.trim();
      const digits = r.grade_level.replace(/\D/g, "");
      const gradeNum = digits ? Number(digits) : 999;
      const gradeLabel = digits ? `Grade ${digits}` : r.grade_level.trim() || "General";
      const key = `${gradeLabel.toLowerCase()}:${r.pathway.toLowerCase()}:${code.toLowerCase()}`;

      const existing = subjectGroupMap.get(key);
      if (existing) {
        if (r.term.trim()) existing.terms.add(r.term.trim());
        if (r.minutes) existing.minutes = r.minutes;
      } else {
        const tSet = new Set<string>();
        if (r.term.trim()) tSet.add(r.term.trim());
        subjectGroupMap.set(key, {
          gradeLabel,
          gradeNum,
          academicYear: r.academic_year || "",
          subjectCode: code,
          pathway: r.pathway.toLowerCase(),
          minutes: r.minutes || "60",
          terms: tSet,
        });
      }
    }

    return [...subjectGroupMap.entries()]
      .map(([key, group]) => {
        const catalogItem = catalogMap.get(group.subjectCode.toLowerCase());
        const subjectName = catalogItem?.subject_name || group.subjectCode;
        const gradingTemplate = catalogItem?.grading_template?.template_name || "—";
        const canonPathway = canonicalizePathway(group.pathway);
        const isShared =
          canonPathway === CANONICAL_PATHWAYS.BOTH || Boolean((catalogItem as any)?.is_core);

        return {
          key,
          gradeLabel: group.gradeLabel,
          gradeNumber: group.gradeNum,
          academicYear: group.academicYear,
          subjectCode: group.subjectCode,
          subjectName,
          gradingTemplate,
          pathway: group.pathway,
          canonicalPathway: canonPathway,
          isShared,
          minutes: group.minutes,
          terms: group.terms,
          allTerms,
        };
      })
      .sort((a, b) => {
        if (a.gradeNumber !== b.gradeNumber) {
          return a.gradeNumber - b.gradeNumber;
        }
        return a.subjectName.localeCompare(b.subjectName);
      });
  }, [offeringRows, catalogMap, allTerms]);

  if (!pendingImport) return null;

  const startEditOffering = (row: GroupedOfferingRow) => {
    setEditingOffering(row);
    setEditMinutes(row.minutes || "60");
    setEditPathway(row.pathway || "general");
    setEditTerms(new Set(row.terms));
  };

  const handleSaveEditedOffering = () => {
    if (!editingOffering || !offeringRows) return;
    const targetCode = editingOffering.subjectCode.toLowerCase();
    const targetGrade = editingOffering.gradeLabel.toLowerCase();
    const targetYear = editingOffering.academicYear.toLowerCase();

    const otherRows = offeringRows.filter((r) => {
      const code = r.subject_code.trim().toLowerCase();
      const grade = r.grade_level.trim().toLowerCase();
      const year = r.academic_year.trim().toLowerCase();
      const isMatch = code === targetCode && (grade.includes(targetGrade.replace(/\D/g, "")) || grade === targetGrade) && (year === targetYear || !year);
      return !isMatch;
    });

    const newRows: OfferingImportDraftRow[] = [];
    const termsToSave = editTerms.size > 0 ? [...editTerms] : ["Term 1"];
    for (const term of termsToSave) {
      newRows.push({
        academic_year: editingOffering.academicYear,
        grade_level: editingOffering.gradeLabel,
        pathway: editPathway,
        term,
        subject_code: editingOffering.subjectCode,
        minutes: editMinutes || "60",
      });
    }

    setOfferingRows([...otherRows, ...newRows]);
    setIsOfferingEdited(true);
    setEditingOffering(null);
  };

  const handleOfferingsImportClick = async () => {
    const fileToSubmit =
      isOfferingEdited && offeringRows && offeringRows.length > 0
        ? buildOfferingCsvFile(offeringRows, pendingImport.file.name)
        : pendingImport.file;
    await onConfirmOfferings(fileToSubmit);
  };

  if (pendingImport.kind === "offerings") {
    return (
      <>
        <Dialog
          open={true}
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
        >
          <Dialog.Content size="4xl" className="flex max-h-[92vh] flex-col overflow-hidden p-0">
            <Dialog.Header className="flex-row items-center justify-between border-b-2 border-black bg-primary px-5 py-4">
              <h3 className="font-sans text-xl font-bold">Import Subject Offerings</h3>
            </Dialog.Header>

            <section className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
              {!offeringRows || offeringRows.length === 0 ? (
                <RetroCard className="border-2 border-black p-5 text-center text-sm shadow-none">
                  <p className="mb-1 text-base font-semibold">Reading CSV File</p>
                  <p className="text-muted-foreground">{pendingImport.file.name}</p>
                </RetroCard>
              ) : (
                <Card className="w-full overflow-hidden border-2 border-black p-0 shadow-md">
                  <div className="overflow-x-auto">
                    <Table wrapperClassName="rounded-none border-0 shadow-none">
                      <Table.Header className="border-b-2 border-border bg-primary font-sans text-black">
                        <Table.Row className="border-b-2 border-black hover:bg-transparent">
                          <Table.Head className="font-bold text-sm text-black">Grade</Table.Head>
                          <Table.Head className="font-bold text-sm text-black">Subject</Table.Head>
                          <Table.Head className="font-bold text-sm text-black">Code</Table.Head>
                          {allTerms.map((term) => (
                            <Table.Head key={term} className="text-center font-bold text-sm text-black">
                              {term}
                            </Table.Head>
                          ))}
                          <Table.Head className="font-bold text-sm text-black">Minutes</Table.Head>
                          <Table.Head className="font-bold text-sm text-black">Grading Template</Table.Head>
                          <Table.Head className="font-bold text-sm text-black">Pathway</Table.Head>
                          <Table.Head className="w-10 text-center font-bold text-sm text-black">Status</Table.Head>
                          <Table.Head className="w-8 text-right font-bold text-sm text-black">Actions</Table.Head>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {singleTableOfferingRows.map((row) => (
                          <Table.Row key={row.key} className="border-b border-border last:border-b-0 hover:bg-black/5">
                            <Table.Cell className="font-semibold whitespace-nowrap">{row.gradeLabel}</Table.Cell>
                            <Table.Cell className="font-semibold">{row.subjectName}</Table.Cell>
                            <Table.Cell>{row.subjectCode || "—"}</Table.Cell>
                            {allTerms.map((term) => (
                              <Table.Cell key={term} className="text-center">
                                {row.terms.has(term) ? (
                                  <span
                                    tabIndex={0}
                                    aria-label={`${row.subjectName} offered in ${term}`}
                                    className="inline-grid size-7 place-items-center rounded-full border-2 border-black bg-primary"
                                  >
                                    <Check className="size-4" />
                                  </span>
                                ) : (
                                  <span className="text-black/50">-</span>
                                )}
                              </Table.Cell>
                            ))}
                            <Table.Cell className="whitespace-nowrap">{row.minutes ? `${row.minutes} mins` : "—"}</Table.Cell>
                            <Table.Cell>{row.gradingTemplate || "—"}</Table.Cell>
                            <Table.Cell>
                              <Badge size="sm" variant="outline" className="capitalize">
                                {getPathwayDisplayName(row.pathway)}
                              </Badge>
                            </Table.Cell>
                            <Table.Cell className="text-center">
                              <Badge size="sm" variant="surface">Active</Badge>
                            </Table.Cell>
                            <Table.Cell className="text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="size-7 p-1 shadow-none"
                                aria-label={`Edit ${row.subjectName}`}
                                onClick={() => startEditOffering(row)}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table>
                  </div>
                </Card>
              )}
            </section>

            <Dialog.Footer className="mt-0 border-t-2 border-black bg-white px-5 py-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isImportingOfferings}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isImportingOfferings}
                onClick={() => void handleOfferingsImportClick()}
              >
                {isImportingOfferings ? "Importing..." : "Import Offerings"}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog>

        {editingOffering ? (
          <Dialog open={Boolean(editingOffering)} onOpenChange={(open) => { if (!open) setEditingOffering(null); }}>
            <Dialog.Content size="md">
              <Dialog.Header className="border-b-2 border-black bg-primary px-5 py-4">
                <h4 className="font-bold text-lg">Edit Imported Offering</h4>
              </Dialog.Header>
              <div className="flex flex-col gap-4 p-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Subject</p>
                  <p className="text-base font-bold text-foreground">{editingOffering.subjectName}</p>
                  <p className="text-xs text-muted-foreground">
                    Code: {editingOffering.subjectCode} • Grade: {editingOffering.gradeLabel}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold">Duration (Minutes)</label>
                  <Input
                    type="number"
                    min="1"
                    max="600"
                    value={editMinutes}
                    className="w-full"
                    onChange={(e) => setEditMinutes(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold">Pathway</label>
                  <Select value={editPathway} onValueChange={setEditPathway}>
                    <Select.Trigger className="w-full">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Group>
                        <Select.Item value="general">General</Select.Item>
                        <Select.Item value="both">Both (Shared)</Select.Item>
                        <Select.Item value="stem_medical">STEM - Medical</Select.Item>
                        <Select.Item value="stem_engineering">STEM - Engineering</Select.Item>
                      </Select.Group>
                    </Select.Content>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold">Offered Terms</label>
                  <div className="flex flex-wrap gap-3">
                    {editingOffering.allTerms.map((term) => (
                      <label key={term} className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                        <Checkbox
                          checked={editTerms.has(term)}
                          onCheckedChange={() => {
                            setEditTerms((prev) => {
                              const next = new Set(prev);
                              if (next.has(term)) next.delete(term);
                              else next.add(term);
                              return next;
                            });
                          }}
                        />
                        <span>{term}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <Dialog.Footer className="border-t-2 border-black bg-white px-5 py-3">
                <Button variant="outline" size="sm" onClick={() => setEditingOffering(null)}>Cancel</Button>
                <Button size="sm" onClick={handleSaveEditedOffering}>Save Changes</Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog>
        ) : null}
      </>
    );
  }

  const updateCatalogRow = (index: number, patch: Partial<CatalogImportDraftRow>) => {
    setCatalogRows((current) =>
      current
        ? current.map((row, idx) => (idx === index ? { ...row, ...patch } : row))
        : current,
    );
  };

  const handleCatalogImportClick = async () => {
    const fileToSubmit =
      catalogRows && catalogRows.length > 0
        ? buildCatalogCsvFile(catalogRows, pendingImport.file.name)
        : pendingImport.file;
    await onConfirmCatalog(fileToSubmit);
  };

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content size="md" className="max-h-[90vh]">
        <Dialog.Header>
          <span className="font-sans text-xl font-bold">Import Catalog Subjects</span>
        </Dialog.Header>

        <section className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto p-4">
          {catalogRows && catalogRows.length > 0 ? (
            catalogRows.map((row, index) => {
              const isEditing = editingCatalogIndex === index;
              return (
                <RetroCard
                  key={index}
                  className="flex w-full flex-col justify-between p-3 shadow-none"
                >
                  {isEditing ? (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold">Edit Imported Subject</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="p-1.5 shadow-none"
                          aria-label="Done editing subject"
                          onClick={() => setEditingCatalogIndex(null)}
                        >
                          <Check className="size-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold">Subject Name</label>
                          <Input
                            value={row.subject_name}
                            onChange={(e) => updateCatalogRow(index, { subject_name: e.target.value })}
                            placeholder="Subject name"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold">Subject Code</label>
                          <Input
                            value={row.subject_code}
                            onChange={(e) => updateCatalogRow(index, { subject_code: e.target.value })}
                            placeholder="Subject code"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold">Grade Level</label>
                          <Select
                            value={row.grade_level}
                            onValueChange={(value) => updateCatalogRow(index, { grade_level: value })}
                          >
                            <Select.Trigger className="w-full">
                              <Select.Value placeholder="Select grade" />
                            </Select.Trigger>
                            <Select.Content>
                              <Select.Group>
                                {availableGradeOptions.map((opt) => (
                                  <Select.Item key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </Select.Item>
                                ))}
                              </Select.Group>
                            </Select.Content>
                          </Select>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold">Grading Template</label>
                          {gradingTemplates.length > 0 ? (
                            <Select
                              value={row.grading_template}
                              onValueChange={(value) => updateCatalogRow(index, { grading_template: value })}
                            >
                              <Select.Trigger className="w-full">
                                <Select.Value placeholder="Select template" />
                              </Select.Trigger>
                              <Select.Content>
                                <Select.Group>
                                  {gradingTemplates.map((t) => (
                                    <Select.Item key={t.grading_template_id} value={t.template_name}>
                                      {t.template_name}
                                    </Select.Item>
                                  ))}
                                </Select.Group>
                              </Select.Content>
                            </Select>
                          ) : (
                            <Input
                              value={row.grading_template}
                              onChange={(e) => updateCatalogRow(index, { grading_template: e.target.value })}
                              placeholder="Core / Applied / Specialized"
                            />
                          )}
                        </div>
                        <div className="col-span-2 flex flex-col gap-1">
                          <label className="text-xs font-semibold">Description</label>
                          <Input
                            value={row.description}
                            onChange={(e) => updateCatalogRow(index, { description: e.target.value })}
                            placeholder="Optional description"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xl font-bold leading-tight">
                            {row.subject_name || "Untitled Subject"}
                          </p>
                          <p className="text-sm font-semibold">
                            {row.subject_code || "No code"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {row.grade_level ? (
                            <Badge size="sm" variant="secondary">
                              {availableGradeOptions.find((opt) => opt.value === row.grade_level)?.label ?? `Grade ${row.grade_level}`}
                            </Badge>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="p-1.5 shadow-none"
                            aria-label={`Edit ${row.subject_name || "subject"}`}
                            onClick={() => setEditingCatalogIndex(index)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-row items-center justify-between gap-2 text-xs">
                        <span className="font-medium">{row.grading_template || "No template"}</span>
                        {row.description ? (
                          <span className="truncate text-muted-foreground">{row.description}</span>
                        ) : null}
                      </div>
                    </>
                  )}
                </RetroCard>
              );
            })
          ) : (
            <p className="break-words text-sm font-medium">{pendingImport.file.name}</p>
          )}
        </section>

        <Dialog.Footer>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isImportingCatalog}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isImportingCatalog}
            onClick={() => void handleCatalogImportClick()}
          >
            {isImportingCatalog ? "Importing..." : "Import"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}

export default ImportCatalogSubjectsDialog;
