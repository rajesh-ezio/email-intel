export const metadata = {
  title: "Email Pattern Finder — API Docs",
};

function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      style={{
        background: "#1e1e2e",
        color: "#cdd6f4",
        padding: "16px",
        borderRadius: "8px",
        overflow: "auto",
        fontSize: "13px",
        lineHeight: "1.5",
      }}
    >
      {children}
    </pre>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} style={{ marginBottom: "48px" }}>
      <h2
        style={{
          fontSize: "22px",
          fontWeight: 600,
          borderBottom: "1px solid #333",
          paddingBottom: "8px",
          marginBottom: "16px",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({
  name,
  type,
  required,
  desc,
}: {
  name: string;
  type: string;
  required?: boolean;
  desc: string;
}) {
  return (
    <tr>
      <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 600 }}>
        {name}
      </td>
      <td style={{ padding: "8px 12px", color: "#888" }}>{type}</td>
      <td style={{ padding: "8px 12px" }}>
        {required && (
          <span
            style={{
              background: "#f43f5e22",
              color: "#f43f5e",
              fontSize: "11px",
              padding: "2px 6px",
              borderRadius: "4px",
              marginRight: "6px",
            }}
          >
            required
          </span>
        )}
        {desc}
      </td>
    </tr>
  );
}

export default function DocsPage() {
  return (
    <div
      style={{
        maxWidth: "800px",
        margin: "0 auto",
        padding: "40px 24px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#e0e0e0",
        background: "#111",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: "32px", fontWeight: 700, marginBottom: "8px" }}>
        Email Pattern Finder API
      </h1>
      <p style={{ color: "#888", fontSize: "15px", marginBottom: "32px" }}>
        Two-step pipeline: seed domain patterns from known emails, then find
        missing emails using pattern matching + Reoon + Enrichley verification.
      </p>

      {/* TOC */}
      <div
        style={{
          background: "#1a1a2e",
          padding: "16px 20px",
          borderRadius: "8px",
          marginBottom: "40px",
        }}
      >
        <p style={{ fontWeight: 600, marginBottom: "8px" }}>Endpoints</p>
        <ul style={{ margin: 0, paddingLeft: "20px", lineHeight: "2" }}>
          <li>
            <a href="#auth" style={{ color: "#60a5fa" }}>
              Authentication
            </a>
          </li>
          <li>
            <a href="#seed" style={{ color: "#60a5fa" }}>
              POST /api/seed-patterns
            </a>{" "}
            — Learn email patterns from known emails
          </li>
          <li>
            <a href="#find" style={{ color: "#60a5fa" }}>
              POST /api/find-email
            </a>{" "}
            — Find missing email for a contact
          </li>
          <li>
            <a href="#verify" style={{ color: "#60a5fa" }}>
              POST /api/verify
            </a>{" "}
            — Verify a single email
          </li>
          <li>
            <a href="#clay" style={{ color: "#60a5fa" }}>
              Clay Integration Guide
            </a>
          </li>
        </ul>
      </div>

      {/* Auth */}
      <Section id="auth" title="Authentication">
        <p style={{ lineHeight: "1.7" }}>
          All endpoints require a Bearer token in the <code>Authorization</code>{" "}
          header. The token is your <code>API_SECRET</code> environment variable.
        </p>
        <CodeBlock>
          {`Authorization: Bearer YOUR_API_SECRET`}
        </CodeBlock>
        <p style={{ color: "#f59e0b", fontSize: "13px", marginTop: "8px" }}>
          Requests without a valid token return 401 Unauthorized.
        </p>
      </Section>

      {/* Seed Patterns */}
      <Section id="seed" title="POST /api/seed-patterns">
        <p style={{ lineHeight: "1.7", marginBottom: "16px" }}>
          Learns email patterns from contacts that already have verified emails.
          Send rows where the email is known — the API detects which pattern each
          email follows (first.last, flast, f.last, etc.) and stores it per
          domain. Run this <strong>before</strong> calling <code>/api/find-email</code>.
        </p>

        <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>
          Request Body
        </h3>
        <p style={{ color: "#888", fontSize: "13px", marginBottom: "8px" }}>
          Single object or array of objects.
        </p>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginBottom: "16px",
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid #333" }}>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Field</th>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Type</th>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Description</th>
            </tr>
          </thead>
          <tbody>
            <Field name="firstName" type="string" required desc="Contact's first name" />
            <Field name="lastName" type="string" required desc="Contact's last name" />
            <Field name="email" type="string" required desc="Known verified email" />
            <Field
              name="companyDomain"
              type="string"
              required
              desc="Company domain (e.g. infosys.com)"
            />
          </tbody>
        </table>

        <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>
          Example Request
        </h3>
        <CodeBlock>
          {`POST /api/seed-patterns
Content-Type: application/json
Authorization: Bearer YOUR_API_SECRET

[
  {
    "firstName": "Rahul",
    "lastName": "Sharma",
    "email": "rahul.sharma@infosys.com",
    "companyDomain": "infosys.com"
  },
  {
    "firstName": "Priya",
    "lastName": "Patel",
    "email": "priya.patel@infosys.com",
    "companyDomain": "infosys.com"
  }
]`}
        </CodeBlock>

        <h3
          style={{
            fontSize: "16px",
            fontWeight: 600,
            marginBottom: "8px",
            marginTop: "16px",
          }}
        >
          Response
        </h3>
        <CodeBlock>
          {`{
  "seeded": 2,
  "skipped": 0,
  "domains": 1
}`}
        </CodeBlock>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: "12px",
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid #333" }}>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Field</th>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>seeded</td>
              <td style={{ padding: "8px 12px" }}>Patterns successfully learned</td>
            </tr>
            <tr>
              <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>skipped</td>
              <td style={{ padding: "8px 12px" }}>
                Rows skipped (missing fields or undetectable pattern)
              </td>
            </tr>
            <tr>
              <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>domains</td>
              <td style={{ padding: "8px 12px" }}>Unique domains processed</td>
            </tr>
          </tbody>
        </table>
      </Section>

      {/* Find Email */}
      <Section id="find" title="POST /api/find-email">
        <p style={{ lineHeight: "1.7", marginBottom: "16px" }}>
          Finds a missing work email for a contact. Uses the domain pattern from
          seed data (or defaults to <code>first.last</code>), generates a
          candidate email, then verifies through Reoon (SMTP) and Enrichley
          (catch-all). Timeout: up to 90 seconds.
        </p>

        <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>
          Request Body
        </h3>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginBottom: "16px",
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid #333" }}>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Field</th>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Type</th>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Description</th>
            </tr>
          </thead>
          <tbody>
            <Field name="firstName" type="string" required desc="Contact's first name" />
            <Field name="lastName" type="string" required desc="Contact's last name" />
            <Field
              name="companyDomain"
              type="string"
              required
              desc="Company domain (e.g. hdfcbank.com)"
            />
          </tbody>
        </table>

        <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>
          Example Request
        </h3>
        <CodeBlock>
          {`POST /api/find-email
Content-Type: application/json
Authorization: Bearer YOUR_API_SECRET

{
  "firstName": "Amit",
  "lastName": "Kumar",
  "companyDomain": "hdfcbank.com"
}`}
        </CodeBlock>

        <h3
          style={{
            fontSize: "16px",
            fontWeight: 600,
            marginBottom: "8px",
            marginTop: "16px",
          }}
        >
          Success Response (email found via Reoon)
        </h3>
        <CodeBlock>
          {`{
  "found_email": "amit.kumar@hdfcbank.com",
  "verification": "reoon_safe",
  "pattern": "first.last",
  "reoon_status": "safe",
  "domain": "hdfcbank.com"
}`}
        </CodeBlock>

        <h3
          style={{
            fontSize: "16px",
            fontWeight: 600,
            marginBottom: "8px",
            marginTop: "16px",
          }}
        >
          Success Response (email found via Enrichley)
        </h3>
        <CodeBlock>
          {`{
  "found_email": "amit.kumar@hdfcbank.com",
  "verification": "enrichley_valid",
  "pattern": "first.last",
  "reoon_status": "catch_all",
  "enrichley_result": "valid",
  "domain": "hdfcbank.com"
}`}
        </CodeBlock>

        <h3
          style={{
            fontSize: "16px",
            fontWeight: 600,
            marginBottom: "8px",
            marginTop: "16px",
          }}
        >
          Not Found Response
        </h3>
        <CodeBlock>
          {`{
  "found_email": null,
  "verification": "reoon_invalid",
  "pattern": "first.last",
  "reoon_status": "invalid",
  "domain": "hdfcbank.com"
}`}
        </CodeBlock>

        <h3
          style={{
            fontSize: "16px",
            fontWeight: 600,
            marginBottom: "8px",
            marginTop: "16px",
          }}
        >
          Response Fields
        </h3>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid #333" }}>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Field</th>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>found_email</td>
              <td style={{ padding: "8px 12px" }}>
                Verified email address, or <code>null</code> if not found
              </td>
            </tr>
            <tr>
              <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>verification</td>
              <td style={{ padding: "8px 12px" }}>
                <code>reoon_safe</code> | <code>enrichley_valid</code> |{" "}
                <code>reoon_invalid</code> | <code>enrichley_invalid</code> |{" "}
                <code>generation_failed</code>
              </td>
            </tr>
            <tr>
              <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>pattern</td>
              <td style={{ padding: "8px 12px" }}>
                Pattern used (first.last, flast, f.last, firstlast, etc.)
              </td>
            </tr>
            <tr>
              <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>reoon_status</td>
              <td style={{ padding: "8px 12px" }}>
                Raw Reoon result: safe, invalid, catch_all, unknown, disposable
              </td>
            </tr>
            <tr>
              <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>
                enrichley_result
              </td>
              <td style={{ padding: "8px 12px" }}>
                Only present when Enrichley was called (catch-all domains)
              </td>
            </tr>
            <tr>
              <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>domain</td>
              <td style={{ padding: "8px 12px" }}>Domain that was checked</td>
            </tr>
          </tbody>
        </table>
      </Section>

      {/* Verify */}
      <Section id="verify" title="POST /api/verify">
        <p style={{ lineHeight: "1.7", marginBottom: "16px" }}>
          Standalone email verification. Verify any email through Reoon,
          Enrichley, or the full pipeline.
        </p>

        <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>
          Request Body
        </h3>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginBottom: "16px",
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid #333" }}>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Field</th>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Type</th>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Description</th>
            </tr>
          </thead>
          <tbody>
            <Field name="email" type="string" required desc="Email to verify" />
            <Field
              name="gate"
              type="string"
              desc={`"reoon", "enrichley", or "full" (default: full)`}
            />
          </tbody>
        </table>

        <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>
          Example
        </h3>
        <CodeBlock>
          {`POST /api/verify
Content-Type: application/json

{
  "email": "john.doe@company.com",
  "gate": "full"
}`}
        </CodeBlock>
      </Section>

      {/* Clay Integration */}
      <Section id="clay" title="Clay Integration Guide">
        <p style={{ lineHeight: "1.7", marginBottom: "16px" }}>
          Use Clay&apos;s HTTP API enrichment to connect this pipeline to your
          table.
        </p>

        <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>
          Step 1: Seed Patterns (run once per list)
        </h3>
        <p style={{ lineHeight: "1.7", marginBottom: "12px" }}>
          Filter your Clay table to rows that <strong>have</strong> a verified
          email. Add an HTTP API enrichment:
        </p>
        <CodeBlock>
          {`URL:    POST https://YOUR_DOMAIN/api/seed-patterns
Header: Authorization: Bearer YOUR_API_SECRET
Body:
{
  "firstName": "{{First Name}}",
  "lastName": "{{Last Name}}",
  "email": "{{Work Email}}",
  "companyDomain": "{{Company Domain}}"
}`}
        </CodeBlock>

        <h3
          style={{
            fontSize: "16px",
            fontWeight: 600,
            marginBottom: "8px",
            marginTop: "24px",
          }}
        >
          Step 2: Find Missing Emails
        </h3>
        <p style={{ lineHeight: "1.7", marginBottom: "12px" }}>
          Filter to rows <strong>without</strong> an email. Add another HTTP API
          enrichment:
        </p>
        <CodeBlock>
          {`URL:    POST https://YOUR_DOMAIN/api/find-email
Header: Authorization: Bearer YOUR_API_SECRET
Body:
{
  "firstName": "{{First Name}}",
  "lastName": "{{Last Name}}",
  "companyDomain": "{{Company Domain}}"
}

Timeout: 100000ms (max)
Rate limit: 5 requests per 3000ms`}
        </CodeBlock>

        <h3
          style={{
            fontSize: "16px",
            fontWeight: 600,
            marginBottom: "8px",
            marginTop: "24px",
          }}
        >
          Step 3: Map Response
        </h3>
        <p style={{ lineHeight: "1.7", marginBottom: "12px" }}>
          Map these fields back to your Clay columns:
        </p>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid #333" }}>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>
                Response Field
              </th>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>
                Map To
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>
                found_email
              </td>
              <td style={{ padding: "8px 12px" }}>Pattern Finder Email</td>
            </tr>
            <tr>
              <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>
                verification
              </td>
              <td style={{ padding: "8px 12px" }}>Verification Method</td>
            </tr>
            <tr>
              <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>
                pattern
              </td>
              <td style={{ padding: "8px 12px" }}>Email Pattern Used</td>
            </tr>
          </tbody>
        </table>

        <h3
          style={{
            fontSize: "16px",
            fontWeight: 600,
            marginBottom: "8px",
            marginTop: "24px",
          }}
        >
          Rate Limit Recommendations
        </h3>
        <div
          style={{
            background: "#1a1a2e",
            padding: "16px",
            borderRadius: "8px",
            lineHeight: "1.8",
          }}
        >
          <p>
            <strong>Reoon:</strong> Power mode takes 1-3 seconds per call. Max 5
            concurrent.
          </p>
          <p>
            <strong>Enrichley:</strong> Called only for catch-all/unknown domains
            (~20-30% of calls).
          </p>
          <p>
            <strong>Recommended Clay setting:</strong> 5 requests per 3000ms
            with retry on failure.
          </p>
          <p>
            <strong>Timeout:</strong> Set to 100,000ms (Clay max) since
            verification can take up to 60s.
          </p>
        </div>
      </Section>

      {/* Supported Patterns */}
      <Section id="patterns" title="Supported Email Patterns">
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid #333" }}>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Pattern</th>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Example</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["first.last", "john.smith@co.com"],
              ["firstlast", "johnsmith@co.com"],
              ["flast", "jsmith@co.com"],
              ["f.last", "j.smith@co.com"],
              ["first_last", "john_smith@co.com"],
              ["first-last", "john-smith@co.com"],
              ["first", "john@co.com"],
              ["last.first", "smith.john@co.com"],
              ["lastfirst", "smithjohn@co.com"],
              ["last.f", "smith.j@co.com"],
              ["lastf", "smithj@co.com"],
              ["firstl", "johns@co.com"],
            ].map(([pattern, example]) => (
              <tr key={pattern}>
                <td
                  style={{
                    padding: "8px 12px",
                    fontFamily: "monospace",
                    fontWeight: 600,
                  }}
                >
                  {pattern}
                </td>
                <td style={{ padding: "8px 12px", color: "#888" }}>{example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Verification Pipeline */}
      <Section id="pipeline" title="Verification Pipeline">
        <div
          style={{
            background: "#1a1a2e",
            padding: "20px",
            borderRadius: "8px",
            fontFamily: "monospace",
            fontSize: "13px",
            lineHeight: "2",
          }}
        >
          <p>1. Generate candidate email using domain pattern</p>
          <p>
            2. Reoon SMTP check (power mode)
            <br />
            &nbsp;&nbsp; → <span style={{ color: "#22c55e" }}>safe</span> →
            return as found_email
            <br />
            &nbsp;&nbsp; → <span style={{ color: "#ef4444" }}>
              invalid / disposable / spamtrap
            </span>{" "}
            → return null
            <br />
            &nbsp;&nbsp; → <span style={{ color: "#f59e0b" }}>
              catch_all / unknown
            </span>{" "}
            → continue to step 3
          </p>
          <p>
            3. Enrichley catch-all verification
            <br />
            &nbsp;&nbsp; → <span style={{ color: "#22c55e" }}>valid</span> →
            return as found_email
            <br />
            &nbsp;&nbsp; → <span style={{ color: "#ef4444" }}>invalid</span> →
            return null
          </p>
        </div>
      </Section>

      {/* Credits */}
      <Section id="credits" title="Credit Usage">
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid #333" }}>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Service</th>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Cost</th>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>When</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "8px 12px" }}>Reoon</td>
              <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>
                $0.001/call
              </td>
              <td style={{ padding: "8px 12px" }}>Every find-email request</td>
            </tr>
            <tr>
              <td style={{ padding: "8px 12px" }}>Enrichley</td>
              <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>
                $0.005-0.012/call
              </td>
              <td style={{ padding: "8px 12px" }}>
                Only when Reoon returns catch_all/unknown
              </td>
            </tr>
          </tbody>
        </table>
        <p style={{ color: "#888", fontSize: "13px", marginTop: "12px" }}>
          Seed-patterns endpoint uses zero verification credits — it only
          analyzes pattern structure.
        </p>
      </Section>

      <footer
        style={{
          borderTop: "1px solid #333",
          paddingTop: "16px",
          color: "#555",
          fontSize: "13px",
        }}
      >
        Email Pattern Finder API — Built for Clay integration
      </footer>
    </div>
  );
}
