import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { ensureSecureDir } from "./secure-dir";

// Registry of mobile devices paired to user accounts. The pair endpoint
// inserts a row here and embeds the deviceId in the JWT it returns; verifyJwt
// rejects tokens whose device has been revoked or deleted.

const DATA_DIR = path.join(process.cwd(), "data");
const DEVICES_FILE = path.join(DATA_DIR, "devices.json");

export interface Device {
  id: string;
  userId: string;
  username: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
}

let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(fn, fn);
  writeLock = next.then(
    () => {},
    () => {}
  );
  return next;
}

function readAll(): Device[] {
  try {
    const raw = fs.readFileSync(DEVICES_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Device[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries: Device[]): void {
  ensureSecureDir(DATA_DIR);
  const tmp = DEVICES_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DEVICES_FILE);
}

export type RegisterDeviceInput = {
  userId: string;
  username: string;
  name: string;
};

export function registerDevice(input: RegisterDeviceInput): Promise<Device> {
  return withLock(async () => {
    const now = Date.now();
    const device: Device = {
      id: `dvc_${crypto.randomBytes(12).toString("base64url")}`,
      userId: input.userId,
      username: input.username,
      name: input.name.slice(0, 120),
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
    };
    const entries = readAll();
    entries.push(device);
    writeAll(entries);
    return device;
  });
}

export function listDevicesForUser(userId: string): Device[] {
  return readAll().filter((d) => d.userId === userId);
}

export function getDevice(deviceId: string): Device | null {
  return readAll().find((d) => d.id === deviceId) ?? null;
}

export function isDeviceActive(deviceId: string): boolean {
  const d = getDevice(deviceId);
  return !!d && d.revokedAt === null;
}

export function revokeDevice(deviceId: string, userId: string): Promise<boolean> {
  return withLock(async () => {
    const entries = readAll();
    const idx = entries.findIndex((d) => d.id === deviceId && d.userId === userId);
    if (idx === -1) return false;
    const device = entries[idx]!;
    if (device.revokedAt !== null) return true;
    device.revokedAt = Date.now();
    entries[idx] = device;
    writeAll(entries);
    return true;
  });
}

export function touchDevice(deviceId: string): void {
  // Best-effort; called from hot paths so don't await.
  void withLock(async () => {
    const entries = readAll();
    const idx = entries.findIndex((d) => d.id === deviceId);
    if (idx === -1) return;
    entries[idx]!.lastSeenAt = Date.now();
    writeAll(entries);
  });
}
