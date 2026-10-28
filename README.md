# Pitch Trace

A pitch trainer for practising choir parts. It runs in the browser, needs no server and no account, and can be installed on a phone like an app.

Your voice is detected with the YIN algorithm and drawn as a line against a semitone grid. Load a MIDI file of your part and the target notes appear on the same grid, scrolling towards you, with the line coloured by how far you are from the note you should be singing: green within 15 cents, amber within 30, red beyond that.

## Use it

1. Open the published page (see **Hosting**) in Chrome, Edge, Firefox or Safari.
2. Press **Start** and allow the microphone, then sing. The right edge of the trace is now. This is the free tuner.
3. To practise a part, press **Load MIDI** and choose a file. Pick your part if the file has several.
4. Press **Play**. A one-bar count-in clicks, then the notes of your part scroll in from the right and the guide tone plays them. Sing along and watch the line.

On a phone, use the browser menu and choose **Add to Home screen** or **Install app**. After the first visit it also works offline.

### Getting a MIDI file from MuseScore

Open the score in MuseScore and choose **File, Export, MIDI**. Each voice part becomes its own track, named after the part, with repeats and tempo changes already played out. Songs you load are kept in the browser on that device (nothing is uploaded), so you load each file once per device.

### Exercises

Open **Exercises**, choose a warm-up and the lowest and highest note you want, then press **Start exercise**. Three are built in: **Single note**, **Scales** (five notes, or a full octave) and **Intervals** (Do-Mi-Sol chord notes, or leaps back to Do). Single note has two modes. With the guide tone playing along, you sing each note for 5, 8 or 12 seconds while the line settles on the bar. With "Listen first, sing from memory", the app plays a note for four seconds, waits a beat, and you sing it back and hold it; the notes stay hidden until they start, and after each answer it says where you landed (first try and end of the note, in semitones). The notes wander through your range, a different sequence each time, small steps first. Use headphones in the memory mode so the microphone does not hear the call. Scales and Intervals start in the middle of your range, climb in whole tones, descend, and return, so every note stays within the limits you set. Loading a song sets the range to your part. The syllables (Do Re Mi) show under the grid, and the speed control slows an exercise down.

### Scores and progress

Play an exercise or a song from the start to the end and the app scores the run. The headline is **notes found**: a note counts as found if you were within the level's tolerance for at least half of it, judged against the note you should be singing at that moment (never a neighbouring one; the first moment of each note is forgiven while you settle). The tolerance is a level you choose under Settings, **Scoring level**: within 2 semitones, within 1 semitone, within 50 cents, within 25 cents, within 15 cents. Start wide; when you find at least 85% of the notes, the result card offers the next level.

The result card also says how far you typically were from the note, whether you were mostly low or high (and by how much on the missed notes), which notes were hardest, and the change since your last run. To score a run you stop early, pause and press **Score this run**: only the notes already finished count. Seeking within a run cancels it.

Open **Progress** to see every scored run as a chart for one exercise or song: typical distance from the note (semitones, lower is better), notes found (%), too low or too high, or steadiness inside a note. The thick line is the average of your last five runs, and tapping a point shows that run. Each run stores its result at every level, so changing the level afterwards re-reads the older runs. Runs are kept in this browser only. Runs of an exercise at different ranges or speeds share one chart.

### Lyrics

If the MIDI file contains lyric events, the words scroll under the grid with the notes. MuseScore 4 writes them when you export; older MuseScore versions do not. A file without lyrics simply shows none. If your part's track has no lyrics, the first track that has some is used.

The lyrics' word breaks follow the file: a trailing hyphen means the word goes on, and in files with no hyphens a trailing space marks the end of a word. If the lyrics seem to belong to another voice (less than 80% of them start on a note of your part, or they come from another track), the app says so under the part name and under the lyrics. MuseScore sometimes writes one voice's lyrics into another voice's MIDI file; export the full score to check.

If a word break is wrong (a hyphen between two different words, or a missing one), press **Fix word breaks** under the lyrics. Every syllable then shows a hyphen (joined to the next) or a space; tap one to flip it. The fixes are kept with the song on this device. The spelling of the words itself cannot be edited.

