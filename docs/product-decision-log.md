# Product Decision Log
**Purpose:** Records the reasoning behind major product decisions.
A PM artifact that makes architectural choices transparent and reviewable.

---

## 2026-02 — Chose GitHub Issues for weekly reports instead of email

**Context:** Needed a stakeholder reporting mechanism to surface platform health data to OECD stakeholders and SIS-CC community members on a regular cadence.

**Options considered:**
- Email via SendGrid — automated delivery, but no permanent archive, no versioning, requires an external account and API key
- Slack webhook — real-time, but not all stakeholders are on the same Slack workspace, and messages are ephemeral
- GitHub Issues with weekly-report label — co-located with the codebase, searchable, linkable from the dashboard

**Decision:** GitHub Issues with `weekly-report` label, auto-generated every Monday 09:00 UTC via GitHub Actions.

**Rationale:** Keeps governance artefacts version-controlled, searchable, and co-located with the codebase. Aligns with SIS-CC's GitLab-first workflow. Zero additional infrastructure cost. Reports are linkable directly from the dashboard, giving stakeholders a single entry point.

**Outcome:** Reports auto-generate every Monday, linked from dashboard. Issues persist indefinitely as an auditable history of platform health.

---

## 2026-02 — Chose JSON file in repo over database for health log storage

**Context:** Needed persistent storage for monitoring data that the dashboard could read without a backend API layer.

**Options considered:**
- PostgreSQL — reliable, queryable, but requires a hosted instance and introduces infrastructure cost and operational overhead
- Redis — fast, but ephemeral by default; adds infrastructure
- S3 — low cost, but requires AWS credentials in CI and a backend fetch layer in the dashboard
- JSON file committed to git by CI bot — no infrastructure, full version history, human-readable

**Decision:** JSON file (`data/health-log.json`) committed to the repository by the GitHub Actions bot after each health check.

**Rationale:** No infrastructure cost, full version history via git, human-readable for debugging, and directly servable to GitHub Pages dashboard without a backend API layer. The file is capped at 200 entries to control size.

**Tradeoff accepted:** File grows with each check (mitigated by 200-entry rolling cap). Not suitable for high-frequency monitoring (unsuitable above ~4 checks/hour before git history becomes unwieldy).

**Outcome:** Works reliably at 6-hour intervals. File size stable at ~200 entries. Dashboard reads it as a static asset with no CORS or auth complexity.

---

## 2026-02 — Chose rolling average anomaly detection over fixed thresholds

**Context:** Needed to detect API slowdowns without generating false positives that would erode stakeholder trust in alerts.

**Options considered:**
- Fixed threshold (e.g., alert if response time > 2000ms) — simple, but fails for endpoints with naturally varying baseline performance
- Rolling average deviation — self-calibrates to each endpoint's normal behaviour

**Decision:** 10-check rolling average with 2× deviation factor for WARNING and 3× for CRITICAL (`ANOMALY_WARNING_FACTOR` and `ANOMALY_CRITICAL_FACTOR` constants in `scripts/check-health.js`).

**Rationale:** Fixed thresholds fail for endpoints that are consistently slower due to query complexity (e.g., the Data Query endpoint fetching a full SDMX dataset vs. the Structures endpoint returning stubs). Rolling average self-calibrates to each endpoint's normal behaviour, reducing false positives. The 5-sample minimum (`ANOMALY_MIN_SAMPLES`) prevents cold-start false positives.

**Outcome:** Anomaly detection fires accurately on genuine degradation events. Zero false positives observed during the first 30 days of operation across three endpoints with different baseline response profiles.

---

## 2026-06 — AI discoverability audit: robots.txt proxy for content access

**Context:** The OECD Communications role JD references "bot activity / content access / AI discoverability" as a measurement area. StatPulse has no access to server-level access logs for oecd.org. A configuration audit of publicly available robots.txt files and llms.txt presence is the highest-fidelity proxy available without infrastructure access.

**Decision:** `scripts/ai-crawler-audit.js` fetches `/robots.txt` and `/llms.txt` for five priority OECD domains and classifies each of 11 AI crawlers as allowed/blocked/partial. Results are committed to `data/ai-crawler-audit.json` and visualised in the Governance view.

**Key findings from first audit run (2026-06-14):**
- `data-explorer.oecd.org` — only OECD domain with `llms.txt` present (✅). All crawlers allowed.
- `sdmx.oecd.org` — no robots.txt (404 = all crawlers allowed by default).
- `www.oecd.org` and `oecd.ai` — partial blocks (some paths restricted, root accessible).
- `www.oecd-ilibrary.org` — robots.txt returns 403 (treated as no-rules → allowed by RFC).
- No OECD domain fully blocks any of the 11 priority AI crawlers.

**Limit acknowledged:** robots.txt is a polite convention, not enforcement. Cloudflare, WAF rules, or rate-limiting can block crawlers independently of robots.txt. This audit measures declared intent, not actual access.

