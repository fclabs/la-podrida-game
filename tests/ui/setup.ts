// Setup for the `ui` Vitest project (jsdom): unmount rendered trees and clear `localStorage`
// after every test. Testing Library's auto-cleanup needs Vitest globals, which are off here.
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    // A test may have replaced `localStorage` with a failing store.
  }
});
