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
  private nextJobId = 0;
  private active:
    | {
        jobId: number;
        reject: (error: Error) => void;
        listener: (event: MessageEvent<EngineResponse>) => void;
      }
    | undefined;

  public constructor(private readonly worker: WorkerLike) {}

  public submit(input: LayoutInput): Promise<SceneModel> {
    const jobId = ++this.nextJobId;
    if (this.active) {
      this.worker.removeEventListener("message", this.active.listener);
      this.active.reject(new Error("superseded by a newer layout job"));
      this.worker.postMessage({ type: "cancel", jobId: this.active.jobId });
    }

    return new Promise<SceneModel>((resolve, reject) => {
      const listener = (event: MessageEvent<EngineResponse>) => {
        if (event.data.jobId !== jobId) return;
        this.worker.removeEventListener("message", listener);
        this.active = undefined;
        if (event.data.type === "success") {
          resolve(event.data.scene);
        } else if (event.data.type === "error") {
          reject(new Error(event.data.message));
        } else {
          reject(new Error("layout job cancelled"));
        }
      };
      this.active = { jobId, reject, listener };
      this.worker.addEventListener("message", listener);
      this.worker.postMessage({ type: "generate", jobId, ...input });
    });
  }

  public cancel(): void {
    if (!this.active) return;
    const active = this.active;
    this.active = undefined;
    this.worker.removeEventListener("message", active.listener);
    this.worker.postMessage({ type: "cancel", jobId: active.jobId });
    active.reject(new Error("layout job cancelled"));
  }

  public dispose(): void {
    this.cancel();
    this.worker.terminate?.();
  }
}

export function createBrowserEngineClient(): EngineClient | null {
  if (typeof Worker === "undefined") return null;
  const worker = new Worker(
    new URL("../workers/engine.worker.ts", import.meta.url),
    {
      type: "module",
    },
  );
  return new EngineClient(worker);
}

export function runLayoutFallback(
  input: LayoutInput,
  options: LayoutOptions = {},
): SceneModel {
  return layoutWordCloud(input.wordSet, input.style, input.metrics, options);
}
