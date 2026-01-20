/**
 * Attachment Processing
 *
 * Downloads and processes Slack attachments to extract text content.
 * Supports: PDF, LaTeX, text files, and images.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { AttachmentMeta } from "../common/schema";
import { extractPDF } from "./pdf";
import { extractTeX } from "./tex";

/**
 * Download an attachment from Slack
 */
export async function downloadAttachment(
  botToken: string,
  url: string,
  destPath: string
): Promise<void> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${botToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download attachment: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, Buffer.from(buffer));
}

/**
 * Process an attachment and extract text content
 */
export async function processAttachment(
  botToken: string,
  attachment: AttachmentMeta,
  workDir: string
): Promise<AttachmentMeta> {
  const attachmentsDir = path.join(workDir, "attachments");
  await fs.mkdir(attachmentsDir, { recursive: true });

  // Generate local file path
  const sanitizedName = attachment.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const localPath = path.join(attachmentsDir, `${attachment.id}_${sanitizedName}`);

  // Download the file
  await downloadAttachment(botToken, attachment.url, localPath);

  // Update attachment with local path
  const result: AttachmentMeta = {
    ...attachment,
    localPath,
  };

  // Extract text based on type
  try {
    if (attachment.mimetype === "application/pdf" || attachment.name.endsWith(".pdf")) {
      result.extractedText = await extractPDF(localPath);
    } else if (
      attachment.name.endsWith(".tex") ||
      attachment.name.endsWith(".latex") ||
      attachment.mimetype === "application/x-tex"
    ) {
      result.extractedText = await extractTeX(localPath);
    } else if (
      attachment.mimetype.startsWith("text/") ||
      attachment.name.endsWith(".txt") ||
      attachment.name.endsWith(".md") ||
      attachment.name.endsWith(".json") ||
      attachment.name.endsWith(".yaml") ||
      attachment.name.endsWith(".yml") ||
      attachment.name.endsWith(".py") ||
      attachment.name.endsWith(".js") ||
      attachment.name.endsWith(".ts") ||
      attachment.name.endsWith(".tsx") ||
      attachment.name.endsWith(".jsx") ||
      attachment.name.endsWith(".html") ||
      attachment.name.endsWith(".css") ||
      attachment.name.endsWith(".sh") ||
      attachment.name.endsWith(".sql") ||
      attachment.name.endsWith(".xml") ||
      attachment.name.endsWith(".csv")
    ) {
      result.extractedText = await fs.readFile(localPath, "utf-8");
    }
    // Images are not text-extracted but kept for potential vision model use
  } catch (err: any) {
    console.error(`Failed to extract text from ${attachment.name}:`, err.message);
    result.extractedText = `[Error extracting text: ${err.message}]`;
  }

  return result;
}

/**
 * Process all attachments in a message list
 */
export async function processAllAttachments(
  botToken: string,
  messages: Array<{ attachments: AttachmentMeta[] }>,
  workDir: string
): Promise<Map<string, AttachmentMeta>> {
  const processed = new Map<string, AttachmentMeta>();

  for (const msg of messages) {
    for (const attachment of msg.attachments) {
      // Skip attachments without IDs or URLs (e.g., link previews, unfurled URLs)
      if (!attachment.id || !attachment.url) continue;
      if (processed.has(attachment.id)) continue;

      try {
        const result = await processAttachment(botToken, attachment, workDir);
        processed.set(attachment.id, result);
      } catch (err: any) {
        console.error(`Failed to process attachment ${attachment.name}:`, err.message);
      }
    }
  }

  return processed;
}
