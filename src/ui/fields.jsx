import { useEffect, useState } from 'react';
import { cm } from '../store.js';

// A number input in centimetres backed by a value in metres.
export function CmField({ label, value, onChange, min = 0, step = 0.5, title }) {
  const [text, setText] = useState(String(cm(value)));
  useEffect(() => setText(String(cm(value))), [value]);
  const commit = (t) => {
    const n = Number(String(t).replace(',', '.'));
    if (Number.isFinite(n) && n >= min) onChange(n / 100);
  };
  return (
    <label className="field" title={title}>
      <span>{label}</span>
      <div className="unit">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => setText(String(cm(value)))}
        />
        <em>cm</em>
      </div>
    </label>
  );
}

export function Select({ label, value, onChange, options }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
