// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Mock implementations that need to be available globally
jest.mock('./utils/eventEmitter');
// Removed API mock since we want to test the actual implementation 