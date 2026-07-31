<div align="center">
  <h1>Topology Path Editor</h1>
</div>

<p align="center">
  <a href="README.md">English</a> •
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
A single-page React + Three.js application for visualizing point-cloud maps and editing topology nodes, edges, path points, and path-facing rotations.
</p>

## Features

- Load point-cloud/map files:
  - PCD ASCII/Binary
  - ASCII PLY
  - XYZ/TXT/CSV point lists
- Load topology JSON files with:
  - `topology_nodes`
  - `edges`
  - `path_points`
- Display the map and topology in a 3D Three.js scene.
- Drag topology nodes and update their `x`, `y`, `z` values.
- Add/delete topology nodes from the panel or place a new node directly in the 3D view.
- Adding a node while another node is selected connects only to that selected node with a new branch edge; other edges (including other branches from the same node) are left untouched. Adding a node with no selection leaves it unconnected.
- Deleting a node removes only the edges touching it; unrelated edges elsewhere in the graph, including other branches, are preserved.
- Drag nodes in the node list to reorder them and renumber node IDs; existing edges keep their endpoints (remapped through the id change) instead of being rebuilt.
- Edit a selected node ID manually; if the target ID already exists, that node and following nodes are shifted forward.
- Add/delete edges.
- Edit node type values.
- Default node types:
  - `junction`
  - `charge`
  - `elevator`
  - `stair`
- Add/delete custom node types.
- Generate edge `path_points` by interpolation.
- Adjust interpolation spacing, default `0.2m`.
- Regenerate all unlocked paths or only the selected unlocked edge.
- Reverse the full route direction while preserving node IDs and existing path geometry.
- Lock selected edges so the `path_points` between those two topo points are preserved while editing other content.
- Add temporary topo points on an edge to control path turns.
- Edit/delete individual path points.
- Edit node and path-point rotation as `angle`, `radian`, or `quaternion`.
- Show rotation arrows for topology nodes and sampled path points in the 3D view.
- Convert an inner edge path point into a real topo point; the original edge is split at that point.
- Convert a topo point with exactly two unlocked connected edges back into a normal path point; the adjacent edges are merged.
- Undo the previous operation.
- Open a history panel and restore any recorded edit step.
- Choose the page and 3D scene background color, default dark.
- Manually adjust the rendered 3D point cloud size and color.
- Switch the camera to any cube-face viewpoint: top, bottom, front, back, left, or right.
- Export updated topology JSON.

## Install

```bash
cd src/topology-path-editor
npm install
```

## Run(Specify port)

```bash
npm run dev -- --port 8080
```

Open:

```text
http://localhost:8080/
```

## Run(No port specified)

```bash
npm run dev
```

Open:

```text
http://localhost:5173/
```

## Build

```bash
npm run build
```

## Preview Production Build

```bash
npm run preview -- --port 4173
```

## Render Verification

The project includes a small headless Chrome smoke test that loads the sample `floor2.json`, renders the WebGL canvas on desktop/mobile viewports, and checks that the canvas is not blank.

```bash
npm run verify:render
```

Screenshots are written to:

```text
/tmp/topology-editor-desktop.png
/tmp/topology-editor-mobile.png
```

If Chrome is not at `/usr/bin/google-chrome`, set:

```bash
CHROME_BIN=/path/to/chrome npm run verify:render
```

## JSON Format

Expected input/output shape:

```json
{
  "metadata": {
    "scene": "topology-editor",
    "distance_threshold": 0.2,
    "total_topology_nodes": 2,
    "total_edges": 1,
    "total_path_points": 2
  },
  "topology_nodes": [
    {
      "id": 0,
      "x": 0,
      "y": 0,
      "z": 0,
      "angle": 0,
      "radian": 0,
      "quaternion": [0, 0, 0, 1],
      "rotation_mode": "path",
      "type": "charge"
    },
    {
      "id": 1,
      "x": 2,
      "y": 0,
      "z": 0,
      "angle": 0,
      "radian": 0,
      "quaternion": [0, 0, 0, 1],
      "rotation_mode": "path",
      "type": "junction"
    }
  ],
  "edges": [
    {
      "from": 0,
      "to": 1,
      "path_points": [
        {
          "seq": 1,
          "x": 0,
          "y": 0,
          "z": 0,
          "angle": 0,
          "radian": 0,
          "quaternion": [0, 0, 0, 1]
        },
        {
          "seq": 2,
          "x": 2,
          "y": 0,
          "z": 0,
          "angle": 0,
          "radian": 0,
          "quaternion": [0, 0, 0, 1]
        }
      ]
    }
  ]
}
```

