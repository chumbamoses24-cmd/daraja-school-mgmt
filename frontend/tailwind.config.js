/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1B2A4A",      // primary — deep register-book navy
        paper: "#F7F5EE",    // background — ledger paper
        slate: "#232323",    // body text
        moss: "#2F6B4F",     // present / paid / positive
        rust: "#C1502E",     // absent / unpaid / alert
        amber: "#E8A33D",    // partial / pending
        line: "#D9D4C6",     // hairline rule color
      },
      fontFamily: {
        display: ["'Fraunces'", "serif"],
        body: ["'IBM Plex Sans'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
    },
  },
  plugins: [],
};
