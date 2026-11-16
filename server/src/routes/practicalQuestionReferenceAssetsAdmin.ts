import { AdminRole } from "@prisma/client";
import { type Request, Router } from "express";
import { prisma } from "../prisma.js";
import { requireRole } from "../middleware/requireRole.js";
import type { AuthedAdminRequest } from "../middleware/requireAdminAuth.js";
import { recordAuditLog } from "../lib/auditLog.js";
import {
  deletePracticalQuestionReferenceAsset,
  uploadPracticalQuestionReferenceAsset,
} from "../lib/practicalQuestionReferenceAssets.js";
import { getExamAssetStorageProvider } from "../lib/storage/examAssetStorage.js";

export const practicalQuestionReferenceAssetsAdminRouter = Router({ mergeParams: true });
const writeOnly = requireRole(AdminRole.SUPER_ADMIN);

/** Reference material isn't graded content — deliberately NOT gated by
 * examHasAnyAssignment, matching the established behavior of exam-level and
 * test-case-level reference-document routes elsewhere in this codebase. */
async function requireQuestion(examId: string, questionId: string) {
  return prisma.practicalQuestion.findFirst({ where: { id: questionId, examId } });
}

practicalQuestionReferenceAssetsAdminRouter.get(
  "/",
  async (req: Request<{ examId: string; questionId: string }>, res) => {
    const question = await requireQuestion(req.params.examId, req.params.questionId);
    if (!question) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    const assets = await prisma.practicalQuestionReferenceAsset.findMany({
      where: { questionId: question.id },
      orderBy: { createdAt: "asc" },
    });
    res.json(assets.map((a) => ({ filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes })));
  }
);

practicalQuestionReferenceAssetsAdminRouter.get(
  "/:filename",
  async (req: Request<{ examId: string; questionId: string; filename: string }>, res) => {
    const question = await requireQuestion(req.params.examId, req.params.questionId);
    if (!question) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    const asset = await prisma.practicalQuestionReferenceAsset.findUnique({
      where: { questionId_filename: { questionId: question.id, filename: req.params.filename } },
    });
    if (!asset) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }
    const provider = getExamAssetStorageProvider();
    if (!(await provider.exists(asset.storageKey))) {
      res.status(404).json({ error: "File not found in storage" });
      return;
    }
    res.setHeader("Content-Type", asset.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename="${asset.filename}"`);
    const stream = await provider.getStream(asset.storageKey);
    stream.on("error", () => {
      if (!res.headersSent) res.status(404).json({ error: "File not found in storage" });
      else res.destroy();
    });
    stream.pipe(res);
  }
);

practicalQuestionReferenceAssetsAdminRouter.post(
  "/",
  writeOnly,
  async (req: AuthedAdminRequest & Request<{ examId: string; questionId: string }>, res) => {
    const question = await requireQuestion(req.params.examId, req.params.questionId);
    if (!question) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    const { filename, dataBase64 } = req.body as { filename?: unknown; dataBase64?: unknown };
    if (typeof filename !== "string" || typeof dataBase64 !== "string") {
      res.status(400).json({ error: "filename and dataBase64 are required" });
      return;
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(dataBase64, "base64");
      if (buffer.length === 0) throw new Error("empty");
    } catch {
      res.status(400).json({ error: "Invalid base64 data" });
      return;
    }
    const result = await uploadPracticalQuestionReferenceAsset(question.id, filename, buffer);
    if (result.error === "INVALID_FILENAME") {
      res.status(400).json({ error: "Filename must end in .jpg, .jpeg, .png or .pdf" });
      return;
    }
    if (result.error === "UNRECOGNIZED_FILE_TYPE") {
      res.status(400).json({ error: "File content doesn't match a supported image or PDF format" });
      return;
    }
    if (result.error === "FILE_TOO_LARGE") {
      res.status(413).json({ error: "File exceeds the size limit for its type" });
      return;
    }
    await recordAuditLog({
      adminId: req.admin!.id,
      action: "PRACTICAL_QUESTION_ASSET_UPLOADED",
      targetType: "PracticalQuestion",
      targetId: question.id,
      detail: `filename=${filename}`,
    });
    res.status(201).json(result.asset);
  }
);

practicalQuestionReferenceAssetsAdminRouter.delete(
  "/:filename",
  writeOnly,
  async (req: AuthedAdminRequest & Request<{ examId: string; questionId: string; filename: string }>, res) => {
    const question = await requireQuestion(req.params.examId, req.params.questionId);
    if (!question) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    const deleted = await deletePracticalQuestionReferenceAsset(question.id, req.params.filename);
    if (!deleted) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }
    await recordAuditLog({
      adminId: req.admin!.id,
      action: "PRACTICAL_QUESTION_ASSET_DELETED",
      targetType: "PracticalQuestion",
      targetId: question.id,
      detail: `filename=${req.params.filename}`,
    });
    res.status(204).send();
  }
);
