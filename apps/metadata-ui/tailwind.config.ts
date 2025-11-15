import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Inter'", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        canvas: {
          DEFAULT: "#0f172a",
          accent: "#1e293b",
        },
      },
      boxShadow: {
        glow: "0 20px 45px rgba(15, 23, 42, 0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
