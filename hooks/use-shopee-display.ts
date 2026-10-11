"use client";

import { useSyncExternalStore } from "react";

const EVENT = "maxius-shopee-display";
const DENSITY_KEY = "maxius.shopee.density";
const THRESHOLD_KEY = "maxius.shopee.lowStockThreshold";

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(EVENT, listener);
  };
}

function read(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { return; }
  window.dispatchEvent(new Event(EVENT));
}

function thresholdSnapshot() {
  const value = read(THRESHOLD_KEY);
  const number = Number(value);
  return value !== null && Number.isInteger(number) && number >= 0 && number <= 1_000_000 ? number : 10;
}

export function useShopeeDisplay() {
  const density = useSyncExternalStore(subscribe, () => read(DENSITY_KEY) === "compact" ? "compact" : "comfortable", () => "comfortable");
  const threshold = useSyncExternalStore(subscribe, thresholdSnapshot, () => 10);
  return {
    density, threshold,
    setDensity: (value: "comfortable" | "compact") => write(DENSITY_KEY, value),
    setThreshold: (value: number) => {
      if (Number.isInteger(value) && value >= 0 && value <= 1_000_000) write(THRESHOLD_KEY, String(value));
    },
  };
}
