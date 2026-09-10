import { useEffect, useState } from 'react';
import { localDate } from '@/common/vaultModel';

/** Follows local calendar changes without moving a route's explicitly chosen date. */
export function useTodayDate(): string {
  const [today, setToday] = useState(() => localDate());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      const now = new Date();
      setToday(localDate(now));
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      // A minute cap also notices clock/timezone changes while the app stays open.
      timer = setTimeout(update, Math.min(60_000, midnight.getTime() - now.getTime() + 25));
    };
    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return today;
}
