# UI regression preview

Run `python3 x86-64/prepare-ui-preview.py /tmp/johnny-ui-preview`, then serve the generated folder with `python3 -m http.server 8765 --bind 127.0.0.1 --directory /tmp/johnny-ui-preview`.

The preview executes the actual custom LuCI view sources against synthetic RPC data and pinned Aurora 1.4.0 CSS/theme logic. It never talks to a router. Check `index.html` at desktop width and `mobile.html` (a real 390px iframe), all three views, light/dark, explicit overrides against the opposite system mode, and live follow-system changes. Wait for `#app[data-page="VIEW"]` after changing views before checking contrast. Expand the ZeroTier identity section and check it too. The unified theme settings require actual UCI and are verified in the disposable guest. The contrast report excludes hidden and disabled elements; it converts browser CSS colors through canvas, including Aurora's Lab colors. Inspect screenshots for overlap in addition to numeric checks.

Theme logic and CSS are fetched from the pinned upstream Aurora source by the preparation script. They are not copies of a production router's private data. A browser-only mock remains insufficient for backend or upgrade verification; run the guest and retention checks separately.

The fixture disables animation and color transitions to measure settled colors deterministically. Use keyboard activation for controls above a scrolled iframe viewport; verify the displayed resolved mode before accepting a report. Hover states must also be checked, and the production stylesheet keeps primary button hover colors paired.

`controls.html` and `controls-mobile.html` use both original Aurora theme controls without a custom CSS loader. Verify unchanged three-option indicator geometry, system/light/dark switching, and no overflow. These controls retain Aurora's animation, so wait for the resolved `data-darkmode` state.

With Playwright available, run `node x86-64/ui-preview/test-toggle-layout.cjs http://127.0.0.1:8765/index.html` and `node x86-64/ui-preview/test-subscription-layout.cjs http://127.0.0.1:8765/index.html`. Set `BROWSER_EXECUTABLE` when using an installed Chromium/Edge instead of Playwright's bundled browser. These checks cover switch thumb geometry, short/long subscription names, narrow screens, account errors and the compact update action. They do not replace actual firmware tests.
