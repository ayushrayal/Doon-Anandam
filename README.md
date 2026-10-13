# Doon Anandam CRM

Production-minded Customer Relationship Management (CRM) system for real estate and enterprise operations.

---

## 1. Tech Stack

- **Frontend**: React 18, Vite, JavaScript, SCSS
- **Backend**: Node.js, Express.js (ES Modules)
- **Database**: MongoDB + Mongoose (Configured in upcoming phase)
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
│   │   ├── config/             # Config loader (env vars)
│   │   ├── controllers/        # Health check controller
│   │   ├── middleware/         # Security, rate limiter, 404 & error handlers
│   │   ├── models/             # Mongoose models placeholder
│   │   ├── routes/             # API routers (GET /api/health)
│   │   ├── services/           # Business logic placeholder
│   │   ├── utils/              # Helper utilities placeholder
│   │   ├── app.js              # Express app setup
│   │   └── server.js           # Server bootstrap
│   ├── scripts/                # Database/migration scripts placeholder
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

---

## 4. Running Locally

### Start the Backend Server

```bash
cd server
npm run dev
```

- Server starts on `http://localhost:5000`
- Health check endpoint: `http://localhost:5000/api/health`

### Start the Frontend Application

Open a separate terminal:

```bash
cd client
npm run dev
```

- Vite dev server starts on `http://localhost:5173`

---

## 5. API Endpoints

### Health Check

```http
GET /api/health
```

**Response (200 OK):**
```json
{
  "success": true,
  "service": "Doon Anandam CRM API",
  "status": "healthy",
  "timestamp": "2026-10-13T09:25:00.000Z",
  "uptime": 12
}
```

---

## 6. Testing with Postman

1. Open Postman.
2. Create a new `GET` request to: `http://localhost:5000/api/health`.
3. Click **Send** and verify a `200 OK` response with the health payload.

---

## 7. Production Build Verification

To verify the client production bundle:

```bash
cd client
npm run build
```
Outputs build files into `client/dist/`.
