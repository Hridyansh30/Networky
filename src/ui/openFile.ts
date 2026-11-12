import { deserialize } from '../model/serialize';
import { useProjectStore } from '../store/projectStore';
import { useTopologyStore } from '../store/topologyStore';

/** Ask for a .networky.json file and open it as a new, unsaved project. Resolves true on success. */
export function openFileDialog(): Promise<boolean> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.networky,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(false);
      const notify = useTopologyStore.getState().notify;
      if (file.size > 2_000_000) {
        notify('That file is larger than 2 MB, which is too big to be a Networky project');
        return resolve(false);
      }
      try {
        const parsed = deserialize(await file.text());
        useTopologyStore.getState().replaceAll(parsed);
        const t = useTopologyStore.getState();
        useProjectStore.setState({ id: undefined, lab: undefined, name: file.name.replace(/\.(networky\.)?json$/i, '').slice(0, 80) || 'Imported', savedTopology: null, savedLayout: null });
        notify(`Opened ${Object.keys(t.topology.devices).length} devices from ${file.name}`, 'info');
        resolve(true);
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e));
        resolve(false);
      }
    };
    input.click();
  });
}

/** Download Networky JSON text as <name>.networky.json. */
export function downloadFile(text: string, name: string) {
  downloadText(text, `${name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'network'}.networky.json`, 'application/json');
}

/** Download any text as a file. The name must already be safe (see interop fileStem). */
export function downloadText(text: string, fileName: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  // Revoking in the same tick can cancel the download in some browsers (Firefox).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
