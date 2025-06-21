import React from 'react';
import Layout from '../components/Layout';
import App from '../App';

const AppPage: React.FC = () => {
  return (
    <Layout showNavbar={false}>
      <App />
    </Layout>
  );
};

export default AppPage; 