import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { runsRouter } from "./routes/runs.js";
import { pauseRouter } from "./routes/pause.js";
import { gatewayRouter } from "./routes/gateway.js";
import { registerSseClient } from "./sse/audit-stream.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "sentinel-api" });
});

app.use("/api/runs", runsRouter);
app.use("/api/runs", pauseRouter);
app.use("/api/gateway", gatewayRouter);

app.get("/api/events/stream", (req, res) => {
  const runId = (req.query.runId as string) ?? config.demoRunId;
  registerSseClient(res, runId);
});

app.listen(config.port, () => {
  console.log(`Sentinel API listening on :${config.port}`);
});