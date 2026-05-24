import { NextRequest, NextResponse } from "next/server";
import { getUserScoping } from "@/lib/session-scope";
import { listDevicesForUser, revokeDevice } from "@/lib/devices";
import { audit } from "@/lib/audit-log";

// GET /api/auth/devices — list paired devices for the current user
// DELETE /api/auth/devices?id=dvc_... — revoke a device

function requireUserId(req: NextRequest): string | null {
  const id = req.headers.get("x-user-id");
  return id && id.length ? id : null;
}

export async function GET(req: NextRequest) {
  const { hasIdentity } = getUserScoping(req.headers);
  if (!hasIdentity) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const userId = requireUserId(req) ?? "single-user";
  const devices = listDevicesForUser(userId).map((d) => ({
    id: d.id,
    name: d.name,
    createdAt: d.createdAt,
    lastSeenAt: d.lastSeenAt,
    revokedAt: d.revokedAt,
  }));
  return NextResponse.json({ devices });
}

export async function DELETE(req: NextRequest) {
  const { hasIdentity } = getUserScoping(req.headers);
  if (!hasIdentity) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const deviceId = req.nextUrl.searchParams.get("id");
  if (!deviceId) {
    return NextResponse.json({ error: "Missing device id" }, { status: 400 });
  }
  const userId = requireUserId(req) ?? "single-user";
  const ok = await revokeDevice(deviceId, userId);
  if (!ok) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }
  audit("device_revoked", {
    username: req.headers.get("x-username") ?? undefined,
    detail: deviceId,
  });
  return NextResponse.json({ success: true });
}
