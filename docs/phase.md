# Project Progress Log: Doon Anandam CRM

## 1. Project Overview & Agreed Tech Stack
**Doon Anandam CRM** is a production-minded Customer Relationship Management system architected for real estate and enterprise operations.

- **Frontend**: React 18, Vite, JavaScript, SCSS (`sass-embedded`)
- **Backend**: Node.js, Express.js (native ES Modules)
- **Database**: MongoDB Atlas + Mongoose
- **Security & Middlewares**: Helmet, CORS, Express Rate Limit, Cookie Parser, Zod, Dotenv, Bcryptjs, JsonWebToken, verifyOrigin CSRF protection
- **API Testing**: Automated test suites (ESM) / Postman / cURL
- **Deployment Plan**: Render (Frontend & Backend isolated services) + MongoDB Atlas

---

## 2. Reconciled Phase Roadmap
- [x] **Phase 0: Project Foundation & Scaffolding** *(Completed & Verified)*
- [x] **Phase 1: MongoDB Connection Foundation & User Model** *(Completed & Verified)*
- [x] **Phase 2: Secure Authentication & Initial Admin Bootstrap** *(Completed & Verified)*
- [x] **Phase 3: Premium Frontend & Admin User Management** *(Completed & Verified)*
- [x] **Phase 4 (Renumbered as Phase 5): Secure Windsor.ai Integration & Lead Ingestion** *(Completed & Verified - Backend Only)*
- [x] **Phase 6: Secure Lead Management API** *(Completed & Verified - Backend Only)*
- [ ] **Phase 7: Lead Management & Pipeline Tracking UI** *(Upcoming - Frontend)*
- [ ] **Phase 8: Advanced Analytics & Operational Reporting** *(Upcoming)*
- [ ] **Phase 9: Production Hardening & Render/Atlas Deployment** *(Upcoming)*

---

## 3. Current Phase & Status
- **Current Phase**: **Phase 6: Secure Lead Management API**
- **Status**: **Completed & Verified** (All 33 Lead Management API tests passing, 36 backend regression tests passing, client builds with 0 errors)

---

## 4. Phase 6 Implementation Details: Lead Management API

### 4.1 Architecture & Security Standards
1. **Authentication & RBAC**:
   - Gated behind existing `authenticate` middleware (HttpOnly JWT cookie).
   - Strict role scoping:
     - **Sales Executives**: Can strictly view and update status ONLY for leads assigned to their user ID (`assignedTo === req.user._id`). Unassigned leads and leads assigned to other representatives return `404 Not Found` to prevent data leakage and enumeration. Sales executives cannot assign leads (`403 Forbidden`).
     - **Administrators**: Full visibility across all leads within the connected business account; exclusive access to lead assignment and upstream manual sync.
2. **Account Isolation**:
   - All lead queries and mutations enforce `accountId: env.WINDSOR_ACCOUNT_ID` scoping.
   - Prevents cross-tenant or foreign test account leaks (e.g. testing with `OFFICESPAZE.com` account vs production).
3. **CSRF & Origin Protection**:
   - State-changing mutations (`PATCH /api/leads/:id/status`, `PATCH /api/leads/:id/assign`) are protected by `verifyOrigin` middleware and cookie-origin verification.
4. **Validation & Caps**:
   - Request bodies validated with Zod schemas.
   - Safe pagination limits enforced (maximum 50 items per page; default 10).
   - Regex escaping on search strings to prevent ReDoS.
   - Natural case-insensitive alphabetical sorting via MongoDB collation (`{ locale: 'en' }`).
5. **Privacy & Sanitization**:
   - No PII, customer contact credentials, internal password hashes, or `__v` exposed in unauthorized scopes or logs.

---

### 4.2 API Endpoint Contracts

#### 1. Lead Listing — `GET /api/leads`
- **Permissions**: Authenticated (`admin` or `sales_executive`).
- **Query Parameters**:
  - `page` (integer $\ge 1$, default: `1`)
  - `limit` (integer $1..50$, default: `10`)
  - `status` (`new`, `contacted`, `qualified`, `lost`, `converted`, or `all`; default: `all`)
  - `assignedTo` (Admin only: valid 24-hex ObjectId string, or `'unassigned'`)
  - `source` (string, e.g. `'facebook_leads'`)
  - `search` (string, max 100 chars; searches `fullName`, `email`, `phoneNumber`, `campaignName`)
  - `startDate` (ISO date string; filters `leadCreatedAt >= startDate`)
  - `endDate` (ISO date string; filters `leadCreatedAt <= endDate`)
  - `sortBy` (`createdAt`, `leadCreatedAt`, `fullName`, `status`; default: `'createdAt'`)
  - `sortOrder` (`asc` or `desc`; default: `'desc'`)
