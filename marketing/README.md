# Hunch Marketing

All promotional material for Hunch. Every image here is built from **real screens captured from the running app**, with demo accounts and live data. There are no placeholder screens.

## Folders

| Folder | What's inside | Sizes |
|---|---|---|
| Product Screenshots | 68 real app screens, grouped by feature, plus one folder per role in `POV/` | Phone 1170×2532, dashboard 2880×1800 |
| Social Media Ads | The 5 ad concepts, each in three formats | 1080×1080, 1080×1350, 1080×1920 |
| Posters | Welcome to Hunch, More Than Social, Your World on the Map, Where Moods Meet Connections | 2160×2880 |
| Magazine Ads | 4 two-page spreads: Timeline, Cloud Notes, Map & Discovery, Work Feed | 3600×2400 |
| App Showcase | Hero with five phones, "Every role" board, dashboard showcase | 3840×2160 |
| Team Workspace Ads, Location Map Ads, Mood Analytics Ads, Highlight Ads, Chat Ads, Notes Ads, Stories Ads, Recruitment Ads | One feature ad each | 1080×1350, 1080×1920 |
| Branding Assets | Logo SVGs (white, black, blue), logo PNGs, app icon, brand guide | various |

### Social Media Ads concepts
1. **Connect Through Moods**: "Every Mood Has A Story. Share Yours On Hunch." Connect. Express. Belong.
2. **Social and Work**: "One App. Personal Life. Work Life. Seamlessly Connected."
3. **Map Experience**: "Discover Moments Around You." Explore Stories Through Places.
4. **Cloud Notes**: "Small Thoughts. Big Connections."
5. **Team Engagement**: "Build Stronger Teams Through Better Connections."

Formats fit Facebook and Instagram feed (1:1, 4:5), Instagram, Threads and TikTok stories (9:16), and LinkedIn (1:1).

### Points of view
`Product Screenshots/POV/` covers every role:
- **User** (agent Hans Aquino, light mode): Timeline, Chat, Notes, Stories, Map, Profile.
- **Team Leader** (Tristan Cruz): Team Feed, Team Schedule, Team Management, Workspace Dashboard.
- **SME** (Lea Navarro): Team View, Reports, Analytics.
- **Manager** (Maria Santos): Team Overview, Reports, Mood Statistics.
- **Developer** (Sam Rivera): Dashboard, User Management, System Analytics.

## Demo data
All people in the material are demo accounts (`…@hunch.local`, password `Hunch@2026`) with illustrated avatars. Post photos are drawn illustrations, not stock photos. The demo developer **Sam Rivera** and the first-login account **Kai Morales** were added for these screens. No real account appears anywhere.

Copy rule: no em dashes in UI text or marketing copy.

## Regenerating
With the app running (`npm run dev` in the project folder):

```bash
cd marketing/_tools
npm install            # first time only
node prepare-demo.mjs  # refreshes 24-hour content: notes, stories, shared locations
node capture.mjs       # retakes all Product Screenshots  (or: node capture.mjs Map)
node compose.mjs       # re-renders every ad, poster, spread and brand asset (or: node compose.mjs poster)
```

Run all three again after UI changes so the marketing always matches the shipped app. Notes and stories expire after 24 hours, so run `prepare-demo.mjs` right before `capture.mjs`.
