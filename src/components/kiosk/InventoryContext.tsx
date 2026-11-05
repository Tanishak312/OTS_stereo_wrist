"use client";

import { createContext, useContext } from "react";
import { estimateInventory, type Inventory } from "@/lib/inventory";

// The page loads the inventory on the server and hands it to every kiosk screen.
const InventoryContext = createContext<Inventory | null>(null);

export function InventoryProvider({ value, children }: { value: Inventory; children: React.ReactNode }) {
  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

let fallback: Inventory | null = null;

export function useInventory(): Inventory {
  // Without a provider (e.g. a component preview) use the estimate rather than crash.
  return useContext(InventoryContext) ?? (fallback ??= estimateInventory());
}
