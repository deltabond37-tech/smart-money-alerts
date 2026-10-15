"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { isEmailAllowed, publicEnv } from "@/lib/env";

/**
 * Sends the magic link using the implicit flow (no PKCE verifier bound to this browser), so the link
 * can be opened from any device or mail app. The link lands on /auth/confirm, which stores the session.
 */
export async function sendMagicLink(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = String(formData.get("next") ?? "/events");
  if (!email) redirect("/login?error=Email%20required");
  if (!isEmailAllowed(email)) redirect("/login?error=This%20email%20is%20not%20allowed");

  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const { url, key } = publicEnv();
  const supabase = createPlainClient(url, key, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const safeNext = next.startsWith("/") ? next : "/events";
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(safeNext)}` },
  });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect("/login?sent=1");
}
