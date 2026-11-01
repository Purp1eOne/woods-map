# Woods Map

A simple hunting map for Minnesota that installs on an Android phone like an app.

- USGS topo (contour lines), USGS satellite, and street map
- Live GPS dot
- Drop pins at your location, the map center, or by long-pressing the map
- Pin types: stand, camp, truck, sign, water, other, plus notes
- "Go there" shows distance and compass direction to any pin
- Walking time: "Go there" shows distance, estimated time and direction. Pins > Measure works out distance and time between any two points (pins, your location, or the map center). Set your pace under More. These are straight-line estimates; real routes take longer
- Sun chip at the top (tap it): sunrise and sunset for your location, plus Minnesota big-game shooting hours (30 min before sunrise to 30 min after sunset). Works with no signal. Other seasons differ, so check the current DNR regulations
- Track button: records the path you walk, keeps the screen awake while recording, saves walks you can show/hide/delete and export as GPX. It only records while the screen is on and the app is open
- Truck button: one tap starts "Go there" to your nearest Parking / truck pin
- Range rings: pick 30, 50, 100, 150 or 200 yards in the pin editor to draw a ring around a stand
- Trail camera and Harvest pin types with a date (cameras show "checked 12 days ago")
- Pins list filter: show only one pin type, on the map and in the list
- Tap the coordinates at the top left to type in coordinates and jump there (decimal or degrees and minutes), or to pin them
- Pins list has an Edit button on every pin, so you can change or delete any pin even if it isn't on screen
- Offline maps: save the areas you hunt (topo and satellite) for no-cell-service use
- Export/import pins (JSON backup or GPX) to back up or share with friends
- MN DNR public land overlays: Wildlife Management Areas (on by default) and walk-in access sites (SW Minnesota). Switch them on/off from the layers button at the top right
- Limited to Minnesota

## Put it online (free) so you and friends can install it

The app must be served over **https** for GPS and offline maps to work. Easiest free options:

### Option A: Netlify Drop (no account tools, about 2 minutes)
1. Go to https://app.netlify.com/drop
2. Drag the whole `hunting-map` folder (unzipped) onto the page.
3. Netlify gives you a link like `https://something.netlify.app`. Send that link to friends.

### Option B: GitHub Pages
1. Create a GitHub repo and upload the contents of this folder.
2. Settings > Pages > deploy from the `main` branch, root folder.
3. Your link will be `https://<your-username>.github.io/<repo-name>/`.

## Install on Android
1. Open the link in **Chrome** on the phone.
2. Tap the ⋮ menu > **Add to Home screen** (or **Install app**).
3. Open it from the home screen and allow **location** when asked.

## Before you head into the woods
1. Open the app on wifi.
2. Tap **Offline**, zoom the map to cover your hunting area, pick Topo (and/or Satellite), then **Download this area**.
3. Turn on airplane mode and confirm the map still shows.

Each friend has to do their own downloads; saved maps and pins live on each phone.

## Notes
- Pins are stored on the phone. Use **More > Export pins** now and then as a backup.
- DNR boundaries are for reference only. Confirm access rules and land ownership before you hunt. Private land is not shown.
- The street map needs a connection (OpenStreetMap's rules don't allow bulk downloads).
- Map data: USGS The National Map, OpenStreetMap contributors.
- To push an update, re-upload the files; the app picks up changes when it's opened online.
