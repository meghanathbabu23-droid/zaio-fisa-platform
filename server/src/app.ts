import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { AdminRole } from "@prisma/client";
import { prisma } from "./prisma.js";
import { assessorRouter } from "./routes/assessor.js";
import { assignmentsRouter } from "./routes/assignments.js";
import { authRouter } from "./routes/auth.js";
import { cohortsRouter } from "./routes/cohorts.js";
import { evidenceRouter } from "./routes/evidence.js";
import { examsRouter } from "./routes/exams.js";
import { examsGenerateRouter } from "./routes/examsGenerate.js";
import { practicalTestCasesRouter } from "./routes/practicalTestCases.js";
import { practicalQuestionsRouter } from "./routes/practicalQuestions.js";
import { practicalQuestionReferenceAssetsAdminRouter } from "./routes/practicalQuestionReferenceAssetsAdmin.js";
import { practicalAssessorRouter, practicalStudentRouter } from "./routes/practical.js";
import {
  proctoringAdminRouter,
  proctoringStudentRouter,
} from "./routes/proctoring.js";
import { studentPortalRouter } from "./routes/studentPortal.js";
import { moderationRouter } from "./routes/moderation.js";
import { resultsRouter } from "./routes/results.js";
import { studentsRouter } from "./routes/students.js";
import { testOtpRouter } from "./routes/testOtp.js";
import { openTestRegistrationRouter } from "./routes/openTestRegistration.js";
import { otpDeliveryFailuresRouter } from "./routes/otpDeliveryFailures.js";
import { adminAuthRouter } from "./routes/adminAuth.js";
import { adminUsersRouter } from "./routes/adminUsers.js";
import { adminStatusRouter } from "./routes/adminStatus.js";
import { otpConfig } from "./lib/otpConfig.js";
import { isOpenTestRegistrationActive } from "./lib/openTestRegistrationConfig.js";
import { corsConfig } from "./lib/corsConfig.js";
import { requireAdminAuth } from "./middleware/requireAdminAuth.js";
import { requireRole } from "./middleware/requireRole.js";
import { apiErrorHandler, forwardAsyncErrorsOnRouter } from "./middleware/forwardAsyncErrors.js";

const { SUPER_ADMIN, ADMIN, ASSESSOR, MODERATOR } = AdminRole;

export const app = express();
// Render puts exactly one reverse proxy (its own edge) in front of this
// process. `1` trusts that one hop's X-Forwarded-For entry for req.ip —
// `true` would trust the whole chain (spoofable), the default `false`
// ignores it entirely (every client collapses to one rate-limit bucket).
app.set("trust proxy", 1);

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header = not a browser cross-origin request (curl,
      // server-to-server, demo-smoke.mjs's Node fetch, same-origin page
      // loads). CORS is a browser-enforced concept; it doesn't apply to
      // these, so they're never blocked here regardless of this allow-list.
      if (!origin) {
        callback(null, true);
        return;
      }
      // Pass `false`, not an Error — an Error here propagates as an
      // unhandled 500 with a full stack trace in the response body
      // (confirmed in an earlier pass), reachable by anyone who sets any
      // Origin header. `false` just omits the CORS headers; the request
      // still reaches the route, which still enforces real auth normally.
      callback(null, corsConfig.allowedOrigins.includes(origin));
    },
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    credentials: true, // cookies now carry the admin session
  })
);

app.use(cookieParser());

// Proctoring recording uploads must parse before the default 1mb JSON limit.
const proctoringStudentMount = express.Router();
proctoringStudentMount.use(express.json({ limit: "25mb" }));
forwardAsyncErrorsOnRouter(proctoringStudentRouter);
proctoringStudentMount.use(proctoringStudentRouter);
app.use("/api/student/proctoring", proctoringStudentMount); // exempt: requireStudent-protected

// Question reference-asset uploads (base64 image/PDF, up to 20MB raw, ~27MB
// base64-inflated) must also parse before the default 1mb JSON limit —
// same reasoning as proctoringStudentMount above.
const practicalQuestionAssetsMount = express.Router({ mergeParams: true });
practicalQuestionAssetsMount.use(express.json({ limit: "30mb" }));
practicalQuestionAssetsMount.use(
  requireAdminAuth,
  requireRole(SUPER_ADMIN, ADMIN),
  practicalQuestionReferenceAssetsAdminRouter
);
app.use("/api/exams/:examId/practical-questions/:questionId/assets", practicalQuestionAssetsMount);

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
}); // exempt: public by design

/**
 * Readiness check, distinct from /api/health above: that one never touches
 * the database, so it can't tell you whether the live DB connection
 * actually works. This runs a trivial read via the ordinary Prisma query
 * API (not $runCommandRaw) so the exact same code works against both the
 * MongoDB-generated client (production) and the SQLite-generated client
 * (local dev/tests) — no DB_PROVIDER branch needed. Never throws past this
 * handler and never includes the caught error (which could carry
 * connection-string/host detail) in the response or a log line.
 */
