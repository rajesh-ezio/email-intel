// Self-annealing: learn from each run, store intelligence for future use
// NO processing logic changes — observation only

// ── Industry Classification ───────────────────────────────────────────────

const INDUSTRY_KEYWORDS: [string[], string][] = [
  [["microfinance", "mfi", "microfin", "micro finance"], "MFI"],
  [["nbfc", "non-banking"], "NBFC"],
  [
    ["small finance bank", "sfb", "payment bank", "payments bank"],
    "Small Finance Bank",
  ],
  [
    [
      "psu bank",
      "nationalised bank",
      "nationalized bank",
      "state bank",
      "bank of baroda",
      "bank of india",
      "punjab national",
      "canara bank",
      "union bank",
      "indian bank",
      "central bank",
      "uco bank",
      "bank of maharashtra",
    ],
    "PSU Bank",
  ],
  [
    [
      "private bank",
      "icici",
      "hdfc bank",
      "axis bank",
      "kotak",
      "indusind",
      "yes bank",
      "idfc first",
      "federal bank",
      "rbl bank",
      "bandhan bank",
    ],
    "Private Bank",
  ],
  [
    ["insurance", "life insurance", "general insurance", "lic"],
    "Insurance",
  ],
  [
    [
      "fintech",
      "payment",
      "wallet",
      "upi",
      "lending",
      "neo bank",
      "neobank",
      "digital lending",
      "bharatpe",
      "paytm",
      "phonepe",
      "rapipay",
      "spicemoney",
      "airpay",
    ],
    "Fintech",
  ],
  [
    [
      "housing finance",
      "home finance",
      "home loan",
      "hfc",
      "housing",
      "homefin",
    ],
    "Housing Finance",
  ],
  [
    [
      "asset management",
      "amc",
      "mutual fund",
      "wealth management",
      "capital market",
      "securities",
      "broking",
      "stock",
    ],
    "Asset Management",
  ],
  [
    [
      "conglomerate",
      "group",
      "aditya birla",
      "reliance",
      "tata",
      "mahindra",
      "adani",
      "birla",
      "godrej",
      "bajaj",
    ],
    "Conglomerate",
  ],
  [
    [
      "it services",
      "software",
      "technology",
      "tech",
      "infosys",
      "tcs",
      "wipro",
      "cognizant",
      "hcl tech",
      "genpact",
    ],
    "IT Services",
  ],
  [
    [
      "credit",
      "loan",
      "finance company",
      "financial services",
      "capital",
      "credit care",
      "fincorp",
    ],
    "NBFC",
  ],
  [["bank"], "Banking (Other)"],
];

export function classifyIndustry(
  companyName: string,
  domain: string
): string {
  const text = `${companyName} ${domain}`.toLowerCase();

  for (const [keywords, industry] of INDUSTRY_KEYWORDS) {
    for (const kw of keywords) {
      if (text.includes(kw)) return industry;
    }
  }

  return "Other";
}

// ── Annealing Data Types ──────────────────────────────────────────────────

export interface PatternStats {
  tried: number;
  valid: number;
  rate: number;
}

export interface IndustryData {
  runs: number;
  reoonResults: {
    safe: number;
    invalid: number;
    catch_all: number;
    unknown: number;
    disabled: number;
    other: number;
  };
  enrichleyResults: {
    valid: number;
    invalid: number;
  };
  patterns: Record<string, PatternStats>;
  totalTried: number;
  totalFound: number;
  overallHitRate: number;
  domains: string[]; // unique domains seen
}

export interface AnnealData {
  version: number;
  totalRuns: number;
  lastUpdated: string;
  industries: Record<string, IndustryData>;
}

// ── Run Result Types (input to annealing) ─────────────────────────────────

export interface ContactResult {
  firstName: string;
  lastName: string;
  companyName: string;
  domain: string;
  emailDomain: string;
  patternsAttempted: {
    pattern: string;
    email: string;
    reoonStatus: string;
    enrichleyResult?: string;
    finalOutcome: "valid" | "invalid" | "skipped";
  }[];
  foundEmail: string | null;
  verification: string | null;
}

// ── Storage ───────────────────────────────────────────────────────────────

const STORAGE_KEY = "email-pattern-finder-anneal";

export function loadAnnealData(): AnnealData {
  if (typeof window === "undefined") {
    return createEmpty();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmpty();
    return JSON.parse(raw) as AnnealData;
  } catch {
    return createEmpty();
  }
}

export function saveAnnealData(data: AnnealData): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    console.warn("Failed to save anneal data to localStorage");
  }
}

export function exportAnnealData(): string {
  return JSON.stringify(loadAnnealData(), null, 2);
}

