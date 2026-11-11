import bcrypt from "bcryptjs";
import { adminAuthConfig } from "./adminAuthConfig.js";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, adminAuthConfig.bcryptRounds);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
