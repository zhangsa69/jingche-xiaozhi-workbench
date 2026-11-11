/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Noto Sans SC",
          "Source Han Sans SC",
          "PingFang SC",
          "Microsoft YaHei",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        ink: {
          950: "#070d1c",
          900: "#0b1428",
          850: "#101a30",
          800: "#152038",
          700: "#1e2c49",
          600: "#2b3d5f",
        },
        brand: {
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
        },
      },
      opacity: {
        6: "0.06",
        8: "0.08",
        12: "0.12",
        15: "0.15",
        85: "0.85",
      },
      boxShadow: {
        glow: "0 24px 60px -30px rgba(37, 99, 235, 0.55)",
        panel: "0 24px 60px -40px rgba(2, 6, 23, 0.85)",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        rise: "rise 0.35s ease-out both",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
