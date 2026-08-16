import { authenticatedUser } from "../_shared/auth.js";

const MAX_BYTES = 3_000_000;

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

async function currentProgress(database, userId) {
  const row = await database.prepare(
    "SELECT state_json, revision, updated_at FROM user_progress WHERE user_id = ?1",
  ).bind(userId).first();
  if (!row) return null;
  try {
    return {
      state: JSON.parse(row.state_json),
      revision: Number(row.revision),
      updatedAt: new Date(Number(row.updated_at) * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

export async function onRequestGet(context) {
  const user = await authenticatedUser(context);
  if (!user) return json({ error: "Sign in to access synchronized progress." }, 401);
  return json({ progress: await currentProgress(context.env.AUTH_DB, user.id) });
}

export async function onRequestPut(context) {
  if (!sameOrigin(context.request)) return json({ error: "Invalid request origin." }, 403);
  const contentLength = Number(context.request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_BYTES) return json({ error: "Progress data is too large." }, 413);

  const user = await authenticatedUser(context);
  if (!user) return json({ error: "Sign in to synchronize progress." }, 401);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid progress data." }, 400);
  }
  const state = body?.state;
  const baseRevision = Number(body?.baseRevision);
  if (!state || typeof state !== "object" || Array.isArray(state) || !state.mastery || !state.preferences || !Number.isInteger(baseRevision) || baseRevision < 0) {
    return json({ error: "Invalid progress data." }, 400);
  }
  const stateJson = JSON.stringify(state);
  if (new TextEncoder().encode(stateJson).byteLength > MAX_BYTES) return json({ error: "Progress data is too large." }, 413);

  if (baseRevision === 0) {
    const inserted = await context.env.AUTH_DB.prepare(
      "INSERT OR IGNORE INTO user_progress (user_id, state_json, revision, updated_at) VALUES (?1, ?2, 1, unixepoch()) RETURNING revision, updated_at",
    ).bind(user.id, stateJson).first();
    if (inserted) return json({ revision: Number(inserted.revision), updatedAt: new Date(Number(inserted.updated_at) * 1000).toISOString() });
  } else {
    const updated = await context.env.AUTH_DB.prepare(
      "UPDATE user_progress SET state_json = ?2, revision = revision + 1, updated_at = unixepoch() WHERE user_id = ?1 AND revision = ?3 RETURNING revision, updated_at",
    ).bind(user.id, stateJson, baseRevision).first();
    if (updated) return json({ revision: Number(updated.revision), updatedAt: new Date(Number(updated.updated_at) * 1000).toISOString() });
  }

  return json({ error: "Progress changed on another device.", progress: await currentProgress(context.env.AUTH_DB, user.id) }, 409);
}

export function onRequestPost() {
  return json({ error: "Method not allowed." }, 405);
}

