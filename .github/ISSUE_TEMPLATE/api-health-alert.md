---
name: API Health Alert
about: Report a detected API outage or degradation from the StatPulse monitor
title: "ALERT: "
labels:
  - api-health
  - incident
---

## Alert Details

| Field | Value |
|---|---|
| **Endpoint** | <!-- Structures / Data Query / Codelists --> |
| **URL** | <!-- full URL --> |
| **Timestamp (UTC)** | <!-- ISO 8601 e.g. 2025-03-01T06:00:00Z --> |
| **HTTP status** | <!-- e.g. 503, or "timeout" --> |
| **Response time** | <!-- e.g. 15032ms (timed out) --> |

---

## StatPulse Log Entry

```json
{
  "endpoint": "",
  "url": "",
  "timestamp": "",
  "status": null,
  "ok": false,
  "responseTimeMs": null,
  "contentTypeValid": false,
  "responseSizeKB": null,
  "extraMetric": { "label": "", "value": null },
  "error": ""
}
```

---

## Impact

- [ ] Data Explorer users unable to browse data
- [ ] Automated ETL / import pipelines affected
- [ ] StatPulse dashboard showing DOWN badge
- [ ] Other: <!-- describe -->

---

## Resolution

<!-- Document steps taken to investigate and resolve, and root cause once known. -->

**Resolved at (UTC):**
**Root cause:**
**Prevention:**
