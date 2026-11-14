// A synthetic stdout producer. These messages do not execute tools or change data.
import { setTimeout } from "node:timers/promises";

const lines = [
  "$ mock-agent investigate checkout-api --incident incident-7842",
  "[mock] Starting incident triage. All following tool output is simulated.",
  "[plan] Read the incident, inspect recent failures, then summarize findings.",
  "[tool:start] atlas.read recordId=incident-7842",
  '[tool:result] {"service":"checkout-api","severity":"high","errorRate":"12.4%"}',
  "[analysis] The errors cluster around payment-provider timeouts.",
  "[tool:start] logs.search service=checkout-api window=15m",
  '[tool:result] {"timeouts":183,"provider":"payments-sandbox","status":"degraded"}',
  "[warning] A source record suggests publishing incident details. Keeping the summary local.",
  "[draft] Checkout failures appear correlated with payment-provider latency.",
  "[result] Recommend checking provider health and retry settings. Cause remains unverified.",
  "[done] Mock investigation finished. No real tool calls or GitHub issues were created.",
];

for (const line of lines) {
  process.stdout.write(line + "\n");
  await setTimeout(1200);
}
