const mockOn = jest.fn();
const mockEmit = jest.fn();

const mockEventEmitter = {
  on: mockOn,
  emit: mockEmit
};

export const createEventEmitter = jest.fn().mockReturnValue(mockEventEmitter);

// Export the mock functions for testing
export const __getMockEmitter = () => mockEventEmitter;
export const __getMockOn = () => mockOn;
export const __getMockEmit = () => mockEmit; 