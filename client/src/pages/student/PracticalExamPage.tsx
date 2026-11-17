import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import CodeMirror from "@uiw/react-codemirror";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  autosavePractical,
  createPracticalFile,
  deletePracticalFile,
  fetchPracticalWorkspace,
  renamePracticalFile,
  runPracticalTests,
  submitPracticalExam,
} from "../../api";
import { buildPreviewDocument, langForFile, type WorkspaceFile } from "../../lib/preview";
import { getIdeExtensions, IDE_CHROME_VARS, type IdeThemeMode } from "../../lib/codeMirrorIdeTheme";
import type { PracticalTestReport, PracticalWorkspace, StudentPracticalQuestion } from "../../types";
import {
  bindProctoringExamMonitors,
  logProctoringEvent,
  uploadAndEndProctoring,
} from "../../student/proctoringHelpers";
import { Button } from "../../components/ui/Button";
import { StateBanner } from "../../components/ui/StateBanner";
import { ModalShell } from "../../components/ui/Modal/ModalShell";

function extensionsFor(filename: string) {
  const lang = langForFile(filename);
  if (lang === "html") return [html()];
  if (lang === "css") return [css()];
  if (lang === "javascript") return [javascript({ jsx: false })];
  return [];
}

function fileIcon(filename: string): { label: string; className: string } {
  if (filename.endsWith(".html")) return { label: "H", className: "bg-[#e2a164] text-[#151515]" };
  if (filename.endsWith(".css")) return { label: "C", className: "bg-[#c397d8] text-[#151515]" };
  if (filename.endsWith(".js")) return { label: "J", className: "bg-[#e8c547] text-[#151515]" };
  return { label: "•", className: "bg-[#929292] text-[#151515]" };
}

const IDE_THEME_STORAGE_KEY = "zaio-fisa-ide-theme";

