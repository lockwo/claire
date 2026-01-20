/**
 * Claire - Slack-Native Code Agent
 *
 * Entry point for the application. Initializes the controller
 * which handles Slack events and manages worker execution.
 */

import { createController } from "./controller";
import { getConfig } from "./common/config";
import { Bus, Events } from "./common/bus";
import { detectGPU, getGPUSummary } from "./common/gpu";

async function main() {
  console.log("Starting Claire...");

  const config = getConfig();
  console.log(`Environment: ${config.NODE_ENV}`);
  console.log(`Log level: ${config.LOG_LEVEL}`);
  console.log(`Local storage: ${config.USE_LOCAL_STORAGE}`);

  // Detect GPU
  const gpuInfo = await detectGPU();
  console.log(`GPU: ${getGPUSummary(gpuInfo)}`);

  // Set up global event logging in development
  if (config.NODE_ENV === "development") {
    Bus.subscribeAll(({ type, payload }) => {
      console.log(`[Event] ${type}:`, JSON.stringify(payload, null, 2));
    });
  }

  // Initialize and start the controller
  const controller = await createController(config);

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    await controller.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Start the controller
  await controller.start();
  console.log("Claire is running!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