export function clearAnnealData(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

function createEmpty(): AnnealData {
  return {
    version: 1,
    totalRuns: 0,
    lastUpdated: "",
    industries: {},
  };
}

// ── Merge Run Results ─────────────────────────────────────────────────────

export function mergeRunResults(
  existing: AnnealData,
  results: ContactResult[]
): AnnealData {
  const data = structuredClone(existing);
  data.totalRuns++;
  data.lastUpdated = new Date().toISOString().split("T")[0];

  for (const contact of results) {
    const industry = classifyIndustry(contact.companyName, contact.domain);

    if (!data.industries[industry]) {
      data.industries[industry] = {
        runs: 0,
        reoonResults: {
          safe: 0,
          invalid: 0,
          catch_all: 0,
          unknown: 0,
          disabled: 0,
          other: 0,
        },
        enrichleyResults: { valid: 0, invalid: 0 },
        patterns: {},
        totalTried: 0,
        totalFound: 0,
        overallHitRate: 0,
        domains: [],
      };
    }

    const ind = data.industries[industry];

    // Track unique domains
    if (contact.emailDomain && !ind.domains.includes(contact.emailDomain)) {
      ind.domains.push(contact.emailDomain);
    }

    ind.totalTried++;

    if (contact.foundEmail) {
      ind.totalFound++;
    }

    // Track each pattern attempt
    for (const attempt of contact.patternsAttempted) {
      // Reoon tracking
      const reoonKey = attempt.reoonStatus as keyof typeof ind.reoonResults;
      if (reoonKey in ind.reoonResults) {
        ind.reoonResults[reoonKey]++;
      } else {
        ind.reoonResults.other++;
      }

      // Enrichley tracking
      if (attempt.enrichleyResult) {
        if (attempt.finalOutcome === "valid") {
          ind.enrichleyResults.valid++;
        } else {
          ind.enrichleyResults.invalid++;
        }
      }

      // Pattern tracking
      if (!ind.patterns[attempt.pattern]) {
        ind.patterns[attempt.pattern] = { tried: 0, valid: 0, rate: 0 };
      }
      ind.patterns[attempt.pattern].tried++;
      if (attempt.finalOutcome === "valid") {
        ind.patterns[attempt.pattern].valid++;
      }
    }
  }

  // Recalculate rates
  for (const ind of Object.values(data.industries)) {
    ind.overallHitRate =
      ind.totalTried > 0 ? ind.totalFound / ind.totalTried : 0;
    ind.runs = data.totalRuns; // simplified — industry seen in all runs

    for (const ps of Object.values(ind.patterns)) {
      ps.rate = ps.tried > 0 ? ps.valid / ps.tried : 0;
    }
  }

  return data;
}

// ── Industry Pattern Lookup (for unknown domains) ────────────────────

export function getIndustryPattern(
  companyName: string,
  domain: string
): { pattern: string; emailDomain: string } | null {
  const data = loadAnnealData();
  if (data.totalRuns === 0) return null;

  const industry = classifyIndustry(companyName, domain);
  const ind = data.industries[industry];

  // If no data for this industry, try "Other" as fallback
  const fallback = ind || data.industries["Other"];
  if (!fallback) return null;

  // Find the best pattern (highest rate with at least 2 tries)
  const sorted = Object.entries(fallback.patterns)
    .filter(([, s]) => s.tried >= 2)
    .sort((a, b) => b[1].rate - a[1].rate);

  if (sorted.length === 0) {
    // Not enough data — default to first.last
    return { pattern: "first.last", emailDomain: domain };
  }

  return { pattern: sorted[0][0], emailDomain: domain };
}

// ── Report Generation ─────────────────────────────────────────────────────

export function generateAnnealReport(data: AnnealData): string {
  if (data.totalRuns === 0) return "No runs recorded yet.";

  const lines: string[] = [];
  lines.push(`=== Self-Anneal Intelligence ===`);
  lines.push(`Total runs: ${data.totalRuns} | Last updated: ${data.lastUpdated}`);
  lines.push("");

  const sorted = Object.entries(data.industries).sort(
    (a, b) => b[1].totalTried - a[1].totalTried
  );

  for (const [industry, ind] of sorted) {
    lines.push(`▸ ${industry}`);
    lines.push(
      `  Contacts: ${ind.totalTried} tried, ${ind.totalFound} found (${(ind.overallHitRate * 100).toFixed(1)}%)`
    );
    lines.push(`  Domains: ${ind.domains.slice(0, 5).join(", ")}${ind.domains.length > 5 ? ` +${ind.domains.length - 5} more` : ""}`);

    // Reoon behavior
    const r = ind.reoonResults;
    const totalReoon = r.safe + r.invalid + r.catch_all + r.unknown + r.disabled + r.other;
    const catchAllPct = totalReoon > 0 ? ((r.catch_all + r.unknown) / totalReoon * 100).toFixed(0) : "0";
    lines.push(
      `  Reoon: ${catchAllPct}% catch-all/unknown | safe:${r.safe} invalid:${r.invalid} catch_all:${r.catch_all} unknown:${r.unknown}`
    );

    // Enrichley
    const e = ind.enrichleyResults;
    const totalEnrich = e.valid + e.invalid;
    const enrichPct = totalEnrich > 0 ? ((e.valid / totalEnrich) * 100).toFixed(0) : "0";
    lines.push(
      `  Enrichley: ${enrichPct}% valid (${e.valid}/${totalEnrich})`
    );

    // Pattern success rates
    const patternEntries = Object.entries(ind.patterns)
      .sort((a, b) => b[1].rate - a[1].rate);
    if (patternEntries.length > 0) {
      const patternStr = patternEntries
        .map(([p, s]) => `${p}:${(s.rate * 100).toFixed(0)}%(${s.valid}/${s.tried})`)
        .join("  ");
      lines.push(`  Patterns: ${patternStr}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}
