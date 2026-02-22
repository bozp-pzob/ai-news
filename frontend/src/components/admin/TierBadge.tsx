import React from 'react';
import { UserTier } from '../../services/api';

/**
 * Tier badge showing user subscription level.
 */
export function TierBadge({ tier }: { tier: UserTier }) {
  const styles = {
    free: 'bg-stone-700 text-stone-300',
    paid: 'bg-amber-900/50 text-amber-400',
    admin: 'bg-purple-900/50 text-purple-400',
  };

  const labels = {
    free: 'Free',
    paid: 'Pro',
    admin: 'Admin',
  };

  return (
    <span className={`px-2 py-0.5 text-xs rounded font-medium ${styles[tier]}`}>
      {labels[tier]}
    </span>
  );
}
