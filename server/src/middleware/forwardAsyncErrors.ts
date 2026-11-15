import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler, RequestHandler, Router } from "express";
import { isPrismaWriteConflictError } from "../lib/prismaWriteConflict.js";

/**
 * Express 4 does not forward rejected promises from `async` route handlers
 * to the error middleware — an unhandled rejection can take down the whole
 * Node process (observed on Heroku during practical exams). Wrap every
 * route handler on the given router so failures call `next(err)` instead.
 */
export function forwardAsyncErrorsOnRouter(router: Router): void {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const routeLayer of layer.route.stack) {
      const handle = routeLayer.handle as RequestHandler;
      if (handle.length >= 4) continue;
      routeLayer.handle = ((req, res, next) =>
        Promise.resolve(handle(req, res, next)).catch(next)) as RequestHandler;
    }
  }
}

export const apiErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  // Log message only — never log full error objects that might embed connection details.
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error("[api] route error:", message);

  if (isPrismaWriteConflictError(err)) {
    res.status(503).json({
      error: "Temporary database conflict — please retry in a moment",
      retryable: true,
    });
    return;
  }

  res.status(500).json({ error: "Internal server error" });
};