/**
 * External Connections API Routes
 * 
 * Platform-agnostic routes for managing external connections
 * (Discord, Telegram, Slack, etc.)
 */

import { Router, Response, Request } from 'express';
import { requireAuth, AuthenticatedRequest } from '../../middleware/authMiddleware';
import { externalConnectionService } from '../../services/externalConnections';
import { PlatformType } from '../../services/externalConnections/types';

const router = Router();

// ============================================================================
// PLATFORM INFO ROUTES
// ============================================================================

/**
 * GET /api/v1/connections/platforms
 * 
 * List all available platforms (configured and enabled)
 */
router.get('/platforms', async (req: Request, res: Response) => {
  try {
    const platforms = externalConnectionService.getAvailablePlatforms();
    res.json({ platforms });
  } catch (error: any) {
    console.error('[Connections] Error listing platforms:', error);
    res.status(500).json({
      error: 'Failed to list platforms',
      message: error.message,
    });
  }
});

// ============================================================================
// CONNECTION LISTING ROUTES
// ============================================================================

/**
 * GET /api/v1/connections
 * 
 * List all connections for the authenticated user
 * Optional query param: ?platform=discord|telegram|slack
 */
router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const platform = req.query.platform as PlatformType | undefined;
    const connections = await externalConnectionService.getUserConnections(req.user.id, platform);

    res.json({ connections });
  } catch (error: any) {
    console.error('[Connections] Error listing connections:', error);
    res.status(500).json({
      error: 'Failed to list connections',
      message: error.message,
    });
  }
});

// ============================================================================
// AUTHORIZATION ROUTES
// ============================================================================

/**
 * GET /api/v1/connections/:platform/auth
 * 
 * Get authorization URL for a platform
 * Query params:
 * - redirect: URL to redirect to after auth completes
 * - popup: If 'true', the callback will return HTML for popup mode
 */
