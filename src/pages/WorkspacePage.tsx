import { ReactFlowProvider } from '@xyflow/react';
import { useEffect } from 'react';
import { navigate } from '../app/router';
import { useProjectStore } from '../store/projectStore';
import { useSimStore } from '../store/simStore';
import { useTopologyStore } from '../store/topologyStore';
import { useUiStore } from '../store/uiStore';
import { DeviceWindow } from '../ui/workspace/DeviceWindow';
import { Canvas } from '../ui/workspace/Canvas';
import { Inspector } from '../ui/workspace/Inspector';
import { LeftPanel } from '../ui/workspace/LeftPanel';
import { PduModal } from '../ui/workspace/PduModal';
import { SimDock } from '../ui/workspace/SimDock';
import { saveProject, TopBar } from '../ui/workspace/TopBar';

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function WorkspacePage({ projectId }: { projectId?: string }) {
  const currentId = useProjectStore((s) => s.id);

  // #/workspace/<id>: load that saved project unless it is already open.
  useEffect(() => {
    if (!projectId || projectId === currentId) return;
    useProjectStore
      .getState()
      .open(projectId)
      .then((ok) => {
        if (!ok) {
          useTopologyStore.getState().notify('That project no longer exists in this browser');
          navigate({ page: 'workspace' }, true);
        }
      });
  }, [projectId, currentId]);

  // Keyboard shortcuts. Never steal keys from a text field or the terminal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveProject();
        return;
      }
      if (typing(e.target) || useUiStore.getState().windowDeviceId || useSimStore.getState().openHop !== null) return;
      const store = useTopologyStore.getState();
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (store.selection) {
          e.preventDefault();
          store.deleteSelection();
        }
      } else if (e.key === 'Escape') store.select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Warn before closing the tab with unsaved work.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (useProjectStore.getState().isDirty()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  return (
    <ReactFlowProvider>
      <div className="workspace">
        <TopBar />
        <LeftPanel />
        <Canvas />
        <Inspector />
        <SimDock />
        <PduModal />
        <DeviceWindow />
      </div>
    </ReactFlowProvider>
  );
}
