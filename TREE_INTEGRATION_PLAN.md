# Tree Integration And Allocation Plan

This plan replaces the old palm-first island tree system with the real tree-lab
bank from the live isometric workshop:

`/Users/asmith/isometric/src/workshop/tree-lab/treeLabModel.js`

The current palm island state is checkpointed as `PALM TREE CLASSIC` before the
tree allocator is replaced. That commit is the backout point.

## Direction

- Use the tree-lab bank for the main land.
- Use palms mostly on island fringes, fairway edges, lagoon edges, bunkers,
  beaches, and lowland transition zones.
- Expanded trees become the normal tree system. There should not be a separate
  "classic palms plus optional Minecraft trees" path.
- The old generic `src/flora/trees.js` broadleaf/conifer stand-ins are not the
  desired visual source.
- The island should feel lush in aerial shots, not like evenly sprinkled props.
- It is okay to support about 2000 trees if placement, scale, and clusters make
  them read as canopy mass instead of noise.

## Source Bank

The tree-lab bank has 96 visible slots, but the current matrix is not final
human-proofed content:

- Slots `1-40` are weaker and more redundant. They skew green/summer.
- Slots `38-72` are broadly usable for autumn and transition regions.
- Slots `65-72` are a useful spruce mix and should not be under-represented.
- Slots `81-88` are among the best trees and are currently under-represented.
- Slots `89-96` may still be unfilled or reserved for incoming palms.
- Slots `27-28` are odd lone branch/skeleton trees and should be categorized
  carefully, not treated as normal dense canopy.

The first integration should import the whole bank, then expose a classification
chart rather than asking for hand editing one slot at a time.

## Target Bank Shape

Build a canonical 128-slot tree registry:

- slots `1-96`: imported tree-lab slots
- slots `97-128`: palm variants generated from the existing production palm

Each slot should carry metadata:

- `slot`
- `family`: broadleaf, autumn, conifer, sparse, palm, skeleton, hybrid
- `season`: summer, autumn, conifer, winter, fringe
- `strength`: primary, secondary, accent, avoid
- `scale`
- `terrainAffinity`
- `clusterAffinity`

The exact classification is allowed to change after seeing the chart.

## Classification Chart

Before judging island placement, produce a chart sorted by the proposed
classification:

- summer greens
- autumn yellows
- autumn rust/red
- conifer/spruce
- sparse peaks/skeletons
- palms/fringe
- weak/avoid

The chart should show slot number, family, season, and intended terrain. The
visual sort matters more than the original numerical order.

## Allocation Layers

Tree placement should be layered. Each layer can have a color/debug view later.

### Terrain Layers

- `sand`: natural beach/coast sand.
- `whiteSand`: future lagoon and beach highlight sand. Needed to sell the
  lagoon.
- `fairway`: manicured green lowland/course surface.
- `grass`: normal lush green land.
- `autumn`: mustard/yellow/orange seasonal land tint.
- `dirt`: dry/talus transition.
- `rock`: steep/massif/sea cliff structure.
- `snow`: upper cap.
- `grassySnow`: upper fringe transition.
- `seafloor`: shallow/deep underwater terrain.
- `bunker`: sand-trap-like patches inside fairway regions.
- `lagoonWater`: inland or semi-inland calm water.
- `lagoonApron`: white-sand/green transition ring around lagoon water.

### Tree Layers

- `palmFringe`: palms near beach, lagoon, bunkers, and lowland fairway edges.
- `summerCanopy`: green broadleaf canopy on low/mid grass.
- `autumnCanopy`: primary tree mass for yellow/orange regions. Target more like
  30 percent visual share, even if raw terrain area is lower.
- `spruceMix`: conifers/spruce on upper slopes and selected autumn edge zones.
- `peakSparse`: sparse pines/skeletons only. Do not trash the mountain tops with
  dense conifers.
- `accentTrees`: isolated odd shapes, skeletons, and high-character slots.
- `openCuts`: deliberate empty masks so the island has bare golf-course/lawn
  areas and readable terrain.

## Placement Model

Do not scatter one tree at a time uniformly.

1. Build candidate cells from terrain:
   - reject water except lagoon-edge palm rules
   - reject steep cliffs for broadleaf
   - allow sparse trees on upper slopes
   - keep summit caps sparse

2. Build cluster fields:
   - season noise field
   - moisture/lagoon distance field
   - coastline distance field
   - slope/altitude field
   - open-cut field

3. Place clusters:
   - each cluster chooses a local slot palette
   - cluster palette should be region-biased, not totally random
   - autumn clusters can mix yellow/rust/green in local families
   - conifer clusters should favor `65-72` and `81-88`
   - palm clusters favor lagoon/bunker/beach/fairway edge

4. Place individual trees inside clusters:
   - use blue-noise-ish spacing or occupancy cells
   - vary scale and rotation
   - use small local palette drift within a cluster
   - respect terrain and slope masks

## Scaling

Tree-lab scale is presentation scale. Island scale must be normalized:

- compute a bounding box per slot
- normalize each slot around the production palm height range
- expose `tree.globalScale`
- expose per-family scale trims
- preserve palms as large fringe silhouettes

The first pass can use bounding-box normalization plus family multipliers. Do
not tune by eye in the raw tree-lab scale.

## Lagoon Layer

The lagoon is a first-class terrain feature, not the same as the valley/delta.

Goals:

- inland or mostly inland lagoon
- optional narrow inlet or seawall-like connection to ocean
- balances the composition opposite/near the massif
- adds palm/fringe density targets
- creates a reason for white sand and lush clusters

Initial lagoon params:

- `lagoon.enable`
- `lagoon.x`
- `lagoon.z`
- `lagoon.radiusX`
- `lagoon.radiusZ`
- `lagoon.rotation`
- `lagoon.depth`
- `lagoon.inlet`
- `lagoon.apronWidth`
- `lagoon.whiteSand`
- `lagoon.treeAttraction`

It should be independent from `valleyDepth` / `deltaFloor`.

## Panel Cleanup

The tree panel can be redesigned from scratch.

Gut or hide:

- `tree.palmSway` for now.
- `godrays` panel for now.
- old generic mixed tree controls.

Render panel direction:

- keep FOV where it is useful.
- Takram tone mapping belongs near the top of render/finishing.
- Dither can stay but is visually minor right now.
- Legacy `render.exposure` is mostly a legacy-sky/ocean-horizon control and
  should not drive Takram look unless explicitly routed that way.

## A1 Target Notes

A1 is currently the target island shape after swapping the A5 look into A1 and
lowering massif to `280`.

Approximate generated land spread:

- summer: `72.8%`
- autumn: `20.8%`
- conifer: `5.5%`
- winter: `0.9%`

Because the desired visual target is closer to 30 percent autumn, the tree
allocator should overweight autumn clusters before changing the season field.
Only rework seasons/massif if the allocation debug map proves the island cannot
carry enough visual variety.

## Phases

1. Checkpoint `PALM TREE CLASSIC`.
2. Import tree-lab model and required methodology generators into clouds.
3. Add palm variants to reach a 128-slot registry.
4. Generate classification chart and metadata draft.
5. Replace island tree placement with the tree-bank allocator.
6. Add lagoon terrain controls and material masks.
7. Add tree/debug panel for counts, layers, cluster density, scale, and family
   weights.
8. Produce island screenshots and allocation maps for tuning.
