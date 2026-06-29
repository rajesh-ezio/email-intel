import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

interface ReoonResult {
  status: string;
  safe: boolean;
}

interface EnrichleyResult {
  valid: boolean;
  result: string;
}

async function checkReoon(email: string): Promise<ReoonResult> {
  const key = process.env.REOON_API_KEY;
  if (!key) throw new Error("REOON_API_KEY not set");

  const url = `https://emailverifier.reoon.com/api/v1/verify?email=${encodeURIComponent(email)}&key=${key}&mode=power`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });

  if (!res.ok) {
    throw new Error(`Reoon HTTP ${res.status}`);
  }

  const data = await res.json();
  return {
    status: data.status || "unknown",
    safe: data.is_safe_to_send === true,
  };
}

async function checkEnrichley(email: string): Promise<EnrichleyResult> {
  const key = process.env.ENRICHLEY_API_KEY;
  if (!key) throw new Error("ENRICHLEY_API_KEY not set");

  const res = await fetch(
    "https://api.enrichley.io/api/v1/validate-single-email",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": key,
      },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(30000),
    }
  );

  // Return rate limit headers for client-side throttling
  const rateLimitRemaining = res.headers.get("x-ratelimit-remaining");
  const rateLimitReset = res.headers.get("x-ratelimit-reset");

  if (res.status === 429) {
    return {
      valid: false,
      result: `rate_limited:${rateLimitReset || ""}`,
    };
  }

  if (!res.ok) {
    throw new Error(`Enrichley HTTP ${res.status}`);
  }

  const data = await res.json();
  return {
    valid: data.valid === true,
    result: data.result || "unknown",
  };
}

export async function POST(request: NextRequest) {
  try {
    const { email, gate } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "email required" }, { status: 400 });
    }

    // gate: "reoon" | "enrichley" | "full" (default: full pipeline)
    const gateType = gate || "full";

    if (gateType === "reoon") {
      const result = await checkReoon(email);
      return NextResponse.json({ gate: "reoon", email, ...result });
    }

    if (gateType === "enrichley") {
      const result = await checkEnrichley(email);
      return NextResponse.json({ gate: "enrichley", email, ...result });
    }

    // Full pipeline: Reoon → conditional Enrichley
    const reoon = await checkReoon(email);

    if (reoon.safe) {
      return NextResponse.json({
        gate: "reoon",
        email,
        status: reoon.status,
        safe: true,
        final: "valid",
      });
    }

    // Discard: invalid, disposable, spamtrap
    if (["invalid", "disposable", "spamtrap"].includes(reoon.status)) {
      return NextResponse.json({
        gate: "reoon",
        email,
        status: reoon.status,
        safe: false,
        final: "invalid",
      });
    }

    // catch_all or unknown → Enrichley
    const enrichley = await checkEnrichley(email);

    if (enrichley.result.startsWith("rate_limited")) {
      return NextResponse.json({
        gate: "enrichley",
        email,
        status: reoon.status,
        enrichleyResult: enrichley.result,
        final: "rate_limited",
        retryAfter: enrichley.result.split(":")[1] || null,
      });
    }

    return NextResponse.json({
      gate: "enrichley",
      email,
      status: reoon.status,
      enrichleyResult: enrichley.result,
      enrichleyValid: enrichley.valid,
      final: enrichley.valid ? "valid" : "invalid",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
