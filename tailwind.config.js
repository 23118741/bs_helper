/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "./test-page/**/*.html"
  ],
  theme: {
    extend: {
      colors: {
        brightspace: {
          blue: '#006fbf',
          hover: '#005694',
          dark: '#1e293b',
          surface: '#0f172a',
          light: '#f8fafc',
          accent: '#0284c7'
        }
      }
    },
  },
  plugins: [],
}
