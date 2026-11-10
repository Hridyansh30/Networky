import { useEffect } from 'react';
import { useTopologyStore } from '../store/topologyStore';
import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { BottomPanel } from './BottomPanel';
import { Palette } from './Palette';
import { Toast } from './Toast';
import { Toolbar } from './Toolbar';

export function App() {
  useKeyboardShortcuts();
  return (
    <div className="app">
      <Toolbar />
      <Palette />
      <Canvas />
      <Inspector />
      <BottomPanel />
      <Toast />
    </div>
  );
}

function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select')) return; // typing in a field
      const s = useTopologyStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        s.deleteSelection();
      } else if (e.key === 'Escape') {
        s.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
