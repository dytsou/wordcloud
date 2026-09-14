import { layoutWordCloud } from "../core/layout";
import type { EngineRequest, EngineResponse } from "../app/engine-client";

const cancelled = new Set<number>();
let latestJobId = 0;

const scope: {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<EngineRequest>) => void,
  ): void;
  postMessage(message: EngineResponse): void;
} = self;

scope.addEventListener("message", (event: MessageEvent<EngineRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    cancelled.add(request.jobId);
    return;
  }

  latestJobId = Math.max(latestJobId, request.jobId);
  try {
    const scene = layoutWordCloud(
      request.wordSet,
      request.style,
      request.metrics,
      {
        shouldCancel: () =>
          cancelled.has(request.jobId) || request.jobId < latestJobId,
      },
    );
    if (cancelled.has(request.jobId) || request.jobId < latestJobId) {
      const response: EngineResponse = {
        type: "cancelled",
        jobId: request.jobId,
      };
      scope.postMessage(response);
      return;
    }
    const response: EngineResponse = {
      type: "success",
      jobId: request.jobId,
      scene,
    };
    scope.postMessage(response);
  } catch (error) {
    const response: EngineResponse = {
      type: "error",
      jobId: request.jobId,
      message: error instanceof Error ? error.message : "layout worker failed",
    };
    scope.postMessage(response);
  } finally {
    cancelled.delete(request.jobId);
  }
});
