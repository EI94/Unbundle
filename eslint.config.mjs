import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// SheetJS only writes spreadsheets, through src/lib/spreadsheet/write.ts and, for the styled
// file of the assessment questions only, src/lib/spreadsheet/write-styled.ts (xlsx-js-style
// loads its codepage tables at import, so it stays out of write.ts): xlsx 0.18.5 has known
// parsing vulnerabilities (prototype pollution, ReDoS) and no fixed release on npm.
// Tests may import it to read back what the app wrote.
const sheetJsMessage =
  "Write spreadsheets with @/lib/spreadsheet/write; SheetJS must not parse files in the app.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    ignores: ["src/lib/spreadsheet/write.ts", "src/lib/spreadsheet/write-styled.ts", "src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "xlsx", message: sheetJsMessage },
            { name: "xlsx-js-style", message: sheetJsMessage },
          ],
          patterns: [{ group: ["xlsx/*", "xlsx-js-style/*"], message: sheetJsMessage }],
        },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "ImportExpression[source.value=/^xlsx(-js-style)?(\\u002F|$)/]", message: sheetJsMessage },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    ".claude/**",
    ".vercel/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
