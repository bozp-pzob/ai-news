/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      keyframes: {
        'slide-in-left': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' }
        },
        'slide-out-left': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-100%)' }
        },
        'spin-slow': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' }
        },
        'progress-indeterminate': {
          '0%': { left: '-30%' },
          '50%': { left: '100%' },
          '100%': { left: '100%' }
        },
        'source-active-pulse': {
          '0%': { opacity: 0.8 },
          '50%': { opacity: 1, boxShadow: '0 0 8px rgba(34, 197, 94, 0.6)' },
          '100%': { opacity: 0.8 }
        },
        'shimmer': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' }
        }
      },
      animation: {
        'slide-in-left': 'slide-in-left 300ms ease-in-out forwards',
        'slide-out-left': 'slide-out-left 300ms ease-in-out forwards',
        'spin-slow': 'spin-slow 3s linear infinite',
        'progress-indeterminate': 'progress-indeterminate 2s ease-in-out infinite',
        'source-active-pulse': 'source-active-pulse 2s ease-in-out infinite',
        'shimmer': 'shimmer 2s infinite'
      }
    },
  },
  plugins: [],
} 