- **Success Response (HTTP 200)**:
```json
{
  "success": true,
  "leads": [
    {
      "_id": "67f6...",
      "externalLeadId": "100234567890123",
      "source": "facebook_leads",
      "accountId": "754258214430492",
      "accountName": "OFFICESPAZE.com",
      "fullName": "Aarav Sharma",
      "email": "aarav.sharma@example.com",
      "phoneNumber": "+919876543210",
      "formId": "form_123",
      "formName": "Contact Form",
      "campaignName": "Luxury Villas Launch",
      "campaignId": "camp_101",
      "adsetName": "Dehradun High Net Worth",
      "adName": "Villa Ad 1",
      "leadCreatedAt": "2026-03-01T10:00:00.000Z",
      "status": "new",
      "assignedTo": {
        "_id": "67f1...",
        "name": "Rajesh Kumar",
        "email": "rajesh@doonanandam.com",
        "role": "sales_executive"
      },
      "notes": "Interested in 4BHK villa",
      "createdAt": "2026-03-01T10:05:00.000Z",
      "updatedAt": "2026-03-01T10:05:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 37,
    "totalPages": 4
  },
  "page": 1,
  "limit": 10,
  "total": 37,
  "totalPages": 4
}
```

#### 2. Lead Details — `GET /api/leads/:id`
- **Permissions**: Authenticated.
  - `admin`: Any lead within the account.
  - `sales_executive`: Only leads assigned to the authenticated user.
- **Path Parameter**: `id` (24-character hexadecimal MongoDB ObjectId).
- **Responses**:
  - `200 OK`: Returns `{ success: true, lead: { ... } }` with approved CRM fields and populated `assignedTo`.
  - `400 Bad Request`: When `id` is not a valid 24-hex ObjectId string (`{ "success": false, "message": "Invalid lead ID format." }`).
  - `404 Not Found`: When lead does not exist, belongs to another account, or is not assigned to the requesting sales executive.

#### 3. Lead Status Update — `PATCH /api/leads/:id/status`
- **Permissions**: Authenticated.
  - `admin`: Any lead in account.
  - `sales_executive`: Only assigned lead.
- **Request Body**:
```json
{
  "status": "contacted"
}
```
- **Allowed CRM Lifecycle Transitions**:
  - `new` $\rightarrow$ `['contacted', 'qualified', 'lost']`
  - `contacted` $\rightarrow$ `['qualified', 'lost', 'new']`
  - `qualified` $\rightarrow$ `['converted', 'lost', 'contacted']`
  - `lost` $\rightarrow$ `['contacted', 'qualified', 'new']`
  - `converted` $\rightarrow$ `['qualified']`
  - Target status equal to current status is treated as an idempotent no-op (`200 OK`).
- **Responses**:
  - `200 OK`: Returns updated lead record with populated `assignedTo`.
  - `400 Bad Request`: Disallowed lifecycle jump (e.g. `new` $\rightarrow$ `converted`) or unrecognized status value.
  - `404 Not Found`: Lead does not exist or outside user's authorized scope.

#### 4. Lead Assignment — `PATCH /api/leads/:id/assign`
- **Permissions**: Administrator only (`authorize(['admin'])`). Sales executives receive `403 Forbidden`.
- **Request Body**:
```json
{
  "assignedTo": "67f1a2b3c4d5e6f7a8b9c0d1"
}
```
*(Or `null` to unassign the lead)*
```json
{
  "assignedTo": null
}
```
- **Validation Rules**:
  - Target user must exist in database.
  - Target user must be active (`isActive: true`). Deactivated users are rejected with `400 Bad Request`.
  - Target user role must be `sales_executive` or `admin`.
- **Responses**:
  - `200 OK`: Returns updated lead with populated `assignedTo`.
  - `400 Bad Request`: Deactivated user, non-existent user, or invalid user ID.
  - `403 Forbidden`: Non-admin access attempt.
  - `404 Not Found`: Lead not found.

---

## 5. Files Created or Changed in Phase 6

### Backend (`server/`)
- `server/src/schemas/lead.schema.js` — **Created**: Zod schemas for query validation (`leadQuerySchema`), status update (`updateLeadStatusSchema`), assignment (`assignLeadSchema`), and lifecycle graph (`ALLOWED_STATUS_TRANSITIONS`).
- `server/src/middleware/validate.js` — **Modified**: Added `validateQuery` middleware for parsing and coercing query parameters with Zod.
- `server/src/controllers/lead.controller.js` — **Modified**: Added `getLeads`, `getLeadById`, `updateLeadStatus`, and `assignLead` with account isolation, role scoping, safe sorting, and lifecycle enforcement.
- `server/src/routes/lead.routes.js` — **Modified**: Mounted Phase 6 endpoints (`GET /`, `GET /:id`, `PATCH /:id/status`, `PATCH /:id/assign`) with `authenticate`, `authorize`, `verifyOrigin`, and validation middlewares.
- `server/scripts/testLeadManagement.js` — **Created**: Comprehensive 33-test automated suite for all Phase 6 lead management operations.

