# Partner Portal SOP

## Add Partner SOP

1. Open the portal and sign in with your organization account.
2. Navigate to `Add Partner`.
3. Complete all required company and contact fields.
4. Paste or draft the capability statement in the structured capability section.
5. Click `Save Partner`.
6. Confirm the partner appears in the database and the audit timeline.
7. In production mode, verify the SharePoint folder exists under `/Partners/<Company>/`.

## Capability Statement SOP

Use this AI prompt:

> As expert BD analyst, create a Six Sigma-validated capability statement for [company] serving [industries]. Return: Overview, Core Competencies (5 bullets), Services, Industries, Differentiators, Past Performance, Certifications. Keep it concise, factual, and proposal-ready.

Process:

1. Generate the capability statement.
2. Review for accuracy and confidentiality.
3. Paste the content into the portal form or directly into the workbook fields.
4. Run the Office Script / Power Automate workflow to refresh the capability PPT output.

## Edit/Delete SOP

1. Open `Partner Database`.
2. Use search or filters to locate the partner.
3. Click `Edit` for updates or `Delete` only after confirming with the record owner.
4. Verify the audit trail reflects the action.

## Maintenance SOP

- Weekly: export and back up `PartnerMasterData.xlsx`.
- Monthly: review site permissions and app registration permissions.
- Monthly: review audit sheet for unusual create/delete/export patterns.
- Before release: run `node --test` and execute a SharePoint integration smoke test.

## Change Management

- All schema changes must be documented before workbook updates.
- Add a migration note when changing columns or capability structure.
- Require at least one reviewer from business operations and one from IT/security.
