import { useEffect, useMemo, useState } from "react";

export default function useLoadMore(items, { initial = 20, step = 20, resetDeps = [] } = {}) {
  const [limit, setLimit] = useState(initial);

  // Reset pagination when dependencies change (e.g., filters, selected month, member id).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setLimit(initial);
  }, [initial, ...resetDeps]);

  const safe = Array.isArray(items) ? items : [];

  const visible = useMemo(() => safe.slice(0, Math.max(0, limit)), [safe, limit]);
  const canLoadMore = safe.length > limit;

  const loadMore = () => setLimit((l) => l + step);
  const reset = () => setLimit(initial);

  return { limit, visible, canLoadMore, loadMore, reset, total: safe.length };
}
