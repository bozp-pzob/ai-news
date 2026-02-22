// src/routes/v1/index.ts

import { Router } from 'express';
import usersRouter from './users';
import configsRouter from './configs';
import searchRouter from './search';
import adminRouter from './admin';
import connectionsRouter from './connections';
import templatesRouter from './templates';
import relayRouter from './relay';
import localRouter from './local';

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

// Admin routes
router.use('/admin', adminRouter);

// External connections (Discord, Telegram, Slack, etc.)
router.use('/connections', connectionsRouter);

// Config templates (public, no auth required)
router.use('/templates', templatesRouter);

// Relay endpoints (forwards encrypted payloads to local servers)
router.use('/relay', relayRouter);

// Local server endpoints (receives and executes encrypted configs)
router.use('/local', localRouter);

export default router;
