const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
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