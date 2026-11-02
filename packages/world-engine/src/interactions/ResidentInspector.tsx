// TEMPORARY STUB (coordinator scaffold). Animation & Interaction engineer replaces it; keep the props.
import type { WorldRuntime } from '@hello-world/contracts';
import type { SceneStore } from '../core/sceneStore';

export interface ResidentInspectorProps {
  store: SceneStore;
  runtime: WorldRuntime;
  selectedResidentId?: string;
  viewerResidentId?: string;
  onClose?: () => void;
}

export function ResidentInspector(props: ResidentInspectorProps) {
  const r = props.selectedResidentId ? props.store.getResident(props.selectedResidentId) : undefined;
  if (!r) return null;
  return <div style={{ position: 'absolute', right: 12, bottom: 12, background: 'rgba(10,14,16,.8)', color: '#fff', padding: 12, borderRadius: 12 }}>{r.displayName} — {r.activity}</div>;
}
