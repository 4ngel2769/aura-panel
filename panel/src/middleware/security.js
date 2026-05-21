import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import helmet from 'helmet';

const JWT_SECRET = process.env.JWT_SECRET || 'aura_panel_super_secret_key_1337';

export const secureHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

export const corsOptions = cors((req, callback) => {
  const origin = req.header('Origin');
  let allowed = false;

  if (!origin) {
    allowed = true;
  } else {
    try {
      const parsedOrigin = new URL(origin);
      const host = req.header('Host');
      
      // 1. Allow if it matches the Host header (same origin)
      if (host && (parsedOrigin.host === host)) {
        allowed = true;
      }
      // 2. Allow localhost/127.0.0.1
      else if (parsedOrigin.hostname === 'localhost' || parsedOrigin.hostname === '127.0.0.1') {
        allowed = true;
      }
      // 3. Allow private network LAN IPs
      else if (
        parsedOrigin.hostname.startsWith('192.168.') ||
        parsedOrigin.hostname.startsWith('10.') ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(parsedOrigin.hostname)
      ) {
        allowed = true;
      }
    } catch (e) {
      allowed = false;
    }
  }

  if (allowed) {
    callback(null, {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
  } else {
    callback(new Error('Blocked by CORS policy'));
  }
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many authentication attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired access token' });
    }
    req.user = user;
    next();
  });
}

export function xssSanitizer(req, res, next) {
  const sanitize = (val) => {
    if (typeof val === 'string') {
      return val.replace(/<[^>]*>/g, '');
    }
    if (Array.isArray(val)) {
      return val.map(sanitize);
    }
    if (typeof val === 'object' && val !== null) {
      const cleaned = {};
      for (const [key, v] of Object.entries(val)) {
        cleaned[key] = sanitize(v);
      }
      return cleaned;
    }
    return val;
  };

  if (req.body) req.body = sanitize(req.body);
  if (req.query) req.query = sanitize(req.query);
  next();
}
