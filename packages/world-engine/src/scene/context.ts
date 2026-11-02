import { createContext, useContext } from 'react';
import type { SceneKit } from './kit';

export const KitContext = createContext<SceneKit | null>(null);

export function useKit(): SceneKit {
  const kit = useContext(KitContext);
  if (!kit) throw new Error('useKit must be used inside <WorldScene>');
  return kit;
}
