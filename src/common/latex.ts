/**
 * LaTeX Detection and Rendering
 *
 * Detects substantial LaTeX content in responses and renders to PDF.
 */

import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";

/**
 * Check if text contains substantial LaTeX that should be rendered
 */
export function containsSubstantialLatex(text: string): boolean {
  // Must have document structure or significant math environments
  const latexPatterns = [
    /\\begin\{document\}/,
    /\\begin\{equation\}/,
    /\\begin\{align\}/,
    /\\begin\{gather\}/,
    /\\begin\{multline\}/,
    /\\begin\{tabular\}/,
    /\\begin\{table\}/,
    /\\begin\{figure\}/,
    /\\begin\{tikzpicture\}/,
    /\\begin\{bmatrix\}/,
    /\\begin\{pmatrix\}/,
  ];

  // Check for multiple equation-like patterns (inline math doesn't count as "substantial")
  const hasLatexStructure = latexPatterns.some((p) => p.test(text));

  // Also check for high density of LaTeX commands (more than 10 backslash commands)
  const backslashCommands = (text.match(/\\[a-zA-Z]+/g) || []).length;
  const hasHighDensity = backslashCommands > 15;

  return hasLatexStructure || hasHighDensity;
}

/**
 * Extract LaTeX content from a response (may be wrapped in code blocks)
 */
export function extractLatex(text: string): string | null {
  // Try to find LaTeX in code blocks first
  const codeBlockMatch = text.match(/```(?:latex|tex)?\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    const content = codeBlockMatch[1].trim();
    if (containsSubstantialLatex(content)) {
      return content;
    }
  }

  // Check if the whole response is LaTeX-heavy
  if (containsSubstantialLatex(text)) {
    // Try to extract just the LaTeX portion
    const docMatch = text.match(/(\\documentclass[\s\S]*\\end\{document\})/);
    if (docMatch?.[1]) {
      return docMatch[1];
    }

    // If no full document, check for substantial math content to wrap
    const mathContent = text.match(/((?:\\begin\{(?:equation|align|gather|bmatrix|pmatrix)\}[\s\S]*?\\end\{(?:equation|align|gather|bmatrix|pmatrix)\}[\s\S]*?)+)/);
    if (mathContent?.[1]) {
      // Wrap in minimal document
      return wrapInDocument(mathContent[1]);
    }
  }

  return null;
}

/**
 * Wrap LaTeX content in a minimal document if needed
 */
function wrapInDocument(content: string): string {
  if (content.includes("\\documentclass")) {
    return content;
  }

  return `\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{geometry}
\\geometry{margin=1in}
\\begin{document}
${content}
\\end{document}`;
}

/**
 * Compile LaTeX to PDF
 */
export async function compileLatexToPdf(
  latex: string,
  workDir: string,
  filename: string = "output"
): Promise<string | null> {
  const texPath = path.join(workDir, `${filename}.tex`);
  const pdfPath = path.join(workDir, `${filename}.pdf`);

  try {
    // Ensure work directory exists
    await fs.mkdir(workDir, { recursive: true });

    // Write LaTeX file
    await fs.writeFile(texPath, latex, "utf-8");

    // Compile with pdflatex (run twice for references)
    for (let i = 0; i < 2; i++) {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("pdflatex", [
          "-interaction=nonstopmode",
          "-halt-on-error",
          "-output-directory", workDir,
          texPath,
        ], {
          cwd: workDir,
          timeout: 30000,
        });

        let stderr = "";
        proc.stderr?.on("data", (data) => {
          stderr += data.toString();
        });

        proc.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`pdflatex exited with code ${code}: ${stderr}`));
          }
        });

        proc.on("error", reject);
      });
    }

    // Check if PDF was created
    await fs.access(pdfPath);
    return pdfPath;
  } catch (err: any) {
    console.error(`[latex] Failed to compile PDF: ${err.message}`);
    return null;
  }
}

/**
 * Clean up LaTeX auxiliary files
 */
export async function cleanupLatexFiles(workDir: string, filename: string): Promise<void> {
  const extensions = [".aux", ".log", ".out", ".toc", ".tex"];
  for (const ext of extensions) {
    try {
      await fs.unlink(path.join(workDir, `${filename}${ext}`));
    } catch {
      // Ignore if file doesn't exist
    }
  }
}
