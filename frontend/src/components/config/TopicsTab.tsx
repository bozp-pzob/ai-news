import React, { useState, useEffect } from 'react';
import { configApi, TopicCount } from '../../services/api';

interface TopicsTabProps {
  configId: string;
  authToken: string | null;
}

/**
 * Topics tab showing a bar-chart list of top topics.
 */
export function TopicsTab({ configId, authToken }: TopicsTabProps) {
  const [topics, setTopics] = useState<TopicCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadTopics() {
      try {
        const result = await configApi.getTopics(configId, { limit: 50 }, authToken || undefined);
        setTopics(result.topics);
      } catch (err) {
        console.error('Error loading topics:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadTopics();
  }, [configId, authToken]);

  if (isLoading) {
    return <div className="text-center py-8 text-stone-400">Loading topics...</div>;
  }

  if (topics.length === 0) {
    return <div className="text-center py-8 text-stone-400">No topics found</div>;
  }

  const maxCount = Math.max(...topics.map(t => t.count));

  return (
    <div className="bg-stone-800 rounded-lg p-4 border border-stone-700">
      <h3 className="font-medium text-white mb-4">Top Topics</h3>
      <div className="space-y-2">
        {topics.map((topic, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-32 text-stone-300 truncate">{topic.topic}</div>
            <div className="flex-1 bg-stone-700 rounded-full h-2 overflow-hidden">
              <div 
                className="bg-amber-500 h-full rounded-full"
                style={{ width: `${(topic.count / maxCount) * 100}%` }}
              />
            </div>
            <div className="w-16 text-right text-stone-400 text-sm">
              {topic.count.toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
