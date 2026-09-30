import { useEffect, useState } from 'react';

export default function SyncDots({ label }: { label: string }) {
  const [count, setCount] = useState(1);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      clearInterval(timer);
      timer = undefined;
      if (!document.hidden && !reducedMotion.matches) {
        timer = setInterval(() => setCount(value => value % 3 + 1), 1000);
      }
    };
    update();
    document.addEventListener('visibilitychange', update);
    reducedMotion.addEventListener('change', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      reducedMotion.removeEventListener('change', update);
    };
  }, []);
  return <span className='inline-block w-[3ch] shrink-0 font-mono' role='img' aria-label={label}>
    <span aria-hidden='true'>{'.'.repeat(count)}</span>
  </span>;
}
