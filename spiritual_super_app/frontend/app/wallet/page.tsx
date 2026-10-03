'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** The wallet now lives in Profile → Wallet; old links and bookmarks land there. */
export default function WalletPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/profile#wallet');
  }, [router]);
  return <p className="text-sm text-ved-green-800/60">Opening your wallet…</p>;
}
