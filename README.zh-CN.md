<div align="center">
  <h1>拓扑路径编辑器</h1>
</div>

<p align="center">
  <a href="README.md">English</a> •
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
这是一个基于 React + Three.js 的单页前端应用，用于加载点云地图、编辑拓扑节点、拓扑边、路径点以及路径朝向旋转。
</p>

## 功能

- 加载点云或地图文件：
  - PCD ASCII/Binary
  - ASCII PLY
  - XYZ/TXT/CSV 点列表
- 加载拓扑 JSON 文件，支持以下字段：
  - `topology_nodes`
  - `edges`
  - `path_points`
- 在 Three.js 3D 场景中显示地图和拓扑结构。
- 拖拽拓扑节点并实时更新 `x`、`y`、`z` 坐标。
- 可从面板添加或删除拓扑节点，也可进入放置模式后在 3D 视图中点击新增节点。
- 添加节点时若有选中节点，只会从该选中节点新拉一条分支 edge 连到新节点；该节点上的其他 edge（包括其他分支）保持不变。若没有选中节点，新节点不会自动连线。
- 删除节点时只会移除与该节点相连的 edge；图中其他不相关的 edge（包括其他分支）都会保留。
- 在 Nodes 列表中拖拽节点顺序，并同步重新编号节点 ID；已有 edge 只是端点 ID 随之映射，不会被重建。
- 在选中节点信息框中手动修改节点 ID；如果目标 ID 已存在，该 ID 及后续节点会整体顺延。
- 添加或删除拓扑边。
- 修改节点 `type`。
- 默认节点类型：
  - `junction`
  - `charge`
  - `elevator`
  - `stair`
- 添加或删除自定义节点类型。
- 根据 edge 自动插值生成 `path_points`。
- 调整插值间距，默认 `0.2m`。
- 可重新生成所有未锁定路径，也可只重新生成当前选中的未锁定 edge。
- 可一键反转整条路线方向，同时保留原节点 ID 和已有路径形状。
- 可锁定指定 edge，锁定后该段两个 topo point 之间的 `path_points` 不会被自动重算。
- 在 edge 上添加临时 topo point，用来控制路径转折。
- 编辑或删除单个路径点。
- 可用 `angle`、`radian` 或 `quaternion` 编辑节点和路径点的旋转朝向。
- 在 3D 视图中显示拓扑节点和采样路径点的朝向箭头。
- 将 edge 内部的普通路径点转换为真正的 topo point；转换时会在该点拆分原 edge。
- 将只有两条未锁定连接边的 topo point 转回普通路径点；转换时会合并相邻两条 edge。
- 撤销上一步操作。
- 打开历史记录窗口，并回退到任意历史步骤。
- 手动选择页面和 3D 场景背景颜色，默认深色。
- 手动调整 3D 点云的点大小和显示颜色。
- 可将相机切换到正方体 6 个面对应的视角：上、下、前、后、左、右。
- 导出更新后的拓扑 JSON。

## 安装

```bash
cd src/topology-path-editor
npm install
```

## 启动（指定端口）

```bash
npm run dev -- --port 8080
```

浏览器打开：

```text
http://localhost:8080/
```

## 启动（不指定端口，默认启动）

```bash
npm run dev
```

浏览器打开：

```text
http://localhost:5173/
```

## 构建

```bash
npm run build
```

## 预览生产构建

```bash
npm run preview -- --port 4173
```

## 渲染验证

项目内置了一个基于 headless Chrome 的渲染冒烟测试。它会加载示例 `floor2.json`，在桌面和移动端视口中渲染 WebGL 画布，并检查画布不是空白。

```bash
npm run verify:render
```

截图输出到：

```text
/tmp/topology-editor-desktop.png
/tmp/topology-editor-mobile.png
```

如果 Chrome 不在 `/usr/bin/google-chrome`，可以这样指定：

```bash
CHROME_BIN=/path/to/chrome npm run verify:render
```

## JSON 格式

输入和导出的 JSON 结构示例：

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

## 旋转字段