### Controls

| Control | What it does |
|---|---|
| Play, Pause, Restart | Starts from the bar before your first entrance. The slider reaches any other point. |
| Speed | 50% to 100%, for learning difficult passages. The guide tone keeps its pitch. |
| Part | Which track is yours. The others can be heard as a backing, quieter. |
| Count-in | One bar of clicks before playback starts. |
| Note names | Letters (C D E) or fixed-do solfège (Do Re Mi), everywhere in the app. Do is always C, and octave numbers follow the usual scientific numbering, so middle C is Do4. |
| Staff overlay | Draws the five bass-clef lines (G2 B2 D3 F3 A3) over the grid, with the clé de fa and ledger lines for notes above or below the staff. The lines sit at their true pitch, so notes with a flat or sharp sit just off their line. |
| Show lyrics | Shows the line being sung in large type under the grid, with the current syllable highlighted and the next line dimmed. Lines break after rests and sentence ends. Needs lyrics inside the MIDI file (see below). |
| Lyrics under the notes | Also draws each syllable under its note, scrolling with the grid. Off by default because syllables get cut off when notes are short. |
| Octave | "Any octave counts" accepts your note an octave above or below the target. "Exact octave" does not. |
| Tempo | Sets the song's tempo as a percentage of the file's, from 25% to 400%. Use it when a file lost its tempo marking and plays too slowly or quickly: the note under the field shows the resulting speed. Saved with the song. The Speed control still slows playback further. |
| Pickup beats | Sets bar 1 after a pickup measure, so bar numbers match your score. MIDI does not store pickups. |
| Voice range | "Fit to score" frames your part. Other choices frame a voice range, and "Follow me" tracks your voice. |
| Sensitivity | The level below which the microphone is ignored. Raise it to catch quiet singing, lower it if noise shows up. |
| Set from room noise | Listens to the room for two seconds and sets the lowest threshold that ignores it. Do this in a quiet moment. |
| Boost quiet microphones | Turns on the phone's automatic gain. Helps with very quiet input, but can raise room noise between notes. |

Pause on a note and sing: the readout shows the cents from that note, so you can check one note at a time.

Notes are shown as sounding pitch. Use headphones with the guide tone, otherwise the microphone hears it too.

## Hosting

The microphone only works on `https://` pages or on `localhost`. With GitHub Pages:

1. Open the repository's **Settings, Pages**.
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
| `pitch.js` | YIN pitch detection |
| `midi.js` | MIDI file reader: parts, note times in seconds, bar grid, lyrics |
| `scoring.js` | Scores a run and summarises runs over time |
| `exercises.js` | Builds the training exercises as MIDI for your range |
| `library.js` | Keeps loaded songs in the browser (IndexedDB) |
| `app.js` | Microphone, playback, drawing, settings |
| `manifest.webmanifest` | Makes the page installable |
| `sw.js` | Service worker for offline use |
| `icons/` | App icons |
| `tests/` | Checks for the detector and the MIDI reader |

Run the tests with `node tests/pitch.test.js && node tests/midi.test.js && node tests/exercises.test.js && node tests/scoring.test.js`. Score files (`.mid`, `.mscz`) are listed in `.gitignore`, so they are not committed by accident; keep arrangements you do not own out of a public repository.

## Updating

The service worker fetches fresh files whenever you are online, so a new version appears the next time you open the app. If you rename, add or remove files, update the `CORE` list in `sw.js` and change `CACHE`.

## Known limits

- Bar numbers assume the first bar starts at the beginning of the file unless you set pickup beats.
- Playback pauses when the app goes to the background, because browsers slow down timers there.
- Bluetooth headphones add delay, so your trace can appear a little behind the notes.

## Roadmap

1. Live tuner with scrolling pitch trace (done)
2. Load a MIDI file of your voice part and draw the target notes behind your trace (done)
3. Practice summary after each run (how many notes were in tune, whether you tend flat or sharp), loop a section, and a delay setting for Bluetooth headphones