app.get("/api/health/ready", async (_req, res) => {
  try {
    await prisma.administrator.count();
    res.json({ ok: true, database: "connected" });
  } catch {
    // eslint-disable-next-line no-console
    console.error("[health] database readiness check failed");
    res.status(503).json({ ok: false, database: "unavailable" });
  }
}); // exempt: public by design — read-only connectivity probe, returns no data

// ——— Exempt: public student-facing auth/portal routes ———
app.use("/api/auth", authRouter); // exempt: OTP request/verify/logout must stay public
// Temporary, heavily-gated internal-tester self-registration — structurally
// absent unless NODE_ENV!=="production" AND OTP_DELIVERY_MODE=mock AND
// ENABLE_OPEN_TEST_REGISTRATION=true, all three, re-checked inside the
// handler too. See docs/OPEN-TEST-REGISTRATION.md.
if (isOpenTestRegistrationActive()) {
  app.use("/api/auth", openTestRegistrationRouter);
}
app.use("/api/student", studentPortalRouter); // exempt: requireStudent-protected
app.use(
  "/api/student/assignments/:assignmentId/practical",
  practicalStudentRouter
); // exempt: requireStudent-protected

// ——— Admin auth itself: login/password-reset are public by necessity;
// logout/me/change-password require a session (enforced inside the router) ———
app.use("/api/admin", adminAuthRouter);

// ——— RBAC-protected administrative routers ———
// Method-level splits (e.g. exams: ADMIN can read, only SUPER_ADMIN can
// write) are applied as an EXTRA requireRole layered inline on the specific
// mutating routes inside those route files, on top of the broader
// router-level check here.
app.use("/api/cohorts", requireAdminAuth, requireRole(SUPER_ADMIN, ADMIN), cohortsRouter);
app.use("/api/students", requireAdminAuth, requireRole(SUPER_ADMIN, ADMIN), studentsRouter);
// Mounted before the more general /api/exams router below so its routes
// (e.g. GET /api/exams/:id) never shadow this more specific path.
app.use("/api/exams/generate", requireAdminAuth, requireRole(SUPER_ADMIN, ADMIN), examsGenerateRouter);
app.use("/api/exams", requireAdminAuth, requireRole(SUPER_ADMIN, ADMIN), examsRouter);
app.use(
  "/api/exams/:examId/practical-tests",
  requireAdminAuth,
  requireRole(SUPER_ADMIN, ADMIN),
  practicalTestCasesRouter
);
app.use(
  "/api/exams/:examId/practical-questions",
  requireAdminAuth,
  requireRole(SUPER_ADMIN, ADMIN),
  practicalQuestionsRouter
);
app.use("/api/assessor", requireAdminAuth, requireRole(SUPER_ADMIN, ASSESSOR), assessorRouter);
app.use("/api/results", requireAdminAuth, requireRole(SUPER_ADMIN, ADMIN), resultsRouter);
app.use("/api/moderation", requireAdminAuth, requireRole(SUPER_ADMIN, MODERATOR), moderationRouter);
app.use("/api/evidence", requireAdminAuth, requireRole(SUPER_ADMIN, ADMIN), evidenceRouter);
app.use("/api/assignments", requireAdminAuth, requireRole(SUPER_ADMIN, ADMIN), assignmentsRouter);
app.use("/api/proctoring", requireAdminAuth, requireRole(SUPER_ADMIN, ADMIN), proctoringAdminRouter);
app.use(
  "/api/assignments/:assignmentId/practical",
  requireAdminAuth,
  requireRole(SUPER_ADMIN, ADMIN, ASSESSOR),
  practicalAssessorRouter
);
app.use("/api/otp-delivery-failures", requireAdminAuth, requireRole(SUPER_ADMIN), otpDeliveryFailuresRouter);
app.use("/api/admin/users", requireAdminAuth, requireRole(SUPER_ADMIN), adminUsersRouter);
app.use("/api/admin/status", requireAdminAuth, requireRole(SUPER_ADMIN), adminStatusRouter);

// Exempt: test-only mock-delivery introspection fixture, not an admin route —
// structurally absent in production (only mounted when OTP_DELIVERY_MODE is
// itself "mock", which the boot check in otpConfig.ts never permits in
// production). Used by demo-smoke.mjs and automated tests, not by admins.
if (otpConfig.deliveryMode === "mock") {
  app.use("/api/test", testOtpRouter);
}

app.use(
  (
    err: { type?: string; status?: number; message?: string },
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (err.type === "entity.too.large") {
      res.status(413).json({ error: "Request entity too large" });
      return;
    }
    next(err);
  }
);

app.use(apiErrorHandler);
