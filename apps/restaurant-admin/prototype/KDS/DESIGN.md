---
name: Amber & Grain KDS
colors:
  surface: '#fdf8f8'
  surface-dim: '#ddd9d8'
  surface-bright: '#fdf8f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f7f2f2'
  surface-container: '#f1edec'
  surface-container-high: '#ece7e7'
  surface-container-highest: '#e6e1e1'
  on-surface: '#1c1b1b'
  on-surface-variant: '#524438'
  inverse-surface: '#313030'
  inverse-on-surface: '#f4f0ef'
  outline: '#857466'
  outline-variant: '#d7c3b3'
  surface-tint: '#8c5000'
  primary: '#6a3c00'
  on-primary: '#ffffff'
  primary-container: '#8c5000'
  on-primary-container: '#ffd0a6'
  inverse-primary: '#ffb873'
  secondary: '#8c5000'
  on-secondary: '#ffffff'
  secondary-container: '#fda54a'
  on-secondary-container: '#6e3d00'
  tertiary: '#755b00'
  on-tertiary: '#ffffff'
  tertiary-container: '#d0a61f'
  on-tertiary-container: '#503d00'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdcbf'
  primary-fixed-dim: '#ffb873'
  on-primary-fixed: '#2d1600'
  on-primary-fixed-variant: '#6a3b00'
  secondary-fixed: '#ffdcbf'
  secondary-fixed-dim: '#ffb873'
  on-secondary-fixed: '#2d1600'
  on-secondary-fixed-variant: '#6a3b00'
  tertiary-fixed: '#ffdf90'
  tertiary-fixed-dim: '#eec13c'
  on-tertiary-fixed: '#241a00'
  on-tertiary-fixed-variant: '#584400'
  background: '#fdf8f8'
  on-background: '#1c1b1b'
  surface-variant: '#e6e1e1'
typography:
  display-lg:
    fontFamily: Literata
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Literata
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 34px
  headline-sm:
    fontFamily: Literata
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 26px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-bold:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '700'
    lineHeight: 20px
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 16px
  margin: 24px
  card-padding: 20px
---

## Brand & Style

This design system is tailored for high-end culinary environments where clarity, warmth, and efficiency intersect. The brand personality is grounded and artisanal, moving away from the cold, clinical aesthetic of traditional kitchen tech. It evokes an emotional response of "calm focus"—reducing the high-stress friction of a busy line through soft, organic tones and sophisticated typography.

The design style is **Modern Tactile Minimalism**. It utilizes a "warm-mode" palette and high-quality serif headlines to provide an editorial feel to functional data. The UI relies on physical metaphors—such as distinct card surfaces and clear color-coded indicators—to ensure information remains scannable under the heat and pressure of a commercial kitchen.

## Colors

The palette is anchored in an earthy, "Amber & Grain" spectrum that provides high legibility without the eye strain of pure white-on-black interfaces.

- **Primary Accent (#8C5000):** Used for critical branding, primary actions, and deep structural elements.
- **Highlight/Active (#E8943A):** Reserved for "In-Progress" states and active selections.
- **Background (#FCFAF8):** A warm, cream-based white that reduces glare from overhead kitchen lighting.
- **Success (#3A9E6F):** Specifically for "Ready" or "Served" states to provide a clear, positive visual cue for order completion.
- **Border (#D9C3B1):** Used for structural definition, keeping the interface organized without creating heavy visual noise.

## Typography

The typography strategy uses a high-contrast pairing to balance heritage and utility. 

**Literata** (Serif) is used for order numbers and table identifiers to provide a distinct, authoritative look that stands out from the list items. 

**Plus Jakarta Sans** (Humanist Sans) handles all functional data, modifiers, and instructions. Its open apertures and modern construction ensure that line cooks can read ticket modifications at a glance from several feet away.

- **Order Numbers:** Use `display-lg` for maximum visibility.
- **Modifiers/Notes:** Use `body-md` with `muted_text_hex` to distinguish from the main item.
- **Timers:** Use `label-bold` to ensure time-sensitive data is prioritized.

## Layout & Spacing

This design system uses a **Fluid Column Grid** designed for horizontal landscape displays typical of KDS hardware.

- **Order Columns:** Content is organized into vertical columns. Each column width is flexible but defaults to a minimum of 320px to prevent text wrapping on long dish names.
- **Gaps:** A consistent 16px gutter between cards ensures that individual orders are distinct.
- **Touch Targets:** All interactive elements (bump buttons, expand icons) maintain a minimum hit area of 48x48px to accommodate rapid, high-pressure interaction.
- **Responsive Behavior:** On smaller tablets, the grid shifts from 4-5 columns to 2-3 columns, prioritizing the oldest tickets (top-left) in the sequence.

## Elevation & Depth

Visual hierarchy is established through a combination of tonal layering and soft ambient shadows.

- **Base Layer:** The `#FCFAF8` background acts as the canvas.
- **Order Cards:** Cards use the `#FFFFFF` surface color with a subtle shadow (`0 2px 12px rgba(0,0,0,0.06)`). This "lift" separates the actionable orders from the background.
- **Priority States:** When a card is selected or overdue, the elevation does not increase; instead, a 4px solid left-border is applied using the status colors (Amber, Orange, or Green) to indicate urgency without cluttering the Z-axis.
- **Modals/Overlays:** Use a slightly deeper shadow and a background dimming overlay (20% opacity of `#534437`) to focus the user on critical settings or bulk actions.

## Shapes

The shape language is "Soft-Modern," using significant corner rounding to create a friendly, approachable interface that contrasts with the hard surfaces of a kitchen.

- **Cards:** Use a 16px (`rounded-lg`) radius to enclose order information securely.
- **Buttons:** All buttons must be **pill-shaped** (full radius) to clearly distinguish them from informational cards and containers.
- **Status Indicators:** Small status dots or badges should be perfectly circular to maintain the organic feel of the design system.

## Components

### Order Cards
The primary container. Features a 16px radius, white surface, and a 1px border of `#D9C3B1`. Each card must include a 4px vertical "status strip" on the far left edge.

### Buttons
- **Primary:** Pill-shaped, `#8C5000` background, white text.
- **Secondary/Action:** Pill-shaped, `#E8943A` background, white text.
- **Ghost:** Pill-shaped, 1px border of `#D9C3B1`, text in `#534437`.

### List Items (Order Details)
Items within a card should have a 12px vertical padding. Active or "Cooking" items use the `neutral_color_hex`, while completed items within an active ticket should be struck through and changed to `muted_text_hex`.

### Status Badges
Used for "Takeout," "Delivery," or "VIP." These should be small, pill-shaped tags with `#FDCF49` backgrounds and `#1C1B1B` text for high-contrast visibility.

### Input Fields
Used in the "Search" or "Settings" screens. Rectangular with an 8px radius (different from buttons to avoid confusion), using a `#FCFAF8` fill and a `#D9C3B1` border.