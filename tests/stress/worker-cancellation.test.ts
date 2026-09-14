import { describe, expect, it } from "vitest";
import {
  EngineClient,
  type EngineRequest,
  type EngineResponse,
} from "../../src/app/engine-client";
import { snapshotLayoutInput, snapshotScene } from "../fixtures/snapshots";

class RapidWorker {
  public readonly cancelled: number[] = [];
  private readonly listeners = new Set<
    (event: MessageEvent<EngineResponse>) => void
  >();

  public addEventListener(
    _type: "message",
    listener: (event: MessageEvent<EngineResponse>) => void,
  ): void {
    this.listeners.add(listener);
  }

  public removeEventListener(
    _type: "message",
    listener: (event: MessageEvent<EngineResponse>) => void,
  ): void {
    this.listeners.delete(listener);
  }

  public postMessage(request: EngineRequest): void {
    if (request.type === "cancel") {
      this.cancelled.push(request.jobId);
      return;
    }
    queueMicrotask(() => {
      const response: EngineResponse = {
        type: "success",
        jobId: request.jobId,
        scene: snapshotScene,
      };
      for (const listener of this.listeners)
        listener({ data: response } as MessageEvent<EngineResponse>);
    });
  }
}

describe("latest-job-wins cancellation", () => {
  it("settles a 1,000-job burst with only the newest scene", async () => {
    const worker = new RapidWorker();
    const client = new EngineClient(worker);
    const jobs = Array.from({ length: 1000 }, () =>
      client.submit(snapshotLayoutInput).then(
        () => "success",
        (error: Error) => error.message,
      ),
    );
    const results = await Promise.all(jobs);

    expect(results.at(-1)).toBe("success");
    expect(
      results.slice(0, -1).every((result) => result.includes("superseded")),
    ).toBe(true);
    expect(worker.cancelled).toHaveLength(999);
    client.dispose();
  });
});
