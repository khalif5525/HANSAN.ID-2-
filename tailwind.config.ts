import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/modules/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        hansan: {
          orange: "#FF7A00",
          blue: "#0029FF",
          ivory: "#FFF5D5",
          surface: "var(--hansan-surface)",
          "surface-soft": "var(--hansan-surface-soft)",
          "surface-raised": "var(--hansan-surface-raised)",
          "surface-sunken": "var(--hansan-surface-sunken)",
          ink: "var(--hansan-ink)",
          "ink-muted": "var(--hansan-ink-muted)",
          line: "var(--hansan-line)",
          "line-strong": "var(--hansan-line-strong)",
          success: "var(--hansan-success)",
          warning: "var(--hansan-warning)",
          danger: "var(--hansan-danger)",
          info: "var(--hansan-info)",
        },
      },
      fontFamily: {
        sans: [
          '"Glacial Indifference"',
          '"Segoe UI"',
          "system-ui",
          "sans-serif",
        ],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        neu: "var(--radius-neu)",
        sm: "var(--radius-sm)",
        xs: "var(--radius-xs)",
        orbit: "var(--radius-orbit)",
      },
      boxShadow: {
        // Approved hybrid (master autopilot visual contract).
        // orbit: ORBIT buttons — hard bottom-right offset, zero blur.
        // sleepwise: prominent cards — crisp offset.
        // raised: dialogs, drawers, login panel, floating POS cart only.
        // inset: text inputs / search / pressed states.
        // flat: hairline rule for dense tables / lists.
        orbit: "var(--orbit-shadow)",
        "orbit-sm": "var(--orbit-shadow-sm)",
        sleepwise: "var(--sleepwise-shadow)",
        "neu-raised": "var(--neu-raised)",
        "neu-raised-sm": "var(--neu-raised-sm)",
        "neu-inset": "var(--neu-inset)",
        "neu-flat": "var(--neu-flat)",
      },
      transitionDuration: {
        fast: "150ms",
        base: "220ms",
      },
      zIndex: {
        header: "var(--z-header)",
        sidebar: "var(--z-sidebar)",
        drawer: "var(--z-drawer)",
        dialog: "var(--z-dialog)",
        toast: "var(--z-toast)",
        tooltip: "var(--z-tooltip)",
      },
      maxWidth: {
        shell: "var(--shell-content-max)",
      },
    },
  },
  plugins: [],
};
export default config;

