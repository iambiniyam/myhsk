import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? undefined : window.location.origin,
  fetchOptions: { credentials: "same-origin" },
});

export interface AuthAvailability {
  email: boolean;
  google: boolean;
}

export interface AuthSessionData {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image?: string | null;
  };
  session: {
    id: string;
    token: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  };
}

export async function loadAuthAvailability(): Promise<AuthAvailability> {
  const response = await fetch("/api/auth-config", { credentials: "same-origin" });
  if (!response.ok) return { email: false, google: false };
  return response.json() as Promise<AuthAvailability>;
}

