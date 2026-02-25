const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Proxy API requests to the backend server for development
  // Uses REACT_APP_API_URL env var or defaults to localhost:3000
  const apiTarget = process.env.REACT_APP_API_URL || 'http://localhost:3000';
  
  // Proxy /api routes to the backend
  app.use(
    '/api',
    createProxyMiddleware({
      target: apiTarget,
      changeOrigin: true,
      onProxyReq: (proxyReq) => {
        console.log(`[Proxy] API request: ${proxyReq.method} ${proxyReq.path} -> ${apiTarget}`);
      },
      onError: (err, req, res) => {
        console.error(`[Proxy] API error:`, err.message);
        res.status(502).json({ error: 'Backend server unavailable', details: err.message });
      }
    })
  );

  // Proxy legacy endpoints used by the NodeGraph local/builder mode
  // Note: /config and /configs are handled separately below to avoid
  // intercepting frontend SPA routes like /configs/:id and /configs/new
  app.use(
    ['/aggregate', '/job', '/jobs', '/status', '/plugins'],
    createProxyMiddleware({
      target: apiTarget,
      changeOrigin: true,
      onProxyReq: (proxyReq) => {
        console.log(`[Proxy] Legacy request: ${proxyReq.method} ${proxyReq.path} -> ${apiTarget}`);
      },
      onError: (err, req, res) => {
        console.error(`[Proxy] Legacy API error:`, err.message);
        res.status(502).json({ error: 'Backend server unavailable', details: err.message });
      }
    })
  );

  // Proxy /config/:name and /configs (exact) to the backend, but NOT /configs/:id
  // which are frontend SPA routes (ConfigPage, NewConfigPage)
  app.use(
    createProxyMiddleware({
      pathFilter: (pathname) => {
        // Exact match for /configs (API: list all configs)
        if (pathname === '/configs') return true;
        // Match /config/:name (API: get/save/delete a specific config by name)
        // but NOT /configs/* which are frontend SPA routes
        if (pathname.startsWith('/config/') && !pathname.startsWith('/configs/')) return true;
        return false;
      },
      target: apiTarget,
      changeOrigin: true,
      onProxyReq: (proxyReq) => {
        console.log(`[Proxy] Config request: ${proxyReq.method} ${proxyReq.path} -> ${apiTarget}`);
      },
      onError: (err, req, res) => {
        console.error(`[Proxy] Config API error:`, err.message);
        res.status(502).json({ error: 'Backend server unavailable', details: err.message });
      }
    })
  );
  
  // Proxy requests to the Docusaurus server for development
  app.use(
    '/docs',
    createProxyMiddleware({
      target: 'http://localhost:3001',
      changeOrigin: true,
      pathRewrite: path => path,
      onProxyReq: (proxyReq) => {
        // For logging purpose
        console.log(`Proxying request to Docusaurus: ${proxyReq.path}`);
      }
    })
  );
}; 