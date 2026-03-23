import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import {
  answerQuestion,
  streamAnswerQuestion
} from "./services/query-service.js";
import {
  buildDataModel,
  getNodeDetails,
  searchNodes
} from "./services/data-model.js";
import type { QueryRequest } from "../shared/types.js";

const port = Number(process.env.PORT ?? 4000);
const rootDirectory = process.cwd();

async function startServer(): Promise<void> {
  const model = await buildDataModel(rootDirectory);
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      status: "ok",
      nodes: model.graph.stats.totalNodes,
      edges: model.graph.stats.totalEdges
    });
  });

  app.get("/api/graph", (_request, response) => {
    response.json(model.graph);
  });

  app.get("/api/graph/nodes/:nodeId", (request, response) => {
    const nodeId = decodeURIComponent(request.params.nodeId);
    const details = getNodeDetails(model, nodeId);
    if (!details) {
      response.status(404).json({ error: "Node not found." });
      return;
    }

    response.json(details);
  });

  app.get("/api/search", (request, response) => {
    const query = String(request.query.q ?? "");
    response.json(searchNodes(model, query));
  });

  app.post("/api/query", async (request, response) => {
    const body = request.body as QueryRequest;
    if (!body?.question?.trim()) {
      response.status(400).json({ error: "Question is required." });
      return;
    }

    const result = await answerQuestion(
      model,
      body.question,
      Array.isArray(body.conversation) ? body.conversation : []
    );
    response.json(result);
  });

  app.post("/api/query/stream", async (request, response) => {
    const body = request.body as QueryRequest;
    if (!body?.question?.trim()) {
      response.status(400).json({ error: "Question is required." });
      return;
    }

    response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");

    const emit = (event: { type: string; payload: unknown }) => {
      response.write(`${JSON.stringify(event)}\n`);
    };

    try {
      await streamAnswerQuestion(
        model,
        body.question,
        Array.isArray(body.conversation) ? body.conversation : [],
        emit
      );
    } catch (error) {
      emit({
        type: "error",
        payload:
          error instanceof Error ? error.message : "Unexpected streaming failure."
      });
    } finally {
      response.end();
    }
  });

  const clientDirectory = path.join(rootDirectory, "dist", "client");
  if (fs.existsSync(clientDirectory)) {
    app.use(express.static(clientDirectory));
    app.get("*", (_request, response) => {
      response.sendFile(path.join(clientDirectory, "index.html"));
    });
  }

  app.listen(port, () => {
    console.log(
      `Dodge Order-to-Cash server listening on http://localhost:${port}`
    );
    console.log(
      `Loaded ${model.graph.stats.totalNodes} graph nodes and ${model.graph.stats.totalEdges} graph edges.`
    );
  });
}

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
