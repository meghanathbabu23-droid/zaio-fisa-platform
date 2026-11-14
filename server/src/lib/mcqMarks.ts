export type MarksInput = { marks: number; sortOrder?: number };

/**
 * sum(question.marks) must equal exam.totalMarks for every MCQ exam. This
 * is the single source of truth for that invariant — called on exam
 * create/update AND on the isActive transition, both server- and
 * client-side, so there is exactly one place this rule can drift.
 */
export function validateMcqMarks(questions: MarksInput[], totalMarks: number): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(totalMarks) || totalMarks <= 0) {
    problems.push("totalMarks must be a positive integer");
    return problems;
  }
  if (questions.length === 0) {
    problems.push("At least one question is required to validate marks");
    return problems;
  }
  const sum = questions.reduce((s, q) => s + q.marks, 0);
  if (sum !== totalMarks) {
    problems.push(`Question marks sum to ${sum}, but totalMarks is ${totalMarks}`);
  }
  questions.forEach((q, i) => {
    if (!Number.isInteger(q.marks) || q.marks < 0) {
      problems.push(`Question at position ${q.sortOrder ?? i} has an invalid marks value: ${q.marks}`);
    }
  });
  return problems;
}

/**
 * base = floor(total/count), remainder distributed one-each to the first
 * `remainder` questions by sortOrder — e.g. 100 marks / 3 questions -> 34,
 * 33, 33. Returns marks in the same order as the input array.
 */
export function autoDistributeMarks(questionCount: number, totalMarks: number): number[] {
  if (questionCount <= 0) return [];
  const base = Math.floor(totalMarks / questionCount);
  const remainder = totalMarks % questionCount;
  return Array.from({ length: questionCount }, (_, i) => base + (i < remainder ? 1 : 0));
}
