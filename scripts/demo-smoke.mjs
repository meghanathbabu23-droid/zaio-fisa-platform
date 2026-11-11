/**
 * Smoke test for Nov 14 demo seed — requires API on localhost:3001
 * Does not mutate data beyond OTP token + optional MCQ answers if SUBMIT_DEMO=1
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load server/.env — this script is a separate process from the API server
// and doesn't otherwise inherit it.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(__dirname, "../server/.env"));
} catch {
  // Fall through — vars may already be set in the shell instead.
}

const BASE = process.env.API_BASE ?? "http://localhost:3001";
const DEMO_COHORT = "Nov 14 Demo — HTML Programmer Skills";
const PRIMARY_EMAIL = "amahle.dlamini@student.zaio.io";

// Individual admin login, not a shared key — set these to the credentials of
// an administrator account created with `npm run bootstrap-admin` (or any
// account subsequently created from the admin UI). Not read from
// server/.env on purpose: these are login credentials for one specific
// account, not app configuration to commit anywhere.
const ADMIN_EMAIL = process.env.DEMO_SMOKE_ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.DEMO_SMOKE_ADMIN_PASSWORD ?? "";

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error(
    "DEMO_SMOKE_ADMIN_EMAIL / DEMO_SMOKE_ADMIN_PASSWORD are not set.\n" +
      "Bootstrap (or reuse) an administrator account first, e.g.:\n" +
      '  cd server && npm run bootstrap-admin -- --email you@zaio.io --name "Your Name" --password "a-strong-password"\n' +
      "then re-run this script with:\n" +
      '  DEMO_SMOKE_ADMIN_EMAIL="you@zaio.io" DEMO_SMOKE_ADMIN_PASSWORD="a-strong-password" npm run smoke:demo'
  );
  process.exit(1);
}

const report = { passed: [], failed: [] };

function pass(step, detail = "") {
  report.passed.push({ step, detail });
}
function fail(step, detail = "") {
  report.failed.push({ step, detail });
}

let adminHeaders = null;

async function loginAdmin() {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Admin login failed (${res.status}): ${body.error ?? res.statusText}`);
  }
  const jar = new Map();
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    jar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
  const sessionToken = jar.get("fisa_admin_session");
  const csrfToken = jar.get("fisa_admin_csrf");
  if (!sessionToken || !csrfToken) {
    throw new Error("Admin login succeeded but session/CSRF cookies were missing from the response");
  }
  adminHeaders = {
    Cookie: `fisa_admin_session=${sessionToken}; fisa_admin_csrf=${csrfToken}`,
    "x-csrf-token": csrfToken,
  };
}

async function json(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error ?? res.statusText ?? `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function admin() {
  if (!adminHeaders) throw new Error("admin() called before loginAdmin() succeeded");
  return adminHeaders;
}

function bearer(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function main() {
  try {
    await loginAdmin();
    pass("Admin: login", ADMIN_EMAIL);

    const cohorts = await json("/api/cohorts", { headers: admin() });
    const cohort = cohorts.find((c) => c.name === DEMO_COHORT);
    if (!cohort) throw new Error(`Cohort not found: ${DEMO_COHORT}`);
    pass("Admin: list cohorts", cohort.id);

    const students = await json("/api/students", { headers: admin() });
    const demoStudents = students.filter((s) => s.cohortId === cohort.id);
    if (demoStudents.length < 5) throw new Error(`Expected 5 demo students, got ${demoStudents.length}`);
    pass("Admin: cohort students", String(demoStudents.length));

    const exams = await json("/api/exams", { headers: admin() });
    const demoExams = exams.filter((e) => e.cohortId === cohort.id);
    if (demoExams.length < 2) throw new Error(`Expected MCQ + practical exams, got ${demoExams.length}`);
    pass("Admin: demo exams", demoExams.map((e) => e.type).join(", "));

    const assignments = await json("/api/assignments", { headers: admin() });
    const demoAssignments = assignments.filter((a) =>
      demoExams.some((e) => e.id === a.examId)
    );
    if (demoAssignments.length < 10) throw new Error(`Expected 10 assignments, got ${demoAssignments.length}`);
    pass("Admin: assignments", String(demoAssignments.length));

    const evidence = await json(`/api/evidence?cohortId=${cohort.id}`, { headers: admin() });
    const demoEvidence = (evidence.rows ?? []).filter((e) =>
      demoAssignments.some((a) => a.id === e.assignmentId)
    );
    if (demoEvidence.length < 10) throw new Error(`Expected 10 evidence rows, got ${demoEvidence.length}`);
    pass("Admin: evidence rows", String(demoEvidence.length));

    await json("/api/auth/otp/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: PRIMARY_EMAIL }),
    });
    pass("Student: OTP request", "accepted (generic response — no code returned)");

    // Mock-delivery introspection endpoint — only exists when the server is
    // running with OTP_DELIVERY_MODE=mock. Reads back what the mock email
    // provider "sent" instead of reading a code from the request response,
    // which no longer contains one under any circumstances.
    const captured = await json(
      `/api/test/last-otp?channel=EMAIL&value=${encodeURIComponent(PRIMARY_EMAIL)}`
    ).catch((e) => {
      throw new Error(
        `Could not read mock OTP — is the server running with OTP_DELIVERY_MODE=mock? (${e.message})`
      );
    });
    pass("Student: OTP captured from mock provider", "ok");

    const session = await json("/api/auth/otp/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: PRIMARY_EMAIL, code: captured.code }),
    });
    pass("Student: OTP verify", session.student.email);

    const mine = await json("/api/student/assignments", { headers: bearer(session.token) });
    const demoMine = mine.filter((a) => demoExams.some((e) => e.id === a.examId));
    if (demoMine.length < 2) throw new Error(`Student expected 2 assignments, got ${demoMine.length}`);
    pass("Student: assignments", String(demoMine.length));
  } catch (e) {
    fail("Smoke", e.message);
  }

  console.log(JSON.stringify(report, null, 2));
  if (report.failed.length) process.exit(1);
}

main();
