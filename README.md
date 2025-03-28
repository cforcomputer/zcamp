# EVE Content Finder

## Installation instructions (development server)

Install railway.com CLI
`railway up` to push changes

### Creating a dockerfile for deploy from dockerhub

Add environment variables docker environment

`docker build -t wrighttech/zcamp:latest .`
`docker push wrighttech/zcamp:latest`

```
LIBSQL_URL="libsql://your-database-url" 
- Build Variable: No
- Is Multiline: No
- Is Literal: No

LIBSQL_AUTH_TOKEN="your-database-auth-token"
- Build Variable: No
- Is Multiline: No
- Is Literal: No

REDIS_URL="redis://your-redis-url:6379"
- Build Variable: No
- Is Multiline: No
- Is Literal: No

SESSION_SECRET="your-secure-session-secret"
- Build Variable: No
- Is Multiline: No
- Is Literal: Yes
Note: randomly generated 64 char sequence for authenticating user sessions

EVE_CLIENT_ID="your-eve-client-id"
- Build Variable: No
- Is Multiline: No
- Is Literal: Yes

EVE_CLIENT_SECRET="your-eve-client-secret"
- Build Variable: No
- Is Multiline: No
- Is Literal: Yes

EVE_CALLBACK_URL="https://your-domain.com/callback/"
- Build Variable: No
- Is Multiline: No
- Is Literal: No

PORT=8080
- Build Variable: Yes
- Is Multiline: No
- Is Literal: No

NODE_ENV="production"
- Build Variable: Yes
- Is Multiline: No
- Is Literal: No

PUBLIC_URL="{full domain name} https://where.zcamp.lol"
- Build Variable: No
- Is Multiline: No
- Is Literal: Yes

```

### Installing locally

`npm install`

`npm i postcss-load-config`

`npm run build`

`node .\server\server.js`

Tech stack:

- LibSQL (Turso free tier)
- NodeJS
- Redis (serve and retrieve, free tier Redis cloud)
- RedisQ (Zkillboard feed, from zKillboard)
- Svelte frontend with shadn/UI
- ThreeJS for visualizations
- Coolify on Hetzner for deployment

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

### TODO

- Add additional options for the tts messages. Allow the user to enable roaming gang warnings, and high risk system warnings, also potentially nearby roam warnings (example, if a gang kills someone in your region).
- Add npc losses tab, showing where players died to valuable npcs (if it is triangulatable)