"use client";

import * as React from "react";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { Select } from "@/components/retroui/Select";
import { Table } from "@/components/retroui/Table";
import { Badge } from "@/components/retroui/Badge";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Empty } from "@/components/retroui/Empty";
import { DownloadIcon, InboxIcon } from "lucide-react";
import { Input } from "@/components/retroui/Input";

export default function AddSubjectModal() {
    const subjects = [
        {
            id: "1",
            subjectName: "Mathematics",
            subjectCode: "MATH101",
            gradingComponent: "Core",
            status: "Assigned",
        },
        {
            id: "2",
            subjectName: "Science",
            subjectCode: "SCI101",
            gradingComponent: "Elective",
            status: "Unassigned",
        },
        {
            id: "3",
            subjectName: "English",
            subjectCode: "ENG101",
            gradingComponent: "Core",
            status: "Assigned",
        },
        {
            id: "4",
            subjectName: "History",
            subjectCode: "HIST101",
            gradingComponent: "Core",
            status: "Unassigned",
        },
    ];

    const [step, setStep] = React.useState<number>(1);
    const [yearLevel, setYearLevel] = React.useState<string>("");

    const [selectedSubjects, setSelectedSubjects] = React.useState<Set<string>>(new Set())

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedSubjects(new Set(subjects.map(sub => sub.id)))
        } else {
            setSelectedSubjects(new Set())
        }
    }

    const handleSelectSubject = (subjectId: string, checked: boolean) => {
        const newSelected = new Set(selectedSubjects)
        if (checked) {
            newSelected.add(subjectId)
        } else {
            newSelected.delete(subjectId)
        }
        setSelectedSubjects(newSelected)
    }

    const isAllSelected = selectedSubjects.size === subjects.length

    if (step === 1) {
        return (
            <Dialog.Content size={"2xl"}>
                <Dialog.Header asChild>
                    <div className="flex items-center justify-between w-full">
                        <Text as="h5" className="font-sans text-xl font-bold">Add Subject</Text>
                        <Text as="h5" className="font-sans text-md font-bold">(Step 1 of 3)</Text>
                    </div>
                </Dialog.Header>
                <section className="flex flex-col gap-4 p-4 max-h-[90vh] overflow-y-auto">
                    <section className="text-md">
                        <div className="flex flex-col gap-3">
                            <div className="flex flex-col gap-1">
                                <label htmlFor="grading-component-name" className="text-sm">Year Level</label>
                                <Select value={yearLevel} onValueChange={setYearLevel}>
                                    <Select.Trigger className="w-full">
                                        <Select.Value placeholder="Select Year Level" />
                                    </Select.Trigger>
                                    <Select.Content>
                                        <Select.Group>
                                            <Select.Item value="g7">Grade 7</Select.Item>
                                            <Select.Item value="g8">Grade 8</Select.Item>
                                            <Select.Item value="g9">Grade 9</Select.Item>
                                            <Select.Item value="g10">Grade 10</Select.Item>
                                            <Select.Item value="g11">Grade 11</Select.Item>
                                            <Select.Item value="g12">Grade 12</Select.Item>
                                        </Select.Group>
                                    </Select.Content>
                                </Select>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label htmlFor="grading-component-name" className="text-sm">Import Subjects</label>
                                <Empty>
                                    <Empty.Content>
                                        <Empty.Icon>
                                            <InboxIcon className="size-10 md:size-12" />
                                        </Empty.Icon>
                                        <Empty.Description className="text-sm">
                                            Supports .xls and .xlsx files
                                        </Empty.Description>
                                        <div className="flex flex-col gap-1">
                                            <Button onClick={() => setStep(2)}>Import now</Button>
                                            <Empty.Description className="text-sm">
                                                or
                                            </Empty.Description>
                                            <Button size={"sm"} variant={"outline"} onClick={() => setStep(2)}>Create manually</Button>
                                        </div>

                                    </Empty.Content>
                                </Empty>
                                <div className="flex justify-between">
                                    <Text as="p" className="text-sm text-muted-foreground mt-1">Upload an excel spreadsheet containing the subject details, codes, and classifications to bulk import them.</Text>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="mt-2 w-fit"
                                    >
                                        <DownloadIcon className="size-4 mr-2" /> Download template
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </section>
                </section>
                <Dialog.Footer>
                    <Dialog.Trigger>
                        <Button variant={"outline"}>Close</Button>
                    </Dialog.Trigger>
                </Dialog.Footer>
            </Dialog.Content>
        );
    }

    if (step === 2) {
        return (
            <Dialog.Content size={"2xl"}>
                <Dialog.Header asChild>
                    <div className="flex items-center justify-between w-full">
                        <Text as="h5" className="font-sans text-xl font-bold">Review and Assign Subjects</Text>
                        <Text as="h5" className="font-sans text-md font-bold">(Step 2 of 3)</Text>
                    </div>
                </Dialog.Header>
                <section className="flex flex-col gap-4 p-4 max-h-[60vh] overflow-y-auto">
                    <section className="text-md">
                        <div className="flex flex-col gap-3">
                            <div className="flex flex-col gap-1">
                                <div className="flex justify-between mb-1 px-1 items-end">
                                    <label htmlFor="grading-weights" className="text-sm">Extracted / Created Subjects</label>
                                    <Dialog>
                                        <Dialog.Trigger>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="w-fit"
                                            >
                                                Add Subject
                                            </Button>
                                        </Dialog.Trigger>
                                        <AddSubjectManuallyModal />
                                    </Dialog>
                                </div>
                                <Table>
                                    <Table.Header className="font-sans">
                                        <Table.Row>
                                            <Table.Head>Subject Name</Table.Head>
                                            <Table.Head>Subject Code</Table.Head>
                                            <Table.Head>Grading Component</Table.Head>
                                            <Table.Head>Status</Table.Head>
                                            <Table.Head></Table.Head>
                                        </Table.Row>
                                    </Table.Header>
                                    <Table.Body>
                                        {subjects.map((item) => (
                                            <Table.Row key={item.id}>
                                                <Table.Cell className="font-medium">{item.subjectName}</Table.Cell>
                                                <Table.Cell className="font-medium">{item.subjectCode}</Table.Cell>
                                                <Table.Cell className="font-medium">{item.gradingComponent}</Table.Cell>
                                                <Table.Cell>
                                                    <Badge
                                                        variant={
                                                            item.status === "Assigned"
                                                                ? "surface"
                                                                : "outline"
                                                        }
                                                        size="sm"
                                                    >
                                                        {item.status}
                                                    </Badge>
                                                </Table.Cell>
                                                <Table.Cell className="w-[50px]">
                                                    <Checkbox
                                                        checked={selectedSubjects.has(item.id)}
                                                        onCheckedChange={(checked) => handleSelectSubject(item.id, Boolean(checked))}
                                                    />
                                                </Table.Cell>
                                            </Table.Row>
                                        ))}
                                    </Table.Body>
                                </Table>
                                <div className="flex justify-between">
                                    <Text as="p" className="text-sm text-muted-foreground mt-1">Subjects shown are extracted from the file. Please review and make any necessary changes.</Text>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="mt-2 w-fit"
                                        onClick={() => handleSelectAll(!isAllSelected)}
                                    >
                                        {isAllSelected ? "Unassign All" : "Assign All"}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </section>
                </section>
                <Dialog.Footer>
                    <Button variant={"outline"} onClick={() => setStep(1)}>Back</Button>
                    <Button variant={"default"} onClick={() => setStep(3)}>Next</Button>
                </Dialog.Footer>
            </Dialog.Content>
        );
    }

    return (
        <Dialog.Content size={"2xl"}>
            <Dialog.Header asChild>
                <div className="flex items-center justify-between w-full">
                    <div className="flex items-center justify-between w-full">
                        <Text as="h5" className="font-sans text-xl font-bold">New Subjects Summary</Text>
                        <Text as="h5" className="font-sans text-md font-bold">(Step 3 of 3)</Text>
                    </div>
                </div>
            </Dialog.Header>
            <section className="flex flex-col gap-4 p-4 max-h-[70vh] overflow-y-auto">
                <section className="text-md">
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col">
                            <div className="flex flex-row items-end gap-2">
                                <Text as="h5" className="font-sans text-sm font-normal pb-1">Grade Level:</Text>
                                <Text as="h5" className="font-sans text-lg font-bold">Grade 7</Text>
                            </div>
                            <div className="flex flex-row items-end gap-2">
                                <Text as="h5" className="font-sans text-sm font-normal pb-1"> Effective as of Academic Year:</Text>
                                <Text as="h5" className="font-sans text-lg font-bold">2026-2027</Text>
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label htmlFor="grading-weights" className="text-sm">Assigned Subjects</label>
                            <Table>
                                <Table.Body>
                                    {subjects.map((item) => (
                                        <Table.Row key={item.id}>
                                            <Table.Cell className="font-medium">{item.subjectName}</Table.Cell>
                                        </Table.Row>
                                    ))}
                                </Table.Body>
                            </Table>
                        </div>
                    </div>
                </section>
            </section>
            <Dialog.Footer>
                <Button variant={"outline"} onClick={() => setStep(2)}>Back</Button>
                <Dialog.Trigger>
                    <Button variant={"default"}>Add Subjects</Button>
                </Dialog.Trigger>
            </Dialog.Footer>
        </Dialog.Content>
    );
}

