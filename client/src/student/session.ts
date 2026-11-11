const TOKEN_KEY = "zaio_fisa_student_token";

export function getStudentToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setStudentToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearStudentToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}