## Rotation Fields

- Nodes and path points use Z-axis yaw rotations.
- The editor keeps `angle` in degrees, `radian` in radians, and `quaternion` as `[x, y, z, w]` synchronized with each other.
- Imported path points can use `angle`, `radian`, `rotation_degrees`, `rotation_radians`, `quaternion`, `quat`, or `orientation`.
- Topology node rotations follow the path direction by default. Manually edited node rotations are exported with `rotation_mode: "manual"`.
- Generated or regenerated path points get their rotation from the path direction.

## Temporary Topo Points

Temporary topo points are internal edge control points. They are useful when an edge should bend between two normal topology nodes.

Behavior:

- They are shown in the 3D scene as orange diamond points.
- They can be added from the selected edge panel with `Add Temp Point`.
- They can be dragged in the 3D view.
- They participate in interpolation as:

```text
from node -> temporary topo points -> to node
```

Export behavior:

- Temporary topo points are not exported as `topology_nodes`.
- The internal `temporary_points` field is stripped from exported edges.
- Their effect is preserved through the generated edge `path_points`.

## Path Locks

Select an edge and enable `Path lock` in the edge panel. While locked:

- Moving other topo points, adding nodes, or changing temporary points on other edges leaves this edge's `path_points` unchanged.
- Global path regeneration and spacing changes skip the locked edge.
- Unlock the edge before editing its temporary topo points, manual path points, or regenerating that edge.
- Lock state is editor-only and is stripped from exported JSON; the preserved `path_points` remain in the exported edge.

## Path Point / Topo Point Conversion

- Select an edge and use the convert button in the `Path points` list to turn an inner path point into a topo point.
- The first and last path points already represent topo points, so only inner path points can be converted.
- Converting a path point splits the original edge into two edges and preserves the path points and temporary topo points on each side.
- Select a topo point and click `Convert to Path Point` to turn it back into a normal path point.
- A topo point can be converted back only when it has exactly two connected unlocked edges; those edges are merged into one edge.

## Editing Workflow

1. Load a map file.
2. Load a topology JSON file.
3. Select nodes or edges from the left panel or 3D scene.
4. Add nodes from the panel or enable placement mode and click the 3D view.
5. Drag nodes or temporary topo points in the 3D scene.
6. Edit node coordinates, type, ID, or `Rotation Z` values from the selected node panel.
7. Drag nodes inside the `Nodes` list if you need to reorder and renumber node IDs.
8. Select an edge to edit path points, temporary topo points, locks, or per-point rotations.
9. Adjust spacing to regenerate interpolated paths.
10. Use the reverse-direction button in `Path Generation` when the loaded route needs to run the other way.
11. Use `Undo` or `History` if you need to roll back.
12. Change the background color, point-cloud size, point-cloud color, or cube-face viewpoint from `Appearance` if needed.
13. Export the edited topology JSON.

## Notes

- Large PCD files are downsampled in the browser for responsive rendering.
- `binary_compressed` PCD is not supported by the lightweight built-in loader.
- Loading JSON preserves existing `path_points`; moving a node only regenerates connected unlocked edges, and moving a temporary point only regenerates that edge.
- If an input JSON contains node types outside the default set, those types are added to the type list automatically.
- Node ID changes update edge `from`/`to` references automatically.
- The topology is a general graph, not a forced single chain: a node can have multiple outgoing/incoming edges (branches), and node add/delete/reorder operations only touch the edges that reference the affected node instead of rebuilding the whole edge list.
- Export updates metadata counts and `distance_threshold` from the current spacing value.
- Regenerated path-point rotations are derived from the path direction in the XY plane.
