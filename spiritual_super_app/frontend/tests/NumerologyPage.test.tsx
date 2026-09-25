import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NumerologyPage } from '@/components/numerology/NumerologyPage';
import { api, type CmsArticle, type NumberMeaning, type NumerologyReading } from '@/lib/api';

function meaning(number: number, title: string): NumberMeaning {
  return {
    number,
    title,
    keywords: [`${title} keyword`],
    summary: `${title} summary`,
    strengths: [`${title} strength`],
    challenges: [`${title} challenge`],
    careers: [`${title} career`],
    relationships: `${title} in love`,
    planet: 'Jupiter (Guru)',
    luckyDay: 'Thursday',
    luckyColour: 'Yellow',
  };
}

const reading: NumerologyReading = {
  name: 'John Smith',
  birthDate: '1990-05-15',
  numbers: { lifePath: 3, destiny: 8, soulUrge: 6, personality: 11, birthday: 6, personalYear: 3 },
  meanings: {
    '3': meaning(3, 'The Communicator'),
    '8': meaning(8, 'The Achiever'),
    '6': meaning(6, 'The Nurturer'),
    '11': meaning(11, 'The Illuminator'),
  },
  compatibleNumbers: [3, 6, 9],
  luckyNumbers: [3, 6, 8],
  personalYearTheme: 'A year of expression.',
};

function article(title: string, slug: string): CmsArticle {
  return {
    id: `id-${slug}-0000000000`,
    slug,
    title,
    excerpt: '',
    coverUrl: null,
    ctaHref: null,
    featured: false,
    published: true,
    publishedAt: '2026-08-12T00:00:00.000Z',
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mockGet(videoYoutubeId: string | null, articles: CmsArticle[] = []) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === 'content/numerology') return { videoYoutubeId };
    if (path === 'content/articles') return { articles };
    return {};
  });
}

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => vi.restoreAllMocks());

describe('NumerologyPage', () => {
  it('sends the calculator details and shows the report', async () => {
    mockGet(null);
    const post = vi.spyOn(api, 'post').mockResolvedValue(reading);
    render(<NumerologyPage />);
    await flush();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Numerology');
    fireEvent.change(screen.getByPlaceholderText('Enter your full name'), { target: { value: ' John Smith ' } });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'john@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('9876543210'), { target: { value: '9876543210' } });
    fireEvent.change(document.querySelector('input[name="birthDate"]')!, { target: { value: '1990-05-15' } });
    fireEvent.click(screen.getByRole('button', { name: /Female/ }));
    fireEvent.submit(screen.getByRole('button', { name: 'Calculate My Numerology Report' }));
    await flush();

    expect(post).toHaveBeenCalledWith('content/numerology/report', {
      fullName: 'John Smith',
      email: 'john@example.com',
      phone: '9876543210',
      birthDate: '1990-05-15',
      gender: 'FEMALE',
    });
    const report = screen.getByRole('region', { name: 'Your numerology report' });
    expect(report).toHaveTextContent('Namaste, John Smith');
    expect(report).toHaveTextContent('The Communicator');
    expect(report).toHaveTextContent('The Illuminator');
    expect(report).toHaveTextContent('A year of expression.');
    expect(document.getElementById('report-compatibility')).toHaveTextContent('The Communicator in love');
  });

  it('shows the server error instead of a report', async () => {
    mockGet(null);
    vi.spyOn(api, 'post').mockRejectedValue(new Error('Enter your full name in English letters'));
    render(<NumerologyPage />);
    await flush();

    fireEvent.submit(screen.getByRole('button', { name: 'Calculate My Numerology Report' }));
    await flush();

    expect(screen.getByRole('alert')).toHaveTextContent('English letters');
    expect(screen.queryByRole('region', { name: 'Your numerology report' })).not.toBeInTheDocument();
  });

  it('plays the admin-chosen explainer video only when one is set', async () => {
    mockGet('dQw4w9WgXcQ');
    render(<NumerologyPage />);
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Watch video to understand numerology' }));
    expect(document.querySelector('iframe')?.getAttribute('src')).toContain('/embed/dQw4w9WgXcQ');
  });

  it('hides the play button when no video is set', async () => {
    mockGet(null);
    render(<NumerologyPage />);
    await flush();
    expect(screen.queryByRole('button', { name: /Watch video/ })).not.toBeInTheDocument();
  });

  it('lists numerology blog articles ahead of the built-in guides', async () => {
    mockGet(null, [article('Ayurveda for winter', 'ayurveda-winter'), article('Your Life Path explained', 'life-path')]);
    render(<NumerologyPage />);
    await flush();

    const guides = screen.getByRole('region', { name: 'Learn more about numerology' });
    const links = [...guides.querySelectorAll('li a')].map((a) => a.getAttribute('href'));
    expect(links[0]).toBe('/articles/life-path');
    expect(links).not.toContain('/articles/ayurveda-winter');
    expect(links).toHaveLength(5);
  });
});
