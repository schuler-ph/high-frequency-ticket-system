const bootstrapLogPrefix = "[worker test bootstrap]";

process.on("uncaughtException", (error) => {
  console.error(`${bootstrapLogPrefix} uncaughtException`, error);
});

process.on("unhandledRejection", (reason) => {
  console.error(`${bootstrapLogPrefix} unhandledRejection`, reason);
});

import "./plugins/pubsub.test.ts";
import "./plugins/support.test.ts";
import "./routes/pubsub-listener.test.ts";
