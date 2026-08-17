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
import { ArrowUpRight, Lock, Pencil, Loader2 } from "lucide-react";
import AddAcademicPeriodModal from "./forms/add-academic-period";
import AddGradingTemplateModal from "./forms/add-grading-template";

import { getAllSettings, updateSetting, type GroupedSettings } from "@/lib/settings-api";
import { useSettings } from "@/context/SettingsContext";
import { getGradingTemplates } from "@/lib/api";



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
  const { refetch: refetchGlobalSettings } = useSettings();

  // Loading state
  const [isLoadingSettings, setIsLoadingSettings] = React.useState(true);
  const [isSavingThresholds, setIsSavingThresholds] = React.useState(false);
  const [isSavingScope, setIsSavingScope] = React.useState(false);

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

  // Toast
  const [toastMsg, setToastMsg] = React.useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 2400);
  };

  // Helper to load dynamic grading templates
  const fetchGradingTemplatesList = React.useCallback(async () => {
    try {
      const templatesRes = await getGradingTemplates({ status: "active" });
      const list = templatesRes.grading_templates || [];
      if (list.length > 0) {
        const mappedTemplates: Template[] = list.map((gt) => {
          const wwComp = gt.components.find((c) => c.component_name.toLowerCase().includes("written"))?.weight ?? 0;
          const ptComp = gt.components.find((c) => c.component_name.toLowerCase().includes("performance"))?.weight ?? 0;
          const qaComp = gt.components.find((c) =>
            c.component_name.toLowerCase().includes("quarter") ||
            c.component_name.toLowerCase().includes("term") ||
            c.component_name.toLowerCase().includes("exam")
          )?.weight ?? 0;
          return {
            name: gt.template_name,
            ww: wwComp,
            pt: ptComp,
            qa: qaComp,
            scope: gt.description || "Database Template",
          };
        });
        setTemplates(mappedTemplates);
      }
    } catch {
      // Fallback to default templates if table empty or unseeded
    }
  }, []);

  // Load Settings from Backend API
  const loadSettingsFromBackend = React.useCallback(async () => {
    setIsLoadingSettings(true);
    try {
      const data: GroupedSettings = await getAllSettings();
      const flatSettings: Record<string, string> = {};
      Object.values(data.groups || {}).forEach((items) => {
        items.forEach((item) => {
          flatSettings[item.key] = item.value;
        });
      });

      if (flatSettings["subject_passing_grade"]) setSubjectPassing(flatSettings["subject_passing_grade"]);
      if (flatSettings["general_average_passing_grade"]) setAveragePassing(flatSettings["general_average_passing_grade"]);
      if (flatSettings["current_school_year"]) setSchoolYear(flatSettings["current_school_year"]);
      if (flatSettings["active_term"]) setActiveTerm(flatSettings["active_term"]);
      if (flatSettings["jhs_enabled"]) setJhsEnabled(flatSettings["jhs_enabled"] === "true");
      if (flatSettings["shs_enabled"]) setShsEnabled(flatSettings["shs_enabled"] === "true");
      if (flatSettings["medical_pathway_enabled"]) setMedicalEnabled(flatSettings["medical_pathway_enabled"] === "true");
      if (flatSettings["engineering_pathway_enabled"]) setEngineeringEnabled(flatSettings["engineering_pathway_enabled"] === "true");

      await fetchGradingTemplatesList();
    } catch {
      // Graceful fallback to default state if backend settings are missing/unseeded
    } finally {
      setIsLoadingSettings(false);
    }
  }, [fetchGradingTemplatesList]);

  React.useEffect(() => {
    loadSettingsFromBackend();
  }, [loadSettingsFromBackend]);

  const saveSingleSetting = async (key: string, value: string) => {
    try {
      await updateSetting(key, value);
      await refetchGlobalSettings();
    } catch (err) {
      console.error(`Failed to update setting ${key}:`, err);
    }
  };

  const handleSaveThresholds = async () => {
    setIsSavingThresholds(true);
    try {
      await saveSingleSetting("subject_passing_grade", subjectPassing);
      await saveSingleSetting("general_average_passing_grade", averagePassing);
      showToast("Passing grade threshold saved");
    } finally {
      setIsSavingThresholds(false);
    }
  };

  const handleSaveScope = async () => {
    setIsSavingScope(true);
    try {
      await saveSingleSetting("jhs_enabled", jhsEnabled ? "true" : "false");
      await saveSingleSetting("shs_enabled", shsEnabled ? "true" : "false");
      await saveSingleSetting("medical_pathway_enabled", medicalEnabled ? "true" : "false");
      await saveSingleSetting("engineering_pathway_enabled", engineeringEnabled ? "true" : "false");
      showToast("Curriculum scope saved");
    } finally {
      setIsSavingScope(false);
    }
  };

  const ratio = Number(activeTerm) / 3;

  const handleTermChange = (value: string) => setPendingTerm(value);
  const confirmTermChange = async () => {
    if (pendingTerm) {
      setActiveTerm(pendingTerm);
      await saveSingleSetting("active_term", pendingTerm);
      showToast(`Active term changed to ${TERM_LABELS[pendingTerm]}`);
    }
    setPendingTerm(null);
  };



  const pathwayPills = (level: string) => {
    if (level !== "Grade 11" && level !== "Grade 12") return null;
    const pills: React.ReactNode[] = [];
    if (medicalEnabled)
      pills.push(
        <Badge size="sm" variant="surface" key="med">
          STEM Medical
        </Badge>,
      );
    if (engineeringEnabled)
      pills.push(
        <Badge size="sm" variant="surface" key="eng">
          STEM Engineering
        </Badge>,
      );
    if (pills.length === 0)
      pills.push(
        <Badge size="sm" variant="default" key="none">
          No pathway enabled
        </Badge>,
      );
    return pills;
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-4xl font-bold tracking-tight">
                  System Settings
                </h1>
              </div>
              {isLoadingSettings && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Loading settings...
                </div>
              )}
            </header>
            <div className="-mx-4 md:-mx-6 border-b border-black/40" />

            {/* Passing Grade Threshold */}
            <Card className="@container/card w-full">
              <Card.Header className="flex flex-row justify-between items-start">
                <Card.Title className="flex flex-row justify-between w-full items-center mb-4">
                  Passing Grade Threshold
                </Card.Title>
                <div className="flex items-center gap-4">
                  <Button
                    size="sm"
                    className="whitespace-nowrap"
                    onClick={handleSaveThresholds}
                    disabled={isSavingThresholds}
                  >
                    Save Thresholds
                  </Button>
                </div>

              </Card.Header>
              <Card.Content className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-row justify-between w-full items-center">
                    <div className="flex flex-col gap-1">
                      <Text as="h6" className="font-sans font-medium">
                        Subject Passing Grade
                      </Text>
                      <Text
                        as="p"
                        className="font-sans text-sm text-muted-foreground"
                      >
                        Used to determine if the learner passed an individual
                        subject.
                      </Text>
                    </div>
                    <Input
                      className="w-20 shadow-none hover:shadow-md focus:shadow-md focus-visible:shadow-md transition-all"
                      type="number"
                      min={0}
                      max={100}
                      value={subjectPassing}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setSubjectPassing(e.target.value)
                      }
                    />
                  </div>

                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-row justify-between w-full items-center">
                    <div className="flex flex-col gap-1">
                      <Text as="h6" className="font-sans font-medium">
                        General Average Passing Grade
                      </Text>
                      <Text
                        as="p"
                        className="font-sans text-sm text-muted-foreground"
                      >
                        Used for general promotion/completion reports. Adjust only
                        if the client confirms a different rule.
                      </Text>
                    </div>

                    <Input
                      className="w-20 shadow-none hover:shadow-md focus:shadow-md focus-visible:shadow-md transition-all"
                      type="number"
                      min={0}
                      max={100}
                      value={averagePassing}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setAveragePassing(e.target.value)
                      }
                    />
                  </div>

                </div>
              </Card.Content>
            </Card>

            {/* Academic Calendar */}
            <Card className="@container/card w-full">
              <Card.Header className="flex flex-row justify-between items-start">
                <Card.Title className="flex flex-col w-full gap-1 mb-4">
                  Academic Calendar
                  <Text
                    as="p"
                    className="text-sm font-normal text-muted-foreground"
                  >
                    Set the active school year and active term. This is the only
                    current-period selector for both JHS and SHS.
                  </Text>

                </Card.Title>
                <div className="flex items-center gap-4">
                  <Dialog>
                    <Dialog.Trigger>
                      <Button size="sm" className="whitespace-nowrap">New Academic Period</Button>
                    </Dialog.Trigger>
                    <AddAcademicPeriodModal />
                  </Dialog>
                </div>
              </Card.Header>
              <Card.Content className="flex flex-col gap-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-2">
                    <Text as="h6" className="font-sans font-medium">
                      Current Academic Year
                    </Text>
                    <Select
                      value={schoolYear}
                      onValueChange={(val) => {
                        setSchoolYear(val);
                        saveSingleSetting("current_school_year", val);
                      }}
                    >
                      <Select.Trigger className="w-full shadow-none hover:shadow-md focus:shadow-md focus-visible:shadow-md data-[state=open]:shadow-md transition-all">
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
                      Period Type
                    </Text>
                    <div className="h-10 border-2 border-black flex items-center gap-2 px-3 text-md">
                      <Lock className="w-3.5 h-3.5" />
                      Three-Term Calendar
                    </div>
                    <Text
                      as="p"
                      className="font-sans text-sm text-muted-foreground"
                    >
                      Locked for the current implementation.
                    </Text>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Text as="h6" className="font-sans font-medium">
                      Active Period
                    </Text>
                    <Select value={activeTerm} onValueChange={handleTermChange}>
                      <Select.Trigger className="w-full shadow-none hover:shadow-md focus:shadow-md focus-visible:shadow-md data-[state=open]:shadow-md transition-all">
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

                <div className="border-2 border-black rounded-md bg-background p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Text as="p" className="text-sm font-semibold">
                        {Math.round(ratio * 100)}% Complete
                      </Text>

                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2">
                        <Text as="p" className="text-sm font-semibold">
                          Active:
                        </Text>
                        <Badge size="sm" variant="secondary">
                          {TERM_LABELS[activeTerm] || `Term ${activeTerm}`}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <Progress value={ratio * 100} className="w-full" />
                </div>
                <div className="flex flex-row justify-between w-full items-center -my-2">
                  <Text as="p" className="font-sans text-sm text-muted-foreground">
                    Applies to Junior High School and Senior High School.
                  </Text>
                  <Button
                    size="sm"
                    variant="link"
                    className="shadow-none -mr-2"
                    onClick={() => navigate(`/admin/academic-periods`)}
                  >
                    View All Periods
                    <ArrowUpRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </Card.Content>
            </Card>

            {/* School Curriculum Scope */}
            <Card className="@container/card w-full">
              <Card.Header className="flex flex-row justify-between items-start">
                <Card.Title className="flex flex-col w-full gap-1 mb-4">
                  School Curriculum Scope
                  <Text
                    as="p"
                    className="text-sm font-normal text-muted-foreground"
                  >
                    Define what the school offers. Actual pathway subjects belong
                    in the Subjects module.
                  </Text>

                </Card.Title>
                <div className="flex items-center gap-4">
                  <Button
                    size="sm"
                    className="whitespace-nowrap"
                    onClick={handleSaveScope}
                    disabled={isSavingScope}
                  >
                    Save Scope
                  </Button>
                </div>
              </Card.Header>
              <Card.Content className="flex flex-col gap-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border-2 border-black p-4 flex flex-col gap-3">
                    <Text as="h6" className="text-xl font-bold">
                      School Levels
                    </Text>
                    <div className="flex items-center justify-between">
                      <Text as="p" className="font-medium">
                        Junior High School
                      </Text>
                      <Switch
                        checked={jhsEnabled}
                        onCheckedChange={() => setJhsEnabled((v) => !v)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
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

                  <div
                    className={`border-2 border-black p-4 flex flex-col gap-3 transition-colors ${shsEnabled
                      ? "bg-background"
                      : "bg-muted text-muted-foreground"
                      }`}
                  >

                    <div className="flex gap-2 flex-wrap justify-between">
                      <Text as="h6" className="text-xl font-bold">
                        Senior High School Setup
                      </Text>
                      <div className="flex items-center gap-2">
                        <Badge
                          size="sm"
                          variant="solid"
                          className={`inline-flex items-center gap-1 transition-colors ${shsEnabled
                            ? "border-border"
                            : "bg-muted text-muted-foreground border-border/50"
                            }`}
                        >
                          Academic Track
                        </Badge>
                        <Badge
                          size="sm"
                          variant="solid"
                          className={`inline-flex items-center gap-1 transition-colors ${shsEnabled
                            ? "border-border"
                            : "bg-muted text-muted-foreground"
                            }`}
                        >
                          STEM Strand
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <Text as="p" className="font-sans font-medium">
                        Medical / Pre-Med Pathway
                      </Text>
                      <Switch
                        checked={medicalEnabled}
                        onCheckedChange={() => setMedicalEnabled((v) => !v)}
                        disabled={!shsEnabled}
                      />
                    </div>
                    <div className="flex items-center justify-between">
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
                <Card.Title className="flex flex-row justify-between w-full items-center mb-4">Academic Levels</Card.Title>
              </Card.Header>
              <Card.Content className="flex flex-col gap-4">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>Level</Table.Head>
                      <Table.Head>Academic Stage</Table.Head>
                      <Table.Head className="text-center">Available Curriculum</Table.Head>
                      <Table.Head className="min-w-32 text-center">Status</Table.Head>
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
                          <Table.Cell className="text-center">
                            {item.stage === "Junior High" ? (
                              <Badge
                                size="sm"
                                variant="default"
                              >
                                Standard JHS setup
                              </Badge>
                            ) : (
                              <div className="flex gap-2 flex-wrap justify-center">
                                {pathwayPills(item.level)}
                              </div>
                            )}
                          </Table.Cell>
                          <Table.Cell className="text-center">
                            <Badge size="sm" variant={stageEnabled ? "secondary" : "default"}>
                              {stageEnabled ? "Enabled" : "Disabled"}
                            </Badge>
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
              <Card.Header className="flex flex-row justify-between items-start">
                <Card.Title className="flex flex-col w-full gap-1 mb-4">
                  Default Grading Templates
                  <Text
                    as="p"
                    className="text-sm font-normal text-muted-foreground"
                  >
                    Subjects will choose one template or override it in the
                    Subjects module.
                  </Text>

                </Card.Title>
                <div className="flex items-center gap-4">
                  <Dialog
                    open={templateModalOpen}
                    onOpenChange={setTemplateModalOpen}
                  >
                    <Dialog.Trigger>
                      <Button size="sm"
                        className="whitespace-nowrap">
                        New Template
                      </Button>
                    </Dialog.Trigger>
                    <AddGradingTemplateModal
                      onClose={() => setTemplateModalOpen(false)}
                      onSaved={async () => {
                        await fetchGradingTemplatesList();
                        setTemplateModalOpen(false);
                        showToast("New grading template saved to database");
                      }}
                    />
                  </Dialog>
                </div>
              </Card.Header>

              <Card.Content className="flex flex-col gap-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {templates.map((t, i) => (
                    <Card key={i} className="shadow-none bg-primary p-3 flex flex-col gap-3 w-full">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <Text as="h6" className="font-sans font-bold">
                            {t.name}
                          </Text>
                          <Text as="p" className="font-sans text-xs text-foreground">
                            {t.scope}
                          </Text>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="bg-background"
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
                        <Card className="flex flex-col shadow-none p-2 items-center justify-center w-full ">
                          <Text as="p" className="font-bold text-lg">
                            {t.ww}%
                          </Text>
                          <Text as="p" className="text-xs text-muted-foreground">
                            WW
                          </Text>
                        </Card>
                        <Card className="flex flex-col shadow-none p-2 items-center justify-center w-full">
                          <Text as="p" className="font-bold text-lg">
                            {t.pt}%
                          </Text>
                          <Text as="p" className="text-xs text-muted-foreground">
                            PT
                          </Text>
                        </Card>
                        <Card className="flex flex-col shadow-none p-2 items-center justify-center w-full">
                          <Text as="p" className="font-bold text-lg">
                            {t.qa}%
                          </Text>
                          <Text as="p" className="text-xs text-muted-foreground">
                            QA
                          </Text>
                        </Card>
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
                <Card.Title className="flex flex-row justify-between w-full items-center mb-4">Module Responsibility Map</Card.Title>
              </Card.Header>
              <Card.Content className="flex flex-col gap-4">
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
                    <Card key={s.n} className="p-3 w-full shadow-none">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="secondary"
                          className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-yellow-300 border-1 border-black p-0 text-xs font-bold"
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
