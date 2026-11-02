// TEMPORARY STUB (coordinator scaffold). Animation & Interaction engineer replaces it; keep the props.
import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { useSceneStore } from '../core/SceneContext';
import type { ResidentStructure } from '../core/sceneStore';

export interface ResidentsLayerProps {
  selectedResidentId?: string;
  onResidentSelect?: (id: string) => void;
  quality?: 'low' | 'high';
  viewerResidentId?: string;
}

function StubResident({ id, selected, onSelect }: { id: string; selected: boolean; onSelect?: (id: string) => void }) {
  const store = useSceneStore();
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const r = store.getResident(id);
    if (r && ref.current) ref.current.position.lerp({ x: r.location.x, y: 0.9, z: r.location.z } as THREE.Vector3, 0.1);
  });
  return <mesh ref={ref} castShadow onClick={e => { e.stopPropagation(); onSelect?.(id); }}>
    <capsuleGeometry args={[0.3, 1.1, 4, 8]} />
    <meshStandardMaterial color={selected ? '#ffd84d' : '#ff7a59'} />
  </mesh>;
}

export function ResidentsLayer(props: ResidentsLayerProps) {
  const store = useSceneStore();
  const [structure, setStructure] = useState<ResidentStructure[]>(() => store.getStructure());
  useEffect(() => store.onStructure(setStructure), [store]);
  return <group>{structure.map(s => <StubResident key={s.id} id={s.id} selected={s.id === props.selectedResidentId} onSelect={props.onResidentSelect} />)}</group>;
}