**Rationale:** For a portfolio-level intelligence tool, declared intent is measurable, reproducible, and sufficient for the JD's "discoverability" signal without requiring privileged server access.

---

## 2026-06 — Grounded chat + AI-visibility measurement design

**Context:** The product brief required two connected capabilities: (a) a chat panel that answers OECD statistical questions using live SDMX data, and (b) a measurement layer that scores how public AI systems represent OECD content.

**Design chosen:** Single grounded-answer pipeline (`api/chat.js`) powers both capabilities. The chat panel calls it live; the AI-visibility probe (`scripts/ai-visibility-probe.js`) calls it to get the SDMX ground truth, then compares it against an ungrounded Gemini call using a third Gemini "judge" call with thinking enabled.

**Rationale:** Reusing the grounded pipeline for the probe means the ground truth is always the same authoritative SDMX data the dashboard already fetches — no separate data-sourcing logic. The judge's thinking mode is left enabled so it can reason through nuanced accuracy calls (e.g. "stale but directionally right") rather than pattern-matching on keywords.

**Tradeoff accepted:** Each probe question makes 3 Gemini calls (grounded intent + ungrounded + judge), so a 10-question battery costs ~30 API calls/day. Kept at daily cadence to control cost.

**Outcome:** Probe, workflow, and dashboard AI-visibility section all operational in Phase 3–4.

---

## 2026-06 — Gemini model choice: gemini-2.5-flash + thinkingBudget: 0 for chat

**Context:** During Phase 1 development, the initial model (`gemini-2.0-flash`) returned HTTP 404 on the project's API key (model deprecated/unavailable). Switching to `gemini-2.5-flash` resolved this. However, `gemini-2.5-flash` with default settings consumed the entire `maxOutputTokens` budget on internal reasoning ("thinking tokens"), leaving no tokens for the actual answer text — returning an empty `parts` array.

**Decision:** Set `thinkingConfig: { thinkingBudget: 0 }` in `generationConfig` for the chat path (intent mapping and grounded-answer generation). For the AI-visibility judge, `thinkingBudget` is intentionally NOT set to zero, so the judge can reason through accuracy scoring.

**Rationale:** Chat responses need to be fast and deterministic; thinking tokens add latency and cost with no benefit for straightforward grounding tasks. The judge benefits from reasoning because accuracy scoring is genuinely ambiguous (stale vs. wrong, regional vs. national averages). Configuring them differently keeps each path optimised for its task.

**Outcome:** Baked into `api/chat.js` as a documented constant. Judge calls in `scripts/ai-visibility-probe.js` omit `thinkingBudget` to let the model use its default.

---

## 2026-06 — Phase 2 accessibility baseline fixes

**Context:** After adding the AI chat panel to `dashboard/index.html` in Phase 2, the automated axe-core audit revealed three classes of WCAG 2.1 AA violations that had existed before the panel was added: `aria-required-children` (critical), `aria-hidden-focus` (serious), and widespread low-contrast text (serious, 6+ occurrences).

**Fixes applied:**
- `aria-required-children`: removed `role="tablist"` from `.nav-links` (buttons had no `role="tab"`)
- `aria-hidden-focus`: replaced `aria-hidden="true"` on `#detail-panel` with the `inert` attribute, and toggled `inert` in JS open/close handlers
- Color contrast: replaced all `#64748b`, `#334155`, `#475569` (failing at ~2–4:1 on `#0d1117`) with `#7b8ea4` (~5.9:1) across ~20 CSS rules

**Rationale:** `inert` is the correct modern approach for panels that should be invisible to focus traversal — it suppresses both tab focus and screen-reader interaction, unlike `aria-hidden` alone which only hides from the accessibility tree but lets keyboard focus enter. The `#7b8ea4` value was chosen as the minimum contrast-compliant muted color that still reads as secondary on the dark background.

**Outcome:** Zero critical violations on audit (was 3 before fix). Documented in governance/accessibility-audit.md.

---

## 2026-02 — Dual sparkline charts instead of shared Y-axis

**Context:** The Catalogue Change Report needed to visualise both DSD count (~530) and Codelist count (~2591) on the same chart. The 5× magnitude difference between the two series created a layout problem.

**Options considered:**
- Single chart with shared Y-axis — simple, but collapses the smaller series (DSDs) to the chart floor, making variance invisible
- Normalised percentage chart — hides absolute values, which matter for governance (a drop from 530 to 520 DSDs is meaningful even if the percentage change is small)
- Two independent Chart.js instances with per-series auto-scaling — each metric has its own meaningful visual range

**Decision:** Two independent Chart.js sparkline instances, each with its own auto-scaled Y-axis.

**Rationale:** Shared axis collapses the smaller series, making variance invisible. Normalised % chart obscures absolute values which matter for governance. Dual charts give each metric its own meaningful visual range while keeping the layout compact via a two-column CSS grid.

**Outcome:** Both series are readable. Stakeholders can detect a 10-DSD drop without it being obscured by the Codelist series scale.
