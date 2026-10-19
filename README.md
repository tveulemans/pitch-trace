# Pitch Trace

A live pitch tuner with a scrolling pitch trace, for practising choir parts. It runs in the browser, needs no server and no account, and can be installed on a phone like an app.

Your voice is detected with the YIN algorithm and drawn as a line against a semitone grid. The line is green when you are within 15 cents of a note, amber within 30, and red beyond that. A large readout shows the note, the cents sharp or flat and the frequency.

## Use it

1. Open the published page (see **Hosting**) in Chrome, Edge, Firefox or Safari.
2. Press **Start** and allow the microphone.
3. Sing. The right edge of the trace is now.

On a phone, use the browser menu and choose **Add to Home screen** or **Install app**. After the first visit it also works offline.

Notes are shown as sounding pitch. Tenor parts are usually written an octave above where they sound, so a written C4 appears as C3. Use headphones when you sing along to a backing track, otherwise the track is picked up too.

## Hosting

The microphone only works on `https://` pages or on `localhost`. With GitHub Pages:

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, then branch `main` and folder `/ (root)`.
3. The app appears at `https://<your-user>.github.io/pitch-trace/` after a minute.

To run it on your computer instead:

```
python3 -m http.server 8000
```

then open `http://localhost:8000`.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure |
| `styles.css` | Styling, light and dark themes |
| `pitch.js` | YIN pitch detection (also loaded by the tests) |
| `app.js` | Microphone, analysis loop, drawing, settings |
| `manifest.webmanifest` | Makes the page installable |
| `sw.js` | Service worker for offline use |
| `icons/` | App icons |
| `tests/pitch.test.js` | Checks the detector on generated tones |

Run the tests with `node tests/pitch.test.js`.

## Updating

The service worker fetches fresh files whenever you are online, so a new version appears the next time you open the app. If you rename or remove files, change `CACHE` in `sw.js` and update the `CORE` list.

## Roadmap

1. Live tuner with scrolling pitch trace (this version)
2. Load a MIDI file of your voice part and draw the target notes behind your trace
3. Play-along mode with a score and a sharp/flat summary
