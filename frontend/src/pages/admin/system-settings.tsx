import * as React from "react";
import { Card } from "@/components/retroui/Card";
import { Text } from "@/components/retroui/Text";
import AppLayout from "@/layouts/app-layout";
import { useNavigate } from "react-router-dom";
import { Select } from "@/components/retroui/Select";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Table } from "@/components/retroui/Table";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Dialog } from "@/components/retroui/Dialog";
import { Switch } from "@/components/retroui/Switch";
import { Progress } from "@/components/retroui/Progress";
import { Badge } from "@/components/retroui/Badge";
import { Alert } from "@/components/retroui/Alert";
import { ArrowUpRight, Lock, Pencil } from "lucide-react";
import AddAcademicPeriodModal from "./forms/add-academic-period";

function Pill({
  children,
  tone = "default",
  locked = false,
}: {
  children: React.ReactNode;
  tone?: "default" | "green" | "blue" | "yellow" | "gray";
  locked?: boolean;
}) {
  const variantMap: Record<
    string,
    "default" | "secondary" | "outline" | "solid" | "surface"
  > = {
    default: "outline",
    green: "secondary",
    blue: "surface",
    yellow: "secondary",
    gray: "default",
  };
  return (
    <Badge
      size="sm"
      variant={variantMap[tone] || "default"}
      className="inline-flex items-center gap-1"
    >
      {locked && <Lock className="w-3 h-3" />}
      {children}
    </Badge>
  );
}

/* ---------------------------------------------------------------- */
/* Data                                                              */
/* ---------------------------------------------------------------- */

type Template = {
  name: string;
  ww: number;
  pt: number;
  qa: number;
  scope: string;
};

const DEFAULT_TEMPLATES: Template[] = [
  {
    name: "JHS Enhanced Academic",
    ww: 40,
    pt: 40,
    qa: 20,
    scope: "JHS enhanced subjects",
  },
  {
    name: "JHS Language / Social Studies",
    ww: 30,
    pt: 50,
    qa: 20,
    scope: "English, Filipino, AP, similar",
  },
  {
    name: "JHS Performance-Based",
    ww: 20,
    pt: 60,
    qa: 20,
    scope: "MAPEH, technology, output-heavy",
  },
  { name: "SHS Core Subject", ww: 25, pt: 50, qa: 25, scope: "Core subjects" },
  {
    name: "SHS Academic Elective",
    ww: 25,
    pt: 45,
    qa: 30,
    scope: "STEM Medical / Engineering electives",
  },
  {
    name: "SHS Work Immersion / Field Exposure",
    ww: 35,
    pt: 40,
    qa: 25,
    scope: "Work immersion, field exposure",
  },
];

const ACADEMIC_LEVELS = [
  { level: "Grade 7", stage: "Junior High" },
  { level: "Grade 8", stage: "Junior High" },
  { level: "Grade 9", stage: "Junior High" },
  { level: "Grade 10", stage: "Junior High" },
  { level: "Grade 11", stage: "Senior High" },
  { level: "Grade 12", stage: "Senior High" },
];

const TERM_LABELS: Record<string, string> = {
  "1": "Term 1",
  "2": "Term 2",
  "3": "Term 3",
};

/* ---------------------------------------------------------------- */
/* Main component                                                    */
/* ---------------------------------------------------------------- */

