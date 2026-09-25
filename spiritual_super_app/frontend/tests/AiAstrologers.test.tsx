import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AiAstrologersPage from '@/app/ai/page';
import AiAnswer from '@/components/ai/AiAnswer';
import { api, session, type AiPredictResult, type BirthProfile } from '@/lib/api';

const router = { push: vi.fn(), replace: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const birth: BirthProfile = {
  complete: true,
  birthDate: '1990-05-15',
  birthTime: '06:30',
  birthTimeKnown: true,
  timezone: 'Asia/Kolkata',
  latitude: 28.6,
  longitude: 77.2,
  placeLabel: 'Delhi',
  utcOffset: '+05:30',
  birthInstantUtc: '1990-05-15T01:00:00.000Z',
};

function result(astrologer: AiPredictResult['astrologer'], answer: string): AiPredictResult {
  return {
    astrologer,
    answer,
    model: 'gpt-4o-mini',
    birthTimeAssumed: false,
    chartBrief: '',
    disclaimer: 'For reflection only.',
    usage: { promptTokens: null, completionTokens: null },
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mockGet(profile: BirthProfile = birth) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === 'vedic/ai-predict/status') return { configured: true, model: 'gpt-4o-mini', ready: true, provider: 'openai' };
    if (path === 'vedic/birth-profile') return profile;
    throw new Error(`unexpected GET ${path}`);
  });
}

function signIn(name: string | null = 'John Smith') {
  session.save('token-123', { userId: 'u1', role: 'USER', astrologerId: null, name, phone: '9999999999' });
}

function card(personaName: string) {
  return within(screen.getByRole('group', { name: 'Choose an AI astrologer' })).getByRole('button', {
    name: new RegExp(personaName),
  });
}

function ask(personaName: string, text: string) {
  fireEvent.change(screen.getByLabelText(`Your question for ${personaName}`), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: `Ask ${personaName}` }));
}

describe('AI astrologers page', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/ai');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    router.push.mockReset();
    window.localStorage.clear();
  });

  it('offers all four AI astrologers, Vedic first', async () => {
    mockGet();
    render(<AiAstrologersPage />);
    await flush();
    const picker = screen.getByRole('group', { name: 'Choose an AI astrologer' });
    const cards = Array.from(picker.querySelectorAll('button')).map((b) => b.textContent);
    expect(cards).toHaveLength(4);
    expect(cards[0]).toContain('Acharya Veda');
    expect(cards[1]).toContain('Nadi Rishi');
    expect(cards[2]).toContain('Stella');
    expect(cards[3]).toContain('Ank Guru');
    expect(card('Acharya Veda')).toHaveAttribute('aria-pressed', 'true');
  });

  it('sends the chosen astrologer and transit toggle for chart-based personas', async () => {
    signIn();
    mockGet();
    const post = vi.spyOn(api, 'post').mockResolvedValue(result('western', 'Your **Sun** is in Taurus.'));
    render(<AiAstrologersPage />);
    await flush();

    fireEvent.click(card('Stella'));
    expect(window.location.search).toBe('?astrologer=western');
    ask('Stella', 'Explain my Big Three please');
    await flush();

    expect(post).toHaveBeenCalledWith('vedic/ai-predict', {
      astrologer: 'western',
      question: 'Explain my Big Three please',
      history: [],
      includeGochar: true,
    });
    expect(screen.getByText('Sun').tagName).toBe('STRONG');
  });

  it('keeps a separate conversation per astrologer', async () => {
    signIn();
    mockGet();
    vi.spyOn(api, 'post').mockResolvedValue(result('vedic', 'Jupiter dasha favours teaching.'));
    render(<AiAstrologersPage />);
    await flush();

    ask('Acharya Veda', 'What about my career?');
    await flush();
    expect(screen.getByText('Jupiter dasha favours teaching.')).toBeInTheDocument();

    fireEvent.click(card('Nadi Rishi'));
    expect(screen.queryByText('Jupiter dasha favours teaching.')).not.toBeInTheDocument();
    expect(screen.getByText('Tell me the story of Saturn in my chart.')).toBeInTheDocument();

    fireEvent.click(card('Acharya Veda'));
    expect(screen.getByText('Jupiter dasha favours teaching.')).toBeInTheDocument();
  });

  it('sends name and date of birth to the numerologist, prefilled from the profile', async () => {
    signIn('John Smith');
    // Numerology works without a complete kundali.
    mockGet({ ...birth, complete: false });
    window.history.replaceState(null, '', '/ai?astrologer=numerology');
    const post = vi.spyOn(api, 'post').mockResolvedValue(result('numerology', 'Life Path 3.'));
    render(<AiAstrologersPage />);
    await flush();

    expect(card('Ank Guru')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/Save your birth details/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Include today/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Full name/)).toHaveValue('John Smith');
    expect(screen.getByLabelText('Date of birth')).toHaveValue('1990-05-15');

    ask('Ank Guru', 'What is my Life Path?');
    await flush();
    expect(post).toHaveBeenCalledWith('vedic/ai-predict', {
      astrologer: 'numerology',
      question: 'What is my Life Path?',
      history: [],
      fullName: 'John Smith',
      birthDate: '1990-05-15',
    });
  });

  it('blocks chart-based personas until the kundali is saved', async () => {
    signIn();
    mockGet({ ...birth, complete: false });
    render(<AiAstrologersPage />);
    await flush();
    expect(screen.getByText(/Save your birth details/)).toBeInTheDocument();
    expect(screen.getByLabelText('Your question for Acharya Veda')).toBeDisabled();
  });

  it('sends guests to login and back to the same astrologer with their question', async () => {
    mockGet();
    const post = vi.spyOn(api, 'post');
    render(<AiAstrologersPage />);
    await flush();
    fireEvent.click(card('Nadi Rishi'));
    fireEvent.change(screen.getByLabelText('Your question for Nadi Rishi'), { target: { value: 'Saturn story' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in & ask Nadi Rishi' }));

    expect(post).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledTimes(1);
    const next = new URL(router.push.mock.calls[0]![0] as string, 'http://x').searchParams.get('next');
    expect(decodeURIComponent(next ?? '')).toBe('/ai?astrologer=nadi&ask=Saturn story');
  });
});

describe('AiAnswer', () => {
  it('renders bullets, headings and bold without injecting HTML', () => {
    const { container } = render(
      <AiAnswer text={'### Career\nA **strong** year.\n\n- First point\n- Second <b>x</b>'} />,
    );
    expect(screen.getByText('Career').tagName).toBe('STRONG');
    expect(screen.getByText('strong').tagName).toBe('STRONG');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText('Second <b>x</b>')).toBeInTheDocument();
  });
});
