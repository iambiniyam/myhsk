import { authAvailability } from "../_shared/auth.js";

export function onRequestGet({ env }) {
  return Response.json(authAvailability(env), {
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
