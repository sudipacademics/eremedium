import { NextResponse } from 'next/server';

/**
 * Public runtime configuration.
 *
 * Served from the server rather than baked in at build time so the same image can be promoted
 * between environments. Only values that are safe in a browser belong here: the LiveKit signalling
 * URL and the Razorpay *publishable* key id. The Razorpay secret and webhook secret stay server-side.
 */
export async function GET() {
  return NextResponse.json(
    {
      livekitUrl: process.env.NEXT_PUBLIC_LIVEKIT_URL ?? '',
      razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? '',
      wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? '',
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
