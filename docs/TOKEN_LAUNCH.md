# Token-launch countdown

The landing page's closing scene includes one shared RLVN launch countdown. The deadline is configured in dist/launch-config.js as an explicit UTC timestamp. It is not saved per browser and does not restart when someone visits or refreshes.

Current preview deadline: 2026-11-02T18:00:57.000Z (November 2, 2026, 1:00:57 PM America/New_York). This was set to 24 hours after the request on November 1; it is not 24 hours after deployment. Adjust TOKEN_LAUNCH_AT before publication if the actual launch schedule changes.

The browser recalculates from Date.now on each tick and when the tab becomes visible. Its accuracy depends on the visitor's device clock. At zero it displays Scheduled launch time reached and points visitors to Twitter / X for launch updates; it does not claim that a token has actually launched or invent a trading link.

Files: dist/launch-config.js, dist/launch-countdown.js, dist/launch-countdown.css and the closing section in dist/index.html. Initialization is in dist/app.js.

Verification: npm run test:countdown and npm run check. Desktop, mobile and short-landscape layouts were checked in Chrome. Local preview screenshots are in output/reference-inspection/countdown-*.png. No deployment or push was performed for this change.
