/**
 * Re-export of the shared Tailwind preset so apps can import it from @amber/ui
 * (the package that also ships the baseline tokens.css and ThemeProvider),
 * keeping a single import surface for theming.
 */
module.exports = require("@amber/config/tailwind/preset");
