# statpulse Onboarding Guide
**For:** New team members, SIS-CC community evaluators, OECD stakeholders
**Time to complete:** 20 minutes

## What you will learn
- What statpulse monitors and why
- How to read the dashboard
- How to interpret health alerts
- How to trigger manual checks
- How to read weekly reports

---

## Step 1: Understanding the Dashboard (5 min)

Visit the live dashboard at **https://erenkahraman.github.io/statpulse**

The dashboard has 5 main sections:

| Section | What it shows | What to look for |
|---|---|---|
| **Status Cards** | Live uptime % and latest response time for each SDMX endpoint | Red badge = endpoint down; yellow = degraded |
| **Response Time Chart** | Last 20 checks as a line chart per endpoint | Spikes above 3000ms indicate performance issues |
| **Anomaly Alerts** | Warning/critical flags when response time deviates from rolling average | 2× avg = warning; 3× avg = critical |
| **Catalogue Change Report** | Timeline of DSD and Codelist count changes with sparkline | Sudden drops = possible accidental deletion |
| **Weekly Health Reports** | GitHub Issues auto-generated every Monday | Click through to read the full narrative |

### Traffic light guide

| Colour | Meaning | Action |
|---|---|---|
| 🟢 All green | Platform healthy, no action needed | None required |
| 🟡 Any yellow | Degraded — elevated response times or partial uptime | Check if SIS-CC have announced maintenance on their status page |
| 🔴 Any red | Potential incident — endpoint down or critical anomaly | Check GitHub Issues for latest status update |

---

## Step 2: Reading a Weekly Report (5 min)

Navigate to the **Issues** tab on this repository → filter by label **`weekly-report`** → open the most recent issue.

Each section of the report explained:

| Section | What it means | When to escalate |
|---|---|---|
| **Uptime %** | Successful checks ÷ total checks × 100 over the past 7 days | Below 99.5% triggers the API Availability KPI alert |
| **Average response time** | Mean responseTimeMs across all checks in the period | Above 3000ms at p95 triggers the Response Time KPI |
| **Catalogue stability** | Change in DSD and Codelist counts vs. the previous week | Drop of >10 warrants a data governance investigation |
| **Anomaly count** | Number of warning/critical deviations detected | Any critical anomaly should be investigated within 24h |

---

## Step 3: Running a Manual Health Check (5 min)

1. Click the **Actions** tab in this repository
2. Select **API Health Check** from the workflow list on the left
3. Click **Run workflow** → select branch `main` → click the green **Run workflow** button
4. Wait ~30 seconds for the job to complete
5. The workflow commits updated results to `data/health-log.json` and the dashboard reflects them within seconds

---

## Step 4: Understanding Catalogue Changes (5 min)

**What is a DSD (DataStructure Definition)?**
A DSD defines the dimensions, attributes, and measures for a statistical dataset. It is the SDMX equivalent of a database schema. The Structures endpoint returns all DSDs published on the NSI.

**What a count change means:**

| Change | Likely cause | Action |
|---|---|---|
| DSD count +1 to +5 | New dataset published through DLM | Normal — confirm in DLM publication log |
| DSD count -1 to -5 | Dataset retired or temporarily de-published | Contact DLM Team to confirm it was intentional |
| DSD count dropped by >10 | Bulk deletion or NSI misconfiguration | Contact data governance team immediately |
| Codelist count change | Codelist added, versioned, or retired | Review in DLM — codelists are shared dependencies |

---

## When to escalate

| Symptom | Likely cause | Action |
|---|---|---|
| All endpoints DOWN | NSI service outage | Check SIS-CC status page; open a GitHub Issue with label `health-alert` |
| One endpoint slow | Network or load issue | Monitor next 2 checks (12 hours); escalate if persists |
| DSD count dropped by >10 | Bulk deletion or NSI misconfiguration | Contact data governance team |
| Weekly report shows anomalies | Intermittent issues | Review `data/health-log.json` for patterns |
| Audit report shows critical violations | Dashboard accessibility regression | Fix before next release — blocks deployment per KPI |
