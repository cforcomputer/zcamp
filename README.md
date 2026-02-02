# New goal:
## Simplification (assume kills are not real time)
### Delete
  - Remove minigame
  - Remove profiles
  - Remove starmap with live updates
  - Remove the content find filter
  - Remove leaderboard
  - Remove discord webhook alerts
  - Remove redis (we only need one db)
  - Remove active battles (5 min)
  - Cloudflare blocking screen
### Keep
  - Roaming gangs
  - Gate camps
  - Pathfinding
  - Salvage sites
  - TTS alerts
  - Postgresql (for future ML)
  - Setting destination ingame
### Add
  - Improved pathfinding algo for destination maker (from paper: Breaking the Sorting Barrier for Directed Single-Source Shortest Paths) else Dijkstra’s
  - TTS alert if disconnected
  - TTS Action summary readout when jumping in system + toggle to turn off.
  - ML model that remembers players who participated in a 99% positive gatecamp, gives higher rating later.
  - Switch to shadecn for cleaner look, remove custom ui blocks(?) -- test for fun
  - Switch to history table in Postgresql so last kms are saved after a restart/crash.

Model can still work if the people dying link their kb losses with no delay? ask. 

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

REDISQ_URL="https://zkillredisq.stream/listen.php?queueID=Voltron9000"
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


### Other ideas (old)

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
- Add additional options for the tts messages. Allow the user to enable roaming gang warnings, and high risk system warnings, also potentially nearby roam warnings (example, if a gang kills someone in your region). It should warn you of the location of the combat activity and tell you what the composition is of the activity if occurred in the last 3 minutes.
- Give the "AI" voice a name, like TARA.
- Reduce the time decay for smartbomb camps and highlight them as blue, allow the user to filter by smartbomb camps.
- Add a second cache list for camps, even if the decay has reduced it to less than 1%, it will stay watch that gate for 20 minutes after to see if there is another kill, then it will still count for the successive kills bonus. For smartbomb camps, it is 30 minutes. 
- Reduce the complexity and load time of the campcrushers leaderboard
- Figure out a way to model the entire eve map and show real time updates and pathing for roaming gangs and camps, allow user to right click and set destination. Clicking a system opens the map and shows locations of kills.
- Add a filter gangs to only show roaming gangs (multiple systems)
- Add a filter for gangs that is a dropdown to show currently active regions, user can also type it in to filter the dropdown to select what they want.
- Add an option to send alerts if there is a gang in a specific region.
- Exclude kills where the attacker is only a structure: https://zkillboard.com/kill/126528882/ https://zkillboard.com/related/30001159/202504232200/ 
- Model complex relationships for camps over 7 days. If a system is repeatedly marked as a camp, record the time of day it first appears, and record when it ends. Create a graph that shows when that system is likely to be camped, and then feed this into the probability calculation. If there is a camp there, it immediately jumps to 95% probability and takes longer to degrade (20 minutes instead of 10). It also has a special mark to show it is a regularly camped system.
- The tables stores the  frequency of camps for the system over time, but we only fetch the last 7 days. This way we continue to accumulate data over time and can use it to visualize popular camp locations over time by specific groups (should also record the corp/alliance name of the campers and the ship types)
- If recording the ship types (We want to show this anyways in the composition instead of probability debug), then we can use the composition to better model against other camps to increase accuracy.
- 50% of the pre-time decay probability prediction should be ML 
- Add an additional score that is recalculated once per day at downtime. This score should check for the frequency + probability > 50% (combined max score) for different systems and groups to identify most camped systems. This score should be used in ML.
- There should be two ML models, one does clustering for a cluster score, and the other is a manual random forest classifier.

- The knows there's a rare npc kill because the status bar is generated, but it does not appear.
- Add a limit to connected roam stargates to 10
