import "server-only";

import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PredictionStorageEnvelope, PredictionStorageLayer, PredictionStorageStream } from "@/lib/storage/types";

const STORAGE_ROOT = path.join(process.cwd(), "data", "prediction");
const STATE_ROOT = path.join(STORAGE_ROOT, "state");
const STATE_LOCK_ROOT = path.join(STATE_ROOT, "locks");
const PROCESS_LOCKS = new Map<string, Promise<void>>();
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 50;
const LOCK_MAX_ATTEMPTS = 120;

function isoDay(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function filePathFor(layer: PredictionStorageLayer, stream: PredictionStorageStream, day: string) {
  return path.join(STORAGE_ROOT, layer, stream, `${day}.jsonl`);
}

function statePath(name: string) {
  return path.join(STATE_ROOT, `${name}.json`);
}

function stateLockPath(name: string) {
  return path.join(STATE_LOCK_ROOT, `${name}.lock`);
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function atomicWriteFile(filePath: string, contents: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, contents, "utf8");
  await rename(tempPath, filePath);
}

async function acquireFileLock(name: string) {
  const lockPath = stateLockPath(name);
  await mkdir(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      }));
      await handle.close();

      return async () => {
        await rm(lockPath, { force: true });
      };
    } catch {
      try {
        const details = await stat(lockPath);
        if (Date.now() - details.mtimeMs > LOCK_STALE_MS) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      await sleep(LOCK_RETRY_MS);
    }
  }

  throw new Error(`Timed out waiting for storage lock "${name}".`);
}

export async function withStorageStateWriter<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const prior = PROCESS_LOCKS.get(name) ?? Promise.resolve();

  let releaseProcessLock!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseProcessLock = resolve;
  });
  PROCESS_LOCKS.set(name, prior.finally(() => current));

  await prior.catch(() => undefined);
  const releaseFileLock = await acquireFileLock(name);

  try {
    return await fn();
  } finally {
    await releaseFileLock().catch(() => undefined);
    releaseProcessLock();
    if (PROCESS_LOCKS.get(name) === current) {
      PROCESS_LOCKS.delete(name);
    }
  }
}

export async function appendPredictionEvents<TPayload>(
  layer: PredictionStorageLayer,
  stream: PredictionStorageStream,
  events: Array<PredictionStorageEnvelope<TPayload>>,
) {
  if (!events.length) return;

  const byDay = new Map<string, string[]>();
  for (const event of events) {
    const day = isoDay(event.recordedAt);
    const row = `${JSON.stringify(event)}\n`;
    const next = byDay.get(day) ?? [];
    next.push(row);
    byDay.set(day, next);
  }

  for (const [day, rows] of byDay) {
    const filePath = filePathFor(layer, stream, day);
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, rows.join(""), "utf8");
  }
}

export async function readPredictionEventsForDay<TPayload>(
  layer: PredictionStorageLayer,
  stream: PredictionStorageStream,
  day: string,
): Promise<Array<PredictionStorageEnvelope<TPayload>>> {
  const filePath = filePathFor(layer, stream, day);
  try {
    const raw = await readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PredictionStorageEnvelope<TPayload>);
  } catch {
    return [];
  }
}

function enumerateDays(startMs: number, endMs: number) {
  const out: string[] = [];
  let cursor = new Date(startMs);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(endMs);
  end.setUTCHours(0, 0, 0, 0);

  while (cursor.getTime() <= end.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }

  return out;
}

export async function readPredictionEventsSince<TPayload>(
  layer: PredictionStorageLayer,
  stream: PredictionStorageStream,
  sinceMs: number,
): Promise<Array<PredictionStorageEnvelope<TPayload>>> {
  const days = enumerateDays(sinceMs, Date.now());
  const out: Array<PredictionStorageEnvelope<TPayload>> = [];

  for (const day of days) {
    const rows = await readPredictionEventsForDay<TPayload>(layer, stream, day);
    out.push(...rows.filter((row) => new Date(row.recordedAt).getTime() >= sinceMs));
  }

  return out;
}

export async function loadStorageState<TState>(name: string, fallback: TState): Promise<TState> {
  const filePath = statePath(name);
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as TState;
  } catch {
    return fallback;
  }
}

export async function saveStorageState<TState>(name: string, state: TState) {
  const filePath = statePath(name);
  await atomicWriteFile(filePath, JSON.stringify(state));
}
