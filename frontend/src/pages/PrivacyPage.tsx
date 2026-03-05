import React from 'react';
import { Link } from 'react-router-dom';

const PrivacyPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <Link to="/" className="text-emerald-600 hover:text-emerald-700 text-sm mb-8 inline-block">
          &larr; Back to Home
        </Link>
        
        <h1 className="text-3xl font-bold text-stone-900 mb-2">Privacy Policy</h1>
        <p className="text-stone-500 text-sm mb-8">Last updated: March 1, 2026</p>

        <div className="prose prose-stone max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">1. Information We Collect</h2>
            <p className="text-stone-600 leading-relaxed">We collect information in the following ways:</p>
            <ul className="list-disc list-inside text-stone-600 space-y-1 ml-4">
              <li><strong>Account Information:</strong> Email address, wallet address, and authentication data provided through our login providers (Google, Twitter, GitHub, Discord, email, or wallet)</li>
              <li><strong>Configuration Data:</strong> Pipeline configurations, API keys (stored encrypted), and connection settings you provide</li>
              <li><strong>Usage Data:</strong> API request logs, aggregation run history, and feature usage metrics</li>
              <li><strong>External Data:</strong> Content fetched from connected services (Discord, GitHub, Telegram, etc.) as configured by you</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">2. How We Use Your Information</h2>
            <p className="text-stone-600 leading-relaxed">We use your information to:</p>
            <ul className="list-disc list-inside text-stone-600 space-y-1 ml-4">
              <li>Provide and maintain the Platform services</li>
              <li>Process your aggregation pipelines and generate content summaries</li>
              <li>Manage your account and subscription status</li>
              <li>Enforce usage limits and prevent abuse</li>
              <li>Improve the Platform based on usage patterns</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">3. Data Security</h2>
            <p className="text-stone-600 leading-relaxed">
              We take data security seriously. Your API keys and secrets are encrypted using AES-256 encryption
              before storage. Authentication is handled through Privy, a trusted third-party authentication
              provider. All data is transmitted over HTTPS.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">4. External Service Connections</h2>
            <p className="text-stone-600 leading-relaxed">
              When you connect external services (Discord servers, GitHub repositories, Telegram groups), we
              access only the data you authorize. For Discord, this includes messages from selected channels.
              For GitHub, this includes public repository data or data from repositories you grant access to
              via the GitHub App. We do not access data beyond what is needed for your configured pipelines.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">5. Data Sharing</h2>
            <p className="text-stone-600 leading-relaxed">
              We do not sell your personal data. Generated summaries and content may be visible to others
              based on your configuration's visibility settings (public, unlisted, or private). We may share
              anonymized, aggregated usage statistics for platform improvement.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">6. Blockchain Transactions</h2>
            <p className="text-stone-600 leading-relaxed">
              Payments processed through the Solana blockchain are publicly visible on-chain by nature.
              We record transaction signatures for payment verification and dispute resolution. Wallet
              addresses used for payments may be linked to your account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">7. AI Processing</h2>
            <p className="text-stone-600 leading-relaxed">
              Content processed through AI providers (OpenAI, OpenRouter) is sent to those providers
              for processing according to their respective privacy policies. We use AI to generate summaries,
              categorize content, and enrich data as configured in your pipelines.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">8. Data Retention</h2>
            <p className="text-stone-600 leading-relaxed">
              Aggregation job logs are retained for 90 days by default. Content items and summaries are retained
              as long as your account is active. You may request deletion of your data at any time.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">9. Your Rights</h2>
            <p className="text-stone-600 leading-relaxed">You have the right to:</p>
            <ul className="list-disc list-inside text-stone-600 space-y-1 ml-4">
              <li>Access the personal data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your account and associated data</li>
              <li>Export your configurations and generated content</li>
              <li>Disconnect external services at any time</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">10. Cookies and Tracking</h2>
            <p className="text-stone-600 leading-relaxed">
              We use essential cookies for authentication and session management. We do not use third-party
              tracking cookies or advertising trackers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">11. Changes to This Policy</h2>
            <p className="text-stone-600 leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of material changes
              through the Platform. The "Last updated" date at the top indicates when the policy was last revised.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mb-3">12. Contact</h2>
            <p className="text-stone-600 leading-relaxed">
              For questions about this Privacy Policy or to exercise your data rights, please contact us
              through the Platform.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPage;
