// All supported email patterns and their generators
export const PATTERNS: Record<string, (first: string, last: string) => string> = {
  "first.last": (f, l) => `${f}.${l}`,
  "firstlast": (f, l) => `${f}${l}`,
  "flast": (f, l) => `${f[0]}${l}`,
  "f.last": (f, l) => `${f[0]}.${l}`,
  "first_last": (f, l) => `${f}_${l}`,
  "first-last": (f, l) => `${f}-${l}`,
  "first": (f, _l) => `${f}`,
  "last.first": (f, l) => `${l}.${f}`,
  "lastfirst": (f, l) => `${l}${f}`,
  "last.f": (f, l) => `${l}.${f[0]}`,
  "lastf": (f, l) => `${l}${f[0]}`,
  "firstl": (f, l) => `${f}${l[0]}`,
};

// Detect which pattern an email follows given first/last name
export function detectPattern(
  email: string,
  firstName: string,
  lastName: string
): string | null {
  if (!email || !firstName || !lastName || !email.includes("@")) return null;

  const local = email.split("@")[0].toLowerCase();
  const first = firstName.toLowerCase().trim();
  const last = lastName.toLowerCase().trim();

  if (!local || !first || !last) return null;

  for (const [name, generator] of Object.entries(PATTERNS)) {
    try {
      if (local === generator(first, last)) return name;
    } catch {
      continue;
    }
  }
  return null;
}

// Extract domain from email
export function getEmailDomain(email: string): string | null {
  if (!email || !email.includes("@")) return null;
  return email.split("@")[1].toLowerCase().trim();
}

// Clean website to domain
export function cleanDomain(website: string): string {
  return website
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

// Find top 2 dominant patterns for a domain from verified emails
export function findDominantPatterns(
  verifiedEmails: Array<{ email: string; firstName: string; lastName: string }>
): string[] {
  const counts: Record<string, number> = {};

  for (const { email, firstName, lastName } of verifiedEmails) {
    const pattern = detectPattern(email, firstName, lastName);
    if (pattern) {
      counts[pattern] = (counts[pattern] || 0) + 1;
    }
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([pattern]) => pattern);
}

// Generate candidate email from pattern
export function generateEmail(
  firstName: string,
  lastName: string,
  domain: string,
  pattern: string
): string | null {
  const generator = PATTERNS[pattern];
  if (!generator) return null;

  const first = firstName.toLowerCase().trim();
  const last = lastName.toLowerCase().trim();
  if (!first || !last || !domain) return null;

  try {
    return `${generator(first, last)}@${domain}`;
  } catch {
    return null;
  }
}

// Build domain pattern map from all verified emails in the CSV
export function buildDomainPatternMap(
  rows: Array<{
    email: string;
    firstName: string;
    lastName: string;
    website: string;
  }>
): Record<string, { patterns: string[]; emailDomain: string }> {
  const domainEmails: Record<
    string,
    Array<{ email: string; firstName: string; lastName: string }>
  > = {};
  const websiteToEmailDomain: Record<string, string> = {};

  for (const row of rows) {
    if (!row.email) continue;
    const emailDomain = getEmailDomain(row.email);
    if (!emailDomain) continue;

    if (!domainEmails[emailDomain]) domainEmails[emailDomain] = [];
    domainEmails[emailDomain].push({
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
    });

    if (row.website) {
      const cleanedWebsite = cleanDomain(row.website);
      websiteToEmailDomain[cleanedWebsite] = emailDomain;
    }
  }

  const result: Record<string, { patterns: string[]; emailDomain: string }> = {};

  for (const [website, emailDomain] of Object.entries(websiteToEmailDomain)) {
    const emails = domainEmails[emailDomain];
    if (!emails || emails.length === 0) continue;

    const patterns = findDominantPatterns(emails);
    if (patterns.length > 0) {
      result[website] = { patterns, emailDomain };
    }
  }

  return result;
}
