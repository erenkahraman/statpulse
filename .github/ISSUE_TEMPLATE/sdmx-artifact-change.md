---
name: SDMX Artifact Change Request
about: Propose a change to a DSD, Codelist, Concept Scheme, or other SDMX artefact
title: "SDMX: "
labels:
  - sdmx-governance
  - needs-review
---

## Artifact Details

| Field | Value |
|---|---|
| **Artifact type** | <!-- DataStructureDefinition / Codelist / ConceptScheme / Dataflow / ContentConstraint --> |
| **Agency ID** | <!-- e.g. OECD, OECD.CFE --> |
| **Artifact ID** | <!-- e.g. INBOUND_TOURISM_TRIPS --> |
| **Current version** | <!-- e.g. 1.3 --> |
| **Proposed version** | <!-- e.g. 2.0 — follow SemVer: major for breaking changes --> |
| **Target data space** | <!-- e.g. nsi-demo-stable, nsi-prod --> |

---

## Change Description

<!-- What is changing and why. Reference the business requirement or data source change that drives this. -->

---

## Impact Assessment

- [ ] **Breaking change** — existing data files or API consumers will need updating
- **Codelists affected:** <!-- list any codelists that gain, lose, or change codes -->
- **Existing automated processes affected:** <!-- ETL jobs, scheduled imports, report queries -->
- **Data Explorer impact:** <!-- facets, labels, or download formats that will change for end users -->

---

## Governance Checklist

- [ ] DSD audit checklist completed (see `governance/dsd-audit-checklist.md`)
- [ ] All referenced artefacts verified to exist in the target data space
- [ ] Test upload validated against NSI demo environment
- [ ] Data owner approval obtained
