import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { PATTERNS, generateEmail, cleanDomain } from "@/lib/patterns";

export const maxDuration = 90;

const NAME_PREFIXES = /^(dr|mr|mrs|ms|prof|lt|col|capt|maj|gen|smt|shri|sri)\.?\s*/i;

function cleanName(name: string): string {
  return name.replace(NAME_PREFIXES, "").trim();
}

interface VerifiedPatterns {
  [pattern: string]: { tried: number; found: number; rate: number };
}

async function getPatterns(domain: string): Promise<Record<string, number>> {
  try {
    const data = await kv.get<Record<string, number>>(`patterns:${domain}`);
    return data || {};
  } catch {
    return {};
  }
}

async function getVerified(domain: string): Promise<VerifiedPatterns> {
  try {
    const raw = await kv.hgetall<Record<string, string>>(`verified:${domain}`);
    if (!raw) return {};
    const result: VerifiedPatterns = {};
    for (const [field, value] of Object.entries(raw)) {
      const [pattern, metric] = field.split("::");
      if (!result[pattern]) result[pattern] = { tried: 0, found: 0, rate: 0 };
      result[pattern][metric as "tried" | "found"] = Number(value);
    }
    for (const v of Object.values(result)) {
      v.rate = v.tried > 0 ? v.found / v.tried : 0;
    }
    return result;
  } catch {
    return {};
  }
}

async function writeVerified(domain: string, pattern: string, found: boolean): Promise<void> {
  try {
    await kv.hincrby(`verified:${domain}`, `${pattern}::tried`, 1);
    if (found) {
      await kv.hincrby(`verified:${domain}`, `${pattern}::found`, 1);
      await bumpGlobalRank(pattern);
    }
  } catch (e) {
    console.log(`[find-email] verify write failed: ${e instanceof Error ? e.message : e}`);
  }
}

// Fold a confirmed discovery into the global pattern ranking (last-resort
// fallback for brand-new domains), mirroring what /seed-patterns does.
async function bumpGlobalRank(pattern: string): Promise<void> {
  try {
    const rank = (await kv.get<Record<string, number>>("global:pattern_rank")) || {};
    rank[pattern] = (rank[pattern] || 0) + 1;
    await kv.set("global:pattern_rank", rank);
  } catch (e) {
    console.log(`[find-email] global rank bump failed: ${e instanceof Error ? e.message : e}`);
  }
}

async function getEmailDomainMapping(domain: string): Promise<string | null> {
  try {
    return await kv.get<string>(`emaildomain:${domain}`);
  } catch {
    return null;
  }
}

async function getGlobalPatternRank(): Promise<Record<string, number>> {
  try {
    const data = await kv.get<Record<string, number>>("global:pattern_rank");
    return data || {};
  } catch {
    return {};
  }
}

function pickTopPatterns(
  seeded: Record<string, number>,
  verified: VerifiedPatterns,
  globalRank: Record<string, number>,
  count: number
): Array<{ pattern: string; source: string }> {
  const picked: Array<{ pattern: string; source: string }> = [];
  const used = new Set<string>();

  // 1. Verified patterns with at least one confirmed hit (best first)
  const verifiedEntries = Object.entries(verified)
    .filter(([, v]) => v.found >= 1)
    .sort((a, b) => b[1].rate - a[1].rate || b[1].found - a[1].found);
  for (const [p] of verifiedEntries) {
    if (picked.length >= count) break;
    if (PATTERNS[p] && !used.has(p)) {
      picked.push({ pattern: p, source: "verified" });
      used.add(p);
    }
  }

  // 2. Seeded patterns by count (highest first), skip 0% verified ones
  const zeroRate = new Set(
    Object.entries(verified).filter(([, v]) => v.tried >= 2 && v.rate === 0).map(([p]) => p)
  );
  const seededEntries = Object.entries(seeded)
    .filter(([p]) => !used.has(p) && !zeroRate.has(p))
    .sort((a, b) => b[1] - a[1]);
  for (const [p] of seededEntries) {
    if (picked.length >= count) break;
    if (PATTERNS[p]) {
      picked.push({ pattern: p, source: "kv" });
      used.add(p);
    }
  }

  // 3. Global pattern rank as fallback
  const globalEntries = Object.entries(globalRank)
    .filter(([p]) => !used.has(p) && !zeroRate.has(p))
    .sort((a, b) => b[1] - a[1]);
  for (const [p] of globalEntries) {
    if (picked.length >= count) break;
    if (PATTERNS[p]) {
      picked.push({ pattern: p, source: "global" });
      used.add(p);
    }
  }

  // 4. If still empty, fallback to first.last
  if (picked.length === 0) {
    picked.push({ pattern: "first.last", source: "fallback" });
  }

  return picked;
}

function authorize(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const token = auth.replace(/^Bearer\s+/i, "");
  return token === process.env.API_SECRET;
}

async function checkReoon(email: string): Promise<{
  status: string;
  safe: boolean;
}> {
  const key = process.env.REOON_API_KEY;
  if (!key) throw new Error("REOON_API_KEY not set");

  const url = `https://emailverifier.reoon.com/api/v1/verify?email=${encodeURIComponent(email)}&key=${key}&mode=power`;
  const res = await fetch(url, { signal: AbortSignal.timeout(45000) });

  if (!res.ok) throw new Error(`Reoon HTTP ${res.status}`);

  const data = await res.json();
  return {
    status: data.status || "unknown",
    safe: data.is_safe_to_send === true,
  };
}

