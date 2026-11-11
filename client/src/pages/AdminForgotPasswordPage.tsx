import { useState } from "react";
import { Link } from "react-router-dom";
import { requestAdminPasswordReset } from "../api";
import { AuthShell } from "../components/ui/AuthShell";
import { Button } from "../components/ui/Button";
import { StateBanner } from "../components/ui/StateBanner";

export function AdminForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await requestAdminPasswordReset(email.trim());
      setMessage(result.message);
    } catch {
      // The endpoint always returns 200 with a generic message — this only
      // fires on a network-level failure, not "email not found".
      setMessage("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <p className="font-display text-xl font-semibold text-zaio-ink">Reset your password</p>
      <p className="mt-1 text-sm text-zaio-ink/60">
        Enter your admin account email and we'll send a reset link if it's registered.
      </p>
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
        {message ? <StateBanner tone="info">{message}</StateBanner> : null}
        <Button type="submit" disabled={loading} fullWidth>
          {loading ? "Sending…" : "Send reset link"}
        </Button>
      </form>
      <Link to="/" className="mt-6 block text-center text-sm font-medium text-zaio-blue hover:underline">
        Back to sign in
      </Link>
    </AuthShell>
  );
}
