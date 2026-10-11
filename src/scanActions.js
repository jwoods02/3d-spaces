import { useStore } from './store.js';
import { saveScan, clearScan } from './idb.js';

// Makes an uploaded scan the room. Items stuck to an earlier scan are dropped
// since they'd be floating in the wrong place.
export async function uploadScan(file) {
  if (!file) return;
  const prev = useStore.getState().scan;
  if (prev?.url) URL.revokeObjectURL(prev.url);
  await saveScan(file).catch(() => {});
  useStore.setState({ scan: null, items: useStore.getState().items.filter((i) => i.kind !== 'surface') });
  useStore.getState().setScan({ url: URL.createObjectURL(file), name: file.name, rotation: 0, scale: 1, visible: true, showRoom: false });
  useStore.getState().setView('3d');
}


export function removeScan() {
  const s = useStore.getState();
  if (s.scan?.url) URL.revokeObjectURL(s.scan.url);
  clearScan().catch(() => {});
  useStore.setState({ scan: null, items: s.items.filter((i) => i.kind !== 'surface') });
}
