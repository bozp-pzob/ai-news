# Toast Notification System

A sleek, compact toast notification system for displaying important messages to users, styled to match the application's stone theme.

## Features

- Clean, modern design with subtle animations
- Stone theme styling with colored accents for different notification types
- Multiple toasts stack vertically with proper spacing
- Auto-dismissal with configurable timeout
- Manual dismissal via close button
- Context-based usage throughout the application

## Visual Design

The toast notifications follow the application's dark stone theme:

- **Container**: Dark stone background (`bg-stone-800`) with a colored left border
- **Icons**: Colored icons matching the notification type
- **Text**: Light gray text for better readability (`text-gray-300`)
- **Status Colors**:
  - Success: Green accents (`border-green-500`, `text-green-400`)
  - Error: Red accents (`border-red-500`, `text-red-400`)
  - Warning: Yellow accents (`border-yellow-500`, `text-yellow-400`) 
  - Info: Amber accents (`border-amber-500`, `text-amber-400`)

## Usage

### 1. Wrap your application with the ToastProvider

The application is already wrapped with the ToastProvider in `index.tsx`:

```tsx
import { ToastProvider } from './components/ToastProvider';

root.render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
);
```

### 2. Use the toast notifications in your components

```tsx
import { useToast } from './components/ToastProvider';

function MyComponent() {
  const { showToast } = useToast();
  
  const handleAction = () => {
    try {
      // Your action logic here
      showToast('Operation completed successfully!', 'success');
    } catch (error) {
      showToast('Failed to complete operation.', 'error');
    }
  };
  
  return (
    <button onClick={handleAction}>
      Perform Action
    </button>
  );
}
```

## Available Toast Types

- `success` - Green accents, for successful operations
- `error` - Red accents, for errors and failures
- `warning` - Yellow accents, for warnings and cautions
- `info` - Amber accents, for general information (uses the amber color to match the application theme)

## API

### `useToast()` Hook

The `useToast` hook provides access to the toast notification system.

```tsx
const { showToast } = useToast();
```

### `showToast(message, type, duration?)` Function

Displays a toast notification.

- `message` (string): The message to display in the toast
- `type` (ToastType): The type of toast ('success', 'error', 'warning', 'info')
- `duration` (number, optional): Duration in milliseconds before automatic dismissal (default: 3000)

## Components

### `<Toast>`

Individual toast notification component with appropriate styling based on the type.

### `<ToastProvider>`

Context provider that manages all toast notifications and exposes the API. The provider handles stacking multiple toasts with proper spacing and animations. 