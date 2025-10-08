import { Request, Response, NextFunction } from 'express';

declare module 'express-session' {
  interface SessionData {
    userId: number;
    username: string;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session && req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized. Please login.' });
  }
}

export function requireGuest(req: Request, res: Response, next: NextFunction) {
  if (req.session && req.session.userId) {
    res.status(403).json({ error: 'Already logged in' });
  } else {
    next();
  }
}
