# DSD Audit Checklist — Pre-Promotion to Production

Use this checklist before promoting any Data Structure Definition (DSD) from the
DLM staging environment to a production .Stat Suite data space. Every item must
be checked or explicitly waived with a documented justification.

---

## 1. Identity & Versioning

- [ ] Agency ID follows the agreed naming convention (e.g. `OECD`, `OECD.CFE`)
- [ ] Artifact ID is upper-case, underscore-separated, and descriptive (e.g. `INBOUND_TOURISM_TRIPS`)
- [ ] Version number follows semantic versioning: **major** for breaking changes (removed/renamed dimensions), **minor** for additive changes, **patch** for annotation-only updates
- [ ] `isFinal="true"` is set — draft DSDs must not be promoted
- [ ] English (`en`) name and description are populated
- [ ] French (`fr`) name and description are populated (OECD bilingual requirement)
- [ ] No duplicate ID exists in the target data space at any version

---

## 2. Structural Completeness

- [ ] All mandatory dimensions are defined and in the correct order
- [ ] `TIME_PERIOD` dimension is present and uses the standard time format codelist (`CL_TIME_FORMAT` or SDMX built-in)
- [ ] `FREQ` dimension is present and references a published `CL_FREQ` codelist
- [ ] All referenced codelists have `isFinal="true"` in the target data space
- [ ] All referenced concept schemes exist in the target data space
- [ ] The primary measure is defined (`OBS_VALUE` or domain-specific equivalent)
- [ ] Mandatory attributes (`OBS_STATUS`, `UNIT_MEASURE`, `DECIMALS`) are included
- [ ] Attribute attachment levels (observation, series, dataset) are correct for the data model

---

## 3. Annotation Review

- [ ] `SUPPORT_DATETIME` annotation is present for any sub-daily frequency data
- [ ] Any custom annotations follow the agreed vocabulary in the platform annotation registry
- [ ] Deprecated annotations from previous versions have been removed
- [ ] `LAST_UPDATE` annotation reflects the actual last structural change date

---

## 4. Dependency Verification

- [ ] Every codelist referenced by the DSD exists in the **target** data space (not just staging)
- [ ] Every concept referenced exists in the target data space
- [ ] Content constraints (if any) reference valid codelists and are structurally consistent
- [ ] The DSD validates cleanly against the SDMX 2.1 schema using the NSI validation endpoint (`/rest/schema/datastructure/{agencyID}/{resourceID}/{version}`)
- [ ] No circular references exist between artefacts

---

## 5. Data Lifecycle Readiness

- [ ] `/init/dataflow` has been called in the target data space to register the dataflow
- [ ] A test data upload (minimum one valid observation) has been validated using the NSI import endpoint
- [ ] Advanced validation rules (if configured) pass for the test dataset
- [ ] Embargo settings have been reviewed — confirm whether the dataset is public or restricted at launch
- [ ] The Data Explorer (SDE) index has been refreshed post-upload to confirm facets appear correctly

---

## 6. Sign-off

| Role | Name | Date |
|---|---|---|
| **Reviewer** (data governance) | | |
| **Data Owner** (accountable for content) | | |
| **Platform Administrator** (technical approval) | | |
| **Product Manager** (final sign-off) | | |

**Approved for promotion:** ☐ Yes ☐ No — held pending: _______________
