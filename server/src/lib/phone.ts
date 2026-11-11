import {
  parsePhoneNumberWithError,
  ParseError,
  isSupportedCountry,
  type CountryCode,
} from "libphonenumber-js";
import { otpConfig } from "./otpConfig.js";

export type PhoneNormalizeResult =
  | { ok: true; e164: string }
  | { ok: false; error: string };

function resolveRegion(region: string): CountryCode | undefined {
  return isSupportedCountry(region) ? region : undefined;
}

/**
 * Validate and normalize a phone number to E.164, defaulting to the
 * configured region (South Africa, +27) for locally-formatted input while
 * still accepting explicit `+`-prefixed international numbers.
 */
export function normalizePhoneToE164(
  raw: string,
  defaultRegion: string = otpConfig.defaultPhoneRegion
): PhoneNormalizeResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Phone number is required" };
  }
  try {
    const parsed = parsePhoneNumberWithError(
      trimmed,
      trimmed.startsWith("+") ? undefined : resolveRegion(defaultRegion)
    );
    if (!parsed.isValid()) {
      return { ok: false, error: "Not a valid phone number" };
    }
    return { ok: true, e164: parsed.number };
  } catch (e) {
    if (e instanceof ParseError) {
      return { ok: false, error: "Could not parse phone number" };
    }
    return { ok: false, error: "Invalid phone number" };
  }
}
