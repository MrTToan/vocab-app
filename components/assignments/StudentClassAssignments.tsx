"use client";

import { useClassAssignments } from "@/lib/swr";
import type { StudentAssignment } from "@/lib/assignments/types";
import StudentAssignmentCard from "./StudentAssignmentCard";

/** The student's assignments for one class (shown on /classes/[id] student view). */
export default function StudentClassAssignments({ classId }: { classId: string }) {
  const { data, isLoading } = useClassAssignments(classId);
  const list: StudentAssignment[] = data && data.role === "student" ? data.assignments : [];
  if (isLoading || list.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold">Assignments</h2>
      <div className="grid gap-3">
        {list.map((a) => (
          <StudentAssignmentCard key={a.id} a={a} />
        ))}
      </div>
    </section>
  );
}
