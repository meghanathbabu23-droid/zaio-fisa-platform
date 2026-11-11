import { useState } from "react";
import { Link } from "react-router-dom";
import { AuthShell } from "./ui/AuthShell";
import { Button } from "./ui/Button";
import { StateBanner } from "./ui/StateBanner";
import { loginAdmin } from "../api";

export function AdminLoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      setLocked(false);
      return;
    }
    setLoading(true);
    setError(null);
    setLocked(false);
    try {
      await loginAdmin(email.trim(), password);
      onLoggedIn();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      if (/temporarily locked/i.test(message)) {
        setLocked(true);
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <p className="font-display text-xl font-semibold text-zaio-ink">Admin sign in</p>
      <p className="mt-1 text-sm text-zaio-ink/60">Sign in with your administrator account.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block text-sm">
          Email
          <input
            className="input mt-1"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Password
          <input
            className="input mt-1"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? (
          <StateBanner tone={locked ? "warning" : "error"}>{error}</StateBanner>
        ) : null}
        <Button type="submit" disabled={loading} fullWidth>
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <Link
        to="/admin/forgot-password"
        className="mt-6 block text-center text-sm font-medium text-zaio-blue hover:underline"
      >
        Forgot your password?
      </Link>
    </AuthShell>
  );
}
