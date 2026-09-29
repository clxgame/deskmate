import { useEffect, useRef, useState } from "react";
import { localDateKey, nextLocalMidnight } from "../../lib/horoscope/date";
import { generateDailyHoroscope } from "../../lib/horoscope/generator";
import type { DailyHoroscope } from "../../lib/horoscope/types";

const DATE_CHECK_INTERVAL_MS = 60_000;

/** Keep the displayed fortune aligned with the device's current local calendar day. */
export function useDailyHoroscope(readNow: () => Date = () => new Date()): DailyHoroscope {
  const [daily, setDaily] = useState(() => generateDailyHoroscope(localDateKey(readNow())));
  const dateKey = useRef(daily.date);

  useEffect(() => {
    let midnightTimer: ReturnType<typeof setTimeout> | undefined;
    let dateCheckTimer: ReturnType<typeof setInterval> | undefined;
    let disposed = false;

    const stopTimers = () => {
      if (midnightTimer !== undefined) clearTimeout(midnightTimer);
      if (dateCheckTimer !== undefined) clearInterval(dateCheckTimer);
      midnightTimer = undefined;
      dateCheckTimer = undefined;
    };

    const checkDate = () => {
      if (disposed || document.hidden) return;
      const now = readNow();
      const currentKey = localDateKey(now);
      if (currentKey !== dateKey.current) {
        const nextDaily = generateDailyHoroscope(currentKey);
        dateKey.current = currentKey;
        setDaily(nextDaily);
      }

      // Recompute after every check: a changed system clock or time zone can
      // move the next local midnight without changing the current date key.
      if (midnightTimer !== undefined) clearTimeout(midnightTimer);
      const delay = Math.max(1, nextLocalMidnight(now).getTime() - now.getTime());
      midnightTimer = setTimeout(checkDate, delay);
    };

    const resume = () => {
      if (document.hidden) {
        stopTimers();
        return;
      }
      checkDate();
      if (dateCheckTimer === undefined) {
        dateCheckTimer = setInterval(checkDate, DATE_CHECK_INTERVAL_MS);
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) stopTimers();
      else resume();
    };

    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", onVisibilityChange);
    resume();

    return () => {
      disposed = true;
      stopTimers();
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return daily;
}
