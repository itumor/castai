# 05 — Database Optimizer: What's Supported + Contract Check

## Product facts (public docs, current)

[DB Optimizer supported platforms](https://docs.cast.ai/docs/dbo-supported-platforms):

| Database | Versions | Status |
|---|---|---|
| PostgreSQL | 13–18 | Full support |
| Amazon Aurora PostgreSQL | 13–18 | Full support |
| MySQL | 5.7–9 | Full support |
| Amazon Aurora MySQL | 5.7–9 | Full support |

> Meeting notes said "currently only supports RDS Postgres" — that's outdated:
> **MySQL and Aurora MySQL are now full support**. **MSSQL** (also in Siemens' footprint) is
> **not** supported yet; roadmap inquiries go to support@cast.ai.
> Getting started: [DBO quick-start](https://docs.cast.ai/docs/dbo-quick-start-guide).

## Is DB Optimizer in Siemens' contract? — check list

External answer can't be fetched from docs; it's an internal commercial fact. Steps:

1. ☐ Pull the Siemens order form / MSA schedule (Salesforce/CPQ → ask the Account Executive)
   and look for "Database Optimizer" / "DBO" line item or product tier.
2. ☐ Cross-check org entitlements for `5e413e89-eb67-48fb-b81c-6172baa988ed` with the
   contract-operations / billing team (or the console Org Settings → enabled products if visible).
3. ☐ If **not** included: answer should state price/terms to quote; otherwise state it's included
   and which cloud/provider coverage (RDS/Aurora) applies.
4. ☐ Record outcome in this file and relay to Siemens at the follow-up session.

## Siemens-side blockers to surface (from meeting)

- **D2 data privacy/compliance review** not yet done for DBO — pilot stays blocked until their
  security/compliance process completes it. Provide the DBO data-collection description
  ([platform permissions & data privacy](https://docs.cast.ai/docs/platform-permissions-and-data-privacy))
  as input to that review.
- Existing security tooling: **Wiz** covers their vulnerability scanning — do not push
  Cast AI security features in the follow-up.

## Suggested one-line answer to Siemens (until contract check completes)

"DBO supports Postgres and MySQL today (not MSSQL). I'm confirming whether it's covered under your
current Cast AI contract; either way the pilot also needs your D2 privacy review, which I can feed
with our data-collection documentation."
