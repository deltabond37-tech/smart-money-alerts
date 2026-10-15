"use server";
import { redirect } from "next/navigation";
import { WebClient } from "@slack/web-api";
import { formatTestMessage } from "@sma/core";
import { slackChannels } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function sendTestAlert(formData: FormData): Promise<void> {
  const key = String(formData.get("channel") ?? "") as keyof ReturnType<typeof slackChannels>;
  const channels = slackChannels();
  const channel = channels[key];
  if (!channel) redirect("/health?error=Unknown%20channel");
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) redirect("/health?error=SLACK_BOT_TOKEN%20is%20not%20set%20on%20the%20dashboard");

  // Only signed-in users may trigger this (middleware guards the page; double-check here for the action).
  const sb = await createClient();
  const { data } = await sb.auth.getClaims();
  if (!data?.claims) redirect("/login");

  try {
    const msg = formatTestMessage(`${key} (${channel})`, `dashboard by ${data.claims.email ?? "user"}`);
    const res = await new WebClient(token).chat.postMessage({ channel, text: msg.text, blocks: msg.blocks as never });
    if (!res.ok) throw new Error(res.error ?? "unknown");
    redirect(`/health?ok=${encodeURIComponent(`Test message posted to ${channel}`)}`);
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    redirect(`/health?error=${encodeURIComponent(`Slack error: ${e instanceof Error ? e.message : String(e)}`)}`);
  }
}
