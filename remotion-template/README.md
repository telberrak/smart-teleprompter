# Whiteboard video (Remotion)

Made by Smart Teleprompter. `public/` holds your cut (`cut.mp4`), one picture per diagram step
(`slides/`), and `timeline.json`: when each slide shows, and the captions.

```
npm install
npm run studio   # preview and tweak in the browser
npm run render   # writes out/whiteboard.mp4
```

Change the look in `src/Whiteboard.tsx` (bubble size, animations, caption style).
Exporting again from the app refreshes `public/` and leaves `src/` alone.
