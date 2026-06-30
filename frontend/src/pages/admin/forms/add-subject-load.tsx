"use client";

import * as React from "react";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { Select } from "@/components/retroui/Select";
import { Table } from "@/components/retroui/Table";
import { Badge } from "@/components/retroui/Badge";
import { Checkbox } from "@/components/retroui/Checkbox";
import { TimePickerSingle, parseTimeRange, formatTimeRange } from "@/components/retroui/TimePicker";
import { Accordion } from "@/components/retroui/Accordion";

export default function AddSubjectLoadModal() {
    const subjects = [
        {
            id: "1",
            subjectName: "Mathematics",
            subjectCode: "MATH101",
            gradingComponent: "Major",
            status: "Assigned",
        },
        {
            id: "2",
            subjectName: "Science",
            subjectCode: "SCI101",
            gradingComponent: "Major",
            status: "Unassigned",
        },
        {
            id: "3",
            subjectName: "English",
            subjectCode: "ENG101",
            gradingComponent: "Minor",
            status: "Assigned",
        },
        {
            id: "4",
            subjectName: "History",
            subjectCode: "HIST101",
            gradingComponent: "Minor",
            status: "Unassigned",
        },
    ];
    const teachers = [
        { id: "t1", name: "John Doe" },
        { id: "t2", name: "Jane Smith" },
        { id: "t3", name: "Alice Johnson" },
    ];

    const [subjectLoad, setSubjectLoad] = React.useState([
        {
            id: "1",
            subjectName: "Mathematics",
            time: "7:45 - 8:45 AM",
            days: ["M", "W", "F"],
            teacherId: "t1",
        },
        {
            id: "2",
            subjectName: "Science",
            time: "8:45 - 9:45 AM",
            days: ["T", "Th"],
            teacherId: "t2",
        },
        {
            id: "3",
            subjectName: "English",
            time: "10:00 - 11:00 AM",
            days: ["M", "W", "F"],
            teacherId: "",
        },
        {
            id: "4",
            subjectName: "History",
            time: "11:00 AM - 12:00 PM",
            days: ["T", "Th"],
            teacherId: "",
        },
    ]);


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

    const handleTeacherChange = (id: string, teacherId: string) => {
        setSubjectLoad(prev => prev.map(item => item.id === id ? { ...item, teacherId } : item));
    };

    const handleTimeChange = (id: string, time: string) => {
        setSubjectLoad(prev => prev.map(item => item.id === id ? { ...item, time } : item));
    };

    const isAllSelected = selectedSubjects.size === subjects.length

    if (step === 1) {
        return (
            <Dialog.Content size={"2xl"}>
                <Dialog.Header asChild>
                    <div className="flex items-center justify-between w-full">
                        <Text as="h5" className="font-sans text-xl font-bold">Add Subject Load</Text>
                        <Text as="h5" className="font-sans text-md font-bold">(Step 1 of 4)</Text>
                    </div>
                </Dialog.Header>
                <section className="flex flex-col gap-4 p-4 max-h-[90vh] overflow-y-auto">
                    <section className="text-md">
                        <div className="flex flex-col gap-3">
                            <div className="flex flex-row gap-2 w-full">
                                <div className="flex flex-col gap-1 w-full">
                                    <label htmlFor="grading-component-name" className="text-sm">Academic Year</label>
                                    <Select value={yearLevel} onValueChange={setYearLevel}>
                                        <Select.Trigger className="w-full">
                                            <Select.Value placeholder="Select academic year" />
                                        </Select.Trigger>
                                        <Select.Content>
                                            <Select.Group>
                                                <Select.Item value="g7">2026-2027</Select.Item>
                                                <Select.Item value="g8">2027-2028</Select.Item>
                                                <Select.Item value="g9">2028-2029</Select.Item>
                                                <Select.Item value="g10">2029-2030</Select.Item>
                                                <Select.Item value="g11">2030-2031</Select.Item>
                                                <Select.Item value="g12">2031-2032</Select.Item>
                                            </Select.Group>
                                        </Select.Content>
                                    </Select>
                                </div>
                                <div className="flex flex-col gap-1 w-full">
                                    <label htmlFor="grading-component-name" className="text-sm">Academic Period</label>
                                    <Select value={yearLevel} onValueChange={setYearLevel}>
                                        <Select.Trigger className="w-full">
                                            <Select.Value placeholder="Select period" />
                                        </Select.Trigger>
                                        <Select.Content>
                                            <Select.Group>
                                                <Select.Item value="g7">Term 1</Select.Item>
                                                <Select.Item value="g8">Term 2</Select.Item>
                                                <Select.Item value="g9">Term 3</Select.Item>
                                            </Select.Group>
                                        </Select.Content>
                                    </Select>
                                </div>
                                <div className="flex flex-col gap-1 w-full">
                                    <label htmlFor="grading-component-name" className="text-sm">Year Level</label>
                                    <Select value={yearLevel} onValueChange={setYearLevel}>
                                        <Select.Trigger className="w-full">
                                            <Select.Value placeholder="Select year level" />
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
                            </div>
                            <div className="flex flex-col gap-1">
                                <label htmlFor="grading-weights" className="text-sm">Subjects</label>
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
                                    <Text as="p" className="text-sm mt-1">Assign all or selected subjects to the subject load.</Text>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="mt-2 w-fit"
                                        onClick={() => handleSelectAll(!isAllSelected)}
                                    >
                                        {isAllSelected ? "Deselect All" : "Select All"}
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
                    <Button variant={"default"} onClick={() => setStep(2)}>Generate Load</Button>
                </Dialog.Footer>
            </Dialog.Content>
        );
    }

    if (step === 2) {
        return (
            <Dialog.Content size={"2xl"}>
                <Dialog.Header asChild>
                    <div className="flex items-center justify-between w-full">
                        <Text as="h5" className="font-sans text-xl font-bold">Add Teacher & Schedule</Text>
                        <Text as="h5" className="font-sans text-md font-bold">(Step 2 of 4)</Text>
                    </div>
                </Dialog.Header>
                <section className="flex flex-col gap-4 p-4 max-h-[80vh] overflow-y-auto">
                    <section className="text-md">
                        <div className="flex flex-row gap-2 w-full">
                            <div className="flex flex-col gap-1 w-full mb-2">
                                <label htmlFor="grading-component-name" className="text-sm">Academic Period</label>
                                <Select value={yearLevel} onValueChange={setYearLevel}>
                                    <Select.Trigger className="w-full">
                                        <Select.Value placeholder="Select period" />
                                    </Select.Trigger>
                                    <Select.Content>
                                        <Select.Group>
                                            <Select.Item value="g7">Term 1</Select.Item>
                                            <Select.Item value="g8">Term 2</Select.Item>
                                            <Select.Item value="g9">Term 3</Select.Item>
                                        </Select.Group>
                                    </Select.Content>
                                </Select>
                                <Text as="p" className="text-sm text-muted-foreground">Assign a schedule to the subject load for the selected academic period.</Text>
                            </div>
                        </div>
                        <div className="flex flex-col gap-3">
                            <div className="flex flex-col gap-1">
                                <div className="flex flex-row justify-between">
                                    <div className="flex flex-row items-end gap-2">
                                        <Text as="h5" className="font-sans text-sm font-normal pb-1">Section:</Text>
                                        <Text as="h5" className="font-sans text-lg font-bold">Macupa</Text>
                                    </div>
                                    <div className="flex flex-row items-end gap-2">
                                        <Badge variant="surface" size="sm">3 unassigned teacher</Badge>
                                        <Badge variant="solid" size="sm">2 conflicts</Badge>
                                    </div>
                                </div>
                                <Table wrapperClassName="overflow-visible">
                                    <Table.Header className="font-sans">
                                        <Table.Row>
                                            <Table.Head>Subject Name</Table.Head>
                                            <Table.Head>Time</Table.Head>
                                            <Table.Head>Days</Table.Head>
                                            <Table.Head>Teacher</Table.Head>
                                        </Table.Row>
                                    </Table.Header>
                                    <Table.Body>
                                        {subjectLoad.map((item) => (
                                            <Table.Row key={item.id}>
                                                <Table.Cell className="font-medium text-lg">{item.subjectName}</Table.Cell>
                                                <Table.Cell className="font-medium">
                                                    <div className="flex items-center gap-1.5">
                                                        <TimePickerSingle
                                                            value={parseTimeRange(item.time).start}
                                                            onChange={(newStart) => {
                                                                const { end } = parseTimeRange(item.time);
                                                                const newRange = formatTimeRange(newStart, end);
                                                                handleTimeChange(item.id, newRange);
                                                            }}
                                                        />
                                                        <span className="text-muted-foreground text-xs font-sans">to</span>
                                                        <TimePickerSingle
                                                            value={parseTimeRange(item.time).end}
                                                            onChange={(newEnd) => {
                                                                const { start } = parseTimeRange(item.time);
                                                                const newRange = formatTimeRange(start, newEnd);
                                                                handleTimeChange(item.id, newRange);
                                                            }}
                                                        />
                                                    </div>
                                                </Table.Cell>
                                                <Table.Cell>
                                                    <div className="flex gap-1">
                                                        {item.days.map((day) => (
                                                            <Badge key={day} variant="outline" size="sm">
                                                                {day}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                </Table.Cell>
                                                <Table.Cell>
                                                    <Select
                                                        value={item.teacherId}
                                                        onValueChange={(val) => handleTeacherChange(item.id, val)}
                                                    >
                                                        <Select.Trigger className="w-[180px] h-8 shadow-none">
                                                            <Select.Value placeholder="Select Teacher" />
                                                        </Select.Trigger>
                                                        <Select.Content>
                                                            <Select.Group>
                                                                {teachers.map((t) => (
                                                                    <Select.Item key={t.id} value={t.id}>
                                                                        {t.name}
                                                                    </Select.Item>
                                                                ))}
                                                            </Select.Group>
                                                        </Select.Content>
                                                    </Select>
                                                </Table.Cell>
                                            </Table.Row>
                                        ))}
                                    </Table.Body>
                                </Table>
                            </div>
                            <div className="flex flex-col gap-1">
                                <div className="flex flex-row items-end gap-2">
                                    <Text as="h5" className="font-sans text-sm font-normal pb-1">Section:</Text>
                                    <Text as="h5" className="font-sans text-lg font-bold">Mahogany</Text>
                                </div>
                                <Table wrapperClassName="overflow-visible">
                                    <Table.Header className="font-sans">
                                        <Table.Row>
                                            <Table.Head>Subject Name</Table.Head>
                                            <Table.Head>Time</Table.Head>
                                            <Table.Head>Days</Table.Head>
                                            <Table.Head>Teacher</Table.Head>
                                        </Table.Row>
                                    </Table.Header>
                                    <Table.Body>
                                        {subjectLoad.map((item) => (
                                            <Table.Row key={item.id}>
                                                <Table.Cell className="font-medium text-lg">{item.subjectName}</Table.Cell>
                                                <Table.Cell className="font-medium">
                                                    <div className="flex items-center gap-1.5">
                                                        <TimePickerSingle
                                                            value={parseTimeRange(item.time).start}
                                                            onChange={(newStart) => {
                                                                const { end } = parseTimeRange(item.time);
                                                                const newRange = formatTimeRange(newStart, end);
                                                                handleTimeChange(item.id, newRange);
                                                            }}
                                                        />
                                                        <span className="text-muted-foreground text-xs font-sans">to</span>
                                                        <TimePickerSingle
                                                            value={parseTimeRange(item.time).end}
                                                            onChange={(newEnd) => {
                                                                const { start } = parseTimeRange(item.time);
                                                                const newRange = formatTimeRange(start, newEnd);
                                                                handleTimeChange(item.id, newRange);
                                                            }}
                                                        />
                                                    </div>
                                                </Table.Cell>
                                                <Table.Cell>
                                                    <div className="flex gap-1">
                                                        {item.days.map((day) => (
                                                            <Badge key={day} variant="outline" size="sm">
                                                                {day}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                </Table.Cell>
                                                <Table.Cell>
                                                    <Select
                                                        value={item.teacherId}
                                                        onValueChange={(val) => handleTeacherChange(item.id, val)}
                                                    >
                                                        <Select.Trigger className="w-[180px] h-8 shadow-none">
                                                            <Select.Value placeholder="Select Teacher" />
                                                        </Select.Trigger>
                                                        <Select.Content>
                                                            <Select.Group>
                                                                {teachers.map((t) => (
                                                                    <Select.Item key={t.id} value={t.id}>
                                                                        {t.name}
                                                                    </Select.Item>
                                                                ))}
                                                            </Select.Group>
                                                        </Select.Content>
                                                    </Select>
                                                </Table.Cell>
                                            </Table.Row>
                                        ))}
                                    </Table.Body>
                                </Table>
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
                        <Text as="h5" className="font-sans text-xl font-bold">Subject Load Summary</Text>
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
                            <div className="flex flex-row items-end gap-2">
                                <Text as="h5" className="font-sans text-sm font-normal pb-1">Configured Academic Period:</Text>
                                <Text as="h5" className="font-sans text-lg font-bold">1st Term</Text>
                                <Text as="h5" className="font-sans text-sm font-normal pb-1">(2nd & 3rd Term are yet to be configured)</Text>
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label htmlFor="grading-component-name" className="text-sm">Published Subject Loads</label>
                            <Accordion className="space-y-3 w-full">
                                <Accordion.Item value="item-1">
                                    <Accordion.Header>Macupa</Accordion.Header>
                                    <Accordion.Content>
                                        <div className="flex flex-col">
                                            <Table>
                                                <Table.Header className="font-sans">
                                                    <Table.Row>
                                                        <Table.Head>Subject Name</Table.Head>
                                                        <Table.Head>Time</Table.Head>
                                                        <Table.Head>Days</Table.Head>
                                                        <Table.Head>Teacher</Table.Head>
                                                    </Table.Row>
                                                </Table.Header>
                                                <Table.Body>
                                                    {subjectLoad.map((item) => (
                                                        <Table.Row key={item.id}>
                                                            <Table.Cell className="font-medium text-lg">{item.subjectName}</Table.Cell>
                                                            <Table.Cell className="font-medium">{item.time}</Table.Cell>
                                                            <Table.Cell>
                                                                <div className="flex gap-1">
                                                                    {item.days.map((day) => (
                                                                        <Badge key={day} variant="outline" size="sm">
                                                                            {day}
                                                                        </Badge>
                                                                    ))}
                                                                </div>
                                                            </Table.Cell>
                                                            <Table.Cell className="font-medium">
                                                                {teachers.find(t => t.id === item.teacherId)?.name || "Unassigned"}
                                                            </Table.Cell>
                                                        </Table.Row>
                                                    ))}
                                                </Table.Body>
                                            </Table>
                                        </div>
                                    </Accordion.Content>
                                </Accordion.Item>
                                <Accordion.Item value="item-2">
                                    <Accordion.Header>Mahogany</Accordion.Header>
                                    <Accordion.Content>
                                        <div className="flex flex-col">
                                            <Table>
                                                <Table.Header className="font-sans">
                                                    <Table.Row>
                                                        <Table.Head>Subject Name</Table.Head>
                                                        <Table.Head>Time</Table.Head>
                                                        <Table.Head>Days</Table.Head>
                                                        <Table.Head>Teacher</Table.Head>
                                                    </Table.Row>
                                                </Table.Header>
                                                <Table.Body>
                                                    {subjectLoad.map((item) => (
                                                        <Table.Row key={item.id}>
                                                            <Table.Cell className="font-medium text-lg">{item.subjectName}</Table.Cell>
                                                            <Table.Cell className="font-medium">{item.time}</Table.Cell>
                                                            <Table.Cell>
                                                                <div className="flex gap-1">
                                                                    {item.days.map((day) => (
                                                                        <Badge key={day} variant="outline" size="sm">
                                                                            {day}
                                                                        </Badge>
                                                                    ))}
                                                                </div>
                                                            </Table.Cell>
                                                            <Table.Cell className="font-medium">
                                                                {teachers.find(t => t.id === item.teacherId)?.name || "Unassigned"}
                                                            </Table.Cell>
                                                        </Table.Row>
                                                    ))}
                                                </Table.Body>
                                            </Table>
                                        </div>
                                    </Accordion.Content>
                                </Accordion.Item>
                            </Accordion>
                        </div>
                    </div>
                </section>
            </section>
            <Dialog.Footer>
                <Button variant={"outline"} onClick={() => setStep(2)}>Back</Button>
                <Dialog.Trigger>
                    <Button variant={"default"}>Publish</Button>
                </Dialog.Trigger>
            </Dialog.Footer>
        </Dialog.Content>
    );
}
