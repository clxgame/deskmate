import { useEffect, useRef } from "react";
import { subscribeNativeHistoryEvents } from "../lib/nativeHistoryEvents";

export function useNativeHistoryEvents(refresh: (native: boolean) => Promise<void>): void {
  const currentRefresh = useRef(refresh);
  currentRefresh.current = refresh;
  useEffect(() => subscribeNativeHistoryEvents(() => { void currentRefresh.current(true); }), []);
}
