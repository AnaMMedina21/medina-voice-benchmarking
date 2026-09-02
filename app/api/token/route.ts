/**
 * POST /api/token — mint a receive-only join token for one live turn.
 *
 * Creates the room with { prompt, mustContain, arm } as metadata, dispatches the
 * voice-bench worker into it, and returns a token that can subscribe but not
 * publish. The browser never gets a microphone grant and never sees a key:
 * LIVEKIT_API_KEY and LIVEKIT_API_SECRET are read here, server-side, and there
 * is no NEXT_PUBLIC_ variable in this project.
 *
 * The arm is encoded in the room name (bench-mercury-… / bench-haiku-…) because
 * that string appears in every LiveKit log line and dashboard row. It is also
 * put in the metadata, and the worker refuses the job if the two disagree.
 */

import { NextResponse } from "next/server";
import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
} from "livekit-server-sdk";

export const runtime = "nodejs";

const REQUIRED_ENV = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const;

/** Must match AGENT_NAME in worker/agent.py. Dispatch is explicit so the
 *  worker cannot auto-join unrelated rooms on this shared LiveKit project. */
const AGENT_NAME = "voice-bench";

const ARM_SLUGS: Record<string, string> = {
  mercury: "inception-mercury-2",
  haiku: "anthropic-claude-haiku-4-5",
};

/** Room lifetime if nothing ever joins. The worker deletes the room itself on
 *  a normal turn; this is the backstop for a browser that never connects. */
const EMPTY_TIMEOUT_S = 120;

function missingEnv(): string[] {
  return REQUIRED_ENV.filter((name) => !(process.env[name] ?? "").trim());
}

/** The realtime URL is wss://; the server APIs want https:// on the same host. */
function httpUrl(wsUrl: string): string {
  return wsUrl.replace(/^ws/, "http");
}

export async function POST(request: Request) {
  const missing = missingEnv();
  if (missing.length > 0) {
    // Name what is missing. A missing key must not surface as an opaque 500.
    return NextResponse.json(
      { error: `Server is missing required environment variables: ${missing.join(", ")}` },
      { status: 500 }
    );
  }

  let body: { prompt?: string; mustContain?: string; arm?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").trim();
  const mustContain = (body.mustContain ?? "").trim();
  const armSlug = (body.arm ?? "").trim();

  if (!prompt) {
    return NextResponse.json({ error: "prompt is required." }, { status: 400 });
  }
  if (!mustContain) {
    // The assertion is the point of the project. A live turn without one is a
    // timing with no correctness check.
    return NextResponse.json(
      { error: "mustContain is required — a live turn with no assertion is just a timing." },
      { status: 400 }
    );
  }
  if (!ARM_SLUGS[armSlug]) {
    return NextResponse.json(
      { error: `arm must be one of: ${Object.keys(ARM_SLUGS).join(", ")}` },
      { status: 400 }
    );
  }

  const url = process.env.LIVEKIT_URL as string;
  const apiKey = process.env.LIVEKIT_API_KEY as string;
  const apiSecret = process.env.LIVEKIT_API_SECRET as string;

  const roomName = `bench-${armSlug}-${crypto.randomUUID().slice(0, 8)}`;
  const metadata = JSON.stringify({ prompt, mustContain, arm: ARM_SLUGS[armSlug] });

  try {
    const rooms = new RoomServiceClient(httpUrl(url), apiKey, apiSecret);
    await rooms.createRoom({ name: roomName, metadata, emptyTimeout: EMPTY_TIMEOUT_S });

    const dispatch = new AgentDispatchClient(httpUrl(url), apiKey, apiSecret);
    await dispatch.createDispatch(roomName, AGENT_NAME);

    const token = new AccessToken(apiKey, apiSecret, {
      identity: `listener-${crypto.randomUUID().slice(0, 8)}`,
      ttl: "10m",
    });
    // Receive-only. No publishing means no microphone path exists at all.
    token.addGrant({
      room: roomName,
      roomJoin: true,
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
    });

    return NextResponse.json({ token: await token.toJwt(), url, roomName });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Could not start a live room for ${armSlug}: ${reason}` },
      { status: 502 }
    );
  }
}
