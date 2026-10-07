import { defineWebExtConfig } from 'wxt';

// Lets `wxt -b brave` / `wxt -b edge` launch those Chromium browsers in dev.
// Adjust the paths for your OS if they differ.
export default defineWebExtConfig({
  binaries: {
    brave: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    edge: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  },
});
