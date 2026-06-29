"use client";

import { useState, useRef, useCallback } from "react";
import Papa from "papaparse";
import {
  buildDomainPatternMap,
  generateEmail,
  cleanDomain,
} from "../lib/patterns";
import {
  loadAnnealData,
  saveAnnealData,
  mergeRunResults,
  generateAnnealReport,
  classifyIndustry,
  clearAnnealData,
  exportAnnealData,
  getIndustryPattern,
  type ContactResult,
} from "../lib/anneal";

// ── Types ──────────────────────────────────────────────────────────────────

interface ColumnMapping {
  firstName: string;
  lastName: string;
  fullName: string;
  website: string;
  verifiedEmail: string;
  linkedinProfile: string;
  jobTitle: string;
}

type ProcessingStatus =
  | "idle"
  | "uploading"
  | "mapping"
  | "processing"
  | "done";

interface LogEntry {
  ts: number;
  msg: string;
  type: "info" | "success" | "error" | "warn";
}

interface VerifyResult {
  final: string;
  gate?: string;
  status?: string;
  enrichleyResult?: string;
  error?: string;
  retryAfter?: string | null;
  safe?: boolean;
  valid?: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────

const REOON_CONCURRENCY = 5;
const ENRICHLEY_CONCURRENCY = 10;
const ENRICHLEY_WINDOW_MS = 10_000;

const COLUMN_KEYWORDS: Record<keyof ColumnMapping, string[]> = {
  firstName: ["first name", "firstname", "first_name", "fname"],
  lastName: ["last name", "lastname", "last_name", "lname"],
  fullName: ["full name", "fullname", "full_name", "name", "contact name"],
  website: ["website", "company website", "domain", "company domain", "url"],
  verifiedEmail: [
    "master email",
    "verified email",
    "safe work email",
    "safe email",
    "valid email",
    "final email",
  ],
  linkedinProfile: [
    "linkedin",
    "linkedin profile",
    "linkedin url",
    "profile url",
    "li url",
  ],
  jobTitle: ["job title", "title", "designation", "role", "position"],
};

// ── Helpers ────────────────────────────────────────────────────────────────

function guessColumn(
  headers: string[],
  key: keyof ColumnMapping
): string {
  const keywords = COLUMN_KEYWORDS[key];
  const lower = headers.map((h) => h.toLowerCase().trim());

  for (const kw of keywords) {
    const idx = lower.indexOf(kw);
    if (idx !== -1) return headers[idx];
  }

  for (const kw of keywords) {
    const idx = lower.findIndex((h) => h.includes(kw));
    if (idx !== -1) return headers[idx];
  }

  return "";
}

function splitFullName(fullName: string): {
  firstName: string;
  lastName: string;
} {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

// Concurrency-limited task runner
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function Home() {
  const [status, setStatus] = useState<ProcessingStatus>("idle");
  const [csvData, setCsvData] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    firstName: "",
    lastName: "",
    fullName: "",
    website: "",
    verifiedEmail: "",
    linkedinProfile: "",
    jobTitle: "",
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, found: 0 });
  const [resultData, setResultData] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [showAnneal, setShowAnneal] = useState(false);
  const [annealReport, setAnnealReport] = useState("");
  const abortRef = useRef(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const contactResultsRef = useRef<ContactResult[]>([]);
  const reoonCreditsRef = useRef(0);
  const enrichleyCreditsRef = useRef(0);

  const addLog = useCallback(
    (msg: string, type: LogEntry["type"] = "info") => {
      setLogs((prev) => [...prev, { ts: Date.now(), msg, type }]);
      setTimeout(
        () => logsEndRef.current?.scrollIntoView({ behavior: "smooth" }),
        50
      );
    },
    []
  );

  // ── Step 1: Upload CSV ──

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const data = result.data as Record<string, string>[];
        const hdrs = result.meta.fields || [];
        setCsvData(data);
        setHeaders(hdrs);

        const guessed: ColumnMapping = {
          firstName: guessColumn(hdrs, "firstName"),
          lastName: guessColumn(hdrs, "lastName"),
          fullName: guessColumn(hdrs, "fullName"),
          website: guessColumn(hdrs, "website"),
          verifiedEmail: guessColumn(hdrs, "verifiedEmail"),
          linkedinProfile: guessColumn(hdrs, "linkedinProfile"),
          jobTitle: guessColumn(hdrs, "jobTitle"),
        };
        setMapping(guessed);
        setStatus("mapping");
      },
    });
  }

  // ── Step 2: Verify email via API ──

  async function callVerify(
    email: string,
    gate: string = "full"
  ): Promise<VerifyResult> {
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, gate }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { final: "error", error: err.error || `HTTP ${res.status}` };
      }
      return await res.json();
    } catch (err) {
      return {
        final: "error",
        error: err instanceof Error ? err.message : "Network error",
      };
    }
  }

  // ── Step 3: Process all rows ──

  async function startProcessing() {
    if (!mapping.verifiedEmail || !mapping.website) {
      alert("Please map at least Website and Verified Email columns.");
      return;
    }
    if (!mapping.firstName && !mapping.fullName) {
      alert("Please map First Name or Full Name column.");
      return;
    }

    setStatus("processing");
    setLogs([]);
    abortRef.current = false;
    reoonCreditsRef.current = 0;
    enrichleyCreditsRef.current = 0;

    const rows = [...csvData];
    addLog(`Loaded ${rows.length} rows from ${fileName}`);

    // Build pattern map from verified emails
    const patternInput = rows
      .map((row) => {
        let firstName = row[mapping.firstName] || "";
        let lastName = row[mapping.lastName] || "";
        if (!firstName && mapping.fullName && row[mapping.fullName]) {
          const split = splitFullName(row[mapping.fullName]);
          firstName = split.firstName;
          lastName = split.lastName;
        }
        return {
          email: row[mapping.verifiedEmail] || "",
          firstName,
          lastName,
          website: row[mapping.website] || "",
        };
      })
      .filter((r) => r.firstName && r.website);

    addLog("Building domain pattern map from verified emails...");
    const domainMap = buildDomainPatternMap(patternInput);

    const domainCount = Object.keys(domainMap).length;
    addLog(
      `Found patterns for ${domainCount} domains`,
      domainCount > 0 ? "success" : "warn"
    );

    for (const [domain, info] of Object.entries(domainMap)) {
      addLog(
        `  ${domain} → ${info.emailDomain} [${info.patterns.join(", ")}]`
      );
    }

    // Find rows needing emails (verified email column is EMPTY)
    type RowToProcess = {
      index: number;
      firstName: string;
      lastName: string;
      website: string;
    };

    const rowsToProcess: RowToProcess[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const verifiedEmail = (row[mapping.verifiedEmail] || "").trim();

      // ONLY generate when verified email is EMPTY
      if (verifiedEmail) continue;

      let firstName = (row[mapping.firstName] || "").trim();
      let lastName = (row[mapping.lastName] || "").trim();
      if (!firstName && mapping.fullName && row[mapping.fullName]) {
        const split = splitFullName(row[mapping.fullName]);
        firstName = split.firstName;
        lastName = split.lastName;
      }

      const website = (row[mapping.website] || "").trim();
      if (!firstName || !lastName || !website) continue;

      const cleaned = cleanDomain(website);
      if (!domainMap[cleaned]) {
        // No domain pattern — try self-anneal industry fallback
        const companyName = row[mapping.jobTitle] || row[mapping.website] || website;
        const industryHint = getIndustryPattern(companyName, cleaned);
        if (industryHint) {
          domainMap[cleaned] = {
            patterns: [industryHint.pattern],
            emailDomain: industryHint.emailDomain,
          };
          addLog(`  ⚡ ${cleaned} — no domain pattern, using industry fallback: ${industryHint.pattern}@${cleaned}`);
        } else {
          // No anneal data at all — default to first.last
          domainMap[cleaned] = {
            patterns: ["first.last"],
            emailDomain: cleaned,
          };
          addLog(`  ⚡ ${cleaned} — no data, defaulting to first.last@${cleaned}`);
        }
      }

      rowsToProcess.push({ index: i, firstName, lastName, website: cleaned });
    }

    addLog(
      `${rowsToProcess.length} contacts need emails (out of ${rows.length} total)`,
      rowsToProcess.length > 0 ? "info" : "warn"
    );

    if (rowsToProcess.length === 0) {
      addLog(
        "Nothing to process — all contacts already have verified emails or no pattern match possible.",
        "warn"
      );
      finishProcessing(rows);
      return;
    }

    setProgress({ done: 0, total: rowsToProcess.length, found: 0 });

    let found = 0;
    let processed = 0;

    // Anneal tracking: one ContactResult per contact
    const annealResults: ContactResult[] = [];
    const annealMap = new Map<number, ContactResult>(); // index → ContactResult

    // Generate all candidate emails
    type CandidateRow = RowToProcess & {
      candidates: string[];
      patternNames: string[];
      companyName: string;
      emailDomain: string;
    };

    const candidateRows: CandidateRow[] = rowsToProcess.map((r) => {
      const info = domainMap[r.website];
      const patternNames = info.patterns;
      const candidates = patternNames
        .map((p) => generateEmail(r.firstName, r.lastName, info.emailDomain, p))
        .filter(Boolean) as string[];
      const companyName =
        rows[r.index][mapping.jobTitle] || rows[r.index][mapping.website] || r.website;

      // Init anneal tracking for this contact
      const cr: ContactResult = {
        firstName: r.firstName,
        lastName: r.lastName,
        companyName,
        domain: r.website,
        emailDomain: info.emailDomain,
        patternsAttempted: [],
        foundEmail: null,
        verification: null,
      };
      annealResults.push(cr);
      annealMap.set(r.index, cr);

      return { ...r, candidates, patternNames, companyName, emailDomain: info.emailDomain };
    });

    // Track rows that need Enrichley after Reoon returns catch_all/unknown
    const enrichleyQueue: {
      index: number;
      email: string;
      patternIdx: number;
      row: CandidateRow;
    }[] = [];

    // ── Phase 1: Reoon (5 concurrent workers) ──
    addLog(`\nPhase 1: Reoon verification (${REOON_CONCURRENCY} workers)...`);

    const reoonTasks = candidateRows.map((cr) => async () => {
      if (abortRef.current) return;
      const contactResult = annealMap.get(cr.index)!;

      for (let pi = 0; pi < Math.min(1, cr.candidates.length); pi++) {
        const email = cr.candidates[pi];
        const result = await callVerify(email, "reoon");
        reoonCreditsRef.current++;
        const reoonStatus = result.status || (result.safe ? "safe" : "unknown");

        if (result.safe === true) {
          rows[cr.index]["_found_email"] = email;
          rows[cr.index]["_verification"] = "reoon_safe";
          rows[cr.index]["_pattern_used"] = `pattern_${pi + 1}`;
          found++;
          contactResult.foundEmail = email;
          contactResult.verification = "reoon_safe";
          contactResult.patternsAttempted.push({
            pattern: cr.patternNames[pi] || `pattern_${pi + 1}`,
            email,
            reoonStatus,
            finalOutcome: "valid",
          });
          addLog(`✓ ${email} — Reoon SAFE`, "success");
          processed++;
          setProgress({ done: processed, total: rowsToProcess.length, found });
          return;
        }

        if (result.status === "catch_all" || result.status === "unknown") {
          contactResult.patternsAttempted.push({
            pattern: cr.patternNames[pi] || `pattern_${pi + 1}`,
            email,
            reoonStatus,
            finalOutcome: "skipped", // will update after Enrichley
          });
          enrichleyQueue.push({
            index: cr.index,
            email,
            patternIdx: pi,
            row: cr,
          });
          addLog(`⟳ ${email} — Reoon ${result.status}, queued for Enrichley`);
          processed++;
          setProgress({ done: processed, total: rowsToProcess.length, found });
          return;
        }

        // invalid/disposable/spamtrap → track and try next pattern
        contactResult.patternsAttempted.push({
          pattern: cr.patternNames[pi] || `pattern_${pi + 1}`,
          email,
          reoonStatus,
          finalOutcome: "invalid",
        });
        addLog(`✗ ${email} — Reoon ${result.status}`);

        if (result.final === "error") {
          addLog(`  Error: ${result.error}`, "error");
        }
      }

      // All patterns failed in Reoon
      processed++;
      setProgress({ done: processed, total: rowsToProcess.length, found });
    });

    await runWithConcurrency(reoonTasks, REOON_CONCURRENCY);

    // ── Phase 2: Enrichley for catch_all/unknown (10 concurrent, 10/10s window) ──
    if (enrichleyQueue.length > 0 && !abortRef.current) {
      addLog(
        `\nPhase 2: Enrichley verification for ${enrichleyQueue.length} catch-all/unknown (${ENRICHLEY_CONCURRENCY} workers)...`
      );

      const ENRICHLEY_MAX_CHECKS = 400;
      const enrichleyLimited = enrichleyQueue.slice(0, ENRICHLEY_MAX_CHECKS);
      if (enrichleyQueue.length > ENRICHLEY_MAX_CHECKS) {
        addLog(`⚠ Limiting Enrichley to ${ENRICHLEY_MAX_CHECKS} checks (${enrichleyQueue.length - ENRICHLEY_MAX_CHECKS} skipped to save credits)`, "warn");
      }

      const enrichleyTasks = enrichleyLimited.map((eq) => async () => {
        if (abortRef.current) return;
        const contactResult = annealMap.get(eq.index)!;
        // Find the pending attempt to update
        const pendingAttempt = contactResult.patternsAttempted.find(
          (a) => a.email === eq.email && a.finalOutcome === "skipped"
        );

        const result = await callVerify(eq.email, "enrichley");
        enrichleyCreditsRef.current++;

        // Rate limit handling
        if (result.final === "rate_limited") {
          const resetMs = result.retryAfter
            ? parseInt(result.retryAfter)
            : 0;
          const waitMs = resetMs
            ? Math.max(0, resetMs - Date.now()) + 500
            : ENRICHLEY_WINDOW_MS;
          addLog(
            `Rate limited, waiting ${Math.ceil(waitMs / 1000)}s...`,
            "warn"
          );
          await new Promise((r) => setTimeout(r, waitMs));
          const retry = await callVerify(eq.email, "enrichley");
          enrichleyCreditsRef.current++;
          if (retry.valid === true) {
            rows[eq.index]["_found_email"] = eq.email;
            rows[eq.index]["_verification"] = "enrichley_valid";
            rows[eq.index]["_pattern_used"] = `pattern_${eq.patternIdx + 1}`;
            found++;
            contactResult.foundEmail = eq.email;
            contactResult.verification = "enrichley_valid";
            if (pendingAttempt) {
              pendingAttempt.enrichleyResult = "valid";
              pendingAttempt.finalOutcome = "valid";
            }
            addLog(`✓ ${eq.email} — Enrichley VALID (after retry)`, "success");
            setProgress({
              done: processed,
              total: rowsToProcess.length,
              found,
            });
            return;
          }
        }

        if (result.valid === true) {
          rows[eq.index]["_found_email"] = eq.email;
          rows[eq.index]["_verification"] = "enrichley_valid";
          rows[eq.index]["_pattern_used"] = `pattern_${eq.patternIdx + 1}`;
          found++;
          contactResult.foundEmail = eq.email;
          contactResult.verification = "enrichley_valid";
          if (pendingAttempt) {
            pendingAttempt.enrichleyResult = "valid";
            pendingAttempt.finalOutcome = "valid";
          }
          addLog(`✓ ${eq.email} — Enrichley VALID`, "success");
        } else {
          if (pendingAttempt) {
            pendingAttempt.enrichleyResult = result.enrichleyResult || "invalid";
            pendingAttempt.finalOutcome = "invalid";
          }

          addLog(
              `✗ ${eq.email} — Enrichley ${result.enrichleyResult || "invalid"}`
            );
        }

        setProgress({ done: processed, total: rowsToProcess.length, found });
      });

      await runWithConcurrency(enrichleyTasks, ENRICHLEY_CONCURRENCY);
    }

    // ── Self-Anneal: merge results into history ──
    contactResultsRef.current = annealResults;
    const existingAnneal = loadAnnealData();
    const updatedAnneal = mergeRunResults(existingAnneal, annealResults);
    saveAnnealData(updatedAnneal);
    const report = generateAnnealReport(updatedAnneal);
    setAnnealReport(report);
    addLog(`\n${report}`, "info");

    addLog(
      `\nDone! Found ${found} valid emails out of ${rowsToProcess.length} contacts processed.`,
      found > 0 ? "success" : "warn"
    );
    addLog(`Credits used — Reoon: ${reoonCreditsRef.current} | Enrichley: ${enrichleyCreditsRef.current} | Total: ${reoonCreditsRef.current + enrichleyCreditsRef.current}`);

    finishProcessing(rows, found, rowsToProcess.length, enrichleyQueue.length);
  }

  function finishProcessing(
    rows: Record<string, string>[],
    found: number = 0,
    totalProcessed: number = 0,
    enrichleyQueueSize: number = 0
  ) {
    const output = rows.map((row) => {
      const out = { ...row };
      out["Pattern Found Email"] = row["_found_email"] || "";
      out["Verification"] = row["_verification"] || "";
      out["Pattern Used"] = row["_pattern_used"] || "";
      delete out["_found_email"];
      delete out["_verification"];
      delete out["_pattern_used"];
      return out;
    });

    setResultData(output);
    setStatus("done");

    // Auto-download CSV
    const csv = Papa.unparse(output);
    const csvBlob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const csvUrl = URL.createObjectURL(csvBlob);
    const csvLink = document.createElement("a");
    csvLink.href = csvUrl;
    csvLink.download = `enriched_${fileName}`;
    csvLink.click();
    URL.revokeObjectURL(csvUrl);

    // Generate and auto-download run report TXT
    const reoonCredits = reoonCreditsRef.current;
    const enrichleyCredits = enrichleyCreditsRef.current;
    const reoonSafe = output.filter((r) => r["Verification"] === "reoon_safe").length;
    const enrichleyValid = output.filter((r) => r["Verification"] === "enrichley_valid").length;

    const foundEmails = output
      .filter((r) => r["Pattern Found Email"])
      .map((r) => `  ${r["Pattern Found Email"]} (${r["Verification"]})`)
      .join("\n");

    const report = [
      `═══════════════════════════════════════════`,
      `  EMAIL PATTERN FINDER — RUN REPORT`,
      `═══════════════════════════════════════════`,
      ``,
      `Date: ${new Date().toLocaleString()}`,
      `File: ${fileName}`,
      `Total rows: ${rows.length}`,
      `Contacts processed: ${totalProcessed}`,
      `Emails found: ${found} (${totalProcessed > 0 ? ((found / totalProcessed) * 100).toFixed(1) : 0}% hit rate)`,
      ``,
      `── Verification Breakdown ──`,
      `  Reoon SAFE:      ${reoonSafe}`,
      `  Enrichley VALID: ${enrichleyValid}`,
      ``,
      `── API Credits Used ──`,
      `  Reoon calls:     ${reoonCredits} (1 credit per call, any result)`,
      `  Enrichley calls: ${enrichleyCredits} (1 credit per call, any result)`,
      `  Total credits:   ${reoonCredits + enrichleyCredits}`,
      ``,
      `── Credit Breakdown ──`,
      `  Reoon: ${reoonCredits} calls → ${reoonSafe} safe, ${enrichleyQueueSize} catch-all/unknown, ${reoonCredits - reoonSafe - enrichleyQueueSize} invalid`,
      `  Enrichley: ${enrichleyCredits} calls → ${enrichleyValid} valid, ${enrichleyCredits - enrichleyValid} invalid`,
      ``,
      `── Found Emails ──`,
      foundEmails || "  (none)",
      ``,
      `═══════════════════════════════════════════`,
    ].join("\n");

    const reportBlob = new Blob([report], { type: "text/plain;charset=utf-8;" });
    const reportUrl = URL.createObjectURL(reportBlob);
    const reportLink = document.createElement("a");
    reportLink.href = reportUrl;
    reportLink.download = `run-report_${fileName.replace(".csv", "")}.txt`;
    setTimeout(() => {
      reportLink.click();
      URL.revokeObjectURL(reportUrl);
    }, 500); // slight delay so browser handles both downloads
  }

  function downloadCSV() {
    const csv = Papa.unparse(resultData);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `enriched_${fileName}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    abortRef.current = true;
    setStatus("idle");
    setCsvData([]);
    setHeaders([]);
    setLogs([]);
    setProgress({ done: 0, total: 0, found: 0 });
    setResultData([]);
    setFileName("");
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "20px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>
        Email Pattern Finder
      </h1>
      <p style={{ color: "#666", fontSize: 13, marginBottom: 24 }}>
        Upload CSV → detect patterns → verify with Reoon + Enrichley → download
        enriched CSV
      </p>

      {/* Step 1: Upload */}
      {status === "idle" && (
        <div
          style={{
            border: "2px dashed #ccc",
            borderRadius: 8,
            padding: 40,
            textAlign: "center",
          }}
        >
          <input
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            style={{ fontSize: 14 }}
          />
        </div>
      )}

      {/* Step 2: Column Mapping */}
      {status === "mapping" && (
        <div>
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>
            Map Columns ({csvData.length} rows loaded)
          </h2>
          <div style={{ display: "grid", gap: 8 }}>
            {(
              [
                ["firstName", "First Name"],
                ["lastName", "Last Name"],
                ["fullName", "Full Name (optional if first+last mapped)"],
                ["website", "Company Website *"],
                ["verifiedEmail", "Verified/Master Email *"],
                ["linkedinProfile", "LinkedIn Profile"],
                ["jobTitle", "Job Title"],
              ] as [keyof ColumnMapping, string][]
            ).map(([key, label]) => (
              <div
                key={key}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <label style={{ width: 250, fontSize: 13 }}>{label}</label>
                <select
                  value={mapping[key]}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [key]: e.target.value }))
                  }
                  style={{
                    flex: 1,
                    padding: "4px 8px",
                    fontSize: 13,
                    border: "1px solid #ccc",
                    borderRadius: 4,
                    backgroundColor: mapping[key] ? "#f0fff0" : "#fff",
                  }}
                >
                  <option value="">— skip —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button
              onClick={startProcessing}
              style={{
                padding: "8px 24px",
                fontSize: 14,
                background: "#000",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Start Processing
            </button>
            <button
              onClick={reset}
              style={{
                padding: "8px 16px",
                fontSize: 14,
                background: "#eee",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Reset
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Processing + Results */}
      {(status === "processing" || status === "done") && (
        <div>
          {progress.total > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  marginBottom: 4,
                }}
              >
                <span>
                  {progress.done}/{progress.total} processed
                </span>
                <span style={{ color: "#16a34a", fontWeight: 600 }}>
                  {progress.found} found
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  background: "#eee",
                  borderRadius: 3,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${(progress.done / progress.total) * 100}%`,
                    background: "#000",
                    transition: "width 0.3s",
                  }}
                />
              </div>
            </div>
          )}

          {/* Log terminal */}
          <div
            style={{
              background: "#111",
              color: "#ddd",
              borderRadius: 8,
              padding: 12,
              fontSize: 12,
              fontFamily: "monospace",
              height: 400,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              lineHeight: 1.5,
            }}
          >
            {logs.map((log, i) => (
              <div
                key={i}
                style={{
                  color:
                    log.type === "success"
                      ? "#4ade80"
                      : log.type === "error"
                      ? "#f87171"
                      : log.type === "warn"
                      ? "#facc15"
                      : "#ddd",
                }}
              >
                {log.msg}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            {status === "processing" && (
              <button
                onClick={() => {
                  abortRef.current = true;
                  addLog("Aborted by user.", "error");
                }}
                style={{
                  padding: "8px 16px",
                  fontSize: 14,
                  background: "#dc2626",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Stop
              </button>
            )}
            {status === "done" && (
              <>
                <button
                  onClick={downloadCSV}
                  style={{
                    padding: "8px 24px",
                    fontSize: 14,
                    background: "#000",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  Download CSV
                </button>
                <button
                  onClick={() => setShowAnneal(!showAnneal)}
                  style={{
                    padding: "8px 16px",
                    fontSize: 14,
                    background: showAnneal ? "#1d4ed8" : "#334155",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  {showAnneal ? "Hide" : "View"} Intelligence
                </button>
                <button
                  onClick={reset}
                  style={{
                    padding: "8px 16px",
                    fontSize: 14,
                    background: "#eee",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  New Upload
                </button>
              </>
            )}
          </div>

          {/* Anneal Intelligence Panel */}
          {showAnneal && annealReport && (
            <div
              style={{
                marginTop: 16,
                background: "#0f172a",
                color: "#e2e8f0",
                borderRadius: 8,
                padding: 16,
                fontSize: 12,
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                lineHeight: 1.6,
                maxHeight: 400,
                overflow: "auto",
              }}
            >
              {annealReport}
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button
                  onClick={() => {
                    const blob = new Blob([exportAnnealData()], {
                      type: "application/json",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "anneal-intelligence.json";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  style={{
                    padding: "4px 12px",
                    fontSize: 11,
                    background: "#334155",
                    color: "#e2e8f0",
                    border: "1px solid #475569",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  Export JSON
                </button>
                <button
                  onClick={() => {
                    if (
                      confirm(
                        "Clear all intelligence data? This cannot be undone."
                      )
                    ) {
                      clearAnnealData();
                      setAnnealReport("Cleared. Run a new batch to start learning.");
                    }
                  }}
                  style={{
                    padding: "4px 12px",
                    fontSize: 11,
                    background: "#334155",
                    color: "#f87171",
                    border: "1px solid #475569",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  Clear History
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
