# FSTuber — Full Build Todo

## Project Setup & Boilerplate
1. [ ] Create `index.html` in project root
2. [ ] Write full HTML5 boilerplate (doctype, html, head, body)
3. [ ] Add proper meta tags (viewport, charset, description, theme-color)
4. [ ] Add title: `FSTuber`
5. [ ] Create `styles.css` and link it in head
6. [ ] Create `app.js` and link it at end of body (defer)
7. [ ] Create folder structure: `/assets`, `/assets/icons`, `/assets/pnuber`, `/js`, `/css`
8. [ ] Move CSS to `/css/styles.css` and update link
9. [ ] Move JS to `/js/app.js` and update script tag
10. [ ] Create `/js/settings.js`
11. [ ] Create `/js/auth.js`
12. [ ] Create `/js/media.js`
13. [ ] Create `/js/pnuber.js`
14. [ ] Create `/js/recorder.js`
15. [ ] Create `/js/shortcuts.js`
16. [ ] Add favicon placeholder in `/assets/icons`

## Native App-Like UI (No Neon)
17. [ ] Set CSS root variables for colors (neutral grays, soft whites, muted accents)
18. [ ] Design light mode palette (clean off-white bg, dark text, subtle borders)
19. [ ] Design dark mode palette (near-black #0f0f0f, soft gray text, muted accents)
20. [ ] Apply system font stack (system-ui, -apple-system, Segoe UI, etc.)
21. [ ] Create full-viewport app shell (no browser chrome feel)
22. [ ] Build top title bar with app name + window controls style buttons
23. [ ] Build left sidebar for tools/navigation
24. [ ] Build main canvas/preview area
25. [ ] Build bottom control bar (playback, timeline, volume)
26. [ ] Build right properties panel
27. [ ] Style all buttons as flat/native (subtle hover, no glow)
28. [ ] Add proper focus states and keyboard navigation
29. [ ] Make UI feel like a desktop app (tight spacing, no oversized padding)
30. [ ] Add subtle shadows and borders only where needed
31. [ ] Implement dark/light mode toggle in settings
32. [ ] Persist theme choice in settings.json
33. [ ] Load theme on app start from settings
34. [ ] Add CSS custom properties that can be overridden by user

## External Libraries & Icons
35. [ ] Choose clean icon set (Lucide or Feather — no neon packs)
36. [ ] Add icon library via CDN or local files
37. [ ] Create icon usage system in UI
38. [ ] Add any needed lightweight utility (optional: only if necessary)
39. [ ] Avoid heavy UI frameworks that force web-app look
40. [ ] Document which libraries are used in a comment or README note

## Settings System
41. [ ] Create default settings object in JS
42. [ ] Implement load settings from `FSTuber/configuration/settings.json` (via Google Drive or local)
43. [ ] Implement save settings back to same file
44. [ ] Add settings panel UI (modal or dedicated view)
45. [ ] Add theme toggle control in settings
46. [ ] Add custom CSS editor textarea in settings
47. [ ] Apply custom CSS on save (inject into style tag)
48. [ ] Add shortcut customization UI in settings
49. [ ] Add volume defaults, auto-save options, etc.
50. [ ] Add “reset to defaults” button
51. [ ] Confirm before overwriting settings
52. [ ] Store last used paths and preferences

## Authentication (Google, GitHub, Spotify)
53. [ ] Set up Google OAuth client (Drive scope)
54. [ ] Implement Google login button and flow
55. [ ] Store Google access token securely in session
56. [ ] Set up GitHub OAuth (repo access)
57. [ ] Implement GitHub login button and flow
58. [ ] Set up Spotify OAuth (playback / track access)
59. [ ] Implement Spotify login button and flow
60. [ ] Show connected account status in UI
61. [ ] Handle token refresh / re-auth
62. [ ] Allow disconnecting any service

## File & Asset Access
63. [ ] After Google login, ensure `FSTuber` folder exists in Drive (create if missing)
64. [ ] Ensure `FSTuber/configuration` subfolder exists
65. [ ] List only allowed formats from Drive (png, jpg, jpeg, gif, apng, webp, mp4, webm, etc.)
66. [ ] List only allowed formats from selected GitHub repo
67. [ ] Build file browser UI (thumbnails + names)
68. [ ] Let user pick a video to edit
69. [ ] Let user pick images/GIFs to use as PNGtuber assets
70. [ ] Advise in UI: “Name files clearly (e.g. anime_laugh.png)”
71. [ ] Support local file upload (video + images) via input type=file
72. [ ] Never overwrite original files — always work on copies

## Screen Share & Video Input
73. [ ] Implement `getDisplayMedia` screen share button
74. [ ] Handle screen share stream in preview
75. [ ] Add local video file upload and load into preview
76. [ ] Display video in main canvas/preview area
77. [ ] Basic playback controls (play, pause, seek, loop)
78. [ ] Show current time and duration
79. [ ] Add volume control for source video

## Basic Editing Tools
80. [ ] Add simple trim start/end controls
81. [ ] Add basic crop or aspect ratio lock
82. [ ] Add brightness/contrast/saturation sliders (applied on canvas)
83. [ ] Add simple text overlay option
84. [ ] Make all edits non-destructive until export
85. [ ] Show preview of edits in real time

## Format Conversion
86. [ ] Research and pick browser-friendly conversion approach (MediaRecorder + canvas or library)
87. [ ] Implement export to mp4
88. [ ] Implement export to webm
89. [ ] Support gif output for short clips if feasible
90. [ ] Let user choose output format in save dialog

## Background Music
91. [ ] Add local audio file upload
92. [ ] Connect Spotify and list user’s tracks or playlists
93. [ ] Let user pick a track as background music
94. [ ] Add music volume slider (separate from video volume)
95. [ ] Sync music start with video playback
96. [ ] Allow mute/unmute music
97. [ ] Mix audio on final export

## PNGtuber System
98. [ ] Load selected PNG/GIF/APNG collection into memory
99. [ ] Display PNGtuber image in corner of preview (draggable + resizable)
100. [ ] Create `pnuber.js` to handle image switching logic
101. [ ] Map filenames to states (laugh, idle, talk, etc.)
102. [ ] Implement keyboard shortcut listener
103. [ ] Let user customize which key triggers which image
104. [ ] Support animation loops (cycle frames on hold or trigger)
105. [ ] Store custom shortcuts and mappings in settings.json
106. [ ] Show current active PNGtuber state in UI
107. [ ] Allow repositioning PNGtuber anytime during playback

## Recording & Replay with Overlay
108. [ ] Implement MediaRecorder on the canvas that includes video + PNGtuber overlay
109. [ ] Add “Replay & Record” button that plays the timeline while recording
110. [ ] Capture both video and mixed audio (source + music)
111. [ ] Show recording indicator
112. [ ] Stop recording and generate blob
113. [ ] Preview the recorded result before saving

## Save / Export Flow
114. [ ] Save button with dropdown: “Save to Google Drive” / “Save Locally”
115. [ ] On save, ask user if they want to rename the file
116. [ ] Default name suggestion based on original + timestamp or “edited”
117. [ ] Upload final file to `FSTuber/` folder (not configuration)
118. [ ] Never replace existing files — always new name or confirm overwrite
119. [ ] For local save, trigger browser download
120. [ ] Show success toast with file location

## Polish & Extra Settings
121. [ ] Add undo/redo for basic edits (or at least reset)
122. [ ] Add keyboard shortcuts help overlay
123. [ ] Add loading states and error messages for all network calls
124. [ ] Make UI fully keyboard accessible
125. [ ] Add simple project autosave of current session state
126. [ ] Test dark and light mode thoroughly
127. [ ] Test custom CSS injection doesn’t break layout
128. [ ] Add about/credits section in settings
129. [ ] Final pass: remove any web-bloat spacing, tighten everything
130. [ ] Write short in-app tips about naming PNGtuber files and using shortcuts

## Optional Later
131. [ ] Multiple PNGtuber layers
132. [ ] Timeline markers
133. [ ] Export preset profiles