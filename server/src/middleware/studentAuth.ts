import type { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma.js";

export type AuthedRequest = Request & { studentId?: string };

export async function requireStudent(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const session = await prisma.studentSession.findUnique({
    where: { token },
  });
  if (!session || session.expiresAt < new Date()) {
    res.status(401).json({ error: "Session expired" });
    return;
  }
  req.studentId = session.studentId;
  next();
}
