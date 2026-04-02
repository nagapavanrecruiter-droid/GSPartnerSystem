# Six Sigma DMAIC Validation

## Define

- Problem statement: partner tracking is fragmented, lacks auditability, and requires a secure internal workflow with SharePoint as the system of record.
- Goal: centralize partner management while reducing data-handling defects, access risks, and manual synchronization failures.
- CTQs:
  - Data accuracy in workbook rows
  - Controlled internal access
  - Reliable audit logging
  - Consistent folder/workbook synchronization

## Measure

- Baseline assumptions before implementation:
  - Manual entry inconsistency risk: high
  - Missing audit trail risk: high
  - Duplicate partner records risk: medium
  - SharePoint folder provisioning delay risk: medium
- Target metrics:
  - Validation defect escape rate: 0 critical defects in tested logic
  - Unauthorized access rate: 0 accepted external accounts
  - Audit coverage: 100% of create/update/delete/export actions

## Analyze

### FMEA

| Failure Mode | Effect | Cause | Severity | Occurrence | Detection | RPN | Mitigation |
|---|---|---:|---:|---:|---:|---:|---|
| External user signs in | Confidential data exposure | Weak tenant restriction | 10 | 3 | 3 | 90 | Entra sign-in plus post-login domain validation and SharePoint membership control |
| Workbook row corruption | Data integrity loss | Manual schema drift or malformed writes | 9 | 4 | 4 | 144 | Named Excel tables, schema guide, input validation, migration adapter |
| Burst Graph writes lock workbook | Failed updates | Parallel writes | 7 | 5 | 4 | 140 | Rate-limited Graph queue and retry strategy |
| Missing audit row | Compliance gap | Partial failure after mutation | 8 | 3 | 4 | 96 | Append audit immediately after mutation with monitoring SOP |
| XSS payload in notes | UI compromise | Unsanitized rendering | 9 | 3 | 2 | 54 | Sanitization helpers, escaped rendering, CSP |
| Incorrect partner deletion | Record loss | Poor row identity mapping | 9 | 2 | 5 | 90 | Require stable workbook row IDs before production delete enablement |

## Improve

- Built sanitization and validation helpers in `lib/core.js`.
- Added migration utilities for workbook compatibility.
- Centralized analytics and export functions to reduce duplicate logic.
- Included test coverage for critical input/data transformations.
- Added deployment checklist and setup automation artifacts for repeatable rollout.

## Control

- Audit sheet governs mutation evidence.
- SOPs define onboarding, workbook backups, permission reviews, and release checks.
- Release gate should require:
  - passing unit tests
  - successful SharePoint integration smoke test
  - security checklist review
  - documented rollback approach
