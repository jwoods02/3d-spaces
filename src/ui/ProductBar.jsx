import { useState } from 'react';
import { useStore, cm } from '../store.js';
import { imageSrc } from '../scene/Item.jsx';

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

// Shrinks uploaded photos so they fit comfortably in local storage.
async function downscale(file, max = 768) {
  const url = await readAsDataUrl(file);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

function ManualForm({ onDone, initial }) {
  const addProduct = useStore((s) => s.addProduct);
  const placeAuto = useStore((s) => s.placeAuto);
  const [f, setF] = useState({ name: '', width: '', height: '', depth: '', mount: 'floor', image: null, url: null, price: null, ...initial });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ok = f.name && Number(f.width) > 0 && Number(f.height) > 0 && Number(f.depth) > 0;
  return (
    <form
      className="manual"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        const p = addProduct({
          ...f,
          width: Number(f.width) / 100,
          height: Number(f.height) / 100,
          depth: Number(f.depth) / 100,
        });
        placeAuto(p.id);
        onDone();
      }}
    >
      {initial?.note && <p className="note">{initial.note}</p>}
      <input placeholder="Name" value={f.name} onChange={set('name')} autoFocus />
      <div className="row">
        <input type="number" step="0.5" placeholder="W cm" value={f.width} onChange={set('width')} />
        <input type="number" step="0.5" placeholder="H cm" value={f.height} onChange={set('height')} />
        <input type="number" step="0.5" placeholder="D cm" value={f.depth} onChange={set('depth')} />
      </div>
      <div className="row">
        <select value={f.mount} onChange={set('mount')}>
          <option value="floor">Stands on floor</option>
          <option value="wall">Mounts on wall</option>
        </select>
        <label className="file">
          {f.image ? 'Photo ✓' : 'Photo…'}
          <input type="file" accept="image/*" hidden onChange={async (e) => e.target.files[0] && setF({ ...f, image: await downscale(e.target.files[0]) })} />
        </label>
      </div>
      <div className="row">
        <button type="button" className="ghost" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" disabled={!ok}>
          Add
        </button>
      </div>
    </form>
  );
}

export default function ProductBar() {
  const products = useStore((s) => s.products);
  const items = useStore((s) => s.items);
  const drag = useStore((s) => s.drag);
  const setDrag = useStore((s) => s.setDrag);
  const addProduct = useStore((s) => s.addProduct);
  const placeAuto = useStore((s) => s.placeAuto);
  const removeProduct = useStore((s) => s.removeProduct);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [manual, setManual] = useState(null);

  async function addLink(e) {
    e.preventDefault();
    const url = link.trim();
    if (!url) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/product?url=${encodeURIComponent(url)}`);
      const data = await res.json().catch(() => ({ error: `Server returned ${res.status}` }));
      if (!res.ok) throw new Error(data.error || 'Could not read that page');
      if (!data.dimensionsFound) {
        // Ask for whatever the page didn't say, keeping what it did.
        setManual({
          name: data.name,
          image: data.image,
          url: data.url,
          price: data.price,
          mount: data.mount,
          width: data.width ? String(cm(data.width)) : '',
          height: data.height ? String(cm(data.height)) : '',
          depth: data.depth ? String(cm(data.depth)) : '',
          note: "Couldn't find every dimension on that page. Fill in the gaps:",
        });
      } else {
        const p = addProduct({ ...data, color: '#a08c76' });
        placeAuto(p.id);
      }
      setLink('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bar">
      <div className="bar-add">
        <form onSubmit={addLink}>
          <input
            type="url"
            placeholder="Paste a product link…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            disabled={busy}
          />
          <button type="submit" disabled={busy || !link.trim()}>
            {busy ? 'Reading…' : 'Add'}
          </button>
        </form>
        <button className="link" onClick={() => setManual({})}>
          or add by hand
        </button>
        {error && <p className="error">{error}</p>}
        {manual && <ManualForm initial={manual} onDone={() => setManual(null)} />}
      </div>
      <div className="cards">
        {products.length === 0 && <p className="empty">Products you add show up here.</p>}
        {products.map((p) => {
          const count = items.filter((i) => i.productId === p.id).length;
          const active = drag?.mode === 'place' && drag.productId === p.id;
          return (
            <div key={p.id} className={`card ${active ? 'active' : ''}`} title="Click, then click in the room to place">
              <button className="card-main" onClick={() => setDrag(active ? null : { mode: 'place', productId: p.id })}>
                <div className="thumb" style={{ background: p.color }}>
                  {p.image && <img src={imageSrc(p.image)} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />}
                </div>
                <div className="card-text">
                  <strong>{p.name}</strong>
                  <span>
                    {cm(p.width)} × {cm(p.height)} × {cm(p.depth)} cm
                  </span>
                  <span>
                    {p.mount === 'wall' ? 'Wall' : 'Floor'}
                    {p.price ? ` · ${p.price}` : ''}
                    {count ? ` · ${count} placed` : ''}
                  </span>
                </div>
              </button>
              <div className="card-actions">
                <button onClick={() => placeAuto(p.id)} title="Find a free spot automatically">
                  Auto place
                </button>
                <button className="ghost" onClick={() => removeProduct(p.id)} title="Remove from the bar and the room">
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
