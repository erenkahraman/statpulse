# How to Add a New Monitored Endpoint
**Audience:** Developer or PM onboarding a new .Stat Suite instance
**Time:** 30 minutes

Adding a new endpoint requires changes in three files and one PR. Follow these steps in order.

---

## Step 1: Add the endpoint to `scripts/check-health.js`

Open `scripts/check-health.js` and find the `ENDPOINTS` array (line 67). Each entry follows this shape:

```javascript
{
  name: 'Structures',                  // label used in dashboard and health log
  url:  'https://...',                 // fully-qualified public URL, no auth
  extraMetric: (body) => ({            // extract a domain-specific metric from the response body
    label: 'DataStructure count',
    value: (body.match(/DataStructure/g) || []).length,
  }),
},
```

Add your new endpoint **after** the existing three entries:

```javascript
// Example: a new NSI instance for a national statistics office
{
  name: 'NSO Instance',
  url:  'https://nsi-nso-example.siscc.org/rest/datastructure/all/all/all?detail=allstubs',
  extraMetric: (body) => ({
    label: 'DataStructure count',
    value: (body.match(/DataStructure/g) || []).length,
  }),
},
```

**Choosing your `extraMetric`:**

| Endpoint type | Recommended metric | Pattern |
|---|---|---|
| `/rest/datastructure/...` | DataStructure count | `(body.match(/DataStructure/g) \|\| []).length` |
| `/rest/codelist/...` | Codelist count | `(body.match(/Codelist/g) \|\| []).length` |
| `/rest/data/...` | Response size KB | `(Buffer.byteLength(body, 'utf8') / 1024).toFixed(2)` |

---

## Step 2: Register the name in `dashboard/index.html`

Open `dashboard/index.html` and find line 1568:

```javascript
const ENDPOINT_NAMES = ['Structures', 'Data Query', 'Codelists'];
```

Add your new endpoint name to the array (must match `name` exactly):

```javascript
const ENDPOINT_NAMES = ['Structures', 'Data Query', 'Codelists', 'NSO Instance'];
```

The dashboard reads this array to render status cards and group health-log entries. No other dashboard changes are needed — the card renders automatically.

---

## Step 3: Add an availability KPI to `governance/kpis.yaml`

Open `governance/kpis.yaml` and append a new entry following the existing pattern:

```yaml
- id: nso-instance-availability
  name: NSO Instance API Availability
  category: Reliability
  description: >
    Percentage of scheduled health checks where the NSO Instance endpoint
    returns HTTP 200 within the timeout window.
  target: ">= 99.5%"
  measurement: "(successful checks / total checks) × 100, rolling 30-day window"
  frequency: Every 6 hours (automated via GitHub Actions)
  owner: Platform Operations
  related_sdmx_component: .Stat Core NSI web service (NSO deployment)
```

---

## Step 4: Test locally

```bash
# Run a single health check and verify the new endpoint appears in the output
npm run check

# Inspect the updated log file
cat data/health-log.json | grep "NSO Instance" | tail -5

# Preview the dashboard with the new card
cp data/health-log.json dashboard/health-log.json
open dashboard/index.html
```

Confirm:
- The new endpoint appears in `data/health-log.json` with `ok`, `responseTimeMs`, and `extraMetric` fields
- A new status card renders in the dashboard
- No JavaScript errors in the browser console

---

## Step 5: Submit a PR

Use the **SDMX Artefact Change** issue template (`.github/ISSUE_TEMPLATE/sdmx-artifact-change.md`) to document the new endpoint before opening the pull request. The PR description should reference the issue number and confirm that Step 4 passed locally.

Label the PR: `endpoint-change`, `governance`.
