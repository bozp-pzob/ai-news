/**
 * Simple typed event emitter system
 */

export interface EventEmitter<EventType extends string | number | symbol> {
  on(event: EventType, callback: (data?: any) => void): () => void;
  off(event: EventType, callback: (data?: any) => void): void;
  emit(event: EventType, data?: any): void;
}

export function createEventEmitter<EventType extends string | number | symbol>(): EventEmitter<EventType> {
  const listeners: Record<string | number | symbol, Array<(data?: any) => void>> = {};

  return {
    on(event: EventType, callback: (data?: any) => void): () => void {
      if (!listeners[event]) {
        listeners[event] = [];
      }
      listeners[event].push(callback);
      
      // Return an unsubscribe function
      return () => {
        this.off(event, callback);
      };
    },
    
    off(event: EventType, callback: (data?: any) => void): void {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(
          listener => listener !== callback
        );
      }
    },
    
    emit(event: EventType, data?: any): void {
      if (listeners[event]) {
        listeners[event].forEach(callback => {
          callback(data);
        });
      }
    }
  };
} 