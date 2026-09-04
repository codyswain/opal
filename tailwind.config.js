/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        "2xs": ["11px", { lineHeight: "14px" }],
        metadata: [
          "var(--text-metadata-size)",
          { lineHeight: "var(--text-metadata-line)" },
        ],
        control: [
          "var(--text-control-size)",
          { lineHeight: "var(--text-control-line)" },
        ],
        ui: ["var(--text-ui-size)", { lineHeight: "var(--text-ui-line)" }],
        "ui-heading": [
          "var(--text-heading-size)",
          { lineHeight: "var(--text-heading-line)" },
        ],
      },
      colors: {
        canvas: "hsl(var(--canvas))",
        sidebar: "hsl(var(--sidebar))",
        surface: {
          DEFAULT: "hsl(var(--surface))",
          raised: "hsl(var(--surface-raised))",
          hover: "hsl(var(--surface-hover))",
          active: "hsl(var(--surface-active))",
          selected: "hsl(var(--surface-selected))",
        },
        border: {
          DEFAULT: "hsl(var(--border))",
          subtle: "hsl(var(--border-subtle))",
          strong: "hsl(var(--border-strong))",
        },
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: {
          DEFAULT: "hsl(var(--foreground))",
          secondary: "hsl(var(--text-secondary))",
          tertiary: "hsl(var(--text-tertiary))",
        },
        icon: "hsl(var(--icon))",
        focus: "hsl(var(--focus))",
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        danger: "hsl(var(--danger))",
        info: "hsl(var(--info))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        row: "var(--radius-row)",
        control: "var(--radius-control)",
        overlay: "var(--radius-overlay)",
        dialog: "var(--radius-dialog)",
      },
      height: {
        "control-compact": "var(--control-height-compact)",
        control: "var(--control-height)",
        "row-compact": "var(--row-height-compact)",
        row: "var(--row-height)",
        header: "var(--header-height)",
      },
      width: {
        sidebar: "var(--sidebar-width)",
        inspector: "var(--inspector-width)",
      },
      maxWidth: {
        reading: "var(--reading-width)",
      },
      boxShadow: {
        overlay: "var(--shadow-overlay)",
        dialog: "var(--shadow-dialog)",
      },
      transitionDuration: {
        hover: "var(--duration-hover)",
        overlay: "var(--duration-overlay)",
        disclosure: "var(--duration-disclosure)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: 0 },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: 0 },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};
