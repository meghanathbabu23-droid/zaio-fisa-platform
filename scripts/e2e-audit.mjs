/**
 * Demo E2E audit — run with API on localhost:3001
 */
const BASE = process.env.API_BASE ?? "http://localhost:3001";

const report = { passed: [], failed: [], notes: [] };

function pass(step, detail = "") {
  report.passed.push({ step, detail });
}
function fail(step, detail = "") {
  report.failed.push({ step, detail });
}

async function json(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((body.error ?? res.statusText) || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function main() {
  const tag = `audit-${Date.now()}`;
  let mcqAssignmentId;
  let practicalAssignmentId;
  let studentToken;
  let studentId;
  let evidenceCountBefore;

  // —— 1 Admin ——
  try {
    const cohort = await json("/api/cohorts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Cohort ${tag}`,
        programme: "FISA Demo",
        startDate: new Date().toISOString(),
        examDate: new Date(Date.now() + 86400000).toISOString(),
        zoomLink: "https://zoom.example/demo",
      }),
    });
    const student = await json("/api/students", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Audit",
        lastName: "Student",
        email: `audit.${tag}@example.com`,
        phone: `+2700${String(Date.now()).slice(-7)}`,
        cohortId: cohort.id,
      }),
    });
    studentId = student.id;

    const mcqExam = await json("/api/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `MCQ ${tag}`,
        type: "MCQ",
        durationMinutes: 30,
        instructions: "Audit MCQ",
        cohortId: cohort.id,
        questions: [
          { prompt: "2+2?", options: ["3", "4"], correctIndex: 1 },
          { prompt: "Sky color?", options: ["Green", "Blue"], correctIndex: 1 },
        ],
      }),
    });

    const practicalExam = await json("/api/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `Practical ${tag}`,
        type: "PRACTICAL",
        durationMinutes: 60,
        instructions: "Build page",
        cohortId: cohort.id,
      }),
    });

    await json(`/api/exams/${practicalExam.id}/practical-tests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "Has title",
        kind: "HTML_CONTAINS",
        targetFile: "index.html",
        expression: "<h1>",
        points: 1,
      }),
    });

    const mcqAsn = await json("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ examId: mcqExam.id, studentId: student.id }),
    });
    mcqAssignmentId = mcqAsn.id;

    const prAsn = await json("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ examId: practicalExam.id, studentId: student.id }),
    });
    practicalAssignmentId = prAsn.id;

    const ev = await json(`/api/evidence?studentId=${student.id}`);
    if (ev.rows.length < 2) throw new Error("Expected 2 evidence rows for new assignments");
    pass("1", `Cohort, student, exams, assignments; evidence rows=${ev.rows.length}`);
  } catch (e) {
    fail("1", e.message);
    throw e;
  }

  // —— 2 OTP ——
  try {
    const otpReq = await json("/api/auth/otp/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `audit.${tag}@example.com` }),
    });
  const otpVerify = await json("/api/auth/otp/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `audit.${tag}@example.com`,
        code: otpReq.demoOtp,
      }),
    });
    studentToken = otpVerify.token;
    pass("2", "OTP request/verify");
  } catch (e) {
    fail("2", e.message);
  }

  const H = authHeaders(studentToken);

  // —— 3 MCQ + proctoring (4–5) ——
  try {
    const sess = await json("/api/student/proctoring/sessions", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ assignmentId: mcqAssignmentId }),
    });
    await json(`/api/student/proctoring/sessions/${sess.sessionId}/events`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ type: "AUDIT_TEST", message: "E2E audit event" }),
    });
    await json(`/api/student/proctoring/sessions/${sess.sessionId}/activate`, {
      method: "POST",
      headers: H,
    });
    const padded = Buffer.alloc(1024, 0);
    padded.writeUInt32BE(0x1a45dfa3, 0);
    padded.write("demo-audit-webm-pad", 4);
    const tinyWebm = padded.toString("base64");
    await json(`/api/student/proctoring/sessions/${sess.sessionId}/recordings`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        kind: "WEBCAM_MIC",
        mimeType: "video/webm",
        dataBase64: tinyWebm,
      }),
    });
    await json(`/api/student/assignments/${mcqAssignmentId}/start`, {
      method: "POST",
      headers: H,
    });
    const examView = await json(`/api/student/assignments/${mcqAssignmentId}/exam`, {
      headers: H,
    });
    const submit = await json(`/api/student/assignments/${mcqAssignmentId}/submit`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ answers: [1, 1] }),
    });
    if (submit.scorePercent !== 100) throw new Error(`MCQ score ${submit.scorePercent}`);
    await json(`/api/student/proctoring/sessions/${sess.sessionId}/end`, {
      method: "POST",
      headers: H,
    });
    pass("3", `MCQ submitted score=${submit.scorePercent}%`);
    pass("4-5", `Proctoring session ${sess.sessionId}; recording uploaded`);
  } catch (e) {
    fail("3", e.message);
    fail("4-5", e.message);
  }

  // —— Practical ——
  try {
    const psess = await json("/api/student/proctoring/sessions", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ assignmentId: practicalAssignmentId }),
    });
    await json(`/api/student/proctoring/sessions/${psess.sessionId}/activate`, {
      method: "POST",
      headers: H,
    });
    await json(`/api/student/assignments/${practicalAssignmentId}/practical/autosave`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({
        activeFile: "index.html",
        files: [
          {
            filename: "index.html",
            content: "<!DOCTYPE html><html><body><h1>Audit</h1></body></html>",
          },
        ],
      }),
    });
    const prSubmit = await json(`/api/student/assignments/${practicalAssignmentId}/practical/submit`, {
      method: "POST",
      headers: H,
    });
    if (!prSubmit.locked) throw new Error("Practical not locked");
    pass("3-practical", `Submitted automated=${JSON.stringify(prSubmit.automated)}`);
  } catch (e) {
    fail("3-practical", e.message);
  }

  // —— 6 Assessor ——
  try {
    await json(`/api/assessor/assignments/${practicalAssignmentId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ finalScorePercent: 88, feedback: "E2E audit review" }),
    });
    pass("6", "Assessor review saved");
  } catch (e) {
    fail("6", e.message);
  }

  // —— 7 Moderation ——
  try {
    await json(`/api/moderation/${practicalAssignmentId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        moderatorName: "Audit Mod",
        decision: "No action required (demo)",
        comments: "Advisory flags reviewed",
        status: "COMPLETED",
      }),
    });
    pass("7", "Moderation decision recorded");
  } catch (e) {
    fail("7", e.message);
  }

  // —— 8 Results ——
  try {
    const results = await json(`/api/results?studentId=${studentId}`);
    const mcqRow = results.rows.find((r) => r.assignmentId === mcqAssignmentId);
    const prRow = results.rows.find((r) => r.assignmentId === practicalAssignmentId);
    if (!mcqRow || mcqRow.status !== "SUBMITTED" || mcqRow.mcqScorePercent !== 100) {
      throw new Error("MCQ results row mismatch");
    }
    if (!prRow || prRow.status !== "SUBMITTED" || prRow.assessorApprovedPercent !== 88) {
      throw new Error("Practical results row mismatch");
    }
    pass("8", "Results marks and statuses OK");
  } catch (e) {
    fail("8", e.message);
  }

  // —— 9–10 Evidence ——
  try {
    const sync1 = await json("/api/evidence/sync", { method: "POST" });
    const list = await json(`/api/evidence?studentId=${studentId}`);
    const mcqEv = list.rows.find((r) => r.assignmentId === mcqAssignmentId);
    const prEv = list.rows.find((r) => r.assignmentId === practicalAssignmentId);
    if (!mcqEv?.artifacts.some((a) => a.kind === "MCQ_ATTEMPT" && a.status === "PRESENT")) {
      throw new Error("MCQ artifact missing");
    }
    if (!prEv?.artifacts.some((a) => a.kind === "PRACTICAL_SUBMISSION")) {
      throw new Error("Practical artifact missing");
    }
    if (!prEv?.artifacts.some((a) => a.kind === "MODERATION" && a.status === "PRESENT")) {
      throw new Error("Moderation artifact missing");
    }
    const simulated = list.rows.flatMap((r) => r.artifacts).filter((a) => a.status === "SIMULATED");
    if (simulated.length === 0) report.notes.push("No SIMULATED artifacts (proctoring may be absent on practical)");
    pass("9", `Artifacts present; simulated count=${simulated.length}`);

    const detail1 = await json(`/api/evidence/${practicalAssignmentId}`, {
      headers: { "X-Evidence-Actor": "e2e-auditor" },
    });
    const artifactMcq = detail1.evidence.artifacts.find((a) => a.kind === "MCQ_ATTEMPT") 
      ?? (await json(`/api/evidence/${mcqAssignmentId}`)).evidence.artifacts.find((a) => a.kind === "MCQ_ATTEMPT");
    const mcqArtId = (await json(`/api/evidence/${mcqAssignmentId}`)).evidence.artifacts.find(
      (a) => a.kind === "MCQ_ATTEMPT"
    )?.id;
    if (!mcqArtId) throw new Error("No MCQ artifact id");

    const dl = await fetch(
      `${BASE}/api/evidence/${mcqAssignmentId}/artifacts/${mcqArtId}/download`,
      { headers: { "X-Evidence-Actor": "e2e-auditor" } }
    );
    if (!dl.ok) throw new Error(`MCQ download HTTP ${dl.status}`);
    const dlBody = await dl.text();
    if (!dlBody.includes("scorePercent")) throw new Error("MCQ download invalid JSON");

    const rep = await fetch(`${BASE}/api/evidence/${practicalAssignmentId}/summary-report`, {
      headers: { "X-Evidence-Actor": "e2e-auditor" },
    });
    if (!rep.ok) throw new Error(`Summary report HTTP ${rep.status}`);

    const detailMcq = await json(`/api/evidence/${mcqAssignmentId}`, {
      headers: { "X-Evidence-Actor": "e2e-auditor" },
    });
    const actionsMcq = new Set(detailMcq.auditTrail.map((a) => a.action));
    const detailPr = await json(`/api/evidence/${practicalAssignmentId}`, {
      headers: { "X-Evidence-Actor": "e2e-auditor" },
    });
    const actionsPr = new Set(detailPr.auditTrail.map((a) => a.action));
    if (!actionsMcq.has("VIEW") || !actionsMcq.has("DOWNLOAD")) {
      throw new Error(`MCQ audit incomplete: ${[...actionsMcq].join(",")}`);
    }
    if (!actionsPr.has("VIEW") || !actionsPr.has("EXPORT_SUMMARY")) {
      throw new Error(`Practical audit incomplete: ${[...actionsPr].join(",")}`);
    }
    pass("10", "Downloads, JSON summary, audit trail OK");

    // Idempotency: double sync, single evidence record per assignment
    await json("/api/evidence/sync", { method: "POST" });
    const detail3 = await json(`/api/evidence/${mcqAssignmentId}`);
    const artCountA = detail3.evidence.artifacts.length;
    await json(`/api/evidence/${mcqAssignmentId}/sync`, { method: "POST" });
    const detail4 = await json(`/api/evidence/${mcqAssignmentId}`);
    if (detail4.evidence.id !== detail3.evidence.id) throw new Error("Evidence record duplicated");
    if (detail4.evidence.artifacts.length !== artCountA) {
      report.notes.push("Artifact count changed on re-sync (expected if data changed)");
    }
    pass("9-idempotent", `Same evidence id ${detail4.evidence.id}`);
  } catch (e) {
    fail("9-10", e.message);
  }

  // Recording file on disk + download
  try {
    const mon = await json("/api/proctoring/sessions?active=false");
    const sess = mon.sessions?.find((s) => s.assignmentId === mcqAssignmentId);
    const rec = sess?.recordings?.[0];
    if (!rec) throw new Error("No recording in monitor API");
    const detail = await json(`/api/evidence/${mcqAssignmentId}`);
    const recArt = detail.evidence.artifacts.find(
      (a) => a.kind === "PROCTORING_RECORDING" && a.filePath
    );
    if (!recArt) throw new Error("Recording artifact without path");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.join(import.meta.dirname, "..", "server");
    const full = path.join(root, recArt.filePath);
    await fs.access(full);
    const recDl = await fetch(
      `${BASE}/api/evidence/${mcqAssignmentId}/artifacts/${recArt.id}/download`
    );
    if (!recDl.ok) throw new Error(`Recording download ${recDl.status}`);
    pass("5-disk", `Recording exists at ${recArt.filePath}`);
  } catch (e) {
    fail("5-disk", e.message);
  }

  // Path traversal guard (unit-style via API would need tainted DB — test resolver in-process)
  try {
    const path = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const { spawnSync } = await import("node:child_process");
    const serverDir = path.join(import.meta.dirname, "..", "server");
    const dist = path.join(serverDir, "dist", "lib", "evidenceSync.js");
    const check = spawnSync(
      process.execPath,
      [
        "-e",
        `import { resolveSafeRecordingPath } from ${JSON.stringify(pathToFileURL(dist).href)};
const bad = resolveSafeRecordingPath("../../etc/passwd");
const good = resolveSafeRecordingPath("data/recordings/x/y.webm");
if (bad !== null) process.exit(2);
if (good === null) process.exit(3);
process.exit(0);`,
      ],
      { cwd: serverDir, stdio: "pipe" }
    );
    if (check.status === 0) pass("security-path", "resolveSafeRecordingPath blocks escape");
    else fail("security-path", `check exit ${check.status} ${check.stderr?.toString()}`);
  } catch (e) {
    fail("security-path", e.message);
  }

  // Failed upload
  try {
    const otpReq = await json("/api/auth/otp/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `audit.${tag}@example.com` }),
    });
    const tok = (
      await json("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: `audit.${tag}@example.com`, code: otpReq.demoOtp }),
      })
    ).token;
    const sess = await json("/api/student/proctoring/sessions", {
      method: "POST",
      headers: authHeaders(tok),
      body: JSON.stringify({ assignmentId: mcqAssignmentId }),
    });
    const big = Buffer.alloc(21 * 1024 * 1024).toString("base64");
    const res = await fetch(`${BASE}/api/student/proctoring/sessions/${sess.sessionId}/recordings`, {
      method: "POST",
      headers: authHeaders(tok),
      body: JSON.stringify({ kind: "WEBCAM_MIC", mimeType: "video/webm", dataBase64: big }),
    });
    if (res.status !== 413) throw new Error(`Expected 413 got ${res.status}`);
    pass("upload-limit", "Oversize recording rejected with 413");
  } catch (e) {
    fail("upload-limit", e.message);
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
