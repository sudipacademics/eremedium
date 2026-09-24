import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProductCarousel } from '@/components/home/ProductCarousel';
import type { AyurvedaProduct } from '@/lib/api';

const crystal: AyurvedaProduct = {
  id: '11111111-1111-1111-1111-111111111111',
  sku: 'crystal-amethyst',
  name: 'Amethyst Cluster',
  description: null,
  price: '1299.00',
  suitedDoshas: [],
  formFactor: 'raw',
  category: 'CRYSTAL',
  imageUrl: null,
};

describe('ProductCarousel', () => {
  it('lists every product with its price and a buy link to that product in the shop', () => {
    render(<ProductCarousel title="Featured Crystals" category="CRYSTAL" products={[crystal]} loading={false} />);

    expect(screen.getByRole('heading', { name: 'Featured Crystals' })).toBeInTheDocument();
    expect(screen.getByText('Amethyst Cluster')).toBeInTheDocument();
    expect(screen.getByText('₹1,299')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Buy Amethyst Cluster' })).toHaveAttribute(
      'href',
      `/ayurveda?category=crystal&product=${crystal.id}`,
    );
    expect(screen.getByRole('link', { name: 'Shop all' })).toHaveAttribute('href', '/ayurveda?category=crystal');
  });

  it('renders nothing once loaded with no products', () => {
    const { container } = render(
      <ProductCarousel title="Featured Crystals" category="CRYSTAL" products={[]} loading={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
