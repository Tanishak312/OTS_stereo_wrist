import { unstable_cache } from "next/cache";
import { kioskClient } from "./supabase";
import { estimateInventory, parseInventory, type Inventory } from "./inventory";

/** Full datasets include MCAP, so their sizes count it. Set on the server. */
const mcapOffered = () => process.env.OFFER_MCAP?.trim() === "true";

// Cached for 5 minutes: the index only changes when a new sheet is imported,
// and the kiosk shouldn't wait on Supabase for every visitor.
const loadLive = unstable_cache(
  async () => {
    const { data, error } = await kioskClient().rpc("ots_inventory");
    // Throw so a failure isn't cached; the caller falls back for this request only.
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return parseInventory(data);
  },
  ["ots-inventory"],
  { revalidate: 300 },
);

/** Live catalogue numbers, or the datasheet estimate (logged) if Supabase can't serve them. */
export async function loadInventory(): Promise<Inventory> {
  try {
    return { ...(await loadLive()), mcap: mcapOffered() };
  } catch (e) {
    const code = (e as { code?: string }).code;
    const hint = code === "PGRST202" ? " -> run supabase/005_inventory.sql" : "";
    // A warning, not an error: the kiosk still works, just on estimates.
    console.warn(`[inventory] falling back to datasheet estimate${hint}:`, e instanceof Error ? e.message : e);
    return { ...estimateInventory(), mcap: mcapOffered() };
  }
}