router.get('/:platform/auth', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { platform } = req.params;
    const redirectUrl = req.query.redirect as string | undefined;
    const popup = req.query.popup === 'true';

    // Validate platform
    if (!externalConnectionService.isPlatformConfigured(platform as PlatformType)) {
      return res.status(400).json({ error: `Platform ${platform} is not available` });
    }

    const result = await externalConnectionService.generateAuthUrl(
      platform as PlatformType,
      req.user.id,
      redirectUrl,
      popup
    );

    res.json(result);
  } catch (error: any) {
    console.error('[Connections] Error generating auth URL:', error);
    res.status(500).json({
      error: 'Failed to generate authorization URL',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/connections/:platform/callback
 * 
 * Handle OAuth callback from platform
 * Supports two modes:
 * - Standard: Redirects to frontend after processing
 * - Popup: Returns HTML that posts message to parent window and closes
 */
router.get('/:platform/callback', async (req: Request, res: Response) => {
  // Get frontend URL for redirects (defaults to same origin)
  const frontendUrl = process.env.FRONTEND_URL || '';
  
  console.log('[Connections] OAuth callback received:', {
    platform: req.params.platform,
    hasCode: !!req.query.code,
    hasState: !!req.query.state,
    guild_id: req.query.guild_id,
    frontendUrl,
  });
  
  // Helper to send popup response
  const sendPopupResponse = (success: boolean, data: any) => {
    const message = JSON.stringify({ type: 'connection_result', success, ...data });
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Connection Complete</title></head>
        <body>
          <p>Connection ${success ? 'successful' : 'failed'}. This window will close automatically.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage(${message}, '*');
            }
            setTimeout(() => window.close(), 1000);
          </script>
        </body>
      </html>
    `);
  };

  try {
    const { platform } = req.params;
    const { code, state, guild_id, permissions, installation_id, setup_action } = req.query;

    // Validate required parameters
    if (!state || typeof state !== 'string') {
      console.log('[Connections] Missing state, redirecting to error');
      return res.redirect(`${frontendUrl}/connections?connection_error=missing_state`);
    }

    // Check if this is a popup request (state contains popup marker)
    const isPopup = state.includes('_popup');
    const cleanState = state.replace('_popup', '');

    // Handle callback
    const connection = await externalConnectionService.handleCallback({
      platform: platform as PlatformType,
      code: code as string,
      state: cleanState,
      guild_id: guild_id as string,
      permissions: permissions as string,
      installation_id: installation_id as string,
      setup_action: setup_action as string,
    });

    console.log('[Connections] Connection created successfully:', connection.externalName);

    // Handle popup mode
    if (isPopup) {
      return sendPopupResponse(true, {
        platform,
        connectionId: connection.id,
        connectionName: connection.externalName,
      });
    }

    // Standard redirect mode
    const encodedName = encodeURIComponent(connection.externalName);
    const redirectUrl = `${frontendUrl}/connections?connection_success=true&platform=${platform}&name=${encodedName}`;
    console.log('[Connections] Redirecting to:', redirectUrl);
    res.redirect(redirectUrl);
  } catch (error: any) {
    console.error('[Connections] OAuth callback error:', error);
    
    // Check if popup mode from state
    const state = req.query.state as string;
    const isPopup = state?.includes('_popup');
    
    if (isPopup) {
      return sendPopupResponse(false, {
        error: error.message || 'Unknown error',
      });
    }

    const errorMessage = encodeURIComponent(error.message || 'Unknown error');
    const redirectUrl = `${frontendUrl}/connections?connection_error=${errorMessage}`;
    console.log('[Connections] Redirecting to error page:', redirectUrl);
    res.redirect(redirectUrl);
  }
});

/**
 * POST /api/v1/connections/:platform/webhook
 * 
 * Handle webhook events from platforms (e.g., Telegram)
 */
router.post('/:platform/webhook', async (req: Request, res: Response) => {
  try {
    const { platform } = req.params;

    await externalConnectionService.handleWebhook(platform as PlatformType, req.body);

    // Always return 200 to acknowledge webhook
    res.sendStatus(200);
  } catch (error: any) {
    console.error('[Connections] Webhook error:', error);
    // Still return 200 to prevent webhook retries
    res.sendStatus(200);
  }
});

// ============================================================================
// CONNECTION MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /api/v1/connections/:connectionId
 * 
 * Get details of a specific connection
 */
router.get('/:connectionId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { connectionId } = req.params;

    // Check if it's a platform name (for backwards compatibility)
    const platforms = ['discord', 'telegram', 'slack'];
    if (platforms.includes(connectionId)) {
      return res.status(400).json({ error: 'Invalid connection ID format' });
    }

    const connection = await externalConnectionService.getConnection(req.user.id, connectionId);

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    // Get channel count
    const channels = await externalConnectionService.getChannels(connectionId);
    const channelCount = channels.filter(c => c.isAccessible).length;

    res.json({
      ...connection,
      channelCount,
    });
  } catch (error: any) {
    console.error('[Connections] Error getting connection:', error);
    res.status(500).json({
      error: 'Failed to get connection',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/v1/connections/:connectionId
 * 
 * Remove a connection (marks as inactive)
 */
router.delete('/:connectionId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { connectionId } = req.params;

    // Verify user owns this connection
    const connection = await externalConnectionService.getConnection(req.user.id, connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    await externalConnectionService.removeConnection(req.user.id, connectionId);

    res.status(204).send();
  } catch (error: any) {
    console.error('[Connections] Error removing connection:', error);
    res.status(500).json({
      error: 'Failed to remove connection',
      message: error.message,
    });
  }
});

/**
 * POST /api/v1/connections/:connectionId/verify
 * 
 * Verify a connection is still valid
 */
router.post('/:connectionId/verify', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { connectionId } = req.params;

    // Verify user owns this connection
    const ownsConnection = await externalConnectionService.validateUserOwnsConnection(
      req.user.id,
      connectionId
    );
    if (!ownsConnection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const isValid = await externalConnectionService.verifyConnection(connectionId);

    res.json({
      valid: isValid,
      verifiedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[Connections] Error verifying connection:', error);
    res.status(500).json({
      error: 'Failed to verify connection',
      message: error.message,
    });
  }
});

// ============================================================================
// CHANNEL ROUTES
// ============================================================================

/**
 * GET /api/v1/connections/:connectionId/channels
 * 
 * Get channels for a connection
 */
router.get('/:connectionId/channels', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { connectionId } = req.params;

    // Verify user owns this connection
    const connection = await externalConnectionService.getConnection(req.user.id, connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const channels = await externalConnectionService.getChannels(connectionId);
    const grouped = await externalConnectionService.getGroupedChannels(connectionId);

    res.json({
      channels,
      grouped,
      connectionId: connection.id,
      connectionName: connection.externalName,
      platform: connection.platform,
    });
  } catch (error: any) {
    console.error('[Connections] Error listing channels:', error);
    res.status(500).json({
      error: 'Failed to list channels',
      message: error.message,
    });
  }
});

/**
 * POST /api/v1/connections/:connectionId/sync
 * 
 * Sync/refresh channels for a connection
 */
router.post('/:connectionId/sync', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { connectionId } = req.params;

    // Verify user owns this connection
    const connection = await externalConnectionService.getConnection(req.user.id, connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    // Verify connection is still valid
    const isValid = await externalConnectionService.verifyConnection(connectionId);
    if (!isValid) {
      return res.status(400).json({
        error: 'Connection is no longer valid',
        message: 'Please reconnect this platform',
      });
    }

    // Sync channels
    const channels = await externalConnectionService.syncChannels(connectionId);

    res.json({
      channels,
      synced: true,
      syncedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[Connections] Error syncing channels:', error);
    res.status(500).json({
      error: 'Failed to sync channels',
      message: error.message,
    });
  }
});

// ============================================================================
// VALIDATION ROUTES
// ============================================================================

/**
 * POST /api/v1/connections/validate-channels
 * 
 * Validate that channels are accessible in a connection
 * Used when creating/updating configs with external sources
 */
router.post('/validate-channels', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { connectionId, channelIds } = req.body;

    if (!connectionId || typeof connectionId !== 'string') {
      return res.status(400).json({ error: 'connectionId is required' });
    }

    if (!channelIds || !Array.isArray(channelIds) || channelIds.length === 0) {
      return res.status(400).json({ error: 'channelIds array is required' });
    }

    // Verify user owns this connection
    const ownsConnection = await externalConnectionService.validateUserOwnsConnection(
      req.user.id,
      connectionId
    );

    if (!ownsConnection) {
      return res.status(403).json({ error: 'You do not have access to this connection' });
    }

    // Validate channels
    const result = await externalConnectionService.validateChannels(connectionId, channelIds);

    res.json(result);
  } catch (error: any) {
    console.error('[Connections] Error validating channels:', error);
    res.status(500).json({
      error: 'Failed to validate channels',
      message: error.message,
    });
  }
});

// ============================================================================
// STATUS ROUTES
// ============================================================================

/**
 * GET /api/v1/connections/status
 * 
 * Get connection service status (for debugging)
 */
router.get('/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const platforms = externalConnectionService.getAvailablePlatforms();

    // Only admins can see detailed status
    if (req.user.tier === 'admin') {
      const connections = await externalConnectionService.getUserConnections(req.user.id);

      res.json({
        platforms,
        connectionCount: connections.length,
        connections: connections.map(c => ({
          id: c.id,
          platform: c.platform,
          name: c.externalName,
          isActive: c.isActive,
          channelCount: c.channelCount,
        })),
      });
    } else {
      res.json({ platforms });
    }
  } catch (error: any) {
    console.error('[Connections] Error getting status:', error);
    res.status(500).json({
      error: 'Failed to get status',
      message: error.message,
    });
  }
});

export default router;
