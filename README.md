# Spray or Wait

A decision support tool that tells a pesticide applicator or Pest Control Adviser whether measured weather at two heights is suitable for spraying an orchard block right now, and why.

Built at the AGxArizona Hackathon 2026 for the track "Using weather intelligence to prevent pesticide drift in orchards".

Live demo: https://rowanbrandenberg-stack.github.io/agriculturalhackathon/

## The problem

Applicators usually judge conditions from what they feel at ground level or from one ground weather station. A temperature inversion cannot be seen from the ground, and wind above the trees can be stronger or blowing a different way than wind inside the canopy.

## What, when, how

The main screen answers three questions for the job in front of the applicator.

* **What**: the product they were already told to spray, picked from a short list (horticultural or neem oil, sulfur, organic fungicide, contact insecticide, volatile herbicide, or custom). The choice changes the rules. Rate and amount come from the label and the PCA; this tool does not set them.
* **When**: now, not now, or unknown, with the next projected suitable weather window.
* **How**: general drift reduction practice from Extension sources (read the label's drift section, use the coarsest droplets the label allows, match sprayer air to the canopy), with links. The label and the PCA decide for the product.

## What we changed after talking to growers

We showed the prototype to growers at a Tucson farmers market during the hackathon.

* A wasted spray is expensive (one grower pays $800 a quart for organic fungicide concentrate), so the planned job check now shows the product cost you enter when the window is too short.
* Organic growers told us they move far out to avoid overspray and want to know what happens near their land and water, so there is a **Neighbor view**: whether an application is in progress at the block and which way the measured wind points. Starting a job can send a notice (no name, no product) to the shared report database. It is a notice, not a drift map.
* Neem oil and organic fungicide were added to the product list, because the growers we met spray those.
* Not built on purpose: how much to apply (label and PCA), soil health, drift path prediction.

## What the screen shows

1. **Current weather**: GO, CAUTION, STOP or UNABLE (unable to assess), with every reason in plain language.
2. **Planned job**: whether the projected suitable weather is long enough for the job you entered. A current STOP always wins. Unknown future conditions are never shown as a confirmed window.
3. **Orchard picture** with the readings at 5 ft and 30 ft.
4. **Ground station comparison**: what a wind check at 5 ft alone would have concluded, and what it does not show.
5. **Scenarios and timeline**: four named demo scenarios and the whole day.
6. **Monitoring and recent alerts**, with a link to the full record.

Secondary sections: decision rules and settings, regional model forecast, application record and signature, full record with CSV export, grower network, Arizona citrus pest guide, waitlist.

## Decision rules

| Rule | Threshold | Result |
| --- | --- | --- |
| Inversion | 30 ft temperature greater than 5 ft temperature | STOP. Any positive difference alerts. Inside the sensor uncertainty (0.5 F) it still alerts, with a note. |
| Small temperature difference | 30 ft less than 0.5 F cooler than 5 ft | CAUTION. The readings cannot rule out an inversion. |
| Wind above limit | Over 10 mph at either height | STOP. Common guidance. The product label controls. |
| Wind below minimum | Under 3 mph at either height | CAUTION. Common guidance. The product label controls. |
| Speed difference between heights | 5 mph or more | CAUTION. Configurable prototype threshold, not a sourced limit. |
| Direction difference between heights | 45 degrees or more, shortest way around the compass | CAUTION. Configurable prototype threshold. Skipped when wind is under 1 mph. |
| Sensitive site | Measured wind at either height within 45 degrees of the site | CAUTION alone, STOP with any other flag. |
| Missing, invalid or stale reading | Any required value absent, impossible, or older than 2 sampling intervals | UNABLE. Never GO. A STOP already confirmed by valid readings stands. |

The status is the worst single flag. Nothing is averaged, so no good reading can cancel a STOP. Impossible settings (for example a maximum below the minimum) are rejected and the previous settings stay active.

## What the data is, and is not

* **Simulated tower readings.** The demo runs on one deterministic simulated day, a reading every 5 minutes. It is not live and not measured.
* **Projected window.** The planned job check scans the remaining samples of that known simulated day. It is a demonstration, not a forecast and not a prediction from history.
* **Comparison statistic.** "In this simulated day, ground wind checks missed X hours flagged by our two height rules" is counted from the readings and the active thresholds. It is not drift prevented and not validated detection accuracy.
* **Imported tower readings.** You can load a CSV from a real two height station. A file is not a live feed. Gaps longer than 2 sampling intervals and blank values show as UNABLE.
* **Regional model forecast.** Open-Meteo model values at 2 m, 80 m and 10 m. Different heights than the tower, and a regional model does not resolve one block. Planning only.
* **Community reports.** Sample reports are drawn as shading and labeled. Only actual reports affect the weather call, and they can only add caution.
* **One tower** describes conditions at the tower, not everywhere in the orchard. The tool does not predict drift paths or distances, and the block illustration does not recommend rows or buffers. Required buffers come from the label and the site.

## Records

* **Session record** (every reading, alert and event): kept in memory, cleared by a reload or by Reset demo. Export it as CSV. Each row has the measurement timestamp with timezone, the event timestamp, both heights, both temperatures, both wind speeds and directions, the differences, the weather status, the ground only status, the planned job status, the reasons, the active thresholds, the job settings and the data source.
* **Application records** (signed on screen when a spray job ends): saved in this browser's local storage and read back to confirm. They stay after a reload on the same device. They are not on a server.
* When online, the conditions of a signed record (no name, no signature) and community reports go to a shared database (Supabase). The app says when that did not happen.
* Nothing is sent to the Arizona Department of Agriculture. The signed record covers the timing and weather part of Form 1080 and is not the official form.
* Alerts (banner, sound, browser notification) work only while the page is open.

## Run it

No build step. Open `index.html` in a browser, or serve the folder with any static host.

## Tests

```
node tests/engine.test.js      # 64 decision logic checks, no dependencies
python3 tests/flows.py [url]   # 49 user flow checks in a headless browser (needs Playwright and Chrome)
```

## Files

* `engine.js` decision rules and planned job check, pure functions, no DOM
* `sim.js` simulated two height tower
* `app.js` interface
* `pests.js` Arizona citrus pest guide data, with sources
* `qr.js` QR code generator by Kazuhiko Arase, MIT license
* `fonts/` Barlow Condensed and IBM Plex Sans, SIL Open Font License
* `tests/` logic tests and user flow checks

## Limits

Spray or Wait supports the applicator's decision. It does not replace the pesticide label, on site checks or regulations, and no system can guarantee zero drift. Shear thresholds, heat limits and after spray watch times are prototype values to be confirmed with a PCA and the product label.

## How it was built

Plain HTML, CSS and JavaScript with no runtime dependencies. Built with Claude (AI assistant) during the hackathon. The team defined the user, the rules and the demo scenarios and reviewed the output.
