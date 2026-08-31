import { ChevronRight, Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { apiFetch } from "@/lib/api";

type TeacherClassLoad = {
    subject_load_id: number;
    subject_id: number;
    subject_name: string;
    subject_codename?: string | null;
    class_id: number;
    section_name: string;
};

type SubjectSummary = {
    subject_id: number;
    subject_name: string;
    classes: TeacherClassLoad[];
};

const Subject = () => {
    const navigate = useNavigate();
    const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchLoads = async () => {
            setIsLoading(true);
            setError("");
            try {
                const res = await apiFetch("/api/v1/classwork-assignments/teacher/classes");
                if (res.ok) {
                    const data = (await res.json()) as TeacherClassLoad[];
                    setLoads(Array.isArray(data) ? data : []);
                }
            } catch (err) {
                setError(
                    err instanceof Error ? err.message : "Failed to fetch class loads."
                );
            } finally {
                setIsLoading(false);
            }
        };

        fetchLoads();
    }, []);

    const subjects = useMemo(() => {
        const bySubject = new Map<number, SubjectSummary>();
        for (const item of loads) {
            const existing = bySubject.get(item.subject_id);
            if (existing) {
                existing.classes.push(item);
            } else {
                bySubject.set(item.subject_id, {
                    subject_id: item.subject_id,
                    subject_name: item.subject_name,
                    classes: [item],
                });
            }
        }
        return Array.from(bySubject.values()).sort((a, b) =>
            a.subject_name.localeCompare(b.subject_name)
        );
    }, [loads]);

    return (
        <AppLayout>
            <div className="flex flex-1 flex-col">
                <div className="@container/main flex flex-1 flex-col">
                    <div className="flex flex-1 flex-col">
                        <header className="flex items-center gap-3 bg-background py-4 px-4 md:px-6">
                            <SidebarTrigger className="md:hidden" />
                            <h1 className="text-2xl md:text-4xl font-bold tracking-tight">Subject</h1>
                        </header>

                        <div className="border-t-2 border-border -mt-[1px] py-4 px-4 md:px-6 flex flex-col gap-4">
                            {error && (
                                <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                                    {error}
                                </div>
                            )}

                            <section className="rounded-lg border border-black bg-[#F6E9B2] px-5 py-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h2 className="text-3xl font-bold">2024 - 2025</h2>
                                        <p className="text-xs font-medium">Subjects assigned for this academic year</p>
                                    </div>
                                    <Info size={16} />
                                </div>
                            </section>

                            {isLoading ? (
                                <p className="py-8 text-center text-gray-500">Loading subjects...</p>
                            ) : (
                                subjects.map((subject) => {
                                    const firstClass = subject.classes[0];
                                    return (
                                        <button
                                            key={subject.subject_id}
                                            type="button"
                                            onClick={() => {
                                                if (firstClass) {
                                                    navigate(`/teacher/classes/${firstClass.class_id}/subjects/${subject.subject_id}`);
                                                }
                                            }}
                                            className="flex flex-col gap-1 rounded-lg border border-black bg-white px-4 py-3 text-left shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                                        >
                                            <p className="text-2xl font-bold text-gray-950">{subject.subject_name}</p>
                                            <p className="text-xs font-medium text-gray-700">
                                                Assigned to {subject.classes.length} section{subject.classes.length === 1 ? "" : "s"}
                                            </p>
                                        </button>
                                    );
                                })
                            )}

                            <button
                                type="button"
                                className="mt-1 flex items-center justify-between rounded-lg border border-gray-300 bg-white px-4 py-3 text-left font-semibold text-gray-700"
                            >
                                Archived Subjects
                                <ChevronRight size={18} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
};

export default Subject;