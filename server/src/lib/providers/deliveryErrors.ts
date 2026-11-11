/**
 * Safe, PII-free delivery-failure categories. Mirrors the Prisma
 * `OtpDeliveryErrorCategory` enum — kept as a plain TS union here (rather than
 * importing from `@prisma/client`) so the provider adapters have no Prisma
 * dependency at all.
 */
export type OtpDeliveryErrorCategory =
  | "AUTH_ERROR"
  | "INVALID_RECIPIENT"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "UNKNOWN";
