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

## 2026-02 — Dual sparkline charts instead of shared Y-axis

**Context:** The Catalogue Change Report needed to visualise both DSD count (~530) and Codelist count (~2591) on the same chart. The 5× magnitude difference between the two series created a layout problem.

**Options considered:**
- Single chart with shared Y-axis — simple, but collapses the smaller series (DSDs) to the chart floor, making variance invisible
- Normalised percentage chart — hides absolute values, which matter for governance (a drop from 530 to 520 DSDs is meaningful even if the percentage change is small)
- Two independent Chart.js instances with per-series auto-scaling — each metric has its own meaningful visual range

**Decision:** Two independent Chart.js sparkline instances, each with its own auto-scaled Y-axis.

**Rationale:** Shared axis collapses the smaller series, making variance invisible. Normalised % chart obscures absolute values which matter for governance. Dual charts give each metric its own meaningful visual range while keeping the layout compact via a two-column CSS grid.

**Outcome:** Both series are readable. Stakeholders can detect a 10-DSD drop without it being obscured by the Codelist series scale.
