"use client";

import { useMyAssignments } from "@/lib/swr";
import StudentAssignmentCard from "./StudentAssignmentCard";

/**
 * The "Assigned to you" roll-up on the /classes hub — every open assignment across
 * the classes the caller is a student in. Hidden when there are none, so a teacher
 * with no assignments sees nothing extra.
 */
export default function AssignedToYou() {
  const { data, isLoading } = useMyAssignments();
  const list = data?.assignments ?? [];
  if (isLoading || list.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold">Assigned to you</h2>
      <div className="grid gap-3">
        {list.map((a) => (
          <StudentAssignmentCard key={a.id} a={a} showClass />
        ))}
      </div>
    </section>
  );
}
