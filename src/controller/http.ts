/**
 * HTTP Server
 *
 * Provides HTTP API endpoints for external integrations
 * like the Firefox extension for caption capture.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "bun";
import { MeetController } from "../meet";
import type { Env } from "../common/config";

export interface HttpServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createHttpServer(config: Env): HttpServer {
  const app = new Hono();
  let server: ReturnType<typeof serve> | null = null;

  // Enable CORS for browser extensions
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    })
  );

  // Health check endpoint
  app.get("/api/health", (c) => {
    return c.json({ status: "ok", service: "claire" });
  });

  // Receive captions from Firefox extension
  app.post("/api/meet/captions", async (c) => {
    try {
      const body = await c.req.json();
      const { captions, channelId, threadTs, meetingContext } = body;

      if (!captions || !Array.isArray(captions)) {
        return c.json({ error: "Missing captions array" }, 400);
      }

      console.log(
        `[http] Received ${captions.length} captions from extension`
      );

      // Process each caption through the Meet trigger system
      for (const caption of captions) {
        if (!caption.text || !caption.speaker) continue;

        // Feed caption to MeetController for trigger detection
        // The extension provides meetUrl, so we use that to resolve the binding
        const meetUrl = caption.meetUrl || "extension://local";

        await MeetController.processExtensionCaption({
          meetUrl,
          speaker: caption.speaker,
          text: caption.text,
          timestamp: new Date(caption.timestamp),
          // Override binding if channelId/threadTs provided
          channelId,
          threadTs,
          meetingContext,
        });
      }

      return c.json({ success: true, processed: captions.length });
    } catch (err) {
      console.error("[http] Error processing captions:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  // Get Meet controller status
  app.get("/api/meet/status", (c) => {
    return c.json({
      activeCount: MeetController.getActiveCount(),
      activeUrls: MeetController.getActiveUrls(),
      cooldownStats: MeetController.getCooldownStats(),
    });
  });

  const port = config.HTTP_PORT || 3000;

  return {
    async start() {
      server = serve({
        fetch: app.fetch,
        port,
      });
      console.log(`HTTP server listening on port ${port}`);
    },

    async stop() {
      if (server) {
        server.stop();
        server = null;
        console.log("HTTP server stopped");
      }
    },
  };
}
