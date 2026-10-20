import { useEffect, useRef, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(REDUCED_MOTION_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

// Informa se o elemento está na área visível. `once` mantém true após a primeira entrada.
export function useInView(ref, { threshold = 0.25, once = false } = {}) {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, threshold, once]);

  return inView;
}

const easeOutCubic = (t) => 1 - (1 - t) ** 3;

// Transição numérica suave até `target`; o valor final é sempre exatamente `target`.
export function useTweenedNumber(target, { duration = 600, disabled = false, from } = {}) {
  const [value, setValue] = useState(from ?? target);
  const valueRef = useRef(value);

  useEffect(() => {
    if (disabled || typeof requestAnimationFrame === 'undefined') {
      valueRef.current = target;
      setValue(target);
      return undefined;
    }
    const start = valueRef.current;
    if (start === target) return undefined;
    const startedAt = performance.now();
    let frame;
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const next = progress === 1 ? target : start + (target - start) * easeOutCubic(progress);
      valueRef.current = next;
      setValue(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, disabled]);

  return value;
}

// Escreve em `--progress` (0 a 1) quanto do elemento já atravessou a viewport.
export function useScrollProgressVar(ref, { disabled = false, start = 1, end = 0.35 } = {}) {
  useEffect(() => {
    const node = ref.current;
    if (!node || disabled || typeof window === 'undefined') {
      node?.style.setProperty('--progress', '1');
      return undefined;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const viewport = window.innerHeight || 1;
      const startY = viewport * start;
      const endY = viewport * end - rect.height;
      const raw = (startY - rect.top) / Math.max(1, startY - endY);
      node.style.setProperty('--progress', Math.min(1, Math.max(0, raw)).toFixed(4));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [ref, disabled, start, end]);
}