function readStoredIdeTheme(): IdeThemeMode {
  try {
    return window.localStorage.getItem(IDE_THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M20.742 13.045a8.088 8.088 0 0 1-2.077.273c-4.508 0-8.165-3.656-8.165-8.164 0-1.396.35-2.71.965-3.861A10.503 10.503 0 0 0 12 1.5C6.201 1.5 1.5 6.201 1.5 12S6.201 22.5 12 22.5c4.776 0 8.798-3.246 10-7.645a8.14 8.14 0 0 1-1.258-1.81z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" strokeLinecap="round" />
    </svg>
  );
}

export function PracticalExamPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [questions, setQuestions] = useState<StudentPracticalQuestion[]>([]);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [activeFile, setActiveFile] = useState("index.html");
  const [locked, setLocked] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSave = useRef(true);
  const splitRef = useRef<HTMLDivElement>(null);
  const [editorBasisPct, setEditorBasisPct] = useState(50);
  const [ideTheme, setIdeTheme] = useState<IdeThemeMode>(readStoredIdeTheme);
  const [showInstructionsModal, setShowInstructionsModal] = useState(false);
  const [testReport, setTestReport] = useState<PracticalTestReport | null>(null);
  const [runningTests, setRunningTests] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(IDE_THEME_STORAGE_KEY, ideTheme);
    } catch {
      /* private browsing / storage disabled — theme just won't persist */
    }
  }, [ideTheme]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    function onMove(ev: MouseEvent) {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setEditorBasisPct(Math.min(75, Math.max(25, pct)));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const load = useCallback(async () => {
    if (!assignmentId) return;
    const data = await fetchPracticalWorkspace(assignmentId);
    setTitle(data.exam.title);
    setInstructions(data.exam.instructions);
    setQuestions(data.exam.questions);
    applyWorkspace(data.workspace);
  }, [assignmentId]);

  /** Legacy/ungrouped test cases (questionId === null) still get credit for
   * their results — they just show under a trailing "General checks"
   * heading instead of a question card, so nothing from the test report
   * silently disappears when an exam has no Questions set up. */
  function progressFor(questionId: string | null): { passed: number; total: number } | null {
    if (!testReport) return null;
    const inGroup = testReport.results.filter((r) => r.questionId === questionId);
    if (inGroup.length === 0) return null;
    return { passed: inGroup.filter((r) => r.passed).length, total: inGroup.length };
  }

  function applyWorkspace(ws: PracticalWorkspace) {
    setFiles(ws.files.map((f) => ({ filename: f.filename, content: f.content })));
    setActiveFile(ws.activeFile);
    setLocked(ws.locked);
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
    void logProctoringEvent("PRACTICAL_LOADED", "Practical workspace loaded.");
    return bindProctoringExamMonitors();
  }, [load]);

  const previewHtml = useMemo(() => buildPreviewDocument(files), [files]);

  const activeContent = files.find((f) => f.filename === activeFile)?.content ?? "";

  const persist = useCallback(
    (nextFiles: WorkspaceFile[], nextActive: string) => {
      if (!assignmentId || locked) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        setSaveStatus("saving");
        autosavePractical(assignmentId, nextFiles, nextActive)
          .then((res) => {
            applyWorkspace(res.workspace);
            setSaveStatus("saved");
          })
          .catch(() => setSaveStatus("error"));
      }, 1200);
    },
    [assignmentId, locked]
  );

  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    persist(files, activeFile);
  }, [files, activeFile, persist]);

  function updateActiveContent(content: string) {
    if (locked) return;
    setFiles((prev) =>
      prev.map((f) => (f.filename === activeFile ? { ...f, content } : f))
    );
  }

  async function addFile() {
    if (!assignmentId || locked) return;
    const name = window.prompt("New file name (e.g. extra.css):");
    if (!name?.trim()) return;
    try {
      await createPracticalFile(assignmentId, name.trim());
      setFiles((prev) => [...prev, { filename: name.trim(), content: "" }]);
      setActiveFile(name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create file");
    }
  }

  async function renameFile(filename: string) {
    if (!assignmentId || locked) return;
    const newName = window.prompt("Rename file:", filename);
    if (!newName?.trim() || newName === filename) return;
    try {
      await renamePracticalFile(assignmentId, filename, newName.trim());
      setFiles((prev) =>
        prev.map((f) => (f.filename === filename ? { ...f, filename: newName.trim() } : f))
      );
      if (activeFile === filename) setActiveFile(newName.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed");
    }
  }

  async function removeFile(filename: string) {
    if (!assignmentId || locked) return;
    if (!window.confirm(`Delete ${filename}?`)) return;
    try {
      await deletePracticalFile(assignmentId, filename);
      setFiles((prev) => {
        const next = prev.filter((f) => f.filename !== filename);
        setActiveFile((af) => (af === filename ? next[0]?.filename ?? af : af));
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function runTests() {
    if (!assignmentId || runningTests) return;
    setRunningTests(true);
    setTestError(null);
    try {
      // Flush the latest edits first — run-tests reads the server-side
      // workspace, which only reflects what's actually been autosaved.
      if (!locked) {
        await autosavePractical(assignmentId, files, activeFile);
      }
      const report = await runPracticalTests(assignmentId);
      setTestReport(report);
    } catch (e) {
      setTestError(e instanceof Error ? e.message : "Could not run tests");
    } finally {
      setRunningTests(false);
    }
  }

  async function finalize() {
    if (!assignmentId || locked) return;
    if (!window.confirm("Submit final work? Editing will be locked.")) return;
    setSaveStatus("saving");
    try {
      await autosavePractical(assignmentId, files, activeFile);
      await submitPracticalExam(assignmentId);
      await uploadAndEndProctoring();
      setLocked(true);
      setSaveStatus("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
      setSaveStatus("error");
    }
  }

  return (
    <div className="flex h-screen flex-col bg-zaio-paper">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zaio-cloud bg-zaio-card px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-display font-semibold text-zaio-ink">{title}</p>
          <p className="text-xs text-zaio-ink/50">{instructions}</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => setShowInstructionsModal(true)}
            aria-label="View instructions and marking rubric"
            className="flex items-center gap-1.5 rounded-xl border border-zaio-cloud bg-zaio-paper px-2.5 py-1.5 font-medium text-zaio-ink transition-colors hover:bg-zaio-mist lg:hidden"
          >
            📋 Brief & Rubric
          </button>
          <span className="text-zaio-ink/50">
            {saveStatus === "saving"
              ? "Saving…"
              : saveStatus === "saved"
                ? "All changes saved"
                : saveStatus === "error"
                  ? "Save error"
                  : "Autosave on"}
          </span>
          <button
            type="button"
            onClick={() => setIdeTheme((m) => (m === "dark" ? "light" : "dark"))}
            aria-label={`Switch to ${ideTheme === "dark" ? "Light" : "Dark"} Mode`}
            className="flex items-center gap-1.5 rounded-xl border border-zaio-cloud px-2.5 py-1.5 font-medium text-zaio-ink transition-colors hover:bg-zaio-paper"
          >
            {ideTheme === "dark" ? <MoonIcon /> : <SunIcon />}
            {ideTheme === "dark" ? "Dark Mode" : "Light Mode"}
          </button>
          <Button type="button" variant="secondary" size="sm" disabled={runningTests} onClick={() => void runTests()}>
            {runningTests ? "Running…" : "Run Tests"}
          </Button>
          {!locked ? (
            <Button type="button" variant="sun" size="sm" onClick={() => void finalize()}>
              Submit final
            </Button>
          ) : null}
          <Link to="/student" className="text-zaio-blue">
            Exit
          </Link>
        </div>
      </header>
      {locked ? (
        <StateBanner tone="info" bleed center>
          Final submission locked · assessor review only
        </StateBanner>
      ) : null}
      {error ? (
        <StateBanner tone="error" bleed>
          {error}
        </StateBanner>
      ) : null}
      <div
        style={IDE_CHROME_VARS[ideTheme] as React.CSSProperties}
        className="grid min-h-0 flex-1 lg:grid-cols-[300px_1fr]"
      >
        <aside className="flex max-h-[40vh] flex-col overflow-y-auto border-b border-r border-[var(--ide-border)] bg-[var(--ide-sidebar-bg)] lg:max-h-none lg:border-b-0">
          <div className="border-b border-[var(--ide-border)] px-3 py-2">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--ide-muted)]">
              Brief &amp; rubric
            </p>
            {questions.length > 0 ? (
              <ul className="mt-1 space-y-1">
                {questions.map((q) => {
                  const progress = progressFor(q.id);
                  return (
                    <li key={q.id} className="text-xs leading-relaxed text-[var(--ide-text)]">
                      <span className="font-medium">{q.title}</span> · {q.marks} mark{q.marks === 1 ? "" : "s"}
                      {progress ? (
                        <span className="text-[var(--ide-muted)]"> · {progress.passed}/{progress.total} passing</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-[var(--ide-text)]">
                {instructions}
              </p>
            )}
          </div>

          <div className="border-b border-[var(--ide-border)] px-3 py-2">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--ide-muted)]">Test results</p>
            {testError ? <p className="mt-1 text-xs text-red-600">{testError}</p> : null}
            {!testReport && !testError ? (
              <p className="mt-1 text-xs text-[var(--ide-muted)]">
                Click <strong>Run Tests</strong> above to check your progress — this never submits your work.
              </p>
            ) : null}
            {testReport ? (
              <div className="mt-1 space-y-1.5">
                <p className="text-xs font-medium text-[var(--ide-text)]">
                  {testReport.scorePercent.toFixed(0)}% ({testReport.earnedPoints}/{testReport.maxPoints} pts)
                </p>
                {testReport.note ? <p className="text-xs text-[var(--ide-muted)]">{testReport.note}</p> : null}
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {testReport.results.map((r) => (
                    <li
                      key={r.testCaseId}
                      className={`rounded-md border px-2 py-1 text-xs ${
                        r.passed ? "border-[var(--ide-pass-border)] bg-[var(--ide-pass-bg)] text-[var(--ide-pass-text)]" : "border-[var(--ide-border)] text-[var(--ide-text)]"
                      }`}
                    >
                      {r.passed ? "✓" : "✗"} {r.label}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between border-b border-[var(--ide-border)] px-3 py-2 text-xs font-medium uppercase tracking-wide text-[var(--ide-muted)]">
            Explorer
            {!locked ? (
              <button type="button" className="normal-case text-zaio-blue" onClick={() => void addFile()}>
                + New
              </button>
            ) : null}
          </div>
          <ul className="flex-1 overflow-y-auto p-2 text-sm">
            {files.map((f) => {
              const icon = fileIcon(f.filename);
              const active = activeFile === f.filename;
              return (
                <li key={f.filename} className="mb-1">
                  <button
                    type="button"
                    onClick={() => setActiveFile(f.filename)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                      active ? "bg-zaio-blue text-white" : "text-[var(--ide-text)] hover:bg-zaio-ink/5"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold ${icon.className}`}
                    >
                      {icon.label}
                    </span>
                    <span className="truncate">{f.filename}</span>
                  </button>
                  {!locked ? (
                    <div className="ml-7 flex gap-2 text-[10px] text-[var(--ide-muted)]">
                      <button type="button" className="hover:text-[var(--ide-text)]" onClick={() => void renameFile(f.filename)}>
                        Rename
                      </button>
                      <button type="button" className="hover:text-[var(--ide-text)]" onClick={() => void removeFile(f.filename)}>
                        Delete
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="flex min-h-0 flex-col bg-[var(--ide-tab-bg)]">
          <div className="flex shrink-0 overflow-x-auto border-b border-[var(--ide-border)]">
            {files.map((f) => {
              const icon = fileIcon(f.filename);
              const active = activeFile === f.filename;
              return (
                <button
                  key={f.filename}
                  type="button"
                  onClick={() => setActiveFile(f.filename)}
                  className={`flex shrink-0 items-center gap-2 border-r border-[var(--ide-border)] px-4 py-2 text-xs ${
                    active
                      ? "bg-[var(--ide-active-tab-bg)] text-[var(--ide-text)]"
                      : "bg-[var(--ide-tab-bg)] text-[var(--ide-muted)] hover:text-[var(--ide-text)]"
                  }`}
                >
                  <span
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-[8px] font-bold ${icon.className}`}
                  >
                    {icon.label}
                  </span>
                  {f.filename}
                </button>
              );
            })}
          </div>

          <div
            ref={splitRef}
            style={{ ["--editor-basis" as string]: `${editorBasisPct}%` }}
            className="flex min-h-0 flex-1 flex-col lg:flex-row"
          >
            <section className="flex min-h-[320px] min-w-0 flex-col border-b border-[var(--ide-border)] bg-[var(--ide-editor-bg)] lg:min-h-0 lg:shrink-0 lg:border-b-0 lg:border-r lg:[flex-basis:var(--editor-basis)]">
              <div className="min-h-0 flex-1 overflow-auto">
                <CodeMirror
                  value={activeContent}
                  theme="none"
                  height="100%"
                  minHeight="320px"
                  extensions={[...getIdeExtensions(ideTheme), ...extensionsFor(activeFile)]}
                  onChange={(v) => updateActiveContent(v)}
                  readOnly={locked}
                  basicSetup={{ lineNumbers: true, foldGutter: true }}
                  className="h-full text-sm [&_.cm-editor]:h-full"
                />
              </div>
            </section>

            <div
              onMouseDown={startResize}
              className="hidden w-1 shrink-0 cursor-col-resize bg-[var(--ide-border)] hover:bg-zaio-blue lg:block"
            />

            <section className="flex min-h-[240px] min-w-0 flex-1 flex-col bg-white">
              <p className="border-b border-[var(--ide-border)] bg-[var(--ide-tab-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ide-muted)]">
                Live preview (sandboxed)
              </p>
              <iframe
                title="Practical preview"
                sandbox="allow-scripts"
                className="min-h-0 flex-1 w-full border-0 bg-white"
                srcDoc={previewHtml}
              />
            </section>
          </div>
        </div>
      </div>
      {showInstructionsModal ? (
        <ModalShell
          title={title || "Practical Assessment Brief & Rubric"}
          size="lg"
          onClose={() => setShowInstructionsModal(false)}
        >
          <div className="space-y-4">
            <div className="rounded-lg bg-zaio-paper p-4 text-xs font-mono text-zaio-ink/70">
              <span className="font-semibold text-zaio-ink">Candidate Notice:</span> Code your solution in
              the file explorer using <code className="bg-zaio-card px-1 py-0.5 rounded border border-zaio-cloud">index.html</code> and <code className="bg-zaio-card px-1 py-0.5 rounded border border-zaio-cloud">styles.css</code>. Autosave is enabled. All test cases run upon clicking Submit Final.
            </div>
            {questions.length > 0 ? (
              <div className="space-y-4">
                {questions.map((q) => {
                  const progress = progressFor(q.id);
                  return (
                    <div key={q.id} className="rounded-lg border border-zaio-cloud p-4">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-display text-sm font-semibold text-zaio-ink">{q.title}</h3>
                        <span className="rounded bg-zaio-ink/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zaio-ink/60">
                          {q.difficulty}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zaio-ink/50">
                        {q.marks} mark{q.marks === 1 ? "" : "s"}
                        {progress ? ` · ${progress.passed}/${progress.total} checks passing` : ""}
                      </p>
                      {q.scenario ? (
                        <p className="mt-2 whitespace-pre-line text-sm text-zaio-ink/90">{q.scenario}</p>
                      ) : null}
                      {q.instructions ? (
                        <p className="mt-2 whitespace-pre-line text-sm text-zaio-ink/80">{q.instructions}</p>
                      ) : null}
                      {q.requirements.length > 0 ? (
                        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-zaio-ink/80">
                          {q.requirements.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
                {progressFor(null) ? (
                  <div className="rounded-lg border border-zaio-cloud p-4">
                    <h3 className="font-display text-sm font-semibold text-zaio-ink">General checks</h3>
                    <p className="mt-1 text-xs text-zaio-ink/50">
                      {progressFor(null)!.passed}/{progressFor(null)!.total} checks passing
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="whitespace-pre-line text-sm leading-relaxed text-zaio-ink/90 font-sans">
                {instructions}
              </div>
            )}
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}
