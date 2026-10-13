# Project Progress Log: Doon Anandam CRM

## 1. Project Overview & Agreed Tech Stack
**Doon Anandam CRM** is a production-minded Customer Relationship Management system architected for real estate and enterprise operations.

- **Frontend**: React 18, Vite, JavaScript, SCSS (`sass-embedded`)
- **Backend**: Node.js, Express.js (native ES Modules)
- **Database**: MongoDB Atlas + Mongoose
- **Security & Middlewares**: Helmet, CORS, Express Rate Limit, Cookie Parser, Zod, Dotenv, Bcryptjs, JsonWebToken
- **API Testing**: Postman / cURL / PowerShell REST client
- **Deployment Plan**: Render (Frontend & Backend isolated services) + MongoDB Atlas

---

## 2. Phase Roadmap
- [x] **Phase 0: Project Foundation & Scaffolding** *(Completed & Verified)*
- [x] **Phase 1: MongoDB Connection Foundation & User Model** *(Completed & Verified)*
- [x] **Phase 2: Secure Authentication & Initial Admin Bootstrap** *(Completed & Verified)*
- [ ] **Phase 3: Role-Based Access Control (RBAC) & Protected Routes**
- [ ] **Phase 4: Employee & User Management**
- [ ] **Phase 5: Lead Management & Pipeline Tracking**
- [ ] **Phase 6: Windsor.ai Integration & Marketing Analytics**
- [ ] **Phase 7: Dashboard Analytics & Operational Reporting**
- [ ] **Phase 8: Production Hardening & Render/Atlas Deployment**

---

## 3. Current Phase & Status
- **Current Phase**: Phase 2: Secure Authentication & Initial Admin Bootstrap
- **Status**: Completed & Verified

---

## 4. Completed Tasks
- [x] **JWT Environment Validation**:
  - Implemented `validateAuthEnv()` in `server/src/config/env.js` ensuring `JWT_SECRET` is present and at least 32 characters long.
- [x] **JWT Token & Cookie Utilities (`server/src/utils/jwt.js`)**:
  - Implemented `signToken()` and `verifyToken()` using `jsonwebtoken`.
  - Configured secure cookie attributes: `HttpOnly: true`, `SameSite: Lax` in dev and `None` in production, `Secure` in production, with 7-day expiration.
  - Implemented `getClearAuthCookieOptions()` for reliable cookie clearing upon logout.
- [x] **Request Validation with Zod (`server/src/schemas/auth.schema.js`, `server/src/middleware/validate.js`)**:
  - Validates login request bodies for required trimmed email and password fields.
  - Returns structured `400 Bad Request` with field-level error messages.
- [x] **Rate Limiting & Security Middlewares**:
  - Created `loginLimiter` in `server/src/middleware/rateLimiter.js` limiting login attempts to 10 per 15 minutes per IP.
  - Implemented `verifyOrigin` in `server/src/middleware/verifyOrigin.js` protecting cookie-authenticated state-changing endpoints against cross-origin request abuse (CSRF).
  - Configured CORS in `server/src/app.js` with credentials support and origin restrictions.
- [x] **Authentication Controller & Routes (`server/src/controllers/auth.controller.js`, `server/src/routes/auth.routes.js`)**:
  - `POST /api/auth/login`: Validates credentials, executes dummy hash check on nonexistent accounts to mitigate timing attacks, checks `user.isActive`, issues JWT HttpOnly cookie, and returns safe user data (never returning `passwordHash`).
  - `GET /api/auth/me`: Protected by `authenticate` middleware, verifies token, rejects inactive accounts with 403, and returns `{ id, name, email, role, isActive }`.
  - `POST /api/auth/logout`: Clears authentication cookie with matching path and options.
- [x] **Initial Admin Bootstrap Script (`server/scripts/bootstrapAdmin.js`)**:
  - Reads `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` from environment variables without printing them.
  - Enforces minimum 8-character password.
  - Refuses to overwrite existing accounts or create duplicate Admins.
  - Uses `bcrypt.hash(password, 12)` and creates Admin with `role: 'admin'`, `isActive: true`.
- [x] **Automated Authentication Test Suite (`server/scripts/testAuth.js`)**:
  - Comprehensive end-to-end test suite testing 13 distinct security, validation, authentication, and rate limiting cases.

---

## 5. Files Created or Changed in Phase 2

