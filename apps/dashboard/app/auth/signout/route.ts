import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { origin, searchParams } = new URL(request.url);
  const supabase = await createClient();
  await supabase.auth.signOut();
  const reason = searchParams.get("reason");
  const q = reason === "not_allowed" ? "?error=Your%20account%20is%20not%20on%20the%20allowlist" : "";
  return NextResponse.redirect(`${origin}/login${q}`);
}

export const POST = GET;
