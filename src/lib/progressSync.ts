import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AppState, AttemptRecord, MasteryRecord, WordListRecord } from "../types";
import { normalizeState } from "./storage";

export type SyncStatus = "guest" | "connecting" | "syncing" | "saved" | "offline" | "error";

export interface ProgressSyncState {
  status: SyncStatus;
  updatedAt?: string;
  message?: string;
}

interface CloudProgress {
  state: AppState;
  revision: number;
  updatedAt: string;
}

function time(value?: string): number {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestMastery(local?: MasteryRecord, cloud?: MasteryRecord): MasteryRecord | undefined {
  if (!local) return cloud;
  if (!cloud) return local;
  return time(local.lastSeenAt) >= time(cloud.lastSeenAt) ? local : cloud;
}

function latestWordList(local?: WordListRecord, cloud?: WordListRecord): WordListRecord | undefined {
  if (!local) return cloud;
  if (!cloud) return local;
  return time(local.updatedAt) >= time(cloud.updatedAt) ? local : cloud;
}

function activityTime(state: AppState): number {
  return Object.values(state.wordLists).reduce((latest, record) => Math.max(latest, time(record.updatedAt)), Math.max(
    time(state.learning.lastRoundAt),
    time(state.attempts[state.attempts.length - 1]?.at),
  ));
}

function attemptIdentity(attempt: AttemptRecord): string {
  return `${attempt.at}|${attempt.key}|${attempt.skill}|${attempt.score}`;
}

export function mergeProgress(localInput: AppState, cloudInput: AppState): AppState {
  const local = normalizeState(localInput);
  const cloud = normalizeState(cloudInput);
  const mastery: Record<string, MasteryRecord> = {};
  for (const key of new Set([...Object.keys(local.mastery), ...Object.keys(cloud.mastery)])) {
    const record = latestMastery(local.mastery[key], cloud.mastery[key]);
    if (record) mastery[key] = record;
  }
  const wordLists: Record<string, WordListRecord> = {};
  for (const word of new Set([...Object.keys(local.wordLists), ...Object.keys(cloud.wordLists)])) {
    const record = latestWordList(local.wordLists[word], cloud.wordLists[word]);
    if (record) wordLists[word] = record;
  }
  const attemptIds = new Set<string>();
  const attempts = [...local.attempts, ...cloud.attempts]
    .filter((attempt) => {
      const id = attemptIdentity(attempt);
      if (attemptIds.has(id)) return false;
      attemptIds.add(id);
      return true;
    })
    .sort((a, b) => time(a.at) - time(b.at))
    .slice(-5000);
  const newer = activityTime(local) >= activityTime(cloud) ? local : cloud;
  const recent = (left: string[], right: string[], limit: number) => [...new Set([...left, ...right])].slice(0, limit);

  return {
    ...newer,
    version: 4,
    mastery,
    wordLists,
    attempts,
    sessionHistory: { ...cloud.sessionHistory, ...local.sessionHistory },
    streak: {
      ...(time(local.streak.lastStudyDate) >= time(cloud.streak.lastStudyDate) ? local.streak : cloud.streak),
      current: Math.max(local.streak.current, cloud.streak.current),
      best: Math.max(local.streak.best, cloud.streak.best),
      lastStudyDate: time(local.streak.lastStudyDate) >= time(cloud.streak.lastStudyDate) ? local.streak.lastStudyDate : cloud.streak.lastStudyDate,
    },
    learning: {
      roundsCompleted: Math.max(local.learning.roundsCompleted, cloud.learning.roundsCompleted),
      totalWords: Math.max(local.learning.totalWords, cloud.learning.totalWords),
      totalCharacters: Math.max(local.learning.totalCharacters, cloud.learning.totalCharacters),
      totalSentences: Math.max(local.learning.totalSentences, cloud.learning.totalSentences),
      recentWords: recent(local.learning.recentWords, cloud.learning.recentWords, 180),
      recentCharacters: recent(local.learning.recentCharacters, cloud.learning.recentCharacters, 180),
      recentNetworks: recent(local.learning.recentNetworks, cloud.learning.recentNetworks, 80),
      lastRoundAt: time(local.learning.lastRoundAt) >= time(cloud.learning.lastRoundAt) ? local.learning.lastRoundAt : cloud.learning.lastRoundAt,
    },
  };
}

async function getCloudProgress(signal?: AbortSignal): Promise<CloudProgress | null> {
  const response = await fetch("/api/progress", { credentials: "same-origin", signal });
  if (response.status === 401) throw new Error("signed-out");
  if (!response.ok) throw new Error("Progress could not be loaded.");
  const body = await response.json() as { progress: CloudProgress | null };
  return body.progress ? { ...body.progress, state: normalizeState(body.progress.state) } : null;
}

async function putCloudProgress(state: AppState, baseRevision: number): Promise<{ revision: number; updatedAt: string; conflict?: CloudProgress }> {
  const response = await fetch("/api/progress", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, baseRevision }),
  });
  const body = await response.json() as { revision?: number; updatedAt?: string; progress?: CloudProgress; error?: string };
  if (response.status === 409 && body.progress) return { revision: body.progress.revision, updatedAt: body.progress.updatedAt, conflict: { ...body.progress, state: normalizeState(body.progress.state) } };
  if (!response.ok || body.revision === undefined || !body.updatedAt) throw new Error(body.error || "Progress could not be saved.");
  return { revision: body.revision, updatedAt: body.updatedAt };
}

