// #/lab/<labId>: the deep link the landing page's lab cards use.
//
// It opens a fresh, unsaved copy of that sample lab and then REPLACES the
// hash with #/playground, so a reload or the Back button never rebuilds the
// lab over the student's changes. An unknown or malformed id goes to the
// Learn page with a toast; it is only ever compared to the ids in EXAMPLES,
// never used to build HTML or a path.
//
// If the current network has unsaved changes (the link was opened in a tab
// that already has work in it), the student is asked first.

import { useEffect, useRef } from 'react';
import { exampleById } from '../model/examples';
import { useProjectStore } from '../store/projectStore';
import { useTopologyStore } from '../store/topologyStore';
import { confirmAction } from '../ui/Confirm';
import { navigate } from './router';

export async function openLabLink(labId: string | undefined): Promise<'opened' | 'unknown' | 'kept'> {
  const lab = labId ? exampleById(labId) : undefined;
  if (!lab) {
    useTopologyStore.getState().notify('That lab link is not valid. Pick a lab here.', 'info');
    navigate({ page: 'learn' }, true);
    return 'unknown';
  }
  const project = useProjectStore.getState();
  if (project.isDirty()) {
    const ok = await confirmAction({
      title: `Open “${lab.name}”?`,
      message: `“${project.name}” has changes you haven't saved. Opening the lab replaces them.`,
      confirmLabel: 'Open lab',
      danger: true,
    });
    if (!ok) {
      navigate({ page: 'workspace', projectId: project.id }, true);
      return 'kept';
    }
  }
  useProjectStore.getState().openLab(lab);
  navigate({ page: 'workspace' }, true);
  return 'opened';
}

export function LabLink({ labId }: { labId?: string }) {
  const started = useRef<string | null | undefined>(null);
  useEffect(() => {
    if (started.current === labId) return; // StrictMode runs effects twice
    started.current = labId;
    void openLabLink(labId);
  }, [labId]);
  return null;
}
