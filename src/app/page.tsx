import { Kiosk } from "@/components/kiosk/Kiosk";
import { InventoryProvider } from "@/components/kiosk/InventoryContext";
import { loadInventory } from "@/lib/inventory-server";
import { previewSlugs } from "@/lib/preview";
import { PreviewProvider } from "@/components/kiosk/Preview";

// Rendered on request, not at build time: the Docker build has no keys, so a page built
// then would carry the datasheet estimate. Supabase is still asked at most every 5
// minutes, see loadLive in inventory-server.ts.
export const dynamic = "force-dynamic";

export default async function Home() {
  return (
    <InventoryProvider value={await loadInventory()}>
      {/* Only which environment types have a preview crosses to the browser, never where the videos live. */}
      <PreviewProvider slugs={previewSlugs()}>
        <Kiosk />
      </PreviewProvider>
    </InventoryProvider>
  );
}
