# SharePoint Setup Guide

## 1. Create The SharePoint Site

1. Create or reuse an internal SharePoint Online team site for partner operations.
2. Create a document library or use `Shared Documents`.
3. Create a folder named `Partners`.

## 2. Prepare The Master Workbook

1. Create `PartnerMasterData.xlsx`.
2. Add worksheets:
   - `Partners`
   - `Capabilities`
   - `Audit`
   - `CapabilityTemplate` (optional, for Office Script output staging)
3. Add tables with exact names:
   - `TablePartners`
   - `TableCapabilities`
   - `TableAudit`

### Suggested Columns

#### Partners

`Employee | Company | Website | Contact | Email | Technologies | Status | Opportunities | EventID | Notes | CapabilityJSON`

#### Capabilities

`Company | Overview | CoreCompetencies | Services | Industries | Differentiators | PastPerformance | Certifications`

#### Audit

`Timestamp | User | Action | Details`

## 3. Register The Entra Application

1. Create an app registration in Microsoft Entra ID.
2. Add SPA redirect URI matching the portal URL.
3. Grant delegated Microsoft Graph permissions:
   - `User.Read`
   - `Files.ReadWrite.All`
   - `Sites.ReadWrite.All`
4. Grant admin consent.

## 4. Collect Runtime IDs

Capture the following and place them in `CONFIG` inside `app.js`:

- `clientId`
- `authority`
- `siteId`
- `driveId`
- `workbookPath`
- `partnerRootFolder`

## 5. Provision Permissions

- Site Members: edit
- Site Visitors: read
- Remove anonymous sharing
- Restrict external sharing at tenant/site level

## 6. Enable Power Automations

- Use `scripts/generate-capability-ppt.ts` in Excel Online / Office Scripts.
- Optionally trigger the script after a new capability row is appended.
- Save generated PPT content into `/Partners/<Company>/CapabilityPPT.pptx` through Power Automate or a serverless worker.

## 7. Important Implementation Note

The included UI can read partner/audit ranges and append new rows. Production-grade update/delete operations should be completed with stable row IDs or a service layer that resolves exact Excel table row identities before mutation. This is the safest way to avoid accidental row overwrite/deletion.
