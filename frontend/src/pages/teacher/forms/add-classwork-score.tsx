"use client";

import { useState } from "react";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { Select } from "@/components/retroui/Select";
import { Input } from "@/components/retroui/Input";

interface AddClassworkScoreModalProps {
    categoryName: string;
}

export default function AddClassworkScoreModal({
    categoryName,
}: AddClassworkScoreModalProps) {
    const [selectedPeriod, setSelectedPeriod] = useState<string>(categoryName);

    return (
        <Dialog.Content size={"lg"}>
            <Dialog.Header position={"fixed"} asChild>
                <Text as="h5" className="font-sans text-xl font-bold">Add {selectedPeriod}</Text>
            </Dialog.Header>
            <section className="flex flex-col gap-4 p-4">
                <div className="flex flex-col gap-2 w-full">
                    <div className="flex flex-col gap-1 w-full mb-2">
                        <label htmlFor="grading-component-name" className="text-sm">Academic Period</label>
                        <Select value={selectedPeriod} onValueChange={(val) => setSelectedPeriod(val)}>
                            <Select.Trigger className="w-full">
                                <Select.Value placeholder="Select period" />
                            </Select.Trigger>
                            <Select.Content>
                                <Select.Group>
                                    <Select.Item value="Written Works">Written Works</Select.Item>
                                    <Select.Item value="Performance Tasks">Performance Tasks</Select.Item>
                                    <Select.Item value="Quarterly Assessment">Quarterly Assessment</Select.Item>
                                </Select.Group>
                            </Select.Content>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-1 w-full mb-2">
                        <label htmlFor="grading-component-name" className="text-sm">Classwork Name</label>
                        <Input
                            placeholder="Enter name"
                            type="text"
                        />
                    </div>
                    <div className="flex flex-col gap-1 w-full mb-2">
                        <label htmlFor="grading-component-name" className="text-sm">Max Score</label>
                        <Input
                            placeholder="Enter maximum score"
                            type="number"
                            min={0}
                            max={100}
                        />
                    </div>
                    <div className="flex flex-col gap-1 w-full mb-2">
                        <label htmlFor="grading-component-name" className="text-sm">Date Classwork Taken</label>
                        <Input
                            type="date"
                        />
                    </div>

                </div>
            </section>
            <Dialog.Footer>
                <Dialog.Trigger>
                    <Button variant={"outline"}>Close</Button>
                </Dialog.Trigger>
                <Dialog.Trigger>
                    <Button variant={"default"}>Add Classwork</Button>
                </Dialog.Trigger>
            </Dialog.Footer>
        </Dialog.Content>
    );
}
