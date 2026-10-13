import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import apiRouter from './routes/index.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

// Security HTTP headers
app.use(helmet());

// Client CORS credentials configuration
const allowedOrigins =
  env.NODE_ENV === 'production'
    ? [env.CLIENT_URL]
    : Array.from(new Set([env.CLIENT_URL, 'http://localhost:5173', 'http://127.0.0.1:5173']));

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., Postman, cURL, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // Deny CORS headers for disallowed origins
      return callback(null, false);
    },
    credentials: true,
  })
);

// Global API rate limiting (100 requests per 15 minutes)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes',
  },
});
app.use('/api', limiter);

// Body and cookie parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// API routes
app.use('/api', apiRouter);

// 404 and centralized error handling
app.use(notFound);
app.use(errorHandler);

export default app;
