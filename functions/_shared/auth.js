import { betterAuth } from "better-auth";

const PROD_ORIGINS = ["https://myhsk.cc", "https://www.myhsk.cc"];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;",
  })[character]);
}

function emailDocument({ title, intro, action, url, note }) {
  return `<!doctype html><html><body style="margin:0;background:#f3f0e8;color:#1c2922;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:34px 18px"><div style="background:#fffdf8;border:1px solid #ded8ca;border-radius:22px;padding:30px"><div style="font-size:26px;font-weight:800">MyHSK <span style="color:#247153">汉</span></div><h1 style="margin:28px 0 12px;font-size:26px">${escapeHtml(title)}</h1><p style="font-size:16px;line-height:1.6;color:#59645e">${escapeHtml(intro)}</p><a href="${escapeHtml(url)}" style="display:inline-block;margin:14px 0 22px;padding:14px 20px;border-radius:12px;background:#1c2922;color:white;text-decoration:none;font-weight:700">${escapeHtml(action)}</a><p style="font-size:12px;line-height:1.6;color:#7b837e">${escapeHtml(note)}</p></div></div></body></html>`;
}

async function deliverEmail(env, message) {
  if (!env.RESEND_API_KEY) throw new Error("Transactional email is not configured.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.AUTH_EMAIL_FROM || "MyHSK <accounts@myhsk.cc>",
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });
  if (!response.ok) throw new Error(`Email provider rejected the request (${response.status}).`);
}

function queueEmail(context, promise) {
  context.waitUntil(promise.catch((error) => {
    console.error("Authentication email failed", error instanceof Error ? error.message : String(error));
  }));
}

export function authAvailability(env) {
  return {
    email: Boolean(env.RESEND_API_KEY),
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  };
}

export function createAuth(context) {
  const { env, request } = context;
  const requestOrigin = new URL(request.url).origin;
  const baseURL = env.BETTER_AUTH_URL || requestOrigin;
  const availability = authAvailability(env);
  const socialProviders = availability.google ? {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      prompt: "select_account",
    },
  } : {};

  return betterAuth({
    appName: "MyHSK",
    baseURL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: env.AUTH_DB,
    trustedOrigins: [...new Set([requestOrigin, baseURL, ...PROD_ORIGINS, "http://localhost:5173", "http://127.0.0.1:5173"])],
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: availability.email,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => queueEmail(context, deliverEmail(env, {
        to: user.email,
        subject: "Reset your MyHSK password",
        html: emailDocument({
          title: "Reset your password",
          intro: `Hello ${user.name || "learner"}. Use the button below to choose a new password.`,
          action: "Reset password",
          url,
          note: "This link expires in one hour. If you did not request it, you can ignore this email.",
        }),
        text: `Reset your MyHSK password: ${url}`,
      })),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }) => queueEmail(context, deliverEmail(env, {
        to: user.email,
        subject: "Verify your MyHSK account",
        html: emailDocument({
          title: "Save your learning progress",
          intro: `Hello ${user.name || "learner"}. Verify this address to securely sync your words, characters, and study history.`,
          action: "Verify email",
          url,
          note: "This link expires in one hour. If you did not create a MyHSK account, you can ignore this email.",
        }),
        text: `Verify your MyHSK account: ${url}`,
      })),
    },
    socialProviders,
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        allowDifferentEmails: false,
      },
    },
    user: {
      deleteUser: { enabled: true },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60 * 5, max: 3 },
      },
    },
    advanced: {
      useSecureCookies: requestOrigin.startsWith("https://"),
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
        ipv6Subnet: 64,
      },
    },
    experimental: { joins: true },
  });
}

export async function authenticatedUser(context) {
  if (!context.env.AUTH_DB || !context.env.BETTER_AUTH_SECRET) return null;
  const auth = createAuth(context);
  const session = await auth.api.getSession({ headers: context.request.headers });
  return session?.user ?? null;
}
