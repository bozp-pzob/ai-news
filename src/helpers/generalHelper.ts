export const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const groupMessagesByUtcDay = (messages: any[]): { [day: string]: any[] } => {
  const groups: { [day: string]: any[] } = {};
  for (const msg of messages) {
    let timestamp: number;
    if (msg.date instanceof Date) {
      timestamp = msg.date.getTime();
    } else if (typeof msg.date === 'number') {
      timestamp = msg.date * 1000;
    } else {
      timestamp = new Date(msg.date).getTime();
    }
    const day = new Date(timestamp).toISOString().split('T')[0];
    if (!groups[day]) {
      groups[day] = [];
    }
    groups[day].push(msg);
  }
  return groups;
}

export const chunkMessagesByCharCount = (messages: any[], maxChars: number): any[][] => {
  const chunks: any[][] = [];
  let currentChunk: any[] = [];
  let currentCount = 0;
  for (const msg of messages) {
    const overhead = 10;
    const msgText = `[Unknown]: ${msg.message}\n`;
    const msgLength = overhead + msgText.length;
    if (currentCount + msgLength > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentCount = 0;
    }
    currentChunk.push(msg);
    currentCount += msgLength;
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  return chunks;
}