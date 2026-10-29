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
    // The whole palette, not an extension: Tailwind's hued defaults (blue,
    // amber, ...) do not exist here, so a component cannot reach for one.
    colors: {
      transparent: "transparent",
      current: "currentColor",
      inherit: "inherit",
      white: "#ffffff",
      black: "#000000",
      chrome: "hsl(var(--chrome))",
      canvas: "hsl(var(--canvas))",
      surface: {
        DEFAULT: "hsl(var(--surface))",
        raised: "hsl(var(--surface-raised))",
        sunken: "hsl(var(--surface-sunken))",
        lift: "hsl(var(--surface-lift))",
        hover: "hsl(var(--surface-hover))",
        active: "hsl(var(--surface-active))",
        selected: "hsl(var(--surface-selected))",
      },
      border: {
        DEFAULT: "hsl(var(--border))",
        subtle: "hsl(var(--border-subtle))",
        strong: "hsl(var(--border-strong))",
        overlay: "hsl(var(--border-overlay))",
      },
      "page-ring": "hsl(var(--page-ring))",
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
      primary: {
        DEFAULT: "hsl(var(--primary))",
        foreground: "hsl(var(--primary-foreground))",
      },
      secondary: {
        DEFAULT: "hsl(var(--secondary))",
        foreground: "hsl(var(--secondary-foreground))",
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
        label: [
          "var(--text-label-size)",
          { lineHeight: "var(--text-label-line)", fontWeight: "510" },
        ],
        control: [
          "var(--text-control-size)",
          { lineHeight: "var(--text-control-line)" },
        ],
        ui: [
          "var(--text-ui-size)",
          {
            lineHeight: "var(--text-ui-line)",
            letterSpacing: "var(--text-ui-tracking)",
          },
        ],
        "ui-heading": [
          "var(--text-heading-size)",
          { lineHeight: "var(--text-heading-line)" },
        ],
      },
      // Inter's variable axis: 510 and 590 are Linear's medium and semibold.
      fontWeight: {
        medium: "510",
        semibold: "590",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        row: "var(--radius-row)",
        control: "var(--radius-control)",
        card: "var(--radius-card)",
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
        "control-compact": "var(--control-height-compact)",
        control: "var(--control-height)",
        sidebar: "var(--sidebar-width)",
      },
      spacing: {
        page: "var(--page-inset)",
      },
      maxWidth: {
        reading: "var(--reading-width)",
      },
      // Tailwind's default ring is blue; ours is the neutral focus token.
      ringColor: {
        DEFAULT: "hsl(var(--focus))",
      },
      boxShadow: {
        control: "var(--shadow-control)",
        overlay: "var(--shadow-overlay)",
        dialog: "var(--shadow-dialog)",
      },
      transitionDuration: {
        hover: "var(--duration-hover)",
        quick: "var(--duration-quick)",
        overlay: "var(--duration-overlay)",
        disclosure: "var(--duration-disclosure)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        emphasized: "var(--ease-emphasized)",
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
  plugins: [require("tailwindcss-animate")],
};
