"use client";

import * as React from "react";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { Select } from "@/components/retroui/Select";
import { Table } from "@/components/retroui/Table";
import { Badge } from "@/components/retroui/Badge";
import { Checkbox } from "@/components/retroui/Checkbox";

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

    const isAllSelected = selectedSubjects.size === subjects.length

    if (step === 1) {
        return (
            <Dialog.Content size={"2xl"}>
                <Dialog.Header asChild>
                    <div className="flex items-center justify-between w-full">
                        <Text as="h5" className="font-sans text-xl font-bold">Add Subject Load</Text>
                        <Text as="h5" className="font-sans text-md font-bold">(Step 1 of 2)</Text>
                    </div>
                </Dialog.Header>
                <section className="flex flex-col gap-4 p-4 max-h-[60vh] overflow-y-auto">
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
                    <Button variant={"default"} onClick={() => setStep(2)}>Next</Button>
                </Dialog.Footer>
            </Dialog.Content>
        );
    }

    return (
        <Dialog.Content size={"2xl"}>
            <Dialog.Header asChild>
                <div className="flex items-center justify-between w-full">
                    <div className="flex items-center justify-between w-full">
                        <Text as="h5" className="font-sans text-xl font-bold">Add Subject Load</Text>
                        <Text as="h5" className="font-sans text-md font-bold">(Step 2 of 2)</Text>
                    </div>
                </div>
            </Dialog.Header>
            <section className="flex flex-col gap-4 p-4 max-h-[70vh] overflow-y-auto">
                <section className="text-md">
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                            <div className="flex flex-row items-end gap-2">
                                <Text as="h5" className="font-sans text-sm font-normal pb-1">Section:</Text>
                                <Text as="h5" className="font-sans text-lg font-bold">Macupa</Text>
                            </div>
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
                <Dialog.Trigger>
                    <Button variant={"default"}>Add Subject Load</Button>
                </Dialog.Trigger>
            </Dialog.Footer>
        </Dialog.Content>
    );
}
