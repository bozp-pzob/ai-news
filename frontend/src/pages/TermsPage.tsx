import React from 'react';
import { Link } from 'react-router-dom';

const TermsPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <Link to="/" className="text-emerald-600 hover:text-emerald-700 text-sm mb-8 inline-block">
          &larr; Back to Home
        </Link>
        
        <h1 className="text-3xl font-bold text-stone-900 mb-2">Terms of Service</h1>
        <p className="text-stone-500 text-sm mb-8">Last updated: March 1, 2026</p>

        <div className="prose prose-stone max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">1. Acceptance of Terms</h2>
            <p className="text-stone-600 leading-relaxed">
              By accessing or using Digital Gardener ("the Platform"), you agree to be bound by these Terms of Service.
              If you do not agree to these terms, please do not use the Platform.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">2. Description of Service</h2>
            <p className="text-stone-600 leading-relaxed">
              Digital Gardener is a content aggregation and curation platform that collects data from various sources
              (including Discord, GitHub, Telegram, and other APIs), enriches it with AI processing, and generates
              organized summaries and insights.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">3. User Accounts</h2>
            <p className="text-stone-600 leading-relaxed">
              You are responsible for maintaining the security of your account and any connected external services.
              You must not share your account credentials or use another person's account without authorization.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">4. Acceptable Use</h2>
            <p className="text-stone-600 leading-relaxed">You agree not to:</p>
            <ul className="list-disc list-inside text-stone-600 space-y-1 ml-4">
              <li>Use the Platform for any illegal or unauthorized purpose</li>
              <li>Attempt to gain unauthorized access to any part of the Platform</li>
              <li>Interfere with or disrupt the integrity or performance of the Platform</li>
              <li>Use the Platform to collect data in violation of third-party terms of service</li>
              <li>Resell or redistribute Platform services without authorization</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">5. Payments and Subscriptions</h2>
            <p className="text-stone-600 leading-relaxed">
              Certain features require payment via USDC on the Solana blockchain. All payments are final and
              non-refundable unless otherwise required by applicable law. Subscription licenses grant access
              for the specified duration from the time of purchase.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">6. Content and Data</h2>
            <p className="text-stone-600 leading-relaxed">
              You retain ownership of your configurations and any custom content you create on the Platform.
              By making content public, you grant other users the right to view and interact with it according
              to the visibility settings you choose.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">7. API and External Connections</h2>
            <p className="text-stone-600 leading-relaxed">
              When connecting external services (Discord, GitHub, Telegram, etc.), you are responsible for
              ensuring you have the right to access and aggregate the data from those services. The Platform
              acts as a tool on your behalf and does not independently claim rights to external data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">8. Limitation of Liability</h2>
            <p className="text-stone-600 leading-relaxed">
              The Platform is provided "as is" without warranties of any kind. We are not liable for any
              indirect, incidental, special, or consequential damages arising from your use of the Platform.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">9. Changes to Terms</h2>
            <p className="text-stone-600 leading-relaxed">
              We reserve the right to modify these terms at any time. We will notify users of material changes
              through the Platform. Continued use after changes constitutes acceptance of the updated terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">10. Contact</h2>
            <p className="text-stone-600 leading-relaxed">
              For questions about these Terms of Service, please contact us through the Platform.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default TermsPage;