### Backend (`server/`)
- `server/src/config/env.js` — **Modified**: Added `validateAuthEnv()` for `JWT_SECRET` length validation.
- `server/src/utils/jwt.js` — **Created**: JWT signing, verification, and cookie options.
- `server/src/schemas/auth.schema.js` — **Created**: Zod login schema.
- `server/src/middleware/validate.js` — **Created**: Express request body validation middleware.
- `server/src/middleware/auth.js` — **Created**: Session token verification, user loading, and active check middleware.
- `server/src/middleware/rateLimiter.js` — **Created**: Per-IP rate limiter for login route.
- `server/src/middleware/verifyOrigin.js` — **Created**: CSRF protection against cross-origin state changes.
- `server/src/controllers/auth.controller.js` — **Created**: Handlers for login, me, and logout.
- `server/src/routes/auth.routes.js` — **Created**: Express router mounting auth endpoints.
- `server/src/routes/index.js` — **Modified**: Mounted `/api/auth` router.
- `server/src/app.js` — **Modified**: Refined CORS origin filtering.
- `server/src/middleware/errorHandler.js` — **Modified**: Added support for explicit error status codes (`err.status`, `err.statusCode`).
- `server/scripts/bootstrapAdmin.js` — **Created**: One-time initial admin user creation script.
- `server/scripts/testAuth.js` — **Created**: 13-case automated end-to-end test suite.

### Documentation
- `docs/phase.md` — **Modified**: Phase 2 log, test matrix, and next step.
- `README.md` — **Modified**: Added initial admin bootstrap instructions, auth API reference, and Postman testing guide.

---

## 6. Commands and Tests Run (with Actual Results)

| Test Case | Scope | Execution Command | Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Missing Fields Validation** | Auth API | `node scripts/testAuth.js` | HTTP 400 with field errors array | **Passed** |
| **Invalid Email Validation** | Auth API | `node scripts/testAuth.js` | HTTP 400: `Please provide a valid email address` | **Passed** |
| **Incorrect Password** | Auth API | `node scripts/testAuth.js` | HTTP 401 with generic message `Invalid email or password` | **Passed** |
| **Nonexistent User Timing Check** | Auth API | `node scripts/testAuth.js` | HTTP 401 with identical generic message | **Passed** |
| **Valid Login & Cookie** | Auth API | `node scripts/testAuth.js` | HTTP 200, sets HttpOnly cookie, omits `passwordHash` | **Passed** |
| **Unauthenticated `/me`** | Auth API | `node scripts/testAuth.js` | HTTP 401: `Authentication required. No session token provided.` | **Passed** |
| **Malformed Token on `/me`** | Auth API | `node scripts/testAuth.js` | HTTP 401: `Invalid or expired session token.` | **Passed** |
| **Authenticated `/me`** | Auth API | `node scripts/testAuth.js` | HTTP 200: Returns safe user fields `{ id, name, email, role, isActive }` | **Passed** |
| **Inactive User Login Block** | Auth API | `node scripts/testAuth.js` | HTTP 403: `Account is deactivated. Please contact an administrator.` | **Passed** |
| **Inactive User Protected Route** | Auth API | `node scripts/testAuth.js` | HTTP 403: Blocks access even with existing session token | **Passed** |
| **Cross-Origin CSRF Protection** | Security | `node scripts/testAuth.js` | HTTP 403: `Cross-origin request forbidden.` | **Passed** |
| **Logout Cookie Clearing** | Auth API | `node scripts/testAuth.js` | HTTP 200: Clears `token` cookie | **Passed** |
| **Login Rate Limiter** | Security | `node scripts/testAuth.js` | HTTP 429: `Too many login attempts from this IP.` after 10 requests | **Passed** |
| **Admin Bootstrap Validation** | Script | `node scripts/bootstrapAdmin.js` | Exited code 1 when env vars or short password provided | **Passed** |
| **Health Check Endpoint** | Server API | `Invoke-RestMethod http://localhost:5056/api/health` | HTTP 200 OK: `status: "healthy"`, `database-connected` | **Passed** |
| **Frontend Production Build** | Client | `npm run build` | Built 28 modules to `dist/` in 1.18s with 0 errors | **Passed** |

---

## 7. Known Limitations & Remaining Work
- **No Self-Registration**: In accordance with the system specification, there is no public user registration endpoint.
- **Pending Features**:
  - Role-Based Access Control (RBAC) middleware for restricting routes to `admin` vs `sales_executive` (Phase 3).
  - Employee and user management CRUD endpoints (Phase 4).
  - Lead management and CRM pipelines (Phase 5).

---

## 8. Exact Next Step
- **Phase 3: Role-Based Access Control (RBAC) & Protected Routes**:
  - Implement role authorization middleware (`authorize(['admin'])`, `authorize(['admin', 'sales_executive'])`).
  - Prepare protected route boundaries for employee and lead administration.
