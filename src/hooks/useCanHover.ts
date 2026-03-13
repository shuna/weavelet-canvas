import { useEffect, useState } from 'react';

const HOVERABLE_POINTER_MEDIA_QUERY = '(hover: hover) and (pointer: fine)';

export default function useCanHover() {
  const [canHover, setCanHover] = useState<boolean>(() =>
    typeof window !== 'undefined' &&
    window.matchMedia(HOVERABLE_POINTER_MEDIA_QUERY).matches
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(HOVERABLE_POINTER_MEDIA_QUERY);
    const update = (event?: MediaQueryListEvent) => {
      setCanHover(event?.matches ?? mediaQuery.matches);
    };

    update();
    mediaQuery.addEventListener('change', update);

    return () => {
      mediaQuery.removeEventListener('change', update);
    };
  }, []);

  return canHover;
}
