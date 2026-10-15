"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const TIERS = new Set(["A", "B", "C"]);

function fail(msg: string): never {
  redirect(`/wallets?error=${encodeURIComponent(msg)}`);
}

export async function createWallet(formData: FormData): Promise<void> {
  const address = String(formData.get("address") ?? "").trim().toLowerCase();
  const label = String(formData.get("label") ?? "").trim();
  const tier = String(formData.get("tier") ?? "C");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!ADDR.test(address)) fail("Invalid address (expected 0x + 40 hex chars)");
  if (!label) fail("Label is required");
  if (!TIERS.has(tier)) fail("Tier must be A, B or C");
  const sb = await createClient();
  const { error } = await sb.from("wallets").insert({ address, label, tier, notes, is_priority: formData.get("is_priority") === "on" });
  if (error) fail(error.message);
  revalidatePath("/wallets");
  redirect("/wallets?ok=Wallet%20added");
}

export async function updateWallet(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const tier = String(formData.get("tier") ?? "C");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const overridesRaw = String(formData.get("overrides") ?? "").trim();
  let overrides: unknown = {};
  if (overridesRaw) {
    try {
      overrides = JSON.parse(overridesRaw);
    } catch {
      fail("Overrides must be valid JSON");
    }
  }
  if (!label || !TIERS.has(tier)) fail("Label and tier are required");
  const sb = await createClient();
  const { error } = await sb.from("wallets").update({ label, tier, notes, overrides }).eq("id", id);
  if (error) fail(error.message);
  revalidatePath("/wallets");
  redirect("/wallets?ok=Saved");
}

export async function toggleWallet(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const field = String(formData.get("field") ?? "");
  const value = formData.get("value") === "true";
  if (!["is_active", "is_priority", "muted"].includes(field)) fail("Bad field");
  const sb = await createClient();
  const { error } = await sb.from("wallets").update({ [field]: value }).eq("id", id);
  if (error) fail(error.message);
  revalidatePath("/wallets");
}

export async function deleteWallet(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const sb = await createClient();
  const { error } = await sb.from("wallets").delete().eq("id", id);
  if (error) fail(error.message);
  revalidatePath("/wallets");
  redirect("/wallets?ok=Deleted");
}

/** CSV: address,label,tier[,priority][,notes]  (header row optional; tier defaults to C) */
export async function importCsv(formData: FormData): Promise<void> {
  let text = String(formData.get("csv") ?? "");
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) text = await file.text();
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const rows: Array<{ address: string; label: string; tier: string; is_priority: boolean; notes: string | null }> = [];
  const bad: string[] = [];
  for (const line of lines) {
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const [address = "", label = "", tier = "C", priority = "", notes = ""] = cols;
    if (address.toLowerCase() === "address") continue; // header
    if (!ADDR.test(address)) {
      bad.push(line);
      continue;
    }
    rows.push({
      address: address.toLowerCase(),
      label: label || `Wallet ${address.slice(0, 6)}`,
      tier: TIERS.has(tier.toUpperCase()) ? tier.toUpperCase() : "C",
      is_priority: ["1", "true", "yes", "y"].includes(priority.toLowerCase()),
      notes: notes || null,
    });
  }
  if (rows.length === 0) fail(`No valid rows${bad.length ? ` (${bad.length} invalid)` : ""}`);
  const sb = await createClient();
  const { error } = await sb.from("wallets").upsert(rows, { onConflict: "address", ignoreDuplicates: false });
  if (error) fail(error.message);
  revalidatePath("/wallets");
  redirect(`/wallets?ok=${encodeURIComponent(`Imported ${rows.length} wallet(s)${bad.length ? `, skipped ${bad.length} invalid line(s)` : ""}`)}`);
}
