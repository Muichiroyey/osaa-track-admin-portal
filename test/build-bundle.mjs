// Bundles the portal as a single classic (IIFE) script so jsdom — which has
// no ES-module loader — can actually execute it. Test-only; the real build
// is still `npm run build`.
import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["../src/main.jsx"],
  bundle: true,
  format: "iife",
  outfile: "harness-bundle.js",
  jsx: "automatic",
  loader: { ".png": "dataurl", ".css": "empty" },
  define: {
    "process.env.NODE_ENV": '"development"',
    "import.meta.env.VITE_API_BASE_URL": '""',
    "import.meta.env.MODE": '"development"',
    "import.meta.env.DEV": "true",
    "import.meta.env.PROD": "false",
  },
  logLevel: "error",
});
console.log("harness bundle built");
