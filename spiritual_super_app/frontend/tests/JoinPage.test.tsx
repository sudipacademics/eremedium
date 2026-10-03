import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import JoinPage from '@/app/join/page';
import { api } from '@/lib/api';

vi.mock('@/lib/photo', () => ({
  resizeSquarePhoto: vi.fn().mockResolvedValue('data:image/jpeg;base64,AAAA'),
  resizeBannerImage: vi.fn(),
}));

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function type(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function addTag(label: string, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

async function upload(input: HTMLInputElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
  await flush();
}

describe('Join as an Expert form', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('submits the application and shows the application ID', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ applicationNo: 'VSJ-261003-7KQ2M', statusLabel: 'Pending', submittedAt: '2026-10-03T10:00:00.000Z' });

    const { container } = render(<JoinPage />);

    type('Full name', 'Ravi Shastri');
    type('Mobile number', '9876543210');
    type('Email', 'ravi@example.com');
    type('Date of birth', '1980-01-15');
    type('Address', '12 Temple Road, Varanasi');
    type('City', 'Varanasi');
    type('State', 'Uttar Pradesh');
    type('Professional category', 'PANDIT');
    type('Experience (years)', '15');
    addTag('Expertise', 'Griha Pravesh');
    addTag('Languages', 'Hindi');
    addTag('Services offered', 'Home puja');
    type('Qualification / certification', 'Shastri, Sampurnanand Sanskrit University');
    type('About / introduction', 'Fifteen years of performing Vedic rituals for families across India.');

    const [photoInput, docInput] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    await upload(photoInput!, new File(['img'], 'me.jpg', { type: 'image/jpeg' }));
    await upload(docInput!, new File(['%PDF-1.4'], 'aadhaar.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText('aadhaar.pdf')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.submit(container.querySelector('form')!);
    await flush();

    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe('join-requests');
    expect(body).toMatchObject({
      name: 'Ravi Shastri',
      phone: '9876543210',
      category: 'PANDIT',
      experienceYears: 15,
      expertise: ['Griha Pravesh'],
      languages: ['Hindi'],
      services: ['Home puja'],
      photo: { name: 'me.jpg', dataUrl: 'data:image/jpeg;base64,AAAA' },
      documents: [{ name: 'aadhaar.pdf', label: 'ID proof' }],
    });
    expect(body).not.toHaveProperty('categoryOther');

    expect(screen.getByText('Application submitted')).toBeInTheDocument();
    expect(screen.getByText('VSJ-261003-7KQ2M')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Track application' })).toHaveAttribute(
      'href',
      '/join/status?application=VSJ-261003-7KQ2M',
    );
  });

  it('asks for missing tags and documents before submitting', async () => {
    const post = vi.spyOn(api, 'post');
    const { container } = render(<JoinPage />);
    type('Professional category', 'ASTROLOGER');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.submit(container.querySelector('form')!);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Add at least one area of expertise.');
    expect(post).not.toHaveBeenCalled();
  });
});
