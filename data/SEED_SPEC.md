# HLT-06 synthetic seed data

The idempotent Prisma seed is backend/prisma/seed.js and runs with npm run db:seed.

It creates three synthetic User accounts (two providers and one reviewer), three DenialReason records with typed evidence rules, three Claims, four Denials (including two denials on one claim), eight Evidence records, one AppealLetter, and three AppealCitation records. All identifiers, payer labels, summaries, dates, and amounts are fictional examples. No patient names, dates of birth, medical record numbers, or real payer data are included.

Demo-only local credentials:

- billing.one@example.test / DemoProvider1!
- billing.two@example.test / DemoProvider2!
- reviewer.one@example.test / DemoReviewer1!

The seed refuses to run in production unless ALLOW_SYNTHETIC_SEED=true is explicitly set. Do not use these demo passwords outside a local development database.