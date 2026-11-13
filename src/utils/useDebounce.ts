import { useState, useEffect } from 'react';

/**
 * Custom hook to debounce values (e.g. search input, query filters).
 * Prevents redundant re-renders and costly filter calculations during rapid user typing.
 */
export function useDebounce<T>(value: T, delay: number = 250): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
