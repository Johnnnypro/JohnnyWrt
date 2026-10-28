# UI regression preview

Run `python3 x86-64/prepare-ui-preview.py /tmp/johnny-ui-preview`, then serve the generated folder with `python3 -m http.server 8765 --bind 127.0.0.1 --directory /tmp/johnny-ui-preview`.

The preview executes the actual custom LuCI view sources against synthetic RPC data and pinned Aurora 1.4.0 CSS/theme logic. It never talks to a router. Check `index.html` at desktop width and `mobile.html` (a real 390px iframe), all four views, light/dark, explicit overrides against the opposite system mode, and live follow-system changes. Wait for `#app[data-page="VIEW"]` after changing views before checking contrast. Expand the ZeroTier identity and theme example sections and check those too. The contrast report excludes hidden and disabled elements; it converts browser CSS colors through canvas, including Aurora's Lab colors. Inspect screenshots for overlap in addition to numeric checks.

Theme logic and CSS are fetched from the pinned upstream Aurora source by the preparation script. They are not copies of a production router's private data. A browser-only mock remains insufficient for backend or upgrade verification; run the guest and retention checks separately.

The fixture disables animation and color transitions to measure settled colors deterministically. Use keyboard activation for controls above a scrolled iframe viewport; verify the displayed resolved mode before accepting a report. Hover states must also be checked, and the production stylesheet keeps primary button hover colors paired.
