# EVE Content Finder

## Installation instructions (development server)

`npm install`

`npm i postcss-load-config`

`npm run build`

`node .\server\server.js`

Tech stack:

- LibSQL
- NodeJS
- Redis (serve and retrieve)
- RedisQ (Zkillboard feed)
- Svelte frontend with shadn/UI
- ThreeJS for visualizations

## Interesting usecases ( real time )

- Viewing fighter lossmails in real time to locate active ratting carriers
- Finding belt ratters who die to mordus legion NPCs
- Tracking roaming gangs to see how strong they are and where they're moving
- Locating low effort gate camps for pvp content farm
- Avoiding cancer camps as they form
- Hunting capital ships based on who they kill by region
- Finding battles to loot/salvage/engage as they happen
- Finding valuable deadspace wrecks or unfinished sites that can be located using bookmark spam via celestials
- Tracking miners who die in belts
- Tracking concorded ships for salvage/loot
- Locating any specific NPC when someone dies to it (officer, commander, etc)
- Finding ganking hotspot locations
- Seeing when specific systems are active
- Filtering your region to send alerts when ships are being killed in nearby systems
- Locating likely botters
- Find regions with highest daily probability of pvp engagements
- Find systems with highest ratting activity by NPC deaths
- Many more

### Send alerts to your discord channel based on your filtered results

- Only get alerts for what makes it through your filters
- Easily copy and paste your single discord webhook into the app. It's like a discord bot with zero setup!
- Also use it as a normal killfeed for your corporation, just make you keep it running in a browser tab.

### Save your filter settings as preset profiles to your account

- Pick up where you left off, or save many profiles to rapidly change your presets to hunt for different things.

### 

-