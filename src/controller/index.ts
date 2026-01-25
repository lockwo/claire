/**
 * Controller
 *
 * Main entry point for the Claire controller. Initializes Slack
 * event handling and the job scheduler.
 */

import type { Env } from "../common/config";
import { createSlackHandler, SlackHandler } from "./slack";
import { createHttpServer, HttpServer } from "./http";
import { Scheduler } from "./scheduler";

export interface Controller {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createController(config: Env): Promise<Controller> {
  let slackHandler: SlackHandler | null = null;
  let httpServer: HttpServer | null = null;

  return {
    async start() {
      console.log("Initializing controller...");

      // Create Slack handler
      slackHandler = await createSlackHandler(config);

      // Initialize scheduler with Slack client
      Scheduler.init(slackHandler.client);

      // Create HTTP server for extension API
      httpServer = createHttpServer(config);

      // Start Slack socket mode
      await slackHandler.start();

      // Start HTTP server
      await httpServer.start();

      console.log("Controller started");
    },

    async stop() {
      console.log("Stopping controller...");

      // Stop HTTP server
      if (httpServer) {
        await httpServer.stop();
      }

      // Stop Slack handler
      if (slackHandler) {
        await slackHandler.stop();
      }

      console.log("Controller stopped");
    },
  };
}
