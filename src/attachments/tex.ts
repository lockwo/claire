/**
 * LaTeX Text Extraction
 *
 * Process LaTeX files to extract readable content.
 */

import * as fs from "fs/promises";

/**
 * Extract readable text from a LaTeX file
 *
 * This does basic cleanup while preserving the mathematical content
 * that Claude can understand.
 */
export async function extractTeX(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, "utf-8");

  // For LaTeX, we want to preserve most content since Claude understands LaTeX
  // Just do basic cleanup

  let text = content
    // Remove comments (but keep content)
    .replace(/(?<!\\)%.*$/gm, "")
    // Remove common boilerplate commands
    .replace(/\\documentclass(\[.*?\])?\{.*?\}/g, "")
    .replace(/\\usepackage(\[.*?\])?\{.*?\}/g, "")
    .replace(/\\begin\{document\}/g, "")
    .replace(/\\end\{document\}/g, "")
    .replace(/\\maketitle/g, "")
    // Clean up whitespace
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Truncate extremely long documents (GPT-5.2 has 128k+ tokens, ~500k chars)
  const maxLength = 200000;
  if (text.length > maxLength) {
    text = text.slice(0, maxLength) + "\n\n... [truncated]";
  }

  return text || "[Empty LaTeX document]";
}

/**
 * Extract just the abstract from a LaTeX document
 */
export async function extractAbstract(filePath: string): Promise<string | null> {
  const content = await fs.readFile(filePath, "utf-8");

  const abstractMatch = content.match(
    /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/
  );

  if (abstractMatch?.[1]) {
    return abstractMatch[1].trim();
  }

  return null;
}

/**
 * Extract title and authors from a LaTeX document
 */
export async function extractMetadata(filePath: string): Promise<{
  title?: string;
  authors?: string;
}> {
  const content = await fs.readFile(filePath, "utf-8");

  const titleMatch = content.match(/\\title\{([^}]+)\}/);
  const authorMatch = content.match(/\\author\{([^}]+)\}/);

  return {
    title: titleMatch?.[1]?.replace(/\\\\/g, " ").trim(),
    authors: authorMatch?.[1]?.replace(/\\\\/g, ", ").trim(),
  };
}
