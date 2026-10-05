# Migration report CSV export
Updated 2026-09-15. API `migrations.exportReport` is a session-only mutation (download audit is written).
Same current owner/admin and configured dedicated workspace checks as the rest of Migration Center.

The terminal-job report is assembled once in the existing transaction, not stitched from paginated browser
responses. It uses the same snapshot helper as the on-screen report. CSV includes a SUMMARY row even with
zero processed rows, then every persisted outcome/validation row. Source physical row numbers remain stable.
Cancelled/failed jobs explicitly retain Remaining rows and Reconciled=false when not fully accounted for.
An export does NOT claim customer records are unchanged or that downstream business value was achieved.

Maximum 5000 row outcomes plus summary; UTF-8 BOM, CRLF, shared formula-neutralizing CSV serializer, 2 MiB
serialized byte cap. Output filename uses only the validated job ID. Raw contact email/name/body are not
included, but source filename and CRM record identifiers are present: treat the downloaded file as private.
The audit stores count/status metadata, never the CSV contents. On authorization or audit failure no file
is returned. The frontend triggers download only after an explicit click and revokes its temporary Blob URL.

Local application tests cover >100 rows, cancelled-empty summary, formula-shaped filename, live authority
revocation and audit failure. Prisma/browser download/production proxy still require real acceptance.
No XLSX parser, merge/update, autonomous import worker or source-retention feature is implied by this export.
