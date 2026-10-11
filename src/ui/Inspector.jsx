import { useStore, cm, useRoomSpace, scanIsRoom } from '../store.js';
import { hitsScan, scanGaps } from '../scanPlacement.js';
import { collisions, wallGaps, clampItem, WALLS, activeWalls, worldBox, itemTransform, sizeOf } from '../geometry.js';
import { CmField, Select } from './fields.jsx';

// Distance from the item's footprint to each wall (to the wall, not the skirting).
function floorGaps(space, product, item) {
  const b = worldBox(itemTransform(space, product, item), sizeOf(product));
  const d = { back: b.min.z, front: space.depth - b.max.z, left: b.min.x, right: space.width - b.max.x };
  return activeWalls(space).map((id) => [`To ${WALLS[id].label.toLowerCase()}`, d[id]]);
}

export default function Inspector() {
  const id = useStore((s) => s.selectedId);
  const space = useRoomSpace();
  const items = useStore((s) => s.items);
  const products = useStore((s) => s.products);
  const updateItem = useStore((s) => s.updateItem);
  const updateProduct = useStore((s) => s.updateProduct);
  const removeItem = useStore((s) => s.removeItem);
  const duplicateItem = useStore((s) => s.duplicateItem);
  const select = useStore((s) => s.select);

  const isScan = useStore(scanIsRoom);
  const item = items.find((i) => i.id === id && (i.kind === 'surface') === isScan);
  const product = item && products.find((p) => p.id === item.productId);
  if (!item || !product) return null;

  const roomItems = items.filter((i) => (i.kind === 'surface') === isScan);
  const hits = collisions(space, products, roomItems, item);
  const inScan = item.kind === 'surface' && hitsScan(product, item);
  const move = (patch) => updateItem(item.id, clampItem(space, product, { ...item, ...patch }));
  const rotate = (deg) => updateItem(item.id, { rot: (item.rot || 0) + (deg * Math.PI) / 180, manualRot: true });
  const gaps = item.kind === 'wall' ? wallGaps(space, products, items, item) : null;

  return (
    <aside className="panel inspector">
      <header>
        <h2>{product.name}</h2>
        <button className="ghost" onClick={() => select(null)} aria-label="Close">
          ✕
        </button>
      </header>
      {product.url && (
        <a className="small" href={product.url} target="_blank" rel="noreferrer">
          View product page ↗
        </a>
      )}

      {(hits.length > 0 || inScan) && (
        <p className="warn">Overlaps {[...hits.map((h) => h.label), ...(inScan ? ['something in the scan'] : [])].join(', ')}</p>
      )}

      <h3>Size</h3>
      <div className="grid3">
        <CmField label="Width" value={product.width} onChange={(v) => v > 0 && updateProduct(product.id, { width: v })} />
        <CmField label="Height" value={product.height} onChange={(v) => v > 0 && updateProduct(product.id, { height: v })} />
        <CmField label="Depth" value={product.depth} onChange={(v) => v > 0 && updateProduct(product.id, { depth: v })} />
      </div>
      <Select
        label="Mounting"
        value={product.mount}
        onChange={(mount) => updateProduct(product.id, { mount })}
        options={[
          ['floor', 'Stands on the floor'],
          ['wall', 'Hangs on a wall'],
        ]}
      />

      <h3>Position</h3>
      {item.kind === 'wall' && (
        <>
          <Select
            label="Wall"
            value={item.wall}
            onChange={(wall) => move({ wall })}
            options={activeWalls(space).map((w) => [w, WALLS[w].label])}
          />
          <div className="grid2">
            <CmField label="From left end" value={item.u} onChange={(u) => move({ u })} title="Left edge of the item, measured from the left end of the wall as you face it" />
            <CmField label="Bottom from floor" value={item.v} onChange={(v) => move({ v })} />
          </div>
          <ul className="gaps">
            {Object.entries(gaps).map(([side, g]) => (
              <li key={side}>
                <span>{side}</span> {cm(g.dist)} cm to {g.label}
              </li>
            ))}
          </ul>
        </>
      )}
      {item.kind === 'floor' && (
        <>
          <div className="grid2">
            <CmField label="Centre from left" value={item.x} onChange={(x) => move({ x })} />
            <CmField label="Centre from back" value={item.z} onChange={(z) => move({ z })} />
          </div>
          <ul className="gaps">
            {floorGaps(space, product, item).map(([label, d]) => (
              <li key={label}>
                {label}: {cm(d)} cm
              </li>
            ))}
          </ul>
          <div className="row">
            <button onClick={() => rotate(-90)}>⟲ 90°</button>
            <button onClick={() => rotate(-15)}>⟲ 15°</button>
            <button onClick={() => rotate(15)}>⟳ 15°</button>
            <button onClick={() => rotate(90)}>⟳ 90°</button>
          </div>
        </>
      )}
      {item.kind === 'surface' && (
        <>
          <p className="small">{item.onWall ? `Bottom edge ${cm(item.y)} cm above the floor.` : 'Standing on the scanned floor.'}</p>
          <ul className="gaps">
            {scanGaps(space, products, roomItems, item).map((g) => (
              <li key={g.side}>
                <span>{g.side}</span> {cm(g.dist)} cm{g.label !== 'scan' ? ` to ${g.label}` : ''}
              </li>
            ))}
          </ul>
          {!item.onWall && (
            <div className="row">
              <button onClick={() => rotate(-90)}>⟲ 90°</button>
              <button onClick={() => rotate(90)}>⟳ 90°</button>
            </div>
          )}
        </>
      )}

      <div className="row actions">
        <button onClick={() => duplicateItem(item.id)}>Add another</button>
        <button className="danger" onClick={() => removeItem(item.id)}>
          Remove
        </button>
      </div>
      <p className="hint">Drag to move. Arrow keys nudge 1 cm (Shift for 10 cm), R rotates, Delete removes.</p>
    </aside>
  );
}
