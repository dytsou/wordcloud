import { encodeJsonFragment } from "../../src/core/codec";
import { LIMITS } from "../../src/core/limits";
import { createSnapshot, type SnapshotPayload } from "../../src/core/snapshot";
import { snapshotScene, snapshotStyle, snapshotWordSet } from "./snapshots";

export const validSnapshot = createSnapshot(
  snapshotWordSet,
  snapshotStyle,
  snapshotScene,
);

export interface HostileSnapshotCase {
  name: string;
  payload: unknown;
}

export const hostileSnapshotCases: HostileSnapshotCase[] = [
  {
    name: "unknown top-level field",
    payload: withMutation((snapshot) => {
      snapshot.unexpected = true;
    }),
  },
  {
    name: "external background",
    payload: withMutation((snapshot) => {
      snapshot.presentation.background = "url(https://evil.example)";
    }),
  },
  {
    name: "external font",
    payload: withMutation((snapshot) => {
      snapshot.presentation.fontFamily = "url(https://evil.example/font)";
    }),
  },
  {
    name: "oversized word list",
    payload: withMutation((snapshot) => {
      snapshot.wordSet.words = Array.from(
        { length: LIMITS.maxUniqueTerms + 1 },
        (_, index) => ({
          ...snapshot.wordSet.words[0],
          term: `word-${index}`,
          rank: index + 1,
        }),
      );
    }),
  },
  {
    name: "control character in term",
    payload: withMutation((snapshot) => {
      snapshot.wordSet.words[0].term = "hello\u0000world";
      snapshot.scene.words[0].term = "hello\u0000world";
    }),
  },
  {
    name: "scene word without reason",
    payload: withMutation((snapshot) => {
      snapshot.scene.words[0].status = "unplaceable";
      delete snapshot.scene.words[0].reason;
    }),
  },
  {
    name: "oversized literal term",
    payload: withMutation((snapshot) => {
      const term = "x".repeat(LIMITS.maxLiteralScalars + 1);
      snapshot.wordSet.words[0].term = term;
      snapshot.scene.words[0].term = term;
    }),
  },
];

export function encodeHostileSnapshot(payload: unknown): string {
  return encodeJsonFragment(payload).fragment;
}

export function withMutation(
  mutate: (snapshot: SnapshotPayload & { unexpected?: boolean }) => void,
): SnapshotPayload {
  const snapshot = structuredClone(validSnapshot) as SnapshotPayload & {
    unexpected?: boolean;
  };
  mutate(snapshot);
  return snapshot as SnapshotPayload;
}
