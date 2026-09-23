// @nestjs/{config,typeorm,passport} v12, uuid v14 and file-type (with its
// dependencies, see transformIgnorePatterns) ship as ESM only, and Jest can't
// require() ESM before Node 24.9. ts-jest (tsconfig.e2e.json: module
// commonjs + allowJs) downlevels them to CommonJS; this wrapper only drops
// the `createRequire(import.meta.url)` shim in @nestjs/typeorm, which has no
// CommonJS equivalent and isn't needed there (CommonJS already has require).
const tsJest = require('ts-jest').default;

const CREATE_REQUIRE_SHIM =
  /^const require = createRequire\(import\.meta\.url\);$/m;

function stripShim(source, filePath) {
  return filePath.includes('node_modules')
    ? source.replace(CREATE_REQUIRE_SHIM, '')
    : source;
}

module.exports = {
  createTransformer(options) {
    const inner = tsJest.createTransformer(options);

    return {
      canInstrument: inner.canInstrument,
      process: (source, filePath, transformOptions) =>
        inner.process(stripShim(source, filePath), filePath, transformOptions),
      getCacheKey: (source, filePath, transformOptions) =>
        inner.getCacheKey(
          stripShim(source, filePath),
          filePath,
          transformOptions,
        ),
    };
  },
};
