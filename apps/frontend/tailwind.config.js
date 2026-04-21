/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#07111b',
        surface: '#0d1824',
        surface2: '#132231',
        surface3: '#1b2d3f',
        border: 'rgba(152, 181, 211, 0.14)',
        red: '#E8002D',
        'red-dim': '#9B0020',
        teal: '#2CF4C5',
        gold: '#f2c879',
        sky: '#85d7ff',
      },
      borderColor: {
        DEFAULT: 'rgba(152, 181, 211, 0.14)',
        border: 'rgba(152, 181, 211, 0.14)',
      },
      fontFamily: {
        sans: ['Space Grotesk', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        display: ['Rajdhani', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
