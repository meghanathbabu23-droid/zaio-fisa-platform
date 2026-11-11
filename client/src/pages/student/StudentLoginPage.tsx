import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { registerTester, requestOtp, verifyOtp } from "../../api";
import { setStudentToken } from "../../student/session";
import { AuthShell } from "../../components/ui/AuthShell";
import { Button } from "../../components/ui/Button";
import { StateBanner } from "../../components/ui/StateBanner";
import type { OtpChannel } from "../../types";

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function StudentLoginPage() {
  const navigate = useNavigate();
  const [channel, setChannel] = useState<OtpChannel>("email");
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"identity" | "otp" | "register">("identity");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendReadyAt, setResendReadyAt] = useState<number | null>(null);
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [registerNotice, setRegisterNotice] = useState<string | null>(null);
  const [regFullName, setRegFullName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPhone, setRegPhone] = useState("");

  useEffect(() => {
    if (step !== "otp") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);

  const cooldownRemaining = resendReadyAt ? Math.max(0, Math.ceil((resendReadyAt - now) / 1000)) : 0;
  const expiryRemaining = expiresAtMs ? Math.max(0, Math.floor((expiresAtMs - now) / 1000)) : 0;
  const expired = step === "otp" && expiresAtMs !== null && expiryRemaining === 0;

  function switchChannel(next: OtpChannel) {
    setChannel(next);
    setValue("");
    setError(null);
  }

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) {
      setError(channel === "email" ? "Enter your registered Zaio email." : "Enter your registered phone number.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await requestOtp(channel, value.trim());
      setResendReadyAt(Date.now() + res.cooldownSeconds * 1000);
      setExpiresAtMs(new Date(res.expiresAt).getTime());
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (cooldownRemaining > 0 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await requestOtp(channel, value.trim());
      setResendReadyAt(Date.now() + res.cooldownSeconds * 1000);
      setExpiresAtMs(new Date(res.expiresAt).getTime());
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  async function confirmOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await verifyOtp(channel, value.trim(), code.trim());
      setStudentToken(res.token);
      navigate("/student");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  function useDifferentIdentity() {
    setStep("identity");
    setCode("");
    setError(null);
    setResendReadyAt(null);
    setExpiresAtMs(null);
  }

  function openRegister() {
    setStep("register");
    setError(null);
    setRegisterNotice(null);
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!regFullName.trim() || !regEmail.trim() || !regPhone.trim()) {
      setError("Full name, email, and mobile number are all required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await registerTester(regFullName.trim(), regEmail.trim(), regPhone.trim());
      setChannel("email");
      setValue(res.student.email);
      setRegisterNotice(
        res.reused
          ? "That email/mobile is already registered to an existing tester record — request your code below."
          : "Registered. Request your code below."
      );
      setStep("identity");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <p className="font-display text-xl font-semibold text-zaio-ink">Student sign-in</p>
      <p className="mt-1 text-sm text-zaio-ink/60">One-time code · single use · 10 minute expiry</p>
      {step === "identity" ? (
        <form onSubmit={sendOtp} className="mt-6 space-y-4">
          <div className="flex gap-2 rounded-lg bg-zaio-paper p-1">
            <button
              type="button"
              onClick={() => switchChannel("email")}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                channel === "email" ? "bg-white text-zaio-ink shadow-sm" : "text-zaio-ink/60"
              }`}
            >
              Email
            </button>
            <button
              type="button"
              onClick={() => switchChannel("phone")}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                channel === "phone" ? "bg-white text-zaio-ink shadow-sm" : "text-zaio-ink/60"
              }`}
            >
              Phone
            </button>
          </div>
          <label className="block text-sm">
            {channel === "email" ? "Zaio email" : "Phone number"}
            <input
              className="input mt-1"
              type={channel === "email" ? "email" : "tel"}
              placeholder={channel === "email" ? "name@zaio.io" : "082 111 0001"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete={channel === "email" ? "email" : "tel"}
            />
          </label>
          {registerNotice ? <StateBanner tone="success">{registerNotice}</StateBanner> : null}
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <Button type="submit" disabled={loading} fullWidth>
            {loading ? "Sending…" : `Send code via ${channel === "email" ? "email" : "SMS"}`}
          </Button>
          <Button type="button" variant="ghost" fullWidth onClick={openRegister}>
            New tester? Register here
          </Button>
        </form>
      ) : step === "register" ? (
        <form onSubmit={submitRegister} className="mt-6 space-y-4">
          <StateBanner tone="info">
            Internal testing only — this creates a clearly-marked test account, never a real exam
            registration. Only available in this environment's testing configuration.
          </StateBanner>
          <label className="block text-sm">
            Full name
            <input
              className="input mt-1"
              value={regFullName}
              onChange={(e) => setRegFullName(e.target.value)}
              autoComplete="name"
            />
          </label>
          <label className="block text-sm">
            Email
            <input
              className="input mt-1"
              type="email"
              value={regEmail}
              onChange={(e) => setRegEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label className="block text-sm">
            Mobile number
            <input
              className="input mt-1"
              type="tel"
              placeholder="082 111 0001"
              value={regPhone}
              onChange={(e) => setRegPhone(e.target.value)}
              autoComplete="tel"
            />
          </label>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <Button type="submit" disabled={loading} fullWidth>
            {loading ? "Registering…" : "Register"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            fullWidth
            onClick={() => {
              setStep("identity");
              setError(null);
            }}
          >
            Back to sign in
          </Button>
        </form>
      ) : (
        <form onSubmit={confirmOtp} className="mt-6 space-y-4">
          <StateBanner tone="info">
            We sent a 6-digit code to your {channel === "email" ? "email" : "phone"}. Check{" "}
            {channel === "email" ? "your inbox (and spam folder)" : "your messages"}.
          </StateBanner>
          <label className="block text-sm">
            Enter code
            <input
              className="input mt-1 font-mono tracking-widest"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
              autoComplete="one-time-code"
            />
          </label>
          <p className="text-xs text-zaio-ink/50">
            {expired ? (
              <span className="text-red-700">Code expired — request a new one.</span>
            ) : (
              `Expires in ${formatCountdown(expiryRemaining)}`
            )}
          </p>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <Button type="submit" disabled={loading || expired} fullWidth>
            {loading ? "Verifying…" : "Verify & continue"}
          </Button>
          <Button type="button" variant="secondary" fullWidth disabled={cooldownRemaining > 0 || loading} onClick={() => void resend()}>
            {cooldownRemaining > 0 ? `Resend code in ${cooldownRemaining}s` : "Resend code"}
          </Button>
          <Button type="button" variant="ghost" fullWidth onClick={useDifferentIdentity}>
            Use a different email/phone
          </Button>
        </form>
      )}
      <Link to="/" className="mt-6 block text-center text-sm text-zaio-blue">
        Back to admin
      </Link>
    </AuthShell>
  );
}
