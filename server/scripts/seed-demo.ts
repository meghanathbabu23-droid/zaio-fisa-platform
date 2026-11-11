/**
 * Nov 14 demo seed — idempotent; does not delete existing rows or create recordings.
 * Run: npm run seed:demo (from repo root) or npm run seed:demo --prefix server
 */
import { ExamType } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { ensureEvidenceRecord, syncEvidenceForAssignment } from "../src/lib/evidenceSync.js";

const DEMO_COHORT_NAME = "Nov 14 Demo — HTML Programmer Skills";
const DEMO_PROGRAMME = "HTML Programmer Skills Programme (SP-230372)";
const DEMO_ZOOM = "https://zoom.us/j/00000000000";

const MCQ_TITLE = "FISA Knowledge — HTML, CSS & JavaScript (Nov 14 Demo)";
const PRACTICAL_TITLE = "FISA Practical — HTML, CSS & JavaScript (Nov 14 Demo)";

const DEMO_STUDENTS = [
  { firstName: "Amahle", lastName: "Dlamini", email: "amahle.dlamini@student.zaio.io", phone: "+27821110001" },
  { firstName: "Jordan", lastName: "Nkosi", email: "jordan.nkosi@student.zaio.io", phone: "+27821110002" },
  { firstName: "Priya", lastName: "Pillay", email: "priya.pillay@student.zaio.io", phone: "+27821110003" },
  { firstName: "Sipho", lastName: "Molefe", email: "sipho.molefe@student.zaio.io", phone: "+27821110004" },
  { firstName: "Zoe", lastName: "van der Merwe", email: "zoe.vandermerwe@student.zaio.io", phone: "+27821110005" },
] as const;

const MCQ_QUESTIONS = [
  {
    prompt: "Which HTML element is most appropriate for the main page heading?",
    options: ["<p>", "<h1>", "<header>", "<title>"],
    correctIndex: 1,
  },
  {
    prompt: "What does CSS stand for in web development?",
    options: [
      "Computer Style Sheets",
      "Cascading Style Sheets",
      "Creative Style System",
      "Component Style Syntax",
    ],
    correctIndex: 1,
  },
  {
    prompt: "Which attribute makes an input field mandatory in HTML5?",
    options: ["mandatory", "validate", "required", "checked"],
    correctIndex: 2,
  },
  {
    prompt: "In CSS, which property controls the space between the border and the content?",
    options: ["margin", "padding", "gap", "spacing"],
    correctIndex: 1,
  },
  {
    prompt: "Which JavaScript keyword declares a block-scoped variable?",
    options: ["var", "let", "function", "static"],
    correctIndex: 1,
  },
  {
    prompt: "What is the correct way to select an element with id=\"menu\" in CSS?",
    options: [".menu", "#menu", "menu", "*menu"],
    correctIndex: 1,
  },
  {
    prompt: "Which HTML tag is used to embed a JavaScript file?",
    options: ["<javascript>", "<js>", "<script>", "<code>"],
    correctIndex: 2,
  },
  {
    prompt: "In the box model, which part is outside the border?",
    options: ["Padding", "Content", "Margin", "Outline"],
    correctIndex: 2,
  },
];

async function findOrCreateCohort() {
  const start = new Date("2026-11-01T08:00:00.000Z");
  const examDate = new Date("2026-11-14T09:00:00.000Z");
  const existing = await prisma.cohort.findFirst({ where: { name: DEMO_COHORT_NAME } });
  if (existing) {
    return prisma.cohort.update({
      where: { id: existing.id },
      data: {
        programme: DEMO_PROGRAMME,
        startDate: start,
        examDate,
        zoomLink: DEMO_ZOOM,
      },
    });
  }

  return prisma.cohort.create({
    data: {
      name: DEMO_COHORT_NAME,
      programme: DEMO_PROGRAMME,
      startDate: start,
      examDate,
      zoomLink: DEMO_ZOOM,
    },
  });
}

async function upsertDemoStudents(cohortId: string) {
  const ids: string[] = [];
  for (const s of DEMO_STUDENTS) {
    const row = await prisma.student.upsert({
      where: { email: s.email },
      create: {
        firstName: s.firstName,
        lastName: s.lastName,
        email: s.email,
        phone: s.phone,
        cohortId,
      },
      update: {
        firstName: s.firstName,
        lastName: s.lastName,
        cohortId,
        phone: s.phone,
      },
    });
    ids.push(row.id);
  }
  return ids;
}

