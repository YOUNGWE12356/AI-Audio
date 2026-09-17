# Local audio-to-MIDI engines

Run the PowerShell setup from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File tools/audio-to-midi/setup-audio-to-midi.ps1
```

The configured modes use:

- Piano: ByteDance `piano_transcription_inference`
- Drums: ADTOF PyTorch
- Guitar, bass, strings: Spotify Basic Pitch with instrument-specific frequency and onset profiles
- Multitrack: YourMT3 through `mt3-infer`

Model checkpoints are stored below `tools/audio-to-midi/models/` and are excluded from Git.
The setup script downloads both the YourMT3 and ByteDance piano checkpoints so the first
conversion does not depend on package-specific download commands such as `wget`.

YourMT3 uses an isolated Transformers 4.38 compatibility layer below
`tools/audio-to-midi/vendor/`. The rest of the application keeps its existing Transformers
version, so installing MIDI support does not downgrade Chatterbox or other voice models.
