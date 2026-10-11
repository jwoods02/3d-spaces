import { useEffect, useRef } from 'react';
import { useStore } from './store.js';
import { activeWalls, clampItem, WALLS } from './geometry.js';
import { loadScan } from './idb.js';
import Scene from './scene/Scene.jsx';
import ProductBar from './ui/ProductBar.jsx';
import Inspector from './ui/Inspector.jsx';
import SpacePanel from './ui/SpacePanel.jsx';

function TopBar() {
  const space = useStore((s) => s.space);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  const importState = useStore((s) => s.importState);
  const fileRef = useRef();

  const exportJson = () => {
    const { space, products, items } = useStore.getState();
    const blob = new Blob([JSON.stringify({ space, products, items }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${space.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'space'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <header className="top">
      <strong className="brand">3D Spaces</strong>
      <span className="space-name">{space.name}</span>
      <nav className="views">
        <button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')}>
          3D
        </button>
        {activeWalls(space).map((id) => (
          <button key={id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>
            {WALLS[id].label}
          </button>
        ))}
      </nav>
      <div className="spacer" />
      <button className={panel === 'space' ? 'on' : ''} onClick={() => setPanel(panel === 'space' ? null : 'space')}>
        Edit space
      </button>
      <button className="ghost" onClick={exportJson}>
        Export
      </button>
      <button className="ghost" onClick={() => fileRef.current.click()}>
        Import
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files[0];
          if (f) importState(JSON.parse(await f.text()));
          e.target.value = '';
        }}
      />
    </header>
  );
}

// Arrow keys nudge, R rotates, Delete removes the selected item.
function useKeyboard() {
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input, select, textarea')) return;
      const s = useStore.getState();
      const item = s.items.find((i) => i.id === s.selectedId);
      if (!item) return;
      const product = s.products.find((p) => p.id === item.productId);
      const step = e.shiftKey ? 0.1 : 0.01;
      const set = (patch) => s.updateItem(item.id, clampItem(s.space, product, { ...item, ...patch }));
      const k = e.key;
      if (k === 'Delete' || k === 'Backspace') return s.removeItem(item.id);
      if (k === 'r' || k === 'R') {
        if (item.kind !== 'wall') s.updateItem(item.id, { rot: (item.rot || 0) + (e.shiftKey ? -1 : 1) * (Math.PI / 2), manualRot: true });
        return;
      }
      const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      if (!dirs[k]) return;
      e.preventDefault();
      const [dx, dy] = dirs[k];
      if (item.kind === 'wall') set({ u: item.u + dx * step, v: item.v + dy * step });
      else if (item.kind === 'floor') set({ x: item.x + dx * step, z: item.z - dy * step });
      else s.updateItem(item.id, { x: item.x + dx * step, z: item.z - dy * step });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function App() {
  const panel = useStore((s) => s.panel);
  const drag = useStore((s) => s.drag);
  useKeyboard();

  // Bring back the last scan after a reload.
  useEffect(() => {
    loadScan()
      .then((file) => {
        if (file && !useStore.getState().scan?.url) {
          useStore.getState().setScan({ url: URL.createObjectURL(file), name: file.name });
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="app">
      <TopBar />
      <main className="stage">
        <Scene />
        {panel === 'space' && <SpacePanel />}
        <Inspector />
        {drag?.mode === 'place' && <div className="toast">Click in the room to place it. Esc cancels.</div>}
      </main>
      <ProductBar />
    </div>
  );
}
