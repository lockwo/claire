/**
 * Controller
 *
 * Main entry point for the Claire controller. Initializes Slack
 * event handling and the job scheduler.
 */

import type { Env } from "../common/config";
import { createSlackHandler, SlackHandler } from "./slack";
import { Scheduler } from "./scheduler";

export interface Controller {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createController(config: Env): Promise<Controller> {
  let slackHandler: SlackHandler | null = null;

  return {
    async start() {
      console.log("Initializing controller...");

      // Create Slack handler
      slackHandler = await createSlackHandler(config);

      // Initialize scheduler with Slack client
      Scheduler.init(slackHandler.client);

      // Start Slack socket mode
      await slackHandler.start();

      console.log("Controller started");
    },

    async stop() {
      console.log("Stopping controller...");

      // Stop Slack handler
      if (slackHandler) {
        await slackHandler.stop();
      }

      console.log("Controller stopped");
    },
  };
}