export function useProgressSync(userId: string | undefined, state: AppState, setState: Dispatch<SetStateAction<AppState>>): ProgressSyncState {
  const [sync, setSync] = useState<ProgressSyncState>({ status: userId ? "connecting" : "guest" });
  const stateRef = useRef(state);
  const revisionRef = useRef(0);
  const readyRef = useRef(false);
  const userRef = useRef<string | undefined>(undefined);
  stateRef.current = state;

  useEffect(() => {
    readyRef.current = false;
    revisionRef.current = 0;
    userRef.current = userId;
    if (!userId) {
      setSync({ status: "guest" });
      return;
    }
    const controller = new AbortController();
    setSync({ status: "connecting" });
    void (async () => {
      try {
        const cloud = await getCloudProgress(controller.signal);
        if (controller.signal.aborted || userRef.current !== userId) return;
        let merged = cloud ? mergeProgress(stateRef.current, cloud.state) : stateRef.current;
        revisionRef.current = cloud?.revision ?? 0;
        if (JSON.stringify(merged) !== JSON.stringify(stateRef.current)) setState(merged);
        let saved = await putCloudProgress(merged, revisionRef.current);
        if (saved.conflict) {
          merged = mergeProgress(merged, saved.conflict.state);
          setState(merged);
          saved = await putCloudProgress(merged, saved.conflict.revision);
        }
        revisionRef.current = saved.revision;
        readyRef.current = true;
        setSync({ status: "saved", updatedAt: saved.updatedAt });
      } catch (error) {
        if (controller.signal.aborted) return;
        const offline = !navigator.onLine;
        setSync({ status: offline ? "offline" : "error", message: error instanceof Error ? error.message : "Progress sync failed." });
      }
    })();
    return () => controller.abort();
  }, [setState, userId]);

  useEffect(() => {
    if (!userId || !readyRef.current) return;
    setSync((current) => ({ ...current, status: navigator.onLine ? "syncing" : "offline" }));
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          let nextState = stateRef.current;
          let saved = await putCloudProgress(nextState, revisionRef.current);
          if (saved.conflict) {
            nextState = mergeProgress(nextState, saved.conflict.state);
            setState(nextState);
            saved = await putCloudProgress(nextState, saved.conflict.revision);
          }
          revisionRef.current = saved.revision;
          setSync({ status: "saved", updatedAt: saved.updatedAt });
        } catch (error) {
          setSync({ status: navigator.onLine ? "error" : "offline", message: error instanceof Error ? error.message : "Progress sync failed." });
        }
      })();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [state, setState, userId]);

  return sync;
}
