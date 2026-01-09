// src/routes/v1/index.ts

import { Router } from 'express';
import usersRouter from './users';
import configsRouter from './configs';
import searchRouter from './search';

const router = Router();

/**
 * API v1 Routes
 * 
 * All routes are prefixed with /api/v1
 */

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// User routes
router.use('/me', usersRouter);

// Config routes
router.use('/configs', configsRouter);

// Search routes
router.use('/search', searchRouter);

export default router;
