
import path from "node:path";
import { fail } from "./errors.mjs";

const CSV_MIME = new Set(["text/csv", "text/plain", "application/csv", "text/tab-separated-values"]);
const XLSX_MIME = new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip"]);

export function detectImportFormat({ filename, mimeType, bytes }) {
  if (typeof filename !== "string" || filename.trim() === "") fail("INVALID_FILENAME", "filename is required");
  if (path.basename(filename) !== filename || filename.includes("\\") || /[\u0000-\u001f\u007f]/.test(filename) || filename.length > 255) fail("UNSAFE_FILENAME", "filename must not contain a path");
  const extension = path.extname(filename).toLowerCase();
  const mime = String(mimeType ?? "").toLowerCase().split(";", 1)[0].trim();
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  if ([".csv", ".tsv"].includes(extension)) {
    if (mime && !CSV_MIME.has(mime)) fail("MIME_MISMATCH", "CSV extension does not match the supplied MIME type", { extension, mime });
    if (buffer.includes(0)) fail("BINARY_CSV", "CSV source contains NUL bytes");
    return extension === ".tsv" ? "TSV" : "CSV";
  }
  if (extension === ".xlsx") {
    if (mime && !XLSX_MIME.has(mime)) fail("MIME_MISMATCH", "XLSX extension does not match the supplied MIME type", { extension, mime });
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || ![[0x03, 0x04], [0x05, 0x06], [0x07, 0x08]].some(([a, b]) => buffer[2] === a && buffer[3] === b)) {
      fail("INVALID_XLSX_SIGNATURE", "XLSX source is not a ZIP container");
    }
    return "XLSX";
  }
  fail("UNSUPPORTED_IMPORT_FORMAT", "Only CSV, TSV, and XLSX imports are supported", { extension });
}
