# Woods Map

A simple hunting map for Minnesota and Illinois that installs on an Android phone like an app.

- USGS topo (contour lines), USGS satellite, Satellite + trails (clear satellite with the topo map's trails in orange), Hybrid (satellite with the topo map's trails, roads, names and contours; public land is shaded pale), and street map
- Live GPS dot
- Drop pins at your location, the map center, or by long-pressing the map
- Waypoints like onX: about 25 pin types (tree stand, ground blind, glassing spot, scrape, rub, bedding, deer trail, funnel, buck sighting, shed, food plot, mast, water, turkey, ducks, gate, entry route, property corner, hazard and more), 11 pin colors, a photo on any pin, and notes
- Share a single pin (with its photo) by text, email or any app. The message has a Google Maps link and a Woods Map link that opens the pin ready to save
- "Go there" shows distance and compass direction to any pin
- Walking time: "Go there" shows distance, estimated time and direction. Pins > Measure works out distance and time between any two points (pins, your location, or the map center). Set your pace under More. These are straight-line estimates; real routes take longer
- Sun chip at the top (tap it): sunrise and sunset for your location, plus the Minnesota or Illinois deer/big-game shooting hours depending on where you are (30 min before sunrise to 30 min after sunset). Works with no signal. Other seasons differ, so check the current DNR regulations
- Track button: records the path you walk, keeps the screen awake while recording, saves walks you can show/hide/delete and export as GPX. It only records while the screen is on and the app is open
- Truck button: one tap starts "Go there" to your nearest Parking / truck pin
- Range rings: pick 30, 50, 100, 150 or 200 yards in the pin editor to draw a ring around a stand
- Trail camera and Harvest pin types with a date (cameras show "checked 12 days ago")
- Pin groups (like folders): put pins in groups such as "My pins" or "Mike's pins", and show or hide whole groups and any mix of pin types on the map and in the list. Single pins can be hidden too (they stay in the Pins list, greyed out). Imports go into their own group
- Tap the coordinates at the top left to type in coordinates and jump there (decimal or degrees and minutes), or to pin them
- Pins list has an Edit button on every pin, so you can change or delete any pin even if it isn't on screen
- Insights (bottom bar): Minnesota whitetail rut calendar (pre-rut, seeking, chasing, peak, post-rut) for any date, with what deer are doing and where to hunt. The Nov 10–16 peak is based on MN DNR breeding research; the other phases are estimates. Below it, your Minnesota deer permit area (found by GPS) with its archery, firearms and muzzleloader dates from the DNR's permit-area data, whether each is open, and which rut phases it covers
- Offline maps (under More): save the areas you hunt (topo, satellite, satellite + trails or hybrid) for no-cell-service use
- Export/import pins to back up or share with friends. The JSON backup includes colors and photos. GPX export, and GPX or KML import (Google Earth, onX and other map apps)
- MN DNR public land overlays: Wildlife Management Areas and walk-in access sites (SW Minnesota), both off by default. Switch them on/off from the layers button at the top right
- Covers Minnesota and Illinois. Illinois has the topo, satellite and street maps, but the DNR public-land overlays are Minnesota only

## How to use it

The full guide is inside the app: tap **More**, then **How to use this app**. Friends see it too.

## Put it online (free) so you and friends can install it

The app must be served over **https** for GPS and offline maps to work. Easiest free options:

### GitHub Pages (recommended)
1. Create a free GitHub account and a new **public** repository.
2. Upload the contents of this folder (the files inside `hunting-map`, not the folder itself) with **Add file > Upload files**, then **Commit changes**.
3. Settings > Pages > deploy from the `main` branch, root folder.
4. Your link will be `https://<your-username>.github.io/<repo-name>/`. It can take a couple of minutes to appear.
5. To update later, upload the changed files again the same way.

### Netlify Drop (works, but adds a "Powered by Netlify" badge on free plans)
1. Go to https://app.netlify.com/drop and drag the unzipped folder onto the page.
2. Claim the site with a free account so it stays online.

## Install on Android
1. Open the link in **Chrome** on the phone.
2. Tap the ⋮ menu > **Add to Home screen** (or **Install app**).
3. Open it from the home screen and allow **location** when asked.

## Before you head into the woods
1. Open the app on wifi.
2. Zoom the map to cover your hunting area, tap **More > Offline maps**, pick a map, then **Download this area**.
3. Turn on airplane mode and confirm the map still shows.

Each friend has to do their own downloads; saved maps and pins live on each phone.

## Notes
- Pins are stored on the phone. Use **More > Export pins** now and then as a backup.
- DNR boundaries are for reference only. Confirm access rules and land ownership before you hunt. Private land is not shown.
- The street map needs a connection (OpenStreetMap's rules don't allow bulk downloads).
- Map data: USGS The National Map, OpenStreetMap contributors.
- To push an update, re-upload the files; the app picks up changes when it's opened online.