### Documentation
- `docs/phase.md` — **Modified**: Reconciled roadmap, documented Phase 6 endpoints, status transitions, RBAC permissions, and test verification logs.

---

## 6. Automated Verification and Test Results

| Test Suite / Command | Execution Command | Result | Status |
| :--- | :--- | :--- | :--- |
| **Phase 6 Lead Management Suite (33 tests)** | `node scripts/testLeadManagement.js` | All 33 tests passed (Auth, CSRF, Account Isolation, Role Scoping, Pagination, Search, Safe Sorting, Details, Status Lifecycle, Assignment) | **Passed** |
| **Phase 5 Windsor Sync Regression Suite (12 tests)** | `node scripts/testWindsorSync.js` | All 12 tests passed (URL building, deduplication, field preservation, RBAC, timeouts) | **Passed** |
| **User Management Regression Suite (11 tests)** | `node scripts/testUsers.js` | All 11 tests passed (Admin RBAC, CRUD, deactivation lockout guard) | **Passed** |
| **Auth Regression Suite (13 tests)** | `node scripts/testAuth.js` | All 13 tests passed (Cookie sessions, /me guards, rate limiting) | **Passed** |
| **Frontend Production Build** | `npm run build` in `client/` | 55 modules transformed; built to `dist/` with 0 errors | **Passed** |

---

## 7. Manual Postman / cURL Verification Guide

To test the Phase 6 APIs via Postman or cURL against local dev backend (`http://localhost:5000`):

### 1. Authenticate as Admin
- **Method**: `POST`
- **URL**: `http://localhost:5000/api/auth/login`
- **Headers**: `Content-Type: application/json`
- **Body**:
  ```json
  {
    "email": "<admin_email>",
    "password": "<admin_password>"
  }
  ```
- **Check**: Cookie `da_session` received.

### 2. List Leads with Filters and Pagination
- **Method**: `GET`
- **URL**: `http://localhost:5000/api/leads?page=1&limit=10&status=new&sortBy=createdAt&sortOrder=desc`
- **Check**: HTTP 200 with `leads` array, `pagination: { page, limit, total, totalPages }`.

### 3. Search Leads
- **Method**: `GET`
- **URL**: `http://localhost:5000/api/leads?search=Aarav`
- **Check**: Returns matching leads without regex injection or errors.

### 4. Fetch Lead Details
- **Method**: `GET`
- **URL**: `http://localhost:5000/api/leads/<lead_id>`
- **Check**: HTTP 200 with populated `assignedTo` object and no `passwordHash`.
- **Negative Check**: `GET http://localhost:5000/api/leads/not-an-id` returns HTTP 400.

### 5. Transition Status
- **Method**: `PATCH`
- **URL**: `http://localhost:5000/api/leads/<lead_id>/status`
- **Headers**: `Content-Type: application/json`, `Origin: http://localhost:5173`
- **Body**:
  ```json
  {
    "status": "contacted"
  }
  ```
- **Check**: HTTP 200 with updated status.
- **Negative Check**: Attempting `new` $\rightarrow$ `converted` returns HTTP 400 with allowed transitions listed.

### 6. Assign Lead
- **Method**: `PATCH`
- **URL**: `http://localhost:5000/api/leads/<lead_id>/assign`
- **Headers**: `Content-Type: application/json`, `Origin: http://localhost:5173`
- **Body**:
  ```json
  {
    "assignedTo": "<sales_executive_user_id>"
  }
  ```
- **Check**: HTTP 200 with updated `assignedTo`.
- **Unassign Check**: Sending `{"assignedTo": null}` unassigns the lead.

### 7. Sales Executive Isolation Check
- Login as a `sales_executive` user.
- Call `GET /api/leads`. Verify response returns *strictly* leads assigned to this user.
- Attempt calling `PATCH /api/leads/<lead_id>/assign`. Verify response returns HTTP 403 Forbidden.

---

## 8. Exact Next Step
- **Phase 7: Lead Management & Pipeline Tracking UI**:
  - Build responsive Lead Directory view with status filters, search bar, and assignment chips.
  - Implement interactive Kanban / Pipeline stage board (`new` $\rightarrow$ `contacted` $\rightarrow$ `qualified` $\rightarrow$ `converted` / `lost`).
  - Add Quick Assign and Status Transition action modals for sales reps and admins.
