import { prisma } from "../prisma.js";

export const DEFAULT_PRACTICAL_FILES = [
  {
    filename: "index.html",
    content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My page</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main>
      <h1>Hello, Zaio</h1>
      <p>Edit HTML, CSS and JavaScript in the file explorer.</p>
      <button type="button" id="btn">Click me</button>
    </main>
    <script src="script.js"></script>
  </body>
</html>
`,
  },
  {
    filename: "styles.css",
    content: `body {
  font-family: system-ui, sans-serif;
  margin: 2rem;
  background: #f9fafc;
  color: #101116;
}

h1 {
  color: #2b2ecf;
}

button {
  background: #ffd400;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  cursor: pointer;
}
`,
  },
  {
    filename: "script.js",
    content: `document.getElementById("btn")?.addEventListener("click", () => {
  alert("Practical preview is working.");
});
`,
  },
] as const;

const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(html|css|js)$/;

export function isValidFilename(name: string): boolean {
  return FILENAME_RE.test(name) && !name.includes("..");
}

export async function getAssignmentForStudent(assignmentId: string, studentId: string) {
  return prisma.examAssignment.findFirst({
    where: { id: assignmentId, studentId },
    include: { exam: true, workspace: { include: { files: true } } },
  });
}

export async function ensurePracticalWorkspace(assignmentId: string, studentId: string) {
  const existing = await prisma.practicalWorkspace.findUnique({
    where: { assignmentId },
    include: { files: true },
  });
  if (existing) return existing;

  return prisma.practicalWorkspace.create({
    data: {
      assignmentId,
      studentId,
      files: {
        create: DEFAULT_PRACTICAL_FILES.map((f) => ({
          filename: f.filename,
          content: f.content,
        })),
      },
    },
    include: { files: true },
  });
}

export function filesToSnapshot(files: { filename: string; content: string }[]) {
  return JSON.stringify(
    files.map((f) => ({ filename: f.filename, content: f.content }))
  );
}
