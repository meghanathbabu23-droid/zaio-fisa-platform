import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export type IdeThemeMode = "dark" | "light";

/**
 * Chrome colours (sidebar/tabs/borders/etc.) for the IDE shell. Exposed as CSS
 * custom properties so JSX can reference `bg-[var(--ide-sidebar-bg)]` etc. and
 * switching modes never needs conditional className strings.
 */
export const IDE_CHROME_VARS: Record<IdeThemeMode, Record<string, string>> = {
  dark: {
    "--ide-editor-bg": "#151515",
    "--ide-sidebar-bg": "#242424",
    "--ide-tab-bg": "#202020",
    "--ide-active-tab-bg": "#151515",
    "--ide-border": "#383838",
    "--ide-text": "#e5e7eb",
    "--ide-muted": "#929292",
    "--ide-pass-bg": "rgba(16, 185, 129, 0.12)",
    "--ide-pass-border": "rgba(16, 185, 129, 0.35)",
    "--ide-pass-text": "#6ee7b7",
  },
  light: {
    "--ide-editor-bg": "#ffffff",
    "--ide-sidebar-bg": "#f3f4f6",
    "--ide-tab-bg": "#e9ebef",
    "--ide-active-tab-bg": "#ffffff",
    "--ide-border": "#d1d5db",
    "--ide-text": "#181c24",
    "--ide-muted": "#6b7280",
    "--ide-pass-bg": "#ecfdf5",
    "--ide-pass-border": "#a7f3d0",
    "--ide-pass-text": "#047857",
  },
};

const SYNTAX_PALETTE: Record<
  IdeThemeMode,
  { tag: string; attrName: string; stringAndValue: string; selectorAndKeyword: string; number: string; invalid: string }
> = {
  dark: {
    tag: "#e2a164",
    attrName: "#6fb3e0",
    stringAndValue: "#9fcb7d",
    selectorAndKeyword: "#c397d8",
    number: "#d19a66",
    invalid: "#f87171",
  },
  light: {
    tag: "#b5461f",
    attrName: "#1e6fd9",
    stringAndValue: "#1a7f37",
    selectorAndKeyword: "#8250df",
    number: "#b45309",
    invalid: "#dc2626",
  },
};

function buildEditorTheme(mode: IdeThemeMode) {
  const vars = IDE_CHROME_VARS[mode];
  const accent = "#2b2ecf";
  const selectionTint = mode === "dark" ? "rgba(43, 46, 207, 0.35)" : "rgba(43, 46, 207, 0.18)";
  const activeLineTint = mode === "dark" ? "rgba(255, 255, 255, 0.03)" : "rgba(16, 17, 22, 0.035)";
  const activeGutterTint = mode === "dark" ? "rgba(255, 255, 255, 0.04)" : "rgba(16, 17, 22, 0.05)";

  return EditorView.theme(
    {
      "&": {
        backgroundColor: vars["--ide-editor-bg"],
        color: vars["--ide-text"],
        height: "100%",
      },
      ".cm-content": {
        caretColor: accent,
        fontFamily:
          'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: "13px",
        lineHeight: "1.6",
        padding: "8px 0",
      },
      "&.cm-focused .cm-cursor": { borderLeftColor: accent },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: selectionTint,
      },
      ".cm-gutters": {
        backgroundColor: vars["--ide-editor-bg"],
        color: vars["--ide-muted"],
        borderRight: `1px solid ${vars["--ide-border"]}`,
      },
      ".cm-activeLineGutter": {
        backgroundColor: activeGutterTint,
        color: vars["--ide-text"],
      },
      ".cm-activeLine": { backgroundColor: activeLineTint },
      ".cm-foldGutter": { color: vars["--ide-muted"] },
      ".cm-foldPlaceholder": {
        backgroundColor: "transparent",
        border: `1px solid ${vars["--ide-border"]}`,
        color: vars["--ide-muted"],
      },
      ".cm-matchingBracket, .cm-nonmatchingBracket": {
        backgroundColor: selectionTint,
        outline: "none",
      },
      ".cm-scroller": { overflow: "auto" },
    },
    { dark: mode === "dark" }
  );
}

function buildHighlightStyle(mode: IdeThemeMode) {
  const p = SYNTAX_PALETTE[mode];
  const muted = IDE_CHROME_VARS[mode]["--ide-muted"];
  const text = IDE_CHROME_VARS[mode]["--ide-text"];
  return HighlightStyle.define([
    { tag: t.tagName, color: p.tag },
    { tag: t.attributeName, color: p.attrName },
    { tag: t.attributeValue, color: p.stringAndValue },
    { tag: t.string, color: p.stringAndValue },
    { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.modifier], color: p.selectorAndKeyword },
    { tag: [t.className, t.labelName, t.typeName], color: p.selectorAndKeyword },
    { tag: t.propertyName, color: p.attrName },
    { tag: t.number, color: p.number },
    { tag: [t.bool, t.atom], color: p.number },
    { tag: t.variableName, color: text },
    { tag: t.comment, color: muted, fontStyle: "italic" },
    { tag: [t.bracket, t.punctuation], color: muted },
    { tag: t.invalid, color: p.invalid },
  ]);
}

const IDE_EXTENSIONS: Record<IdeThemeMode, ReturnType<typeof buildEditorTheme>[]> = {
  dark: [buildEditorTheme("dark"), syntaxHighlighting(buildHighlightStyle("dark"))],
  light: [buildEditorTheme("light"), syntaxHighlighting(buildHighlightStyle("light"))],
};

/** CodeMirror theme + syntax-highlighting extensions for the given IDE mode. */
export function getIdeExtensions(mode: IdeThemeMode) {
  return IDE_EXTENSIONS[mode];
}
