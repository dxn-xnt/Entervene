"use client";

import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";

export default function AddGradingComponentModal() {

    return (
        <Dialog.Content size={"lg"}>
            <Dialog.Header position={"fixed"} asChild>
                <Text as="h5" className="font-sans text-xl font-bold">Add Grading Component</Text>
            </Dialog.Header>
            <section className="flex flex-col gap-4 p-4">
                <section className="text-md">
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                            <label htmlFor="grading-component-name" className="text-sm">Component Name</label>
                            <Input type="text" placeholder="Enter name" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label htmlFor="grading-weights" className="text-sm">Grade Weights</label>
                            <div className="grid grid-cols-3 gap-3 w-full">
                                <div className="flex flex-col justify-between w-full items-start">
                                    <Text as="h6" className="font-sans text-md font-semibold">
                                        Written Works
                                    </Text>
                                    <Input className="w-full" type="text" placeholder="40%" />
                                </div>
                                <div className="flex flex-col justify-between w-full items-start">
                                    <Text as="h6" className="font-sans text-md font-semibold">
                                        Performance Tasks
                                    </Text>
                                    <Input className="w-full" type="text" placeholder="40%" />
                                </div>
                                <div className="flex flex-col justify-between w-full items-start">
                                    <Text as="h6" className="font-sans text-md font-semibold">
                                        Major Exams
                                    </Text>
                                    <Input className="w-full" type="text" placeholder="20%" />
                                </div>
                            </div>
                            <div className="flex w-full items-center justify-end pt-2">
                                <Button variant={"outline"} size={"sm"}>Add New Category</Button>
                            </div>
                        </div>
                    </div>
                </section>
            </section>
            <Dialog.Footer>
                <Dialog.Trigger>
                    <Button variant={"outline"}>Close</Button>
                </Dialog.Trigger>
                <Dialog.Trigger>
                    <Button variant={"default"}>Add</Button>
                </Dialog.Trigger>
            </Dialog.Footer>
        </Dialog.Content>
    );
}
