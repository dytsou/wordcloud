import { describe, expect, it, vi } from "vitest";
import {
  createBrowserEngineClient,
  EngineClient,
} from "../../src/app/engine-client";
import type {
  EngineRequest,
  EngineResponse,
} from "../../src/app/engine-client";
import { snapshotLayoutInput } from "../fixtures/snapshots";

class FakeWorker {
  private listener: ((event: MessageEvent<EngineResponse>) => void) | undefined;

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<EngineResponse>) => void,
  ) {
    this.listener = listener;
  }

  removeEventListener() {
    this.listener = undefined;
  }

  postMessage(request: EngineRequest) {
    if (request.type === "cancel") return;
    queueMicrotask(() => {
      this.listener?.({
        data: {
          type: "error",
          jobId: request.jobId,
          message: "fake worker response",
        },
      } as MessageEvent<EngineResponse>);
    });
  }
}

class ErrorWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;

  // biome-ignore lint/suspicious/noEmptyBlockStatements: This worker stub has no event listeners.
  addEventListener() {}

  // biome-ignore lint/suspicious/noEmptyBlockStatements: This worker stub has no event listeners.
  removeEventListener() {}

  postMessage(request: EngineRequest) {
    if (request.type === "generate")
      queueMicrotask(() =>
        this.onerror?.({ message: "worker crashed" } as ErrorEvent),
      );
  }
}

describe("EngineClient", () => {
  it("rejects a stale result when a newer job is submitted", async () => {
    const client = new EngineClient(new FakeWorker());
    const first = client
      .submit(snapshotLayoutInput)
      .catch((error: Error) => error.message);
    const second = client
      .submit(snapshotLayoutInput)
      .catch((error: Error) => error.message);

    await expect(first).resolves.toContain("superseded");
    await expect(second).resolves.toBe("fake worker response");
  });

  it("rejects the active job when the native worker reports an error", async () => {
    const client = new EngineClient(new ErrorWorker());

    await expect(client.submit(snapshotLayoutInput)).rejects.toThrow(
      "layout worker failed",
    );
    client.dispose();
  });

  it("falls back when Worker construction throws", () => {
    class ThrowingWorker {
      public constructor() {
        throw new Error("worker unavailable");
      }
    }
    vi.stubGlobal("Worker", ThrowingWorker);

    expect(createBrowserEngineClient()).toBeNull();

    vi.unstubAllGlobals();
  });
});
