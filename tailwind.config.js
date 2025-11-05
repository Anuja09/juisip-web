/** @type {import('tailwindcss').Config} */
export default {
  // CRUCIAL: This tells Tailwind to scan all JSX, TSX, JS, and TS files inside the 'src' folder
  // for classes like 'flex', 'bg-lime-500', etc.
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
