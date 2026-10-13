# Doon Anandam CRM

Production-minded Customer Relationship Management (CRM) system for real estate and enterprise operations.

---

## 1. Tech Stack

- **Frontend**: React 18, Vite, JavaScript, SCSS
- **Backend**: Node.js, Express.js (ES Modules)
- **Database**: MongoDB Atlas + Mongoose
- **Security & Utilities**: Helmet, CORS, Express Rate Limit, Zod, Dotenv, Cookie Parser, Bcryptjs, JsonWebToken
- **API Testing**: Postman / cURL
- **Deployment Target**: Render (Frontend & Backend separately) + MongoDB Atlas

---

## 2. Project Structure

```text
doon-anandam-crm/
├── client/                     # React + Vite frontend
│   ├── src/
│   │   ├── styles/             # SCSS tokens and global resets
│   │   ├── App.jsx             # Minimal starter screen with health checker
│   │   ├── App.scss            # Component styles
│   │   └── main.jsx            # React root mount
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   └── .env.example
├── server/                     # Express backend (ES Modules)
│   ├── src/
│   │   ├── config/             # Config loader (env vars, MongoDB connection)
│   │   │   ├── db.js
│   │   │   └── env.js
│   │   ├── controllers/        # Route controllers
│   │   │   ├── auth.controller.js
│   │   │   └── health.controller.js
│   │   ├── middleware/         # Security, auth, rate limiters, error handlers
│   │   │   ├── auth.js
│   │   │   ├── errorHandler.js
│   │   │   ├── notFound.js
│   │   │   ├── rateLimiter.js
│   │   │   ├── validate.js
│   │   │   └── verifyOrigin.js
│   │   ├── models/             # Mongoose schemas
│   │   │   └── User.js
│   │   ├── routes/             # API routes
│   │   │   ├── auth.routes.js
│   │   │   ├── health.routes.js
│   │   │   └── index.js
│   │   ├── schemas/            # Zod validation schemas
│   │   │   └── auth.schema.js
│   │   ├── utils/              # JWT & helper utilities
│   │   │   └── jwt.js
│   │   ├── app.js              # Express app setup
│   │   └── server.js           # Server bootstrap
│   ├── scripts/                # Utility scripts
│   │   ├── bootstrapAdmin.js   # One-time initial Admin creation
│   │   └── testAuth.js         # Automated auth test suite
│   ├── package.json
│   └── .env.example
├── docs/
│   └── phase.md                # Project progress and phase audit log
├── .gitignore
├── .env.example
└── README.md
```

---

## 3. Getting Started

### Prerequisites
- Node.js (v18+ or v20+ recommended)
- npm (v9+)
- MongoDB Atlas cluster or local MongoDB daemon

### Installation

Clone the repository and install dependencies in both `server/` and `client/`:

```bash
# 1. Install backend dependencies
cd server
npm install

# 2. Install frontend dependencies
cd ../client
npm install
```

### Environment Configuration

Create `server/.env` with the following variables:

```env
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:5173
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<database>?retryWrites=true&w=majority
JWT_SECRET=your_jwt_secret_min_32_characters_long
JWT_EXPIRES_IN=7d
USE_CUSTOM_DNS=true
```

---

## 4. Initial Admin Bootstrap

To create the initial Admin user safely without exposing credentials or allowing public signup:

### PowerShell (Windows)
```powershell
cd server
$env:ADMIN_NAME="System Admin"
$env:ADMIN_EMAIL="admin@doonanandam.com"
$env:ADMIN_PASSWORD="YourStrongPassword123!"
node scripts/bootstrapAdmin.js
Remove-Item Env:ADMIN_NAME, Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD
```

### Bash (macOS/Linux)
```bash
cd server
ADMIN_NAME="System Admin" ADMIN_EMAIL="admin@doonanandam.com" ADMIN_PASSWORD="YourStrongPassword123!" node scripts/bootstrapAdmin.js
```

---

## 5. Running Locally

### Start the Backend Server

```bash
cd server
npm run dev
```

- Server starts on `http://localhost:5000`
- Health check endpoint: `http://localhost:5000/api/health`

### Start the Frontend Application

```bash
cd client
npm run dev
```

- Vite dev server starts on `http://localhost:5173`

---

## 6. Authentication API Endpoints

### 1. Health Check
```http
GET /api/health
```

### 2. Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@doonanandam.com",
  "password": "YourStrongPassword123!"
}
```
*Sets `Set-Cookie: token=<jwt>; HttpOnly; SameSite=Lax; Path=/`*

### 3. Current User Profile
```http
GET /api/auth/me
```
*Requires authentication cookie `token`.*

### 4. Logout
```http
POST /api/auth/logout
```
*Clears authentication cookie `token`.*

---

## 7. Testing with Postman

1. **Health Check**: Send `GET http://localhost:5000/api/health` → Expect `200 OK`.
2. **Login**: Send `POST http://localhost:5000/api/auth/login` with JSON body:
   ```json
   {
     "email": "admin@doonanandam.com",
     "password": "YourStrongPassword123!"
   }
   ```
   Postman will automatically store the `token` cookie.
3. **Get Current User**: Send `GET http://localhost:5000/api/auth/me`. The cookie is automatically included, returning user details.
4. **Logout**: Send `POST http://localhost:5000/api/auth/logout`. Cookie will be cleared.
5. **Verify Logout**: Send `GET http://localhost:5000/api/auth/me` again → Expect `401 Unauthorized`.

---

## 8. Automated Testing

To run the full end-to-end authentication test suite against MongoDB:

```bash
cd server
node scripts/testAuth.js
```

Runs 13 automated checks verifying input validation, password checks, inactive account blocking, HttpOnly cookie security, `/me` authorization, CSRF protection, and rate limiting.
