import { describe, expect, it } from "vitest";
import { EngineClient } from "../../src/app/engine-client";
import type {
  EngineRequest,
  EngineResponse,
} from "../../src/app/engine-client";

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

describe("EngineClient", () => {
  it("rejects a stale result when a newer job is submitted", async () => {
    const client = new EngineClient(new FakeWorker());
    const first = client
      .submit({} as never)
      .catch((error: Error) => error.message);
    const second = client
      .submit({} as never)
      .catch((error: Error) => error.message);

    await expect(first).resolves.toContain("superseded");
    await expect(second).resolves.toBe("fake worker response");
  });
});
