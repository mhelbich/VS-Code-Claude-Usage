const { defineConfig } = require("@vscode/test-cli");

module.exports = defineConfig({
  files: "out/test/**/*.test.js",
  launchArgs: ["--disable-extensions"],
  mocha: {
    ui: "tdd",
    timeout: 20000,
  },
});
