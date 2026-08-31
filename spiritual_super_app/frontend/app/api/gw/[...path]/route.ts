import { NextResponse, type NextRequest } from 'next/server';

/**
 * Server-side proxy to the core gateway.
 *
 * The browser never talks to the gateway directly. Two reasons:
 *
 *  1. The gateway is published only on the container network, so the staging gate that nginx applies
 *     to /api/v1/* never enters the picture and its shared secret never has to reach client JS.
 *  2. It keeps the browser on one origin, so there is no CORS surface to widen.
 *
 * The caller's bearer token is forwarded untouched; this proxy grants no authority of its own.
 */
const GATEWAY = process.env.GATEWAY_INTERNAL_URL ?? 'http://core-gateway:8000';

// Paths the browser must never be able to reach through this proxy, regardless of what it sends.
const BLOCKED = [/^payments\/webhook/i, /^rtc\/webhook/i];

async function forward(request: NextRequest, path: string[]): Promise<NextResponse> {
  const suffix = path.join('/');

  if (BLOCKED.some((pattern) => pattern.test(suffix))) {
    // Provider webhooks authenticate by signature. Exposing them via a browser-facing proxy would
    // let anyone replay a body against them.
    return NextResponse.json({ error: 'FORBIDDEN_PATH' }, { status: 403 });
  }

  const target = new URL(`${GATEWAY}/api/v1/${suffix}`);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  headers.set('accept', 'application/json');
  const authorization = request.headers.get('authorization');
  if (authorization) {
    headers.set('authorization', authorization);
  }
  const contentType = request.headers.get('content-type');
  if (contentType) {
    headers.set('content-type', contentType);
  }
  // Preserve the real client IP so the gateway's per-IP rate limiting is not keyed to this container.
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    headers.set('x-forwarded-for', forwardedFor);
  }

  const method = request.method;
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.text();

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'GATEWAY_UNREACHABLE',
        message: error instanceof Error ? error.message : 'Upstream request failed',
      },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await context.params).path);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await context.params).path);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await context.params).path);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await context.params).path);
}
