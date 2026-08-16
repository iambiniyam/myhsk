import { createAuth } from "../../_shared/auth.js";

export async function onRequest(context) {
  if (!context.env.AUTH_DB || !context.env.BETTER_AUTH_SECRET) {
    return Response.json({ message: "Account service is not configured." }, { status: 503 });
  }
  return createAuth(context).handler(context.request);
}