async function findOrCreateMcqExam(cohortId: string) {
  let exam = await prisma.exam.findFirst({
    where: { title: MCQ_TITLE, cohortId },
    include: { questions: true },
  });
  if (!exam) {
    exam = await prisma.exam.create({
      data: {
        title: MCQ_TITLE,
        type: ExamType.MCQ,
        durationMinutes: 45,
        instructions:
          "Answer all knowledge questions. This section is auto-marked. Allow 45 minutes.",
        cohortId,
        questions: {
          create: MCQ_QUESTIONS.map((q, i) => ({
            prompt: q.prompt,
            options: JSON.stringify(q.options),
            correctIndex: q.correctIndex,
            sortOrder: i,
          })),
        },
      },
      include: { questions: true },
    });
  } else if (exam.questions.length === 0) {
    await prisma.mcqQuestion.createMany({
      data: MCQ_QUESTIONS.map((q, i) => ({
        examId: exam!.id,
        prompt: q.prompt,
        options: JSON.stringify(q.options),
        correctIndex: q.correctIndex,
        sortOrder: i,
      })),
    });
    exam = await prisma.exam.findUniqueOrThrow({
      where: { id: exam.id },
      include: { questions: true },
    });
  }
  return exam;
}

async function findOrCreatePracticalExam(cohortId: string) {
  let exam = await prisma.exam.findFirst({
    where: { title: PRACTICAL_TITLE, cohortId },
    include: { practicalTests: true },
  });
  if (!exam) {
    exam = await prisma.exam.create({
      data: {
        title: PRACTICAL_TITLE,
        type: ExamType.PRACTICAL,
        durationMinutes: 120,
        instructions:
          "Build a single-page site with index.html, styles.css and script.js. " +
          "Include a visible <h1>, a CSS rule for body, and a console.log in script.js. " +
          "Submit when finished.",
        cohortId,
      },
      include: { practicalTests: true },
    });
  }

  if (exam.practicalTests.length === 0) {
    const tests = [
      {
        label: "index.html contains h1",
        kind: "HTML_CONTAINS" as const,
        targetFile: "index.html",
        expression: "<h1",
        points: 1,
        sortOrder: 0,
      },
      {
        label: "styles.css includes body rule",
        kind: "CSS_CONTAINS" as const,
        targetFile: "styles.css",
        expression: "body",
        points: 1,
        sortOrder: 1,
      },
      {
        label: "script.js logs to console",
        kind: "JS_CONTAINS" as const,
        targetFile: "script.js",
        expression: "console.log",
        points: 1,
        sortOrder: 2,
      },
    ];
    await prisma.practicalTestCase.createMany({
      data: tests.map((t) => ({ examId: exam!.id, ...t })),
    });
    exam = await prisma.exam.findUniqueOrThrow({
      where: { id: exam.id },
      include: { practicalTests: true },
    });
  }
  return exam;
}

async function ensureAssignments(examId: string, studentIds: string[]) {
  let created = 0;
  for (const studentId of studentIds) {
    const row = await prisma.examAssignment.upsert({
      where: { examId_studentId: { examId, studentId } },
      create: { examId, studentId },
      update: {},
    });
    await ensureEvidenceRecord(row.id);
    await syncEvidenceForAssignment(row.id);
    created += 1;
  }
  return created;
}

async function main() {
  const cohort = await findOrCreateCohort();
  const studentIds = await upsertDemoStudents(cohort.id);
  const mcqExam = await findOrCreateMcqExam(cohort.id);
  const practicalExam = await findOrCreatePracticalExam(cohort.id);
  const mcqAssignments = await ensureAssignments(mcqExam.id, studentIds);
  const practicalAssignments = await ensureAssignments(practicalExam.id, studentIds);

  const summary = {
    cohort: { id: cohort.id, name: cohort.name, programme: cohort.programme },
    students: DEMO_STUDENTS.map((s) => s.email),
    exams: [
      { id: mcqExam.id, title: mcqExam.title, type: "MCQ", questions: MCQ_QUESTIONS.length },
      {
        id: practicalExam.id,
        title: practicalExam.title,
        type: "PRACTICAL",
        testCases: practicalExam.practicalTests?.length ?? 3,
      },
    ],
    assignmentsPerExam: mcqAssignments,
    studentLogin: "Use any demo student email at /student/login (simulated OTP)",
    primaryDemoStudent: DEMO_STUDENTS[0].email,
    note: "Re-running this script upserts the same cohort/students/exams; it does not create recordings or submit exams.",
  };

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
