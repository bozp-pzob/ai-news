import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const DocsPage: React.FC = () => {
  const location = useLocation();
  
  useEffect(() => {
    // Docusaurus is running on its own port (3000), so redirect to it
    const docusaurusUrl = 'http://localhost:3000/docs';
    
    // Get the path after /docs/ to maintain deep linking
    const path = location.pathname.replace(/^\/docs\/?/, '');
    const targetUrl = path ? `${docusaurusUrl}/${path}` : docusaurusUrl;
    
    // Redirect to the Docusaurus site
    window.location.href = targetUrl;
  }, [location.pathname]);

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      flexDirection: 'column'
    }}>
      <h1>Redirecting to Documentation...</h1>
      <p>If you are not redirected automatically, click <a href="http://localhost:3000/docs">here</a>.</p>
    </div>
  );
};

export default DocsPage; 