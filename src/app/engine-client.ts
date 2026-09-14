import {
  layoutWordCloud,
  type LayoutOptions,
  type LayoutStyle,
} from "../core/layout";
import type { FontMetricsTable } from "../core/metrics";
import type { SceneModel } from "../core/scene";
import type { WordSet } from "../core/types";

export interface GenerateRequest {
  type: "generate";
  jobId: number;
  wordSet: WordSet;
  style: LayoutStyle;
  metrics: FontMetricsTable;
}

export interface CancelRequest {
  type: "cancel";
  jobId: number;
}

export type EngineRequest = GenerateRequest | CancelRequest;

export type EngineResponse =
  | { type: "success"; jobId: number; scene: SceneModel }
  | { type: "error"; jobId: number; message: string }
  | { type: "cancelled"; jobId: number };

export interface WorkerLike {
  onerror?: ((event: ErrorEvent) => void) | null;
  onmessageerror?: ((event: MessageEvent) => void) | null;
  postMessage(message: EngineRequest): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<EngineResponse>) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<EngineResponse>) => void,
  ): void;
  terminate?(): void;
}

export interface LayoutInput {
  wordSet: WordSet;
  style: LayoutStyle;
  metrics: FontMetricsTable;
}

export class EngineClient {
  private static readonly JOB_TIMEOUT_MS = 10_000;
  private nextJobId = 0;
  private active:
    | {
        jobId: number;
        reject: (error: Error) => void;
        listener: (event: MessageEvent<EngineResponse>) => void;
        timeoutId: ReturnType<typeof setTimeout>;
      }
    | undefined;

  public constructor(private readonly worker: WorkerLike) {
    this.worker.onerror = () => {
      this.rejectActive(new Error("layout worker failed"));
    };
    this.worker.onmessageerror = () => {
      this.rejectActive(new Error("layout worker message failed"));
    };
  }

  private rejectActive(error: Error): void {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    this.worker.removeEventListener("message", active.listener);
    clearTimeout(active.timeoutId);
    active.reject(error);
  }

  public submit(input: LayoutInput): Promise<SceneModel> {
    const jobId = ++this.nextJobId;
    if (this.active) {
      const active = this.active;
      this.rejectActive(new Error("superseded by a newer layout job"));
      try {
        this.worker.postMessage({ type: "cancel", jobId: active.jobId });
      } catch {
        // The active promise is already rejected; a dead worker needs no retry.
      }
    }

    return new Promise<SceneModel>((resolve, reject) => {
      const listener = (event: MessageEvent<EngineResponse>) => {
        if (event.data.jobId !== jobId) return;
        const active = this.active;
        if (!active || active.jobId !== jobId) return;
        this.active = undefined;
        this.worker.removeEventListener("message", listener);
        clearTimeout(active.timeoutId);
        if (event.data.type === "success") {
          resolve(event.data.scene);
        } else if (event.data.type === "error") {
          reject(new Error(event.data.message));
        } else {
          reject(new Error("layout job cancelled"));
        }
      };
      const timeoutId = setTimeout(() => {
        if (this.active?.jobId !== jobId) return;
        this.rejectActive(new Error("layout worker timed out"));
      }, EngineClient.JOB_TIMEOUT_MS);
      this.active = { jobId, reject, listener, timeoutId };
      try {
        this.worker.addEventListener("message", listener);
        this.worker.postMessage({ type: "generate", jobId, ...input });
      } catch (error) {
        this.rejectActive(
          error instanceof Error ? error : new Error("layout worker failed"),
        );
      }
    });
  }

  public cancel(): void {
    if (!this.active) return;
    const active = this.active;
    this.rejectActive(new Error("layout job cancelled"));
    try {
      this.worker.postMessage({ type: "cancel", jobId: active.jobId });
    } catch {
      // The active promise is already rejected; a dead worker needs no retry.
    }
  }

  public dispose(): void {
    this.cancel();
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
    this.worker.terminate?.();
  }
}

export function createBrowserEngineClient(): EngineClient | null {
  if (typeof Worker === "undefined") return null;
  try {
    const worker = new Worker(
      new URL("../workers/engine.worker.ts", import.meta.url),
      {
        type: "module",
      },
    );
    return new EngineClient(worker);
  } catch {
    return null;
  }
}

export function runLayoutFallback(
  input: LayoutInput,
  options: LayoutOptions = {},
): SceneModel {
  return layoutWordCloud(input.wordSet, input.style, input.metrics, options);
}
