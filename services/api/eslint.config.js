import base from "@amber/config/eslint/base";

export default [
  ...base,
  {
    rules: {
      // Nest's DI resolves constructor params via emitDecoratorMetadata's
      // design:paramtypes, which needs the real class, not an erased type.
      // Auto-fixing these to `import type` replaces the class with `Function`
      // in the emitted metadata and breaks provider resolution at runtime.
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
];
