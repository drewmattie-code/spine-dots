# SPINE-dots demo video

Remotion source for `../media/demo.mp4` — the 60-second walkthrough (ungoverned vs governed).

```bash
npm install
npm run studio    # preview/edit
npm run render    # -> ../media/demo.mp4
```

Edit copy, colours, scene lengths and the two terminal "runs" in `src/content.ts`; the animation
lives in `src/scenes.tsx`. 1920×1080, 30 fps. The terminal content mirrors the real output of
`node ../demo/run.mjs`.
