---
name: Amber & Grain Operations
colors:
  surface: '#fff8f5'
  surface-dim: '#e5d8ce'
  surface-bright: '#fff8f5'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#fff1e8'
  surface-container: '#f9ebe2'
  surface-container-high: '#f4e6dc'
  surface-container-highest: '#eee0d6'
  on-surface: '#211a15'
  on-surface-variant: '#524438'
  inverse-surface: '#372f29'
  inverse-on-surface: '#fceee4'
  outline: '#857466'
  outline-variant: '#d7c3b3'
  surface-tint: '#8c5000'
  primary: '#6a3c00'
  on-primary: '#ffffff'
  primary-container: '#8c5000'
  on-primary-container: '#ffd0a6'
  inverse-primary: '#ffb873'
  secondary: '#6c5b4d'
  on-secondary: '#ffffff'
  secondary-container: '#f2dcca'
  on-secondary-container: '#705f51'
  tertiary: '#004b71'
  on-tertiary: '#ffffff'
  tertiary-container: '#006495'
  on-tertiary-container: '#b7ddff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdcbf'
  primary-fixed-dim: '#ffb873'
  on-primary-fixed: '#2d1600'
  on-primary-fixed-variant: '#6a3b00'
  secondary-fixed: '#f5decd'
  secondary-fixed-dim: '#d8c3b1'
  on-secondary-fixed: '#25190e'
  on-secondary-fixed-variant: '#534437'
  tertiary-fixed: '#cbe6ff'
  tertiary-fixed-dim: '#8fcdff'
  on-tertiary-fixed: '#001e30'
  on-tertiary-fixed-variant: '#004b71'
  background: '#fff8f5'
  on-background: '#211a15'
  surface-variant: '#eee0d6'
typography:
  display-lg:
    fontFamily: Literata
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Literata
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-md:
    fontFamily: Literata
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  title-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  data-mono:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  container-max: 1440px
  gutter: 24px
---

## Brand & Style

This design system establishes a high-performance "cockpit" environment for restaurant proprietors and floor managers. It balances the warmth of hospitality with the rigorous precision required for real-time inventory, table management, and financial reporting.

The aesthetic is **Premium Corporate**, blending refined editorial touches with a systematic, data-heavy layout. It utilizes a neutral, off-white foundation to reduce eye strain during long shifts, punctuated by deep amber tones that evoke high-quality ingredients and aged spirits. The emotional response should be one of "calm authority"—providing the manager with the clarity needed to handle high-pressure service environments efficiently.

## Colors

The palette is rooted in organic, culinary-inspired tones but applied with technical rigor. 

- **Primary (Deep Amber Brown):** Used for primary actions, active navigation states, and brand-critical identifiers. 
- **Functional States:** Success Green is reserved for revenue-positive actions (Paid, Open Table). Warning Orange identifies active orders or items requiring attention. Danger Red is strictly for critical alerts, such as 86'd inventory or overdue table turnovers.
- **Neutrality:** The background utilizes an off-white to create a softer contrast than pure white, while surfaces remain pure white to elevate data containers and provide clear visual separation.

## Typography

This system employs a dual-typeface strategy to distinguish between "Brand/Narrative" and "Utility/Data."

- **Literata (Serif):** Applied to high-level page headers and section titles. It injects a sense of established, premium hospitality.
- **Plus Jakarta Sans (Sans-serif):** The workhorse for all interactive elements, data tables, and labels. It offers exceptional legibility at small sizes.
- **Data Treatment:** For financial figures and quantities, ensure `tabular-nums` is enabled to allow for easy vertical scanning of columns.

## Layout & Spacing

This system utilizes a **Fixed-Fluid Hybrid Grid** optimized for 1440px desktop displays. 

- **Sidebar:** A fixed 280px navigation rail on the left.
- **Main Canvas:** A fluid 12-column grid for the dashboard content, with a max-width of 1440px.
- **Rhythm:** An 8px linear scale is the primary driver of spacing, but 4px (base) increments are used for tight data-component relationships (e.g., a label and its input).
- **Margins:** Page margins are set to 32px (xl) to provide breathing room, while internal card padding is set to 24px (lg).

## Elevation & Depth

Visual hierarchy is achieved through a combination of **Tonal Layering** and **Subtle Ambient Shadows**.

1. **Background (#F8F7F5):** The lowest level.
2. **Cards (#FFFFFF):** Raised via a soft, diffused shadow (0px 4px 20px rgba(83, 68, 55, 0.06)).
3. **Overlays/Modals:** Elevated with a more pronounced shadow and a 20% opacity backdrop blur to maintain context without visual clutter.
4. **Interactive Elements:** Buttons and inputs use a 1px border (#E5E1DE) to define their boundaries, relying on state-based color changes rather than deep shadows to maintain the clean "cockpit" feel.

## Shapes

The shape language is sophisticated and approachable. 
- **Containers & Cards:** Use a 16px (rounded-xl) corner radius to soften the data-heavy layout.
- **UI Controls:** Inputs and dropdowns use an 8px radius.
- **Interactive Triggers:** Buttons and status chips (e.g., "Table Available") utilize **Pill-shaped** (fully rounded) geometry to distinguish them from structural containers.

## Components

- **Buttons:** Primary buttons are pill-shaped, using the Deep Amber fill with white text. Secondary buttons use a transparent background with a 1px amber border.
- **Cards:** White surfaces with a 16px radius. Headers within cards should use a subtle bottom border (#E5E1DE) to separate titles from the data body.
- **Data Tables:** Clean, no vertical borders. Use horizontal dividers only. Row hover states should use a subtle tint of the primary color (5% opacity).
- **Status Chips:** Small, pill-shaped indicators. Use the functional color palette (Success, Warning, Danger) with a 10% opacity background fill and a 100% opacity text color for maximum readability.
- **Input Fields:** 1px solid border (#E5E1DE) that transitions to the Primary Amber on focus. Labels should be small, bold, and in Plus Jakarta Sans.
- **Icons:** Use 24px stroke-based icons with a 1.5px or 2px weight to ensure they look "engineered" and reliable.