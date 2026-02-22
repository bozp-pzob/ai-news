import React from 'react';
import Layout from '../components/Layout';
import Hero from '../components/sections/Hero';
import Features from '../components/sections/Features';
import GithubStats from '../components/sections/GithubStats';
import CallToAction from '../components/sections/CallToAction';

const LandingPage: React.FC = () => {
  return (
    <Layout>
      <Hero />
      <Features />
      <GithubStats />
      <CallToAction />
    </Layout>
  );
};

export default LandingPage; 