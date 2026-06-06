import type { AvailableStudent } from "@/types/adminClasses";

export default function StudentTransfer({ title, students, action, onAction }: {
  title: string;
  students: AvailableStudent[];
  action: string;
  onAction: (student: AvailableStudent) => void;
}) {
  return (
    <div className="grid gap-2 rounded-md border border-black p-3">
      <h3 className="font-bold">{title}</h3>
      {(["Male", "Female"] as const).map((gender) => (
        <div key={gender} className="grid gap-1">
          <p className="text-xs font-bold">{gender}</p>
          {students.filter((student) => student.gender === gender).map((student) => (
            <button key={student.id} className="flex items-center justify-between rounded border border-black bg-[#fffdf5] px-2 py-1 text-left text-xs" onClick={() => onAction(student)}>
              <span>{student.name}<span className="block text-[10px]">LRN {student.lrn}</span></span>
              <span>{action}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
