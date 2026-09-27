import { useEffect, useRef, useState, type FormEvent } from "react";
/** Shared keyboard-wedge reader: clear synchronously and serialize rapid scans. */
export function useBarcodeReader(
  active: boolean,
  onRead: (code: string) => Promise<void>,
  onError: (error: Error, code: string) => void,
) {
  const input = useRef<HTMLInputElement>(null),
    queue = useRef(Promise.resolve()),
    latest = useRef({ onRead, onError });
  latest.current = { onRead, onError };
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (active) input.current?.focus();
  }, [active]);
  function scan(event: FormEvent) {
    event.preventDefault();
    const code = input.current?.value.trim() ?? "";
    if (input.current) input.current.value = "";
    input.current?.focus();
    if (!code || !active) return;
    setPending((n) => n + 1);
    queue.current = queue.current.then(async () => {
      try {
        await latest.current.onRead(code);
      } catch (error) {
        latest.current.onError(error as Error, code);
      } finally {
        setPending((n) => n - 1);
      }
    });
  }
  return { input, pending, scan };
}
