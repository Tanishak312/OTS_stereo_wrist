import { Kiosk } from "@/components/kiosk/Kiosk";
import { InventoryProvider } from "@/components/kiosk/InventoryContext";
import { loadInventory } from "@/lib/inventory-server";

// Rendered on request, not at build time: the Docker build has no keys, so a page built
// then would carry the datasheet estimate. Supabase is still asked at most every 5
// minutes, see loadLive in inventory-server.ts.
export const dynamic = "force-dynamic";

export default async function Home() {
  return (
    <InventoryProvider value={await loadInventory()}>
      <Kiosk />
    </InventoryProvider>
  );
}