- 节点和路径点使用 Z 轴 yaw 朝向。
- 编辑器会同步维护角度制 `angle`、弧度制 `radian`，以及 `[x, y, z, w]` 格式的 `quaternion`。
- 导入的路径点可使用 `angle`、`radian`、`rotation_degrees`、`rotation_radians`、`quaternion`、`quat` 或 `orientation`。
- 拓扑节点默认跟随路径方向；手动编辑过的节点朝向会以 `rotation_mode: "manual"` 导出。
- 自动生成或重新生成的路径点朝向来自路径方向。

## 临时 Topo Point

临时 topo point 是 edge 内部的控制点，适合用来让两个正常拓扑节点之间的路径产生转折。

行为：

- 在 3D 场景中显示为橙色菱形点。
- 选中 edge 后，可通过 `Add Temp Point` 添加。
- 可以在 3D 视图中拖拽。
- 插值生成路径时按以下顺序参与计算：

```text
from node -> temporary topo points -> to node
```

导出行为：

- 临时 topo point 不会导出为 `topology_nodes`。
- 内部使用的 `temporary_points` 字段不会出现在导出的 edge 中。
- 它对路径的影响会保留在生成后的 edge `path_points` 中。

## 路径锁定

选中某条 edge 后，可以在该 edge 面板中打开 `Path lock`。锁定后：

- 移动其他 topo point、添加节点、调整其他 edge 的临时点时，这条 edge 的 `path_points` 保持不变。
- 全局重新生成路径或修改 spacing 时，会跳过锁定 edge。
- 需要编辑该 edge 的临时 topo point、手动 path point 或重新生成该 edge 时，先关闭锁定。
- 锁定状态只在编辑器内部使用，导出 JSON 时会移除；锁定期间保留下来的 `path_points` 仍会正常导出。

## Path Point 与 Topo Point 转换

- 选中 edge 后，在 `Path points` 列表中点击路径点行右侧的转换按钮，可将普通路径点转换为 topo point。
- edge 首尾两个路径点本身已经对应 topo point，不能再次转换；只有 edge 内部路径点可以转换。
- 转换普通路径点时，原 edge 会被拆成两条 edge，并保留两侧已有 `path_points` 和临时 topo point。
- 选中 topo point 后，可点击 `Convert to Path Point` 将它转回普通路径点。
- topo point 转回路径点要求该节点只有两条连接 edge，且这两条 edge 都未锁定；转换后相邻两条 edge 会合并成一条 edge。

## 编辑流程

1. 加载地图文件。
2. 加载拓扑 JSON 文件。
3. 从左侧面板或 3D 场景中选择节点或边。
4. 可从面板添加节点，也可启用放置模式后在 3D 视图中点击新增节点。
5. 在 3D 场景中拖拽节点或临时 topo point。
6. 在选中节点面板中编辑节点坐标、类型、ID 或 `Rotation Z`。
7. 需要调整节点编号时，在 `Nodes` 列表中拖拽节点顺序。
8. 选中 edge 后，可编辑路径点、临时 topo point、锁定状态和单个路径点朝向。
9. 调整 spacing 重新生成插值路径。
10. 如果加载后的路线方向相反，可在 `Path Generation` 中点击反转方向按钮。
11. 需要回退时使用 `Undo` 或 `History`。
12. 需要时在 `Appearance` 中修改背景颜色、点云大小、点云颜色或切换 6 面视角。
13. 导出编辑后的拓扑 JSON。

## 注意事项

- 大型 PCD 文件会在浏览器中下采样，以保证交互流畅。
- 内置轻量加载器不支持 `binary_compressed` PCD。
- 加载 JSON 时会保留已有 `path_points`；移动节点只会重新生成连接该节点且未锁定的 edge，移动临时点只会重新生成对应 edge。
- 如果输入 JSON 中包含默认类型之外的节点类型，这些类型会自动加入 type 列表，避免旧数据丢失。
- 修改节点 ID 时会自动同步更新 edge 的 `from`/`to` 引用。
- 拓扑结构是一个通用图，而不是强制的单链：一个节点可以有多条出边/入边（分支）；添加、删除、排序节点时只会处理与受影响节点相关的 edge，不会重建整个 edge 列表。
- 导出时会根据当前 spacing 更新 `distance_threshold` 和 metadata 统计数量。
- 重新生成的路径点朝向来自 XY 平面内的路径方向。
