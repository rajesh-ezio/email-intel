import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { cleanDomain } from "@/lib/patterns";

export const maxDuration = 30;

function authorize(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  return auth.replace(/^Bearer\s+/i, "") === process.env.API_SECRET;
}

// POST /api/manage-group
// Body: { domain: "hdfc.com", emailDomains: ["hdfcbank.com", "hdfcsec.com", "hdfcergo.com"] }
// Stores group:hdfc.com → ["hdfcbank.com", "hdfcsec.com", "hdfcergo.com"]
//
// To delete a group: { domain: "hdfc.com", emailDomains: [] }
// To get a group:    GET /api/manage-group?domain=hdfc.com

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { domain, emailDomains } = await request.json();
    if (!domain) return NextResponse.json({ error: "domain required" }, { status: 400 });

    const cleaned = cleanDomain(domain);
    const domains: string[] = Array.isArray(emailDomains)
      ? emailDomains.map((d: string) => cleanDomain(d)).filter(Boolean)
      : [];

    if (domains.length === 0) {
      await kv.del(`group:${cleaned}`);
      return NextResponse.json({ deleted: true, domain: cleaned });
    }

    await kv.set(`group:${cleaned}`, domains);
    return NextResponse.json({ domain: cleaned, emailDomains: domains });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const domain = request.nextUrl.searchParams.get("domain");
  if (!domain) return NextResponse.json({ error: "domain required" }, { status: 400 });

  const cleaned = cleanDomain(domain);
  const group = await kv.get<string[]>(`group:${cleaned}`);
  return NextResponse.json({ domain: cleaned, emailDomains: group || [] });
}
