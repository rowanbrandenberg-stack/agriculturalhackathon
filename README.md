# Spray or Wait

**Two heights. One clear answer.** A decision support tool that tells a pesticide applicator or PCA whether it is safe to spray an orchard block right now, and why.

Built at the AGxArizona Hackathon 2026 for the "Spray or Wait" track: using weather intelligence to prevent pesticide drift in orchards.

## The problem

Applicators usually judge conditions from what they feel at ground level or from one ground weather station. The riskiest condition, a temperature inversion, is invisible from the ground, and wind above the trees can be stronger or blowing a different way than wind inside the canopy.

## What it does

Spray or Wait reads temperature and wind at two heights (5 ft and 30 ft) and gives one status: **GO, CAUTION or STOP**, with the reason in plain language.

| Check | Rule |
| --- | --- |
| Temperature inversion | Flag when the 30 ft sensor is warmer than the 5 ft sensor. Stop at 0.5 F or more, caution below that. |
| Air barely mixing | Caution when the upper sensor is less than 0.5 F cooler (inversion forming or breaking). |
| Wind limits | Flag wind under 3 mph or over 10 mph at either height. Both limits can be set to the label. |
| Wind shear, speed | Flag a 5 mph or larger difference between heights. |
| Wind shear, direction | Flag a 45 degree or larger difference between heights. |
| Sensitive site downwind | Flag when wind at either height would carry drift toward a marked site. With any other flag it becomes a stop. |
| Spray profile | The applicator picks what they were told to spray (oil, sulfur, contact insecticide, volatile herbicide). The profile sets volatility and a heat limit. High volatility treats any inversion as a stop and extends the after spray watch. The tool never recommends a product. |

Other features:

* **Ground station comparison.** Next to every call, the app shows what a single ground station would have said and what it could not see.
* **Time stamped spray record.** Every reading, alert, spray start and end, setting change and applicator note is logged and exports to CSV.
* **Next safe window.** Adds to your calendar. Looks ahead for the next stretch of GO conditions long enough for the job, and warns before conditions turn.
* **Monitoring during and after spraying.** Alerts (banner, sound, push notification) the moment conditions change mid job, then keeps watching for an inversion after the job.
* **Real forecast outlook.** Pulls a live 72 hour model forecast (Open-Meteo, near ground and about 260 ft) for planning.
* **Bring your own tower data.** Load a CSV from a real two height station.

* **Whole block or part of it.** When the only issue is a sensitive site or crew downwind, the block map shows which edge rows to hold so the rest can be sprayed now.
* **Grower network.** A shared public database (Supabase) of anonymous field reports: inversion signs, drift seen, crew in a field, spraying now. Nearby recent reports adjust the call for other growers. Reports are unverified, so they can only add caution and never turn a STOP into a GO. No names or products, location rounded to about 300 ft, reports expire after 48 hours.

* **Arizona citrus pest guide.** For the main Arizona citrus pests: when they matter, how to scout, the action threshold, the options University of Arizona Extension lists, and how to keep the grove's natural enemies working. One click sets the matching spray profile. It is a sourced reference for the PCA conversation, not a prescription.

* **Report filed for you.** When a spray job ends, the app fills in an application report from the tower record (time of application, wind direction and speed at both heights, temperature, product type, the tower's call during the job). One tap sends it. The fields match what Arizona's Form 1080 asks for. In this demo it does not file with the state.
* **Grower heatmap.** A map of where growers nearby are reporting risk, built from the shared database, with one tap report buttons. The demo adds clearly labeled sample reports so the map is not empty.
* **Simple main screen.** Status, picture, timeline, spray and report, heatmap. Everything else sits behind Show details.

## Run it

No build step. Open `index.html` in a browser, or serve the folder with any static host.

## Files

* `pests.js` Arizona citrus pest guide data, with sources
* `engine.js` decision rules, pure functions, no DOM
* `sim.js` simulated two height tower (one realistic cool season day in a citrus grove, a reading every 5 minutes)
* `app.js` interface
* `index.html`, `style.css`

## Honest limits

Spray or Wait supports the applicator's decision. It does not replace the pesticide label, on site checks or regulations, and no system can guarantee zero drift. The tower data in the demo is simulated. Shear thresholds and after spray watch times are starting values to be confirmed with a PCA and the product label.

## How it was built

Plain HTML, CSS and JavaScript with no dependencies. Built with Claude (AI assistant) during the hackathon; the team defined the user, the rules and the demo scenario and verified the output.
