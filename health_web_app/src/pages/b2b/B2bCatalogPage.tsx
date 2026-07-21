import { useEffect, useState } from 'react';
import { api, B2bCatalogItem } from '../../api';

function DualRate({ mrp, sell, sellLabel }: { mrp: number; sell: number; sellLabel: string }) {
  const showSlash = mrp > sell && sell > 0;
  return (
    <div className="price-tag price-tag-sm" title={`${sellLabel}${showSlash ? ` · MRP ₹${mrp}` : ''}`}>
      {showSlash ? <span className="price-mrp">MRP ₹{mrp.toFixed(0)}</span> : null}
      <span className="price-sale">₹{sell.toFixed(0)}</span>
      {showSlash ? (
        <span className="price-off">{Math.round((1 - sell / mrp) * 100)}% off</span>
      ) : null}
    </div>
  );
}

export function B2bCatalogPage() {
  const [items, setItems] = useState<B2bCatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getB2bCatalog()
      .then((res) => setItems(res.data.items || []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load catalog'));
  }, []);

  const rateLabel = items[0]?.franchisee_rate_label || 'FOCO rate';
  const franchiseeType = items[0]?.franchisee_type || 'Pulse';

  return (
    <>
      <h1>Price catalog</h1>
      <p className="muted">
        {rateLabel} is shown as the sell price. Company MRP is struck through when higher. Type:{' '}
        {franchiseeType}.
      </p>
      {error ? <div className="error">{error}</div> : null}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Test</th>
              <th>{rateLabel}</th>
              <th>Margin vs MRP</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.item_code}>
                <td>{item.item_name}</td>
                <td>
                  <DualRate mrp={item.retail_rate} sell={item.wholesale_rate} sellLabel={rateLabel} />
                </td>
                <td>₹{item.margin.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!items.length && !error ? <p className="muted">No lab items configured.</p> : null}
    </>
  );
}
