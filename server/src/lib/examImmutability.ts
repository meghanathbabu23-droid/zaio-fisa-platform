import { prisma } from "../prisma.js";

/**
 * Once a single student has been assigned an exam, every student who was,
 * is, or will be assigned it must see the exact same questions/test cases
 * and the exact same marks/duration — otherwise different students are
 * effectively sitting different exams, and historical scores (computed
 * against whatever totalMarks/durationMinutes existed at the time) silently
 * stop matching the exam's current configuration.
 *
 * This is the single source of truth for that invariant, used by exams.ts
 * (edit/delete) and practicalTestCases.ts (create/edit/delete test cases).
 */
export async function examHasAnyAssignment(examId: string): Promise<boolean> {
  const count = await prisma.examAssignment.count({ where: { examId } });
  return count > 0;
}
