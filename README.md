# Vis Muse

Real-time audio-reactive particle visualizer using WebGL (Three.js) with GPU computation for hundreds of thousands of particles.

## Run

```bash
pnpm i # or npm i / yarn
pnpm dev
```

Visit `http://localhost:5173`.

## Inputs

- Mic: click 🎤 Mic
- System audio: click 💻 System (Chrome screen-share with audio; may require selecting a tab/window with audio)
- File: click 📁 File and choose an audio file

## Controls

- Space: switch between 100 randomized profiles
- M: mute/unmute
- Move mouse or touch: attract/perturb particles

## Notes

- The app uses a simplified GPU computation pass. You can increase `PARTICLES_SIDE` in `src/main.ts` if your GPU can handle more.
- System audio capture on macOS typically requires selecting a Chrome tab or using a virtual audio device.