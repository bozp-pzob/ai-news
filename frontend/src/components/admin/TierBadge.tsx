import React from 'react';
import { UserTier } from '../../services/api';

/**
 * Tier badge showing user subscription level.
 */
export function TierBadge({ tier }: { tier: UserTier }) {
  const styles = {
    free: 'bg-stone-100 text-stone-600',
    paid: 'bg-emerald-100 text-emerald-700',
    admin: 'bg-purple-100 text-purple-700',
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
