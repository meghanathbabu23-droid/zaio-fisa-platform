export type WorkspaceFile = { filename: string; content: string };

/** Build a single HTML document for sandboxed iframe preview. */
export function buildPreviewDocument(files: WorkspaceFile[]): string {
  const htmlFile = files.find((f) => f.filename.endsWith(".html"));
  const css = files
    .filter((f) => f.filename.endsWith(".css"))
    .map((f) => f.content)
    .join("\n");
  const js = files
    .filter((f) => f.filename.endsWith(".js"))
    .map((f) => f.content)
    .join("\n");

  const raw = htmlFile?.content ?? "<p>No HTML file</p>";

  if (/<!DOCTYPE/i.test(raw) || /<html[\s>]/i.test(raw)) {
    let doc = raw;
    if (css && !doc.includes("</head>")) {
      doc = doc.replace(/<html[^>]*>/i, (m) => `${m}<head></head>`);
    }
    if (css && doc.includes("</head>")) {
      doc = doc.replace("</head>", `<style id="injected-css">\n${css}\n</style></head>`);
    } else if (css) {
      doc = `<style id="injected-css">\n${css}\n</style>${doc}`;
    }
    if (js && doc.includes("</body>")) {
      doc = doc.replace(
        "</body>",
        `<script id="injected-js">\n${js}\n<\/script></body>`
      );
    } else if (js) {
      doc = `${doc}<script id="injected-js">\n${js}\n<\/script>`;
    }
    return doc;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style id="injected-css">
${css}
</style>
</head>
<body>
${raw}
<script id="injected-js">
${js}
<\/script>
</body>
</html>`;
}

export function langForFile(filename: string): "html" | "css" | "javascript" | "text" {
  if (filename.endsWith(".html")) return "html";
  if (filename.endsWith(".css")) return "css";
  if (filename.endsWith(".js")) return "javascript";
  return "text";
}