async function checkEnrichley(email: string): Promise<{
  valid: boolean;
  result: string;
}> {
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
      signal: AbortSignal.timeout(45000),
    }
  );

  if (res.status === 429) {
    return { valid: false, result: "rate_limited" };
  }

  if (!res.ok) throw new Error(`Enrichley HTTP ${res.status}`);

  const data = await res.json();
  const result = data.result || "unknown";
  return {
    valid: data.valid === true && result === "ok",
    result,
  };
}

async function checkRedis(): Promise<boolean> {
  try {
    await kv.ping();
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await checkRedis())) {
    return NextResponse.json({ error: "Redis unavailable — daily limit may be exceeded" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { firstName, lastName, companyDomain } = body;
    const patternCount = Math.min(Math.max(Number(body.patternCount) || 1, 1), 12);

    if (!firstName || !lastName || !companyDomain) {
      return NextResponse.json(
        { error: "firstName, lastName, companyDomain required" },
        { status: 400 }
      );
    }

    const first = cleanName(firstName);
    const last = cleanName(lastName);
    const domain = cleanDomain(companyDomain);

    if (!first || !last || first.length < 2 || last.length < 2) {
      return NextResponse.json({
        found_email: null,
        verification: "skipped_bad_name",
        pattern: null,
        reoon_status: null,
        domain,
        reoon_calls: 0,
        enrichley_calls: 0,
        attempts: 0,
        patterns_tried: [],
        reason: `Name too short or invalid: "${first} ${last}"`,
      });
    }

    const mappedEmailDomain = await getEmailDomainMapping(domain);
    const emailDomain = mappedEmailDomain || domain;

    let seeded = await getPatterns(domain);
    let verified = await getVerified(domain);

    if (Object.keys(seeded).length === 0 && mappedEmailDomain) {
      seeded = await getPatterns(mappedEmailDomain);
      verified = await getVerified(mappedEmailDomain);
    }

    const globalRank = await getGlobalPatternRank();
    const candidates = pickTopPatterns(seeded, verified, globalRank, patternCount);

    let reoonCalls = 0;
    let enrichleyCalls = 0;
    const patternsTried: string[] = [];

    console.log(`[find-email] ${first} ${last} @ ${domain} → ${emailDomain} | trying ${candidates.length} patterns`);

    for (const { pattern, source } of candidates) {
      const candidateEmail = generateEmail(first, last, emailDomain, pattern);
      if (!candidateEmail) continue;

      patternsTried.push(pattern);

      // Reoon check
      let reoon: { status: string; safe: boolean };
      try {
        reoon = await checkReoon(candidateEmail);
        reoonCalls++;
        console.log(`[find-email] #${patternsTried.length} ${candidateEmail} (${source}) | reoon: ${reoon.status} safe:${reoon.safe}`);
      } catch (e) {
        reoonCalls++;
        console.log(`[find-email] reoon failed: ${e instanceof Error ? e.message : e}`);
        continue;
      }

      if (reoon.status === "safe") {
        await writeVerified(emailDomain, pattern, true);
        return NextResponse.json({
          found_email: candidateEmail,
          verification: "reoon_safe",
          pattern,
          pattern_source: source,
          reoon_status: reoon.status,
          domain: emailDomain,
          attempts: patternsTried.length,
          reoon_calls: reoonCalls,
          enrichley_calls: enrichleyCalls,
          patterns_tried: patternsTried,
        });
      }

      // Only catch_all and unknown go to Enrichley; every other status is rejected
      if (reoon.status !== "catch_all" && reoon.status !== "unknown") {
        await writeVerified(emailDomain, pattern, false);
        continue;
      }

      // Enrichley for catch-all/unknown
      let enrichley: { valid: boolean; result: string };
      try {
        enrichley = await checkEnrichley(candidateEmail);
        enrichleyCalls++;
        console.log(`[find-email] enrichley: ${candidateEmail} | valid:${enrichley.valid} result:${enrichley.result}`);
      } catch (e) {
        enrichleyCalls++;
        console.log(`[find-email] enrichley failed: ${e instanceof Error ? e.message : e}`);
        continue;
      }

      if (enrichley.valid) {
        await writeVerified(emailDomain, pattern, true);
        return NextResponse.json({
          found_email: candidateEmail,
          verification: "enrichley_valid",
          pattern,
          pattern_source: source,
          reoon_status: reoon.status,
          enrichley_result: enrichley.result,
          domain: emailDomain,
          attempts: patternsTried.length,
          reoon_calls: reoonCalls,
          enrichley_calls: enrichleyCalls,
          patterns_tried: patternsTried,
        });
      }

      await writeVerified(emailDomain, pattern, false);
    }

    return NextResponse.json({
      found_email: null,
      verification: "all_patterns_failed",
      pattern: null,
      reoon_status: null,
      domain: emailDomain,
      attempts: patternsTried.length,
      reoon_calls: reoonCalls,
      enrichley_calls: enrichleyCalls,
      patterns_tried: patternsTried,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
