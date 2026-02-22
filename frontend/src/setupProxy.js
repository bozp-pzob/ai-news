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
  app.use(
    ['/aggregate', '/job', '/jobs', '/status', '/config', '/configs', '/plugins'],
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