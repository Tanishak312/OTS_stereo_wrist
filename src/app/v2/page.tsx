import type { Metadata } from "next";
import { Kiosk } from "@/components/kiosk/Kiosk";
import { InventoryProvider } from "@/components/kiosk/InventoryContext";
import { loadInventory } from "@/lib/inventory-server";
import { previewSlugs } from "@/lib/preview";
import { PreviewProvider } from "@/components/kiosk/Preview";

// The next version of the site, under review: the same kiosk, with the step 2 cards played
// as video thumbnails. Kept out of search results until it replaces "/".
export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

export default async function HomeV2() {
  return (
    <InventoryProvider value={await loadInventory()}>
      <PreviewProvider slugs={previewSlugs()}>
        <Kiosk variant="v2" />
      </PreviewProvider>
    </InventoryProvider>
  );
}
