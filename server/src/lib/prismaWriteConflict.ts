import { Prisma } from "@prisma/client";

/** MongoDB (and some other providers) can return P2034 when concurrent
 * writers hit the same documents — common during practical autosave plus
 * periodic proctoring chunk uploads on a single dyno. */
export function isPrismaWriteConflictError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

export async function withPrismaWriteConflictRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 4
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (!isPrismaWriteConflictError(error) || attempt >= maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}