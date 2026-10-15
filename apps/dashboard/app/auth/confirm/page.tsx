"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Magic-link landing (implicit flow). Supabase redirects here with the session in the URL fragment
 * (#access_token=…&refresh_token=…). We store it as the normal cookie session and continue.
 * Works even when the link is opened on a different device than the one that requested it.
 * Links carrying ?code= or ?token_hash= are forwarded to the server-side /auth/callback handler.
 */
export default function ConfirmPage() {
  const router = useRouter();
  const [status, setStatus] = useState("Signing you in…");

  useEffect(() => {
    const run = async () => {
      const url = new URL(window.location.href);
      const next = url.searchParams.get("next") ?? "/events";
      const safeNext = next.startsWith("/") ? next : "/events";

      if (url.searchParams.get("code") || url.searchParams.get("token_hash")) {
        window.location.replace(`/auth/callback${url.search}`);
        return;
      }

      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
      const errorDesc = hash.get("error_description") ?? url.searchParams.get("error_description");
      if (errorDesc) {
        router.replace(`/login?error=${encodeURIComponent(errorDesc)}`);
        return;
      }
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      if (!accessToken || !refreshToken) {
        router.replace("/login?error=Invalid%20or%20expired%20sign-in%20link");
        return;
      }
      // Remove tokens from the address bar / history before doing anything else.
      window.history.replaceState(null, "", url.pathname + url.search);

      const supabase = createClient();
      const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (error) {
        router.replace(`/login?error=${encodeURIComponent(error.message)}`);
        return;
      }
      setStatus("Signed in. Redirecting…");
      window.location.replace(safeNext);
    };
    void run();
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <p className="text-sm text-zinc-400">{status}</p>
    </main>
  );
}
