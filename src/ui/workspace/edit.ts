import type { Topology } from '../../model/types';
import { useTopologyStore } from '../../store/topologyStore';

/**
 * Runs a model op as one undo step and returns the error text (for showing
 * next to the field that caused it) or null. A refused op changes nothing.
 */
export function editTopology(op: (t: Topology) => Topology): string | null {
  let error: string | null = null;
  useTopologyStore.getState().apply(({ topology, layout }) => {
    try {
      return { topology: op(topology), layout };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      return { topology, layout }; // unchanged: no history entry, no toast
    }
  });
  return error;
}
