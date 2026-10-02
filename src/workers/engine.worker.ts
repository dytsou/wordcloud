import type { EngineRequest, EngineResponse } from "../app/engine-client";
import { encodeBrotliJsonFragment } from "../core/codec";
import { layoutWordCloudAsync } from "../core/layout";
import { decodeSnapshotFragmentAsync } from "../core/snapshot";

const cancelled = new Set<number>();
const activeJobs = new Set<number>();
let latestJobId = 0;

const scope: {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<EngineRequest>) => void,
  ): void;
  postMessage(message: EngineResponse): void;
} = self;

scope.addEventListener("message", (event: MessageEvent<EngineRequest>) => {
  void handleMessage(event.data);
});

async function handleMessage(request: EngineRequest): Promise<void> {
  if (request.type === "cancel") {
    if (activeJobs.has(request.jobId)) cancelled.add(request.jobId);
    return;
  }

  latestJobId = Math.max(latestJobId, request.jobId);
  activeJobs.add(request.jobId);
  try {
    if (request.type === "share-encode") {
      const encoded = await encodeBrotliJsonFragment(request.value);
      if (cancelled.has(request.jobId) || request.jobId < latestJobId) {
        const response: EngineResponse = {
          type: "cancelled",
          jobId: request.jobId,
        };
        scope.postMessage(response);
        return;
      }
      const response: EngineResponse = {
        type: "share-encoded",
        jobId: request.jobId,
        encoded,
      };
      scope.postMessage(response);
      return;
    }
    if (request.type === "share-decode") {
      const snapshot = await decodeSnapshotFragmentAsync(request.fragment);
      if (cancelled.has(request.jobId) || request.jobId < latestJobId) {
        const response: EngineResponse = {
          type: "cancelled",
          jobId: request.jobId,
        };
        scope.postMessage(response);
        return;
      }
      const response: EngineResponse = {
        type: "share-decoded",
        jobId: request.jobId,
        snapshot,
      };
      scope.postMessage(response);
      return;
    }

    const scene = await layoutWordCloudAsync(
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
    activeJobs.delete(request.jobId);
    cancelled.delete(request.jobId);
  }
}
