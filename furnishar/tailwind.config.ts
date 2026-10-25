import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#4F46E5',
          light: '#6366F1',
          dark: '#4338CA',
        },
        surface: {
          DEFAULT: '#0F172A',
          raised: '#1E293B',
          border: '#334155',
        },
      },
    },
  },
  plugins: [],
};

export default config;
