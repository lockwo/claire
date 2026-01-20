/**
 * PDF Text Extraction
 *
 * Extract text content from PDF files using pdf-parse.
 */

import pdf from "pdf-parse";
import * as fs from "fs/promises";

/**
 * Extract text from a PDF file
 */
export async function extractPDF(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);

  try {
    const data = await pdf(buffer);

    // Clean up extracted text
    let text = data.text
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // Truncate extremely long documents (GPT-5.2 has 128k+ tokens, ~500k chars)
    const maxLength = 200000;
    if (text.length > maxLength) {
      text = text.slice(0, maxLength) + "\n\n... [truncated]";
    }

    return text || "[No text content extracted from PDF]";
  } catch (err: any) {
    // Handle encrypted or malformed PDFs
    if (err.message.includes("encrypted") || err.message.includes("password")) {
      return "[PDF is encrypted and cannot be read]";
    }
    throw err;
  }
}

/**
 * Get PDF metadata
 */
export async function getPDFMetadata(filePath: string): Promise<{
  numPages: number;
  title?: string;
  author?: string;
}> {
  const buffer = await fs.readFile(filePath);
  const data = await pdf(buffer);

  return {
    numPages: data.numpages,
    title: data.info?.Title,
    author: data.info?.Author,
  };
}
