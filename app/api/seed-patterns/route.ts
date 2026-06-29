import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { detectPattern, getEmailDomain, cleanDomain } from "@/lib/patterns";

export const maxDuration = 30;

function today(): string {
  return new Date().toISOString().split("T")[0];
}

async function getPatterns(domain: string): Promise<Record<string, number>> {
  try {
    const data = await kv.get<Record<string, number>>(`patterns:${domain}`);
    return data || {};
  } catch (e) {
    console.log(`[seed] KV read failed ${domain}: ${e instanceof Error ? e.message : e}`);
    return {};
  }
}

async function setPatterns(domain: string, patterns: Record<string, number>): Promise<void> {
  try {
    await kv.set(`patterns:${domain}`, patterns, {});
  } catch (e) {
    console.log(`[seed] KV write failed ${domain}: ${e instanceof Error ? e.message : e}`);
  }
}

async function updateMeta(domain: string): Promise<void> {
  try {
    const existing = await kv.get<{ firstSeen: string; lastUpdated: string; seedCount: number }>(`meta:${domain}`);
    const now = today();
    if (existing) {
      existing.lastUpdated = now;
      existing.seedCount = (existing.seedCount || 0) + 1;
      await kv.set(`meta:${domain}`, existing, {});
    } else {
      await kv.set(`meta:${domain}`, { firstSeen: now, lastUpdated: now, seedCount: 1 }, {});
    }
  } catch {}
}

function authorize(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const token = auth.replace(/^Bearer\s+/i, "");
  return token === process.env.API_SECRET;
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

    const rows: Array<{
      firstName: string;
      lastName: string;
      email: string;
      companyDomain: string;
    }> = Array.isArray(body) ? body : [body];

    let seeded = 0;
    let skipped = 0;
    const domainsSeen = new Set<string>();
    const globalPatternBatch: Record<string, number> = {};

    for (const row of rows) {
      const { firstName, lastName, email, companyDomain } = row;

      if (!email || !firstName || !lastName) {
        skipped++;
        continue;
      }

      const emailDomain = getEmailDomain(email);
      if (!emailDomain) {
        skipped++;
        continue;
      }

      const pattern = detectPattern(email, firstName, lastName);
      if (!pattern) {
        skipped++;
        continue;
      }

      globalPatternBatch[pattern] = (globalPatternBatch[pattern] || 0) + 1;

      // Store pattern + meta under emailDomain
      const existingEmail = await getPatterns(emailDomain);
      existingEmail[pattern] = (existingEmail[pattern] || 0) + 1;
      await setPatterns(emailDomain, existingEmail);
      await updateMeta(emailDomain);
      domainsSeen.add(emailDomain);

      // Store under companyDomain if different
      if (companyDomain) {
        const cleaned = cleanDomain(companyDomain);
        if (cleaned && cleaned !== emailDomain) {
          const existingCompany = await getPatterns(cleaned);
          existingCompany[pattern] = (existingCompany[pattern] || 0) + 1;
          await setPatterns(cleaned, existingCompany);
          await updateMeta(cleaned);
          domainsSeen.add(cleaned);

          // Email domain mapping
          try {
            await kv.set(`emaildomain:${cleaned}`, emailDomain, {});
          } catch {}
        }
      }

      seeded++;
    }

    // Update global pattern ranking
    if (Object.keys(globalPatternBatch).length > 0) {
      try {
        const existing = await kv.get<Record<string, number>>("global:pattern_rank") || {};
        for (const [p, count] of Object.entries(globalPatternBatch)) {
          existing[p] = (existing[p] || 0) + count;
        }
        await kv.set("global:pattern_rank", existing);
      } catch {}
    }

    console.log(`[seed] done: ${seeded} seeded, ${skipped} skipped, ${domainsSeen.size} domains`);

    return NextResponse.json({
      seeded,
      skipped,
      domains: domainsSeen.size,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