export default function AdminSystemSettings() {
  const navigate = useNavigate();

  // Passing grade thresholds
  const [subjectPassing, setSubjectPassing] = React.useState("80");
  const [averagePassing, setAveragePassing] = React.useState("80");

  // Academic calendar
  const [schoolYear, setSchoolYear] = React.useState("AP26-27");
  const [activeTerm, setActiveTerm] = React.useState("1");
  const [pendingTerm, setPendingTerm] = React.useState<string | null>(null);

  // Curriculum scope
  const [jhsEnabled, setJhsEnabled] = React.useState(true);
  const [shsEnabled, setShsEnabled] = React.useState(true);
  const [medicalEnabled, setMedicalEnabled] = React.useState(true);
  const [engineeringEnabled, setEngineeringEnabled] = React.useState(true);

  // Grading templates
  const [templates, setTemplates] =
    React.useState<Template[]>(DEFAULT_TEMPLATES);
  const [templateModalOpen, setTemplateModalOpen] = React.useState(false);
  const [tplName, setTplName] = React.useState("");
  const [tplWw, setTplWw] = React.useState("25");
  const [tplPt, setTplPt] = React.useState("45");
  const [tplQa, setTplQa] = React.useState("30");
  const [tplError, setTplError] = React.useState<string | null>(null);

  // Toast
  const [toastMsg, setToastMsg] = React.useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 2400);
  };

  const ratio = Number(activeTerm) / 3;

  const handleTermChange = (value: string) => setPendingTerm(value);
  const confirmTermChange = () => {
    if (pendingTerm) setActiveTerm(pendingTerm);
    setPendingTerm(null);
  };

  const openTemplateModal = () => {
    setTplName("");
    setTplWw("25");
    setTplPt("45");
    setTplQa("30");
    setTplError(null);
    setTemplateModalOpen(true);
  };

  const addTemplate = () => {
    const name = tplName.trim();
    const ww = Number(tplWw) || 0;
    const pt = Number(tplPt) || 0;
    const qa = Number(tplQa) || 0;

    if (!name) {
      setTplError("Template name is required.");
      return;
    }
    if (ww + pt + qa !== 100) {
      setTplError(
        `Weights must total 100%. Current total is ${ww + pt + qa}%.`,
      );
      return;
    }
    setTemplates((prev) => [
      ...prev,
      { name, ww, pt, qa, scope: "Custom template" },
    ]);
    setTemplateModalOpen(false);
    showToast("New grading template added");
  };

  const pathwayPills = (level: string) => {
    if (level !== "Grade 11" && level !== "Grade 12") return null;
    const pills: React.ReactNode[] = [];
    if (medicalEnabled)
      pills.push(
        <Pill tone="blue" key="med">
          STEM Medical
        </Pill>,
      );
    if (engineeringEnabled)
      pills.push(
        <Pill tone="blue" key="eng">
          STEM Engineering
        </Pill>,
      );
    if (pills.length === 0)
      pills.push(
        <Pill tone="gray" key="none">
          No pathway enabled
        </Pill>,
      );
    return pills;
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <h1 className="text-4xl font-bold tracking-tight">
                System Settings
              </h1>
            </header>
            <div className="-mx-4 md:-mx-6 border-b border-black/40" />

            {/* Passing Grade Threshold */}
            <Card className="@container/card w-full">
              <Card.Header>
                <Card.Title className="flex flex-row justify-between w-full items-center">
                  Passing Grade Threshold
                  <Button
                    size="sm"
                    onClick={() => showToast("Passing grade threshold saved")}
                  >
                    Save Thresholds
                  </Button>
                </Card.Title>
              </Card.Header>
              <Card.Content className="px-4 pt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-row justify-between w-full items-center">
                    <Text as="h6" className="font-sans font-medium">
                      Subject Passing Grade
                    </Text>
                    <Input
                      className="w-20"
                      type="number"
                      min={0}
                      max={100}
                      value={subjectPassing}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setSubjectPassing(e.target.value)
                      }
                    />
                  </div>
                  <Text
                    as="p"
                    className="font-sans text-sm text-muted-foreground"
                  >
                    Used to determine if the learner passed an individual
                    subject.
                  </Text>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-row justify-between w-full items-center">
                    <Text as="h6" className="font-sans font-medium">
                      General Average Passing Grade
                    </Text>
                    <Input
                      className="w-20"
                      type="number"
                      min={0}
                      max={100}
                      value={averagePassing}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setAveragePassing(e.target.value)
                      }
                    />
                  </div>
                  <Text
                    as="p"
                    className="font-sans text-sm text-muted-foreground"
                  >
                    Used for general promotion/completion reports. Adjust only
                    if the client confirms a different rule.
                  </Text>
                </div>
              </Card.Content>
            </Card>

            {/* Academic Calendar */}
            <Card className="@container/card w-full">
              <Card.Header>
                <Card.Title className="flex flex-row justify-between w-full items-center">
                  Academic Calendar
                  <div className="flex items-center gap-4">
                    <Button
                      size="sm"
                      variant="link"
                      className="p-0! shadow-none flex-row gap-2"
                      onClick={() => navigate(`/admin/academic-periods`)}
                    >
                      View All Periods
                      <ArrowUpRight className="w-4 h-4" />
                    </Button>
                    <Dialog>
                      <Dialog.Trigger>
                        <Button size="sm">New Academic Period</Button>
                      </Dialog.Trigger>
                      <AddAcademicPeriodModal />
                    </Dialog>
                  </div>
                </Card.Title>
              </Card.Header>
              <Card.Content className="px-4 pt-4 flex flex-col gap-4">
                <Text
                  as="p"
                  className="font-sans text-sm text-muted-foreground -mt-2"
                >
                  Set the active school year and active term. This is the only
                  current-period selector for both JHS and SHS.
                </Text>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-2">
                    <Text as="h6" className="font-sans font-medium">
                      Current Academic Year
                    </Text>
                    <Select value={schoolYear} onValueChange={setSchoolYear}>
                      <Select.Trigger className="w-full">
                        <Select.Value placeholder="2026 - 2027" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Group>
                          <Select.Item value="AP25-26">2025 - 2026</Select.Item>
                          <Select.Item value="AP26-27">2026 - 2027</Select.Item>
                          <Select.Item value="AP27-28">2027 - 2028</Select.Item>
                        </Select.Group>
                      </Select.Content>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Text as="h6" className="font-sans font-medium">
                      Calendar Type
                    </Text>
                    <div className="h-10 border-2 border-black flex items-center gap-2 px-3 text-sm bg-neutral-50 shadow-[4px_4px_0_#000]">
                      <Lock className="w-3.5 h-3.5" />
                      Three-Term Calendar
                    </div>
                    <Text
                      as="p"
                      className="font-sans text-xs text-muted-foreground"
                    >
                      Locked for the current implementation.
                    </Text>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Text as="h6" className="font-sans font-medium">
                      Active Period
                    </Text>
                    <Select value={activeTerm} onValueChange={handleTermChange}>
                      <Select.Trigger className="w-full">
                        <Select.Value placeholder="Term 1" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Group>
                          <Select.Item value="1">Term 1</Select.Item>
                          <Select.Item value="2">Term 2</Select.Item>
                          <Select.Item value="3">Term 3</Select.Item>
                        </Select.Group>
                      </Select.Content>
                    </Select>
                  </div>
                </div>

                <div className="border-2 border-black bg-neutral-50 rounded-md p-3">
                  <div className="flex items-center justify-between gap-3">
                    <Text as="p" className="font-sans text-sm">
                      <strong>Active:</strong> {TERM_LABELS[activeTerm]} ·
                      Progress Ratio {ratio.toFixed(4)} · Applies to JHS and SHS
                    </Text>
                    <Pill tone="green">TERM</Pill>
                  </div>
                  <Progress value={ratio * 100} className="mt-2" />
                </div>
              </Card.Content>
            </Card>

            {/* School Curriculum Scope */}
            <Card className="@container/card w-full">
              <Card.Header>
                <Card.Title className="flex flex-row justify-between w-full items-center">
                  School Curriculum Scope
                  <Button
                    size="sm"
                    onClick={() => showToast("Curriculum scope saved")}
                  >
                    Save Scope
                  </Button>
                </Card.Title>
              </Card.Header>
              <Card.Content className="px-4 pt-4 flex flex-col gap-4">
                <Text
                  as="p"
                  className="font-sans text-sm text-muted-foreground -mt-2"
                >
                  Define what the school offers. Actual pathway subjects belong
                  in the Subjects module.
                </Text>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border-2 border-black rounded-md p-4 flex flex-col gap-3">
                    <Text as="h6" className="font-sans font-bold">
                      School Levels
                    </Text>
                    <div className="flex items-center justify-between border-2 border-black rounded-md px-3 py-2">
                      <Text as="p" className="font-sans font-medium">
                        Junior High School
                      </Text>
                      <Switch
                        checked={jhsEnabled}
                        onCheckedChange={() => setJhsEnabled((v) => !v)}
                      />
                    </div>
                    <div className="flex items-center justify-between border-2 border-black rounded-md px-3 py-2">
                      <Text as="p" className="font-sans font-medium">
                        Senior High School
                      </Text>
                      <Switch
                        checked={shsEnabled}
                        onCheckedChange={() => setShsEnabled((v) => !v)}
                      />
                    </div>
                    <Text
                      as="p"
                      className="font-sans text-xs text-muted-foreground"
                    >
                      Enabled levels control the available grade levels,
                      dashboards, and reports.
                    </Text>
                  </div>

                  <div className="border-2 border-black rounded-md p-4 flex flex-col gap-3 bg-neutral-50">
                    <Text as="h6" className="font-sans font-bold">
                      Senior High School Setup
                    </Text>
                    <div className="flex gap-2 flex-wrap">
                      <Pill locked>Academic Track</Pill>
                      <Pill locked>STEM Strand</Pill>
                    </div>
                    <div className="flex items-center justify-between border-2 border-black rounded-md px-3 py-2 bg-white">
                      <Text as="p" className="font-sans font-medium">
                        Medical / Pre-Med Pathway
                      </Text>
                      <Switch
                        checked={medicalEnabled}
                        onCheckedChange={() => setMedicalEnabled((v) => !v)}
                        disabled={!shsEnabled}
                      />
                    </div>
                    <div className="flex items-center justify-between border-2 border-black rounded-md px-3 py-2 bg-white">
                      <Text as="p" className="font-sans font-medium">
                        Engineering Pathway
                      </Text>
                      <Switch
                        checked={engineeringEnabled}
                        onCheckedChange={() => setEngineeringEnabled((v) => !v)}
                        disabled={!shsEnabled}
                      />
                    </div>
                    <Text
                      as="p"
                      className="font-sans text-xs text-muted-foreground"
                    >
                      Client scope is STEM only. Other strands are hidden to
                      prevent wrong setup.
                    </Text>
                  </div>
                </div>

                <Alert status="warning" className="border-2 border-dashed border-black bg-yellow-50 text-foreground text-sm">
                  <strong>Design rule:</strong> Settings only says the school
                  offers STEM Medical and STEM Engineering. The different
                  subjects for each pathway should be configured in{" "}
                  <strong>Subjects → Subject Offerings</strong>, not here.
                </Alert>
              </Card.Content>
            </Card>

            {/* Academic Levels */}
            <Card className="@container/card w-full">
              <Card.Header>
                <Card.Title>Academic Levels</Card.Title>
              </Card.Header>
              <Card.Content className="px-4 pt-4">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>Level</Table.Head>
                      <Table.Head>School Stage</Table.Head>
                      <Table.Head>Available Curriculum</Table.Head>
                      <Table.Head>Status</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {ACADEMIC_LEVELS.map((item) => {
                      const stageEnabled =
                        item.stage === "Junior High" ? jhsEnabled : shsEnabled;
                      return (
                        <Table.Row key={item.level}>
                          <Table.Cell className="font-bold">
                            {item.level}
                          </Table.Cell>
                          <Table.Cell>{item.stage}</Table.Cell>
                          <Table.Cell>
                            {item.stage === "Junior High" ? (
                              <Text
                                as="p"
                                className="text-muted-foreground text-sm"
                              >
                                Standard JHS setup
                              </Text>
                            ) : (
                              <div className="flex gap-2 flex-wrap">
                                {pathwayPills(item.level)}
                              </div>
                            )}
                          </Table.Cell>
                          <Table.Cell>
                            <Pill tone={stageEnabled ? "green" : "gray"}>
                              {stageEnabled ? "Enabled" : "Disabled"}
                            </Pill>
                          </Table.Cell>
                        </Table.Row>
                      );
                    })}
                  </Table.Body>
                </Table>
              </Card.Content>
            </Card>

            {/* Default Grading Templates */}
            <Card className="@container/card w-full">
              <Card.Header>
                <Card.Title className="flex flex-row justify-between w-full items-center">
                  Default Grading Templates
                  <Dialog
                    open={templateModalOpen}
                    onOpenChange={setTemplateModalOpen}
                  >
                    <Dialog.Trigger>
                      <Button size="sm" onClick={openTemplateModal}>
                        New Template
                      </Button>
                    </Dialog.Trigger>
                    <Dialog.Content size="md">
                      <Dialog.Header position="static">
                        <Text as="h5" className="font-sans text-xl font-bold">
                          New Grading Template
                        </Text>
                      </Dialog.Header>
                      <section className="flex flex-col gap-4 p-4 text-sm">
                        <Text as="p" className="text-muted-foreground text-xs">
                          Weights must total 100%. This creates a reusable
                          template only; subject assignment happens in Subjects.
                        </Text>
                        <div className="flex flex-col gap-2">
                          <Text as="h6" className="font-sans font-medium">
                            Template Name
                          </Text>
                          <Input
                            value={tplName}
                            onChange={(
                              e: React.ChangeEvent<HTMLInputElement>,
                            ) => setTplName(e.target.value)}
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="flex flex-col gap-2">
                            <Text
                              as="h6"
                              className="font-sans text-sm font-medium"
                            >
                              Written Work %
                            </Text>
                            <Input
                              type="number"
                              value={tplWw}
                              onChange={(
                                e: React.ChangeEvent<HTMLInputElement>,
                              ) => setTplWw(e.target.value)}
                            />
                          </div>
                          <div className="flex flex-col gap-2">
                            <Text
                              as="h6"
                              className="font-sans text-sm font-medium"
                            >
                              Performance Task %
                            </Text>
                            <Input
                              type="number"
                              value={tplPt}
                              onChange={(
                                e: React.ChangeEvent<HTMLInputElement>,
                              ) => setTplPt(e.target.value)}
                            />
                          </div>
                          <div className="flex flex-col gap-2">
                            <Text
                              as="h6"
                              className="font-sans text-sm font-medium"
                            >
                              Quarterly/Term Assessment %
                            </Text>
                            <Input
                              type="number"
                              value={tplQa}
                              onChange={(
                                e: React.ChangeEvent<HTMLInputElement>,
                              ) => setTplQa(e.target.value)}
                            />
                          </div>
                        </div>
                        {tplError && (
                          <Alert status="error" className="text-sm">
                            {tplError}
                          </Alert>
                        )}
                      </section>
                      <Dialog.Footer position="static">
                        <Button onClick={addTemplate}>Save Template</Button>
                        <Button
                          variant="outline"
                          onClick={() => setTemplateModalOpen(false)}
                        >
                          Cancel
                        </Button>
                      </Dialog.Footer>
                    </Dialog.Content>
                  </Dialog>
                </Card.Title>
              </Card.Header>
              <Card.Content className="px-4 pt-4 flex flex-col gap-4">
                <Text
                  as="p"
                  className="font-sans text-sm text-muted-foreground -mt-2"
                >
                  Subjects will choose one template or override it in the
                  Subjects module.
                </Text>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {templates.map((t, i) => (
                    <Card key={i} className="p-3 flex flex-col gap-3 w-full">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <Text as="h6" className="font-sans font-bold">
                            {t.name}
                          </Text>
                          <Text
                            as="p"
                            className="font-sans text-xs text-muted-foreground"
                          >
                            {t.scope}
                          </Text>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            showToast(
                              `Edit workflow opened for ${t.name} (preview only)`,
                            )
                          }
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="border-2 border-black rounded-md bg-neutral-50 text-center py-2">
                          <Text as="p" className="font-bold text-lg">
                            {t.ww}%
                          </Text>
                          <Text
                            as="p"
                            className="text-xs text-muted-foreground"
                          >
                            WW
                          </Text>
                        </div>
                        <div className="border-2 border-black rounded-md bg-neutral-50 text-center py-2">
                          <Text as="p" className="font-bold text-lg">
                            {t.pt}%
                          </Text>
                          <Text
                            as="p"
                            className="text-xs text-muted-foreground"
                          >
                            PT
                          </Text>
                        </div>
                        <div className="border-2 border-black rounded-md bg-neutral-50 text-center py-2">
                          <Text as="p" className="font-bold text-lg">
                            {t.qa}%
                          </Text>
                          <Text
                            as="p"
                            className="text-xs text-muted-foreground"
                          >
                            QA
                          </Text>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
                <Alert status="warning" className="border-2 border-dashed border-black bg-yellow-50 text-foreground text-sm">
                  <strong>Important:</strong> Do not assign Medical or
                  Engineering subjects in Settings. Settings stores reusable
                  grade-weight templates only. Actual grading setup per subject
                  belongs in <strong>Subjects → Grading Setup</strong>.
                </Alert>
              </Card.Content>
            </Card>

            {/* Module Responsibility Map */}
            <Card className="@container/card w-full">
              <Card.Header>
                <Card.Title>Module Responsibility Map</Card.Title>
              </Card.Header>
              <Card.Content className="px-4 pt-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  {[
                    {
                      n: 1,
                      title: "Settings",
                      body: "Academic year, active term, STEM scope, pathways, default templates.",
                    },
                    {
                      n: 2,
                      title: "Subjects",
                      body: "Subject catalog, Medical/Engineering offerings per grade and term, grading template assignment.",
                    },
                    {
                      n: 3,
                      title: "Classes",
                      body: "Sections such as Grade 11 STEM Medical or Grade 11 STEM Engineering.",
                    },
                    {
                      n: 4,
                      title: "Subject Load",
                      body: "Teacher assignment per subject, section, and term.",
                    },
                  ].map((s) => (
                    <Card key={s.n} className="p-3 w-full">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="secondary"
                          className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-yellow-300 border-2 border-black p-0 text-xs font-bold"
                        >
                          {s.n}
                        </Badge>
                        <Text as="h6" className="font-sans font-bold">
                          {s.title}
                        </Text>
                      </div>
                      <Text
                        as="p"
                        className="font-sans text-xs text-muted-foreground"
                      >
                        {s.body}
                      </Text>
                    </Card>
                  ))}
                </div>
              </Card.Content>
            </Card>
          </div>
        </div>
      </div>

      {/* Confirm term change */}
      <Dialog
        open={pendingTerm !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTerm(null);
        }}
      >
        <Dialog.Content size="md">
          <Dialog.Header position="static">
            <Text as="h5" className="font-sans text-xl font-bold">
              Confirm Period Change
            </Text>
          </Dialog.Header>
          <section className="flex flex-col gap-4 p-4 text-sm">
            <p>
              Change the active period to{" "}
              <strong>{pendingTerm ? TERM_LABELS[pendingTerm] : ""}</strong>?
              This applies to both Junior and Senior High School, and will mark{" "}
              <strong>{TERM_LABELS[activeTerm]}</strong> as completed.
            </p>
          </section>
          <Dialog.Footer position="static">
            <Button onClick={confirmTermChange}>Confirm</Button>
            <Button variant="outline" onClick={() => setPendingTerm(null)}>
              Cancel
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

      {/* Toast */}
      {toastMsg && (
        <div
          className="fixed right-6 bottom-6 z-50 border-2 border-black bg-white rounded-md px-4 py-3 font-bold text-sm max-w-sm"
          style={{ boxShadow: "5px 5px 0 #000" }}
        >
          ✓ {toastMsg}
        </div>
      )}
    </AppLayout>
  );
}
