import { useCallback, useRef } from "react";
import type { WheelEvent as ReactWheelEvent } from "react";

type UseSearchScrollOptions = {
  showSearchBox: boolean;
  setShowSearchBox: (val: boolean) => void;
  search: string;
  showSettings: boolean;
  showTagManager: boolean;
  appSettings: Record<string, string>;
};

export const useSearchScroll = (_opts: UseSearchScrollOptions) => {
  const listScrollTopRef = useRef(0);
  const topReachedTimeRef = useRef(0);

  const handleListScroll = useCallback((offset: number) => {
    if (offset === 0 && listScrollTopRef.current > 0) {
      topReachedTimeRef.current = Date.now();
    }
    listScrollTopRef.current = offset;
  }, []);

  const handleMainWheel = useCallback(
    (_e: ReactWheelEvent<HTMLElement>) => {
      // Search box stays fixed; no longer auto-hide on scroll.
      // only the Virtuoso list area scrolls.
    },
    []
  );

  return {
    handleListScroll,
    handleMainWheel
  };
};
