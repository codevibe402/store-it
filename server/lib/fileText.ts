const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/javascript",
  "application/typescript",
  "application/xml",
  "image/svg+xml",
]);

const TEXT_EXTENSIONS = new Set([
  "c",
  "cpp",
  "cs",
  "css",
  "csv",
  "go",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "log",
  "md",
  "php",
  "py",
  "rb",
  "rs",
  "sql",
  "svg",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

const MAX_INDEX_CHARS = 120_000;

function extensionOf(filename: string) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function looksTextual(filename: string, mimeType: string) {
  return (
    TEXT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix)) ||
    TEXT_MIME_TYPES.has(mimeType) ||
    TEXT_EXTENSIONS.has(extensionOf(filename))
  );
}

function cleanText(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_INDEX_CHARS);
}

export async function extractSearchText(
  buffer: Buffer,
  filename: string,
  mimeType: string
) {
  try {
    if (looksTextual(filename, mimeType)) {
      return cleanText(buffer.toString("utf8"));
    }

    if (mimeType.includes("pdf") || extensionOf(filename) === "pdf") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      const parsed = await parser.getText();
      await parser.destroy();
      return cleanText(parsed.text ?? "");
    }
  } catch (error) {
    console.warn("[extractSearchText] indexing skipped", error);
  }

  return "";
}
