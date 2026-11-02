import { createContext, useContext } from 'react';
import type { SceneStore } from './sceneStore';

export const SceneStoreContext = createContext<SceneStore | null>(null);

export function useSceneStore(): SceneStore {
  const store = useContext(SceneStoreContext);
  if (!store) throw new Error('useSceneStore must be used inside <WorldScene>');
  return store;
}
