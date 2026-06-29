const REOON_KEY = process.env.REOON_API_KEY || "";
const ENRICHLEY_KEY = process.env.ENRICHLEY_API_KEY || "";

export type ReoonResult = {
  status: string; // valid, invalid, catch_all, unknown, disposable, spamtrap
  safe: boolean;
};

export type EnrichleyResult = {
  valid: boolean;
  result: string; // ok, catch_all_validated, catch_all, invalid, unknown
};

export type VerifyResult = {
  email: string;
  reoonStatus: string;
  reoonSafe: boolean;
  enrichleyResult: string | null;
  enrichleyValid: boolean | null;
  isFinal: boolean;
};

// Verify email with Reoon
async function checkReoon(email: string): Promise<ReoonResult> {
  const url = `https://emailverifier.reoon.com/api/v1/verify?email=${encodeURIComponent(email)}&key=${REOON_KEY}&mode=power`;

  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Reoon HTTP ${res.status}`);

  const data = await res.json();
  return {
    status: data.status || "error",
    safe: data.is_safe_to_send === true,
  };
}

// Verify email with Enrichley
async function checkEnrichley(email: string): Promise<EnrichleyResult> {
  const res = await fetch(
    "https://api.enrichley.io/api/v1/validate-single-email",
    {
      method: "POST",
      headers: {
        "X-Api-Key": ENRICHLEY_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(30000),
    }
  );
  if (!res.ok) throw new Error(`Enrichley HTTP ${res.status}`);

  const data = await res.json();
  return {
    valid: data.valid === true,
    result: data.result || "error",
  };
}

// Full verification pipeline for one email:
// Reoon first → if safe, done. If catch_all/unknown → Enrichley.
export async function verifyEmail(email: string): Promise<VerifyResult> {
  const result: VerifyResult = {
    email,
    reoonStatus: "error",
    reoonSafe: false,
    enrichleyResult: null,
    enrichleyValid: null,
    isFinal: false,
  };

  // Step 1: Reoon
  try {
    const reoon = await checkReoon(email);
    result.reoonStatus = reoon.status;
    result.reoonSafe = reoon.safe;

    // If Reoon says safe → FINAL
    if (reoon.status === "safe" || (reoon.status === "valid" && reoon.safe)) {
      result.isFinal = true;
      return result;
    }

    // If invalid/disposable/spamtrap → DISCARD, no need for Enrichley
    if (["invalid", "disposable", "spamtrap"].includes(reoon.status)) {
      return result;
    }
  } catch (e) {
    result.reoonStatus = `error: ${e instanceof Error ? e.message : "unknown"}`;
    // If Reoon fails, still try Enrichley
  }

  // Step 2: Enrichley (only for catch_all, unknown, or Reoon error)
  if (["catch_all", "unknown"].includes(result.reoonStatus) || result.reoonStatus.startsWith("error")) {
    try {
      const enrichley = await checkEnrichley(email);
      result.enrichleyResult = enrichley.result;
      result.enrichleyValid = enrichley.valid;

      // If Enrichley says valid → FINAL
      if (enrichley.valid) {
        result.isFinal = true;
      }
    } catch (e) {
      result.enrichleyResult = `error: ${e instanceof Error ? e.message : "unknown"}`;
      result.enrichleyValid = false;
    }
  }

  return result;
}

// Rate-limited delay
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
