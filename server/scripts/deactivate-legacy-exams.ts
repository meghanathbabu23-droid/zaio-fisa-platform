/**
 * One-time (but safe to re-run) cleanup: marks every exam that is NOT one
 * of the two canonical FISA assessments, and NOT one of the Nov 14 demo
 * cohort's two exams, as isActive=false — so they no longer appear in the
 * exam-assignment picker, without deleting a single row. Existing
 * assignments, submissions, results, and evidence tied to a deactivated
 * exam are completely unaffected; students who already have one of these
 * exams assigned keep full access to it exactly as before.
 *
 * Usage: npx tsx scripts/deactivate-legacy-exams.ts [--dry-run]
 */
import { prisma } from "../src/prisma.js";
import { FISA_MCQ_TITLE, FISA_PRACTICAL_TITLE } from "./seed-fisa-assessment.js";

const NOV_14_MARKER = "(Nov 14 Demo)";

export async function planDeactivation() {
  const exams = await prisma.exam.findMany({
    select: { id: true, title: true, type: true, isActive: true },
  });
  const toDeactivate = exams.filter(
    (e) => e.title !== FISA_MCQ_TITLE && e.title !== FISA_PRACTICAL_TITLE && !e.title.includes(NOV_14_MARKER)
  );
  const toKeepActive = exams.filter((e) => !toDeactivate.some((d) => d.id === e.id));
  return { toDeactivate, toKeepActive };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const { toDeactivate, toKeepActive } = await planDeactivation();

  console.log(`Keeping active (${toKeepActive.length}):`);
  for (const e of toKeepActive) console.log(`  - [${e.type}] ${e.title}`);

  console.log(`\n${dryRun ? "Would deactivate" : "Deactivating"} (${toDeactivate.length}):`);
  for (const e of toDeactivate) console.log(`  - [${e.type}] ${e.title} (currently isActive=${e.isActive})`);

  if (dryRun) {
    console.log("\n--dry-run: no changes made.");
    return;
  }

  const result = await prisma.exam.updateMany({
    where: { id: { in: toDeactivate.map((e) => e.id) } },
    data: { isActive: false },
  });
  console.log(`\nDeactivated ${result.count} exam(s). No rows were deleted.`);
}

if (process.argv[1]?.endsWith("deactivate-legacy-exams.ts")) {
  main()
    .catch((err) => {
      console.error("Failed:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
