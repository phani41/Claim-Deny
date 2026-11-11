# HLT-06 Setup, Role-Based Workflows & Indian Healthcare Integration

## Overview

ClaimDesk (HLT-06) is a comprehensive healthcare claim denial analysis and appeal-letter assistant. It has been integrated with realistic synthetic Indian healthcare scenarios, INR (`₹`) currency formatting, authentic Indian provider hospitals, fictional health insurers, and strict role-based access control.

### Architecture & Boundaries

- **`frontend/`**: React 19 + Vite + Tailwind CSS + Lucide Icons. Role-protected routing, dynamic role-specific navigation, interactive demo credentials selector, and custom role dashboards (`/admin/dashboard`, `/billing/dashboard`, `/reviewer/dashboard`). Communicates exclusively with the Node API.
- **`backend/`**: Node.js (Express 5), Prisma 7 with SQLite (`dev.db`), JWT authentication with role authorization middleware, bcrypt password hashing, PDF/DOCX file storage in `backend/uploads/`. SQLite is the single source of truth for all application records.
- **`ai-service/`**: Python 3.11 + FastAPI, LangGraph workflow, Docling extraction, and persistent ChromaDB vector store (`ai-service/.data/chroma`). Features a local fallback embedding model (Chroma ONNX) and a deterministic grounded fallback generator if external AI credentials are offline. Python never accesses SQLite directly.

---

## Seeded Indian Demo Accounts

All demo accounts use password **`Demo@123`** (hashed with bcrypt in SQLite):

| Name | Work Email | Role | Default Dashboard | Key Permissions |
| :--- | :--- | :--- | :--- | :--- |
| **Arjun Reddy** | `admin@demo.in` | `ADMIN` | `/admin/dashboard` | Manage users (create, edit, activate/deactivate), view all claims & appeals, system stats & analytics |
| **Priya Sharma** | `billing@demo.in` | `BILLING_SPECIALIST` | `/billing/dashboard` | Manage authorized claims, analyze denials, upload documents, generate AI appeals, submit for review |
| **Rahul Varma** | `reviewer@demo.in` | `REVIEWER` | `/reviewer/dashboard` | Review queue, inspect appeal citations, approve appeals, reject appeals with mandatory comments |
| **Sneha Nair** | `billing2@demo.in` | `BILLING_SPECIALIST` | `/billing/dashboard` | Second specialist for facility scoping and isolation |
| **Karthik Rao** | `reviewer2@demo.in` | `REVIEWER` | `/reviewer/dashboard` | Second reviewer for multi-reviewer assignment |

*(Note: Legacy backward-compatible testing users `billing.one@example.test`, `billing.two@example.test`, and `reviewer.one@example.test` also remain seeded for legacy test suite execution).*

---

## Synthetic Indian Healthcare Dataset

- **Hospitals / Facilities**:
  - Sri Venkateswara Multispeciality Hospital — Hyderabad
  - Aadhya Multispeciality Hospital — Bengaluru
  - Lakshmi Narayana Medical Centre — Vijayawada
  - Sunrise Super Speciality Hospital — Chennai
  - Sree Sai Institute of Medical Sciences — Visakhapatnam
  - Ananya Care Hospital — Pune
  - Veda Multispeciality Hospital — Kochi
- **Insurers**: Bharat Health Assurance, Aarogya General Insurance, Suraksha Health Insurance, National Care Insurance, PrimeShield Health Assurance.
- **Claims**: 10 realistic Indian claims (CLM-1001 to CLM-1010) ranging from ₹45,000 to ₹2,10,000 across multiple stages (`SUBMITTED`, `DENIED`, `UNDER_REVIEW`, `APPEAL_DRAFT`, `SUBMITTED_FOR_REVIEW`, `APPROVED`, `REJECTED`).
- **Documents & Evidence**: Real sample PDF documents in `backend/uploads/` for claims CLM-1001 through CLM-1005 with extracted chunks indexed in persistent ChromaDB.

---

## Quick Start (PowerShell)

### 1. AI Service

```powershell
cd ai-service
# Active python venv
.venv\Scripts\Activate.ps1
# Run unit tests (21 tests)
python -m unittest discover -s tests -v
# Start service on port 8001
python -m uvicorn app.main:app --port 8001
```

### 2. Backend API

```powershell
cd backend
npm install
npm run prisma:generate
npm run db:deploy
npm run db:seed
# Run unit & isolation tests (9 tests)
npm test
# Start development server on port 3000
npm run dev
```

### 3. Frontend Web Application

```powershell
cd frontend
npm install
npm run build
npm run dev
```
Open **`http://127.0.0.1:5173`** in your browser.

---

## End-to-End Validation Suite

To execute the automated end-to-end integration test exercising all roles, authentication, authorization bounds, ChromaDB RAG retrieval, draft editing, rejection with mandatory comment, and reviewer final approval:

```powershell
node backend/scripts/validate_e2e.js
```
Expected output:
```
=== 1. System Health Check ===
✔ Backend SQLite Database is healthy.
=== 2. Demo User Authentication & Roles ===
✔ Admin logged in: Arjun Reddy (ADMIN)
✔ Billing Specialist logged in: Priya Sharma (BILLING_SPECIALIST)
✔ Reviewer logged in: Rahul Varma (REVIEWER)
=== 3. GET /auth/me Verification ===
✔ GET /auth/me verified for authenticated sessions.
=== 4. Role Authorization Boundaries & Enforcements ===
✔ Billing specialist denied access to admin users endpoint (403 Forbidden).
✔ Reviewer denied permission to create claims (403 Forbidden).
=== 5. Admin Capabilities: Statistics & User Management ===
✔ Admin stats retrieved: claims & users.
✔ Admin created new user.
✔ Admin deactivated user account.
✔ Deactivated user blocked from logging in (401).
=== 6. Billing Specialist Workflow: Indian Claims, Denial & RAG Appeal Draft ===
✔ Specialist loaded authorized claims.
✔ Verified INR currency on CLM-1001: ₹85,000.00 at Sri Venkateswara Multispeciality Hospital
✔ Denial inspected & ChromaDB RAG retrieval succeeded.
✔ Specialist updated draft and submitted for review (SUBMITTED_FOR_REVIEW).
=== 7. Reviewer Workflow: Review Queue, Rejection & Approval ===
✔ Reviewer inspected queue.
✔ Specialist prevented from self-approving appeal (403 Forbidden).
✔ Rejection without comment rejected by validation (400 Bad Request).
✔ Reviewer rejected appeal with feedback comment (REJECTED).
✔ Specialist verified feedback, revised draft, and resubmitted.
✔ Reviewer approved appeal (APPROVED) with timestamp!
🎉 ALL END-TO-END WORKFLOW INTEGRATION CHECKS PASSED!
```
