const TOKEN_KEY = "zaio_fisa_student_token";
/** Stored alongside the token (same sessionStorage, cleared together on
 * logout) purely so client-side code — notably recording-chunk recovery —
 * can scope itself to "this browser's currently logged-in student" without
 * decoding the opaque session token. Never sent anywhere itself; the server
 * always re-derives studentId from the token on every request regardless. */
const STUDENT_ID_KEY = "zaio_fisa_student_id";

export function getStudentToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setStudentToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearStudentToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function getStudentId(): string | null {
  return sessionStorage.getItem(STUDENT_ID_KEY);
}

export function setStudentId(id: string): void {
  sessionStorage.setItem(STUDENT_ID_KEY, id);
}

export function clearStudentId(): void {
  sessionStorage.removeItem(STUDENT_ID_KEY);
}
