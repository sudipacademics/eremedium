import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NewsletterSection } from '@/components/home/NewsletterSection';
import { api } from '@/lib/api';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('NewsletterSection', () => {
  afterEach(() => vi.restoreAllMocks());

  it('subscribes the email and links only the social profiles the admin has set', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ youtubeUrl: 'https://www.youtube.com/@vedsutra' });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ subscribed: true });
    render(<NewsletterSection />);
    await flush();

    expect(screen.getByRole('link', { name: 'Vedsutra on YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/@vedsutra');
    expect(screen.getByLabelText('Vedsutra on Facebook — coming soon')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: ' seeker@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: /Subscribe/ }));
    await flush();

    expect(post).toHaveBeenCalledWith('content/newsletter', { email: 'seeker@example.com' });
    expect(screen.getByRole('status')).toHaveTextContent('You’re subscribed');
    expect(screen.getByLabelText('Email address')).toHaveValue('');
  });

  it('shows the error when subscribing fails', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(null);
    vi.spyOn(api, 'post').mockRejectedValue(new Error('Too many requests'));
    render(<NewsletterSection />);
    await flush();

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'seeker@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Subscribe/ }));
    await flush();

    expect(screen.getByRole('status')).toHaveTextContent('Too many requests');
  });
});
