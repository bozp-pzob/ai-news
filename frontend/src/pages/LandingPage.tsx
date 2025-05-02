import React from 'react';
import Layout from '../components/Layout';
import Hero from '../components/sections/Hero';
import Features from '../components/sections/Features';
import Demo from '../components/sections/Demo';
import GithubStats from '../components/sections/GithubStats';
import CallToAction from '../components/sections/CallToAction';

// This is a simplified version of the landing page
// We'll need to copy over the actual components from the HTML project later

const LandingPage: React.FC = () => {
  return (
    <Layout>
      <Hero />
      <Features />
      <Demo />
      <GithubStats />
      <CallToAction />
    </Layout>
  );
};

export default LandingPage; 