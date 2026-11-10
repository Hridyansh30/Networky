import { useEffect } from 'react';
import { useTopologyStore } from '../store/topologyStore';

export function Toast() {
  const toast = useTopologyStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => useTopologyStore.setState({ toast: null }), toast.kind === 'info' ? 8000 : 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} role="status">
      {toast.text}
    </div>
  );
}
