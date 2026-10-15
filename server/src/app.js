import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import apiRouter from './routes/index.js';
import { getAllowedOrigins } from './middleware/verifyOrigin.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Stable absolute path to generated frontend build
const publicDir = path.resolve(__dirname, '../public');
const indexHtmlPath = path.join(publicDir, 'index.html');

const app = express();

// Trust reverse proxy (exactly 1 hop for Render / cloud load balancers)
// Ensures accurate client IP detection for rate limiting and secure cookie transmission
app.set('trust proxy', 1);

// Security HTTP headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// Client CORS credentials configuration
app.use(
  cors((req, callback) => {
    const allowedOrigins = getAllowedOrigins(req);

    callback(null, {
      origin: (origin, cb) => {
        // Allow requests with no origin (e.g., Postman, cURL, server-to-server, same-origin browser fetches)
        if (!origin) {
          return cb(null, true);
        }
        const cleanOrigin = origin.trim().replace(/\/+$/, '');
        if (allowedOrigins.includes(cleanOrigin)) {
          return cb(null, true);
        }
        // Deny CORS headers for disallowed origins
        return cb(null, false);
      },
      credentials: true,
    });
  })
);

// Global API rate limiting for DoS and volumetric protection
app.use('/api', apiLimiter);

// Body and cookie parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// 1. API routes mounted first
app.use('/api', apiRouter);

// 2. Strict 404 handler for any unmapped /api/* endpoints (prevents index.html leakage)
app.all('/api/*', notFound);

// 3. Serve static frontend assets from server/public
app.use(
  express.static(publicDir, {
    index: false,
    maxAge: env.NODE_ENV === 'production' ? '1d' : 0,
  })
);

// 4. React Router fallback: serve index.html for browser page navigations
app.get('*', (req, res, next) => {
  // Safeguard: Never serve HTML for /api paths
  if (req.path.startsWith('/api')) {
    return notFound(req, res, next);
  }

  // Block hidden/dotfiles from fallback
  if (req.path.split('/').some((segment) => segment.startsWith('.'))) {
    return notFound(req, res, next);
  }

  // If path has a file extension (e.g. .png, .css, .js) that was not found in static files, return 404
  if (path.extname(req.path)) {
    return notFound(req, res, next);
  }

  // Only serve index.html for requests accepting HTML
  if (!req.accepts('html')) {
    return notFound(req, res, next);
  }

  // If index.html exists, serve the React single-page application
  if (fs.existsSync(indexHtmlPath)) {
    return res.sendFile(indexHtmlPath);
  }

  return notFound(req, res, next);
});

// 5. Catch-all not-found and centralized error handling
app.use(notFound);
app.use(errorHandler);

export default app;