export function AddSubjectManuallyModal() {
    const [gradingComponent, setGradingComponent] = React.useState<string>("");

    return (
        <Dialog.Content size={"lg"}>
            <Dialog.Header asChild>
                <div className="flex items-center justify-between w-full">
                    <Text as="h5" className="font-sans text-xl font-bold">Add Subject Manually</Text>
                </div>
            </Dialog.Header>
            <section className="flex flex-col gap-4 p-4 max-h-[70vh] overflow-y-auto">
                <section className="text-md">
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                            <label htmlFor="grading-component-name" className="text-sm">Subject Name</label>
                            <Input type="text" placeholder="Enter name" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label htmlFor="grading-component-name" className="text-sm">Subject Code</label>
                            <Input type="text" placeholder="Enter code" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label htmlFor="grading-component-name" className="text-sm">Grading Component</label>
                            <Select value={gradingComponent} onValueChange={setGradingComponent}>
                                <Select.Trigger className="w-full">
                                    <Select.Value placeholder="Select Grading Component" />
                                </Select.Trigger>
                                <Select.Content>
                                    <Select.Group>
                                        <Select.Item value="core">Core</Select.Item>
                                        <Select.Item value="elec">Elective</Select.Item>
                                        <Select.Item value="app">Applied</Select.Item>
                                        <Select.Item value="ot">Others</Select.Item>
                                    </Select.Group>
                                </Select.Content>
                            </Select>
                        </div>

                    </div>
                </section>
            </section>
            <Dialog.Footer>
                <Dialog.Trigger>
                    <Button variant={"outline"}>Close</Button>
                </Dialog.Trigger>
                <Dialog.Trigger>
                    <Button variant={"default"}>Add Subject</Button>
                </Dialog.Trigger>
            </Dialog.Footer>
        </Dialog.Content>
    );
}