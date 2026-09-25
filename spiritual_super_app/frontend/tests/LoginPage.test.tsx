import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LoginPage from '@/app/login/page';
import { ApiError, api, session, type VerifyResult } from '@/lib/api';

const router = { push: vi.fn(), replace: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function verified(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    accessToken: 'jwt-token',
    isNewAccount: false,
    user: { id: 'u1', phone: '+919876543210', name: 'Priya Sharma', role: 'USER', astrologerId: null },
    ...overrides,
  };
}

async function reachCodeStep() {
  fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '+91 98765 43210' } });
  fireEvent.click(screen.getByRole('button', { name: 'Get OTP' }));
  await flush();
}

function pasteCode(code: string) {
  fireEvent.paste(screen.getByLabelText('Digit 1 of 6'), { clipboardData: { getData: () => code } });
}

describe('OTP login', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/login?next=%2Fastrologers');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    router.replace.mockReset();
    window.localStorage.clear();
  });

  it('normalises an Indian number and only enables the button for a valid one', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ codeLength: 6, expiresInSeconds: 300, resendAfterSeconds: 60 });
    render(<LoginPage />);
    await flush();

    const input = screen.getByLabelText('Mobile number');
    fireEvent.change(input, { target: { value: '12345' } });
    expect(screen.getByRole('button', { name: 'Get OTP' })).toBeDisabled();

    await reachCodeStep();
    expect(post).toHaveBeenCalledWith('auth/otp/request', { phone: '+919876543210' });
    expect(screen.getByText('+91 98•••••210')).toBeInTheDocument();
    expect(screen.getByText('Code expires in 5:00')).toBeInTheDocument();
    expect(screen.getByText('Resend in 1:00')).toBeInTheDocument();
    expect(screen.getByLabelText('Digit 1 of 6')).toHaveAttribute('autocomplete', 'one-time-code');
  });

  it('verifies a pasted code automatically and returns to the page the user came from', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValueOnce({ codeLength: 6, expiresInSeconds: 300, resendAfterSeconds: 60 })
      .mockResolvedValueOnce(verified());
    render(<LoginPage />);
    await flush();
    await reachCodeStep();

    pasteCode('482-913');
    await flush();

    expect(post).toHaveBeenLastCalledWith('auth/otp/verify', { phone: '+919876543210', code: '482913' });
    expect(session.token).toBe('jwt-token');
    expect(router.replace).toHaveBeenCalledWith('/astrologers');
  });

  it('asks a new user for their name before continuing', async () => {
    vi.spyOn(api, 'post')
      .mockResolvedValueOnce({ codeLength: 6, expiresInSeconds: 300, resendAfterSeconds: 60 })
      .mockResolvedValueOnce(verified({ isNewAccount: true, user: { ...verified().user, name: 'Devotee' } }));
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({});
    render(<LoginPage />);
    await flush();
    await reachCodeStep();
    pasteCode('482913');
    await flush();

    expect(router.replace).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Asha Rao' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await flush();

    expect(patch).toHaveBeenCalledWith('auth/profile', { name: 'Asha Rao' });
    expect(session.profile?.name).toBe('Asha Rao');
    expect(router.replace).toHaveBeenCalledWith('/astrologers');
  });

  it('clears the boxes and explains a wrong code', async () => {
    vi.spyOn(api, 'post')
      .mockResolvedValueOnce({ codeLength: 6, expiresInSeconds: 300, resendAfterSeconds: 60 })
      .mockRejectedValueOnce(new ApiError(401, 'Invalid or expired code'));
    render(<LoginPage />);
    await flush();
    await reachCodeStep();
    pasteCode('000000');
    await flush();

    expect(screen.getByRole('alert')).toHaveTextContent('That code is incorrect or has expired');
    expect(screen.getByLabelText('Digit 1 of 6')).toHaveValue('');
    expect(session.token).toBeNull();
  });

  it('shows how long to wait when the number is rate limited', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(
      new ApiError(429, 'Too many codes requested for this number; try again later', { retryAfterSeconds: 600 }),
    );
    render(<LoginPage />);
    await flush();
    await reachCodeStep();

    expect(screen.getByRole('alert')).toHaveTextContent('try again in about 10 minutes');
    expect(screen.getByRole('button', { name: 'Try again in 10:00' })).toBeDisabled();
  });
});
