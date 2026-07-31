import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  ColorPicker,
  Divider,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  message,
} from 'antd';
import {
  ArrowRightLeft,
  Download,
  FileJson,
  Focus,
  GitBranchPlus,
  GripVertical,
  History as HistoryIcon,
  Link2,
  Lock,
  Map as MapIcon,
  MousePointer2,
  Palette,
  Plus,
  RefreshCw,
  Route,
  Spline,
  Trash2,
  Undo2,
  Unlock,
  UploadCloud,
} from 'lucide-react';
import TopologyViewer from './components/TopologyViewer';
import { parseMapFile } from './helpers/fileLoaders';
import { getTypeColor } from './helpers/colors';
import {
  DEFAULT_SPACING,
  LOCKED_EDGE_FIELD,
  TEMPORARY_POINTS_FIELD,
  edgeKey,
  ensurePathPoints,
  getTemporaryPoints,
  isPathLocked,
  refreshTopologyMetadata,
  regenerateAffectedPaths,
  regenerateAllPaths,
  resequencePathPoints,
  temporaryPointKey,
} from './helpers/pathInterpolation';
import {
  createEmptyTopology,
  downloadTopologyJson,
  getNextNodeId,
  getTypesFromTopology,
  loadTopologyJson,
} from './helpers/topologyJson';
import {
  getPointRotationRadians,
  getYawBetweenPoints,
  normalizePointRotation,
  regeneratePathPointRotations,
  syncRotationFields,
} from './helpers/rotation';

const blankTopology = createEmptyTopology();
const blankNodeTypes = getTypesFromTopology(blankTopology);
const MAX_HISTORY_ENTRIES = 120;
const DEFAULT_BACKGROUND_COLOR = '#0f172a';
const DEFAULT_POINT_CLOUD_COLOR = '#38bdf8';
const DEFAULT_POINT_CLOUD_SIZE = 0.035;
const ROTATION_MODE_FIELD = 'rotation_mode';
const MANUAL_ROTATION_MODE = 'manual';
const BACKGROUND_PRESETS = ['#0f172a', '#111827', '#1f2937', '#ffffff', '#f8fafc'];
const VIEW_FACE_OPTIONS = [
  { value: 'top', label: 'Top', title: 'Top face (+Z)' },
  { value: 'bottom', label: 'Bottom', title: 'Bottom face (-Z)' },
  { value: 'front', label: 'Front', title: 'Front face (-Y)' },
  { value: 'back', label: 'Back', title: 'Back face (+Y)' },
  { value: 'left', label: 'Left', title: 'Left face (-X)' },
  { value: 'right', label: 'Right', title: 'Right face (+X)' },
];

function cloneValue(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function createHistoryEntry(label, topology, spacing, nodeTypes, activeType) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    label,
    timestamp: new Date().toISOString(),
    snapshot: {
      topology: cloneValue(topology),
      spacing,
      nodeTypes: [...nodeTypes],
      activeType,
    },
  };
}

function formatHistoryTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatNumber(value) {
  return Number(value || 0).toFixed(3);
}

function getRotationField(point, field) {
  return normalizePointRotation(point, getPointRotationRadians(point, 0))[field];
}

function getQuaternionArray(point) {
  return getRotationField(point, 'quaternion') || [0, 0, 0, 1];
}

function isManualNodeRotation(node) {
  return node?.[ROTATION_MODE_FIELD] === MANUAL_ROTATION_MODE;
}

function getEdgeIndexByKey(edges, key) {
  return (edges || []).findIndex((edge, index) => edgeKey(edge, index) === key);
}

function clampSpacing(value) {
  return Math.max(0.01, Number(value) || DEFAULT_SPACING);
}

function clampPointCloudSize(value) {
  return Math.max(0.001, Math.min(1, Number(value) || DEFAULT_POINT_CLOUD_SIZE));
}

function makeExportName(sourceName) {
  if (!sourceName) return 'topology-edited.json';
  return sourceName.toLowerCase().endsWith('.json')
    ? sourceName.replace(/\.json$/i, '-edited.json')
    : `${sourceName}-edited.json`;
}

function normalizeHexColor(value) {
  const text = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(text)) return `#${text.toLowerCase()}`;
  return null;
}

function copyPathPoint(point, fallbackSeq = 1) {
  return {
    ...point,
    seq: Number.isFinite(Number(point?.seq)) ? Number(point.seq) : fallbackSeq,
    x: Number(point?.x) || 0,
    y: Number(point?.y) || 0,
    z: Number(point?.z) || 0,
  };
}

function nodeToPathPoint(node, seq = 1) {
  const rotation = normalizePointRotation(node, getPointRotationRadians(node, 0));
  return {
    seq,
    x: Number(node?.x) || 0,
    y: Number(node?.y) || 0,
    z: Number(node?.z) || 0,
    angle: rotation.angle,
    radian: rotation.radian,
    quaternion: rotation.quaternion,
  };
}

function pointDistance(first, second) {
  return Math.hypot(
    (Number(first?.x) || 0) - (Number(second?.x) || 0),
    (Number(first?.y) || 0) - (Number(second?.y) || 0),
    (Number(first?.z) || 0) - (Number(second?.z) || 0),
  );
}

function getFirstDistinctPoint(points = [], reference) {
  return points.find((point) => pointDistance(point, reference) > 0.0001);
}

function getLastDistinctPoint(points = [], reference) {
  return points.slice().reverse().find((point) => pointDistance(point, reference) > 0.0001);
}

function getNodePathYaw(topology, node, fallbackRadians = 0) {
  if (!node) return fallbackRadians;
  const nodeId = Number(node.id);
  const nodesById = new Map((topology.topology_nodes || []).map((item) => [Number(item.id), item]));

  const edges = topology.edges || [];
  for (const edge of edges) {
    const pathPoints = edge.path_points || [];

    if (Number(edge.from) === nodeId) {
      const nextPoint = getFirstDistinctPoint(pathPoints.slice(1), node) || nodesById.get(Number(edge.to));
      return nextPoint ? getYawBetweenPoints(node, nextPoint, fallbackRadians) : fallbackRadians;
    }
  }

  for (const edge of edges) {
    const pathPoints = edge.path_points || [];
    if (Number(edge.to) === nodeId) {
      const previousPoint = getLastDistinctPoint(pathPoints.slice(0, -1), node) || nodesById.get(Number(edge.from));
      return previousPoint ? getYawBetweenPoints(previousPoint, node, fallbackRadians) : fallbackRadians;
    }
  }

  const orderedNodes = topology.topology_nodes || [];
  const nodeIndex = orderedNodes.findIndex((item) => Number(item.id) === nodeId);
  const nextNode = orderedNodes[nodeIndex + 1];
  const previousNode = orderedNodes[nodeIndex - 1];
  if (nextNode) return getYawBetweenPoints(node, nextNode, fallbackRadians);
  if (previousNode) return getYawBetweenPoints(previousNode, node, fallbackRadians);
  return fallbackRadians;
}

function normalizeTopologyNodeRotations(topology) {
  let fallbackRadians = 0;
  return {
    ...topology,
    topology_nodes: (topology.topology_nodes || []).map((node) => {
      if (isManualNodeRotation(node)) {
        const radians = getPointRotationRadians(node, fallbackRadians);
        fallbackRadians = radians;
        return normalizePointRotation(node, radians);
      }

      const pathYaw = getNodePathYaw(topology, node, fallbackRadians);
      fallbackRadians = pathYaw;
      return syncRotationFields({
        ...node,
        [ROTATION_MODE_FIELD]: 'path',
      }, 'radian', pathYaw);
    }),
  };
}

function getNearestPathPointIndex(pathPoints = [], point) {
  if (!pathPoints.length) return -1;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  pathPoints.forEach((pathPoint, index) => {
    const distance = pointDistance(pathPoint, point);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function splitTemporaryPoints(edge, splitIndex) {
  const pathPoints = edge.path_points || [];
  const splitPoint = pathPoints[splitIndex];
  const first = [];
  const second = [];

  getTemporaryPoints(edge).forEach((point) => {
    if (splitPoint && pointDistance(point, splitPoint) < 0.0001) return;
    const nearestIndex = getNearestPathPointIndex(pathPoints, point);
    if (nearestIndex >= 0 && nearestIndex <= splitIndex) {
      first.push(point);
    } else {
      second.push(point);
    }
  });

  return [first, second];
}

function getBaseEdgeFields(edge = {}) {
  const {
    from: _from,
    to: _to,
    source: _source,
    target: _target,
    start: _start,
    end: _end,
    path_points: _pathPoints,
    temporary_points: _temporaryPoints,
    temp_points: _legacyTempPoints,
    _temporary_points: _privateTemporaryPoints,
    path_locked: _pathLocked,
    locked_path: _legacyPathLocked,
    _path_locked: _privatePathLocked,
    ...rest
  } = edge;

  return rest;
}

function makeSplitEdge(sourceEdge, from, to, pathPoints, temporaryPoints) {
  return {
    ...getBaseEdgeFields(sourceEdge),
    from: Number(from),
    to: Number(to),
    [TEMPORARY_POINTS_FIELD]: temporaryPoints,
    [LOCKED_EDGE_FIELD]: isPathLocked(sourceEdge),
    path_points: pathPoints.map((point, index) => copyPathPoint(point, index + 1)),
  };
}

function insertNodeBetweenEdgeEndpoints(nodes = [], edge, node) {
  const fromIndex = nodes.findIndex((item) => Number(item.id) === Number(edge.from));
  const toIndex = nodes.findIndex((item) => Number(item.id) === Number(edge.to));

  if (fromIndex >= 0 && toIndex >= 0 && Math.abs(fromIndex - toIndex) === 1) {
    const nextNodes = [...nodes];
    nextNodes.splice(Math.max(fromIndex, toIndex), 0, node);
    return nextNodes;
  }

  if (fromIndex >= 0) {
    const nextNodes = [...nodes];
    nextNodes.splice(fromIndex + 1, 0, node);
    return nextNodes;
  }

  return [...nodes, node];
}

function getConnectedEdgeEntries(edges = [], nodeId) {
  return edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => Number(edge.from) === Number(nodeId) || Number(edge.to) === Number(nodeId));
}

function getOtherEndpoint(edge, nodeId) {
  if (Number(edge.from) === Number(nodeId)) return Number(edge.to);
  if (Number(edge.to) === Number(nodeId)) return Number(edge.from);
  return null;
}

function orientPathPoints(edge, startId, endId, nodesById) {
  const sourcePoints = Array.isArray(edge.path_points) && edge.path_points.length
    ? edge.path_points.map((point, index) => copyPathPoint(point, index + 1))
    : [
        nodeToPathPoint(nodesById.get(Number(edge.from)), 1),
        nodeToPathPoint(nodesById.get(Number(edge.to)), 2),
      ];
  const shouldReverse = Number(edge.from) === Number(endId) && Number(edge.to) === Number(startId);
  const oriented = shouldReverse ? sourcePoints.slice().reverse() : sourcePoints;
  const startNode = nodesById.get(Number(startId));
  const endNode = nodesById.get(Number(endId));
  const withStart = startNode && pointDistance(oriented[0], startNode) > 0.0001
    ? [nodeToPathPoint(startNode, 1), ...oriented]
    : oriented;

  return endNode && pointDistance(withStart[withStart.length - 1], endNode) > 0.0001
    ? [...withStart, nodeToPathPoint(endNode, withStart.length + 1)]
    : withStart;
}

function orientTemporaryPoints(edge, startId, endId) {
  const temporaryPoints = getTemporaryPoints(edge);
  return Number(edge.from) === Number(endId) && Number(edge.to) === Number(startId)
    ? temporaryPoints.slice().reverse()
    : temporaryPoints;
}

function pickDemotionSegments(nodes = [], nodeId, connectedEdges = []) {
  const nodeIndex = nodes.findIndex((node) => Number(node.id) === Number(nodeId));
  const entries = connectedEdges.map((entry) => {
    const neighborId = getOtherEndpoint(entry.edge, nodeId);
    return {
      ...entry,
      neighborId,
      neighborIndex: nodes.findIndex((node) => Number(node.id) === Number(neighborId)),
    };
  });

  const before = entries
    .filter((entry) => entry.neighborIndex >= 0 && entry.neighborIndex < nodeIndex)
    .sort((first, second) => second.neighborIndex - first.neighborIndex)[0];
  const after = entries
    .filter((entry) => entry.neighborIndex > nodeIndex)
    .sort((first, second) => first.neighborIndex - second.neighborIndex)[0];

  if (before && after) return [before, after];
  return entries.sort((first, second) => first.index - second.index);
}

function isSameUndirectedEdge(edge, firstNodeId, secondNodeId) {
  return (
    (Number(edge.from) === Number(firstNodeId) && Number(edge.to) === Number(secondNodeId)) ||
    (Number(edge.from) === Number(secondNodeId) && Number(edge.to) === Number(firstNodeId))
  );
}

function getEdgeIndexesForNode(edges = [], nodeId) {
  return edges.reduce((indexes, edge, index) => {
    const id = Number(nodeId);
    return Number(edge.from) === id || Number(edge.to) === id
      ? [...indexes, index]
      : indexes;
  }, []);
}

function reverseRouteTopology(topology, spacing) {
  let nextSeq = 1;
  const edges = (topology.edges || []).slice().reverse().map((edge) => {
    const pathPoints = regeneratePathPointRotations(
      (edge.path_points || []).slice().reverse().map((point) => {
        const nextPoint = {
          ...copyPathPoint(point, nextSeq),
          seq: nextSeq,
        };
        nextSeq += 1;
        return nextPoint;
      }),
    );

    return {
      ...getBaseEdgeFields(edge),
      from: Number(edge.to),
      to: Number(edge.from),
      [TEMPORARY_POINTS_FIELD]: getTemporaryPoints(edge).slice().reverse(),
      [LOCKED_EDGE_FIELD]: isPathLocked(edge),
      path_points: pathPoints,
    };
  });

  return refreshTopologyMetadata(
    {
      ...topology,
      topology_nodes: (topology.topology_nodes || []).slice().reverse(),
      edges,
    },
    spacing,
  );
}

export default function App() {
  const [topology, setTopology] = useState(blankTopology);
  const [mapData, setMapData] = useState(null);
  const [spacing, setSpacing] = useState(DEFAULT_SPACING);
  const [nodeTypes, setNodeTypes] = useState(blankNodeTypes);
  const [activeType, setActiveType] = useState(blankNodeTypes[0]);
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_BACKGROUND_COLOR);
  const [backgroundColorInput, setBackgroundColorInput] = useState(DEFAULT_BACKGROUND_COLOR);
  const [pointCloudSize, setPointCloudSize] = useState(DEFAULT_POINT_CLOUD_SIZE);
  const [pointCloudColor, setPointCloudColor] = useState(DEFAULT_POINT_CLOUD_COLOR);
  const [pointCloudColorInput, setPointCloudColorInput] = useState(DEFAULT_POINT_CLOUD_COLOR);
  const [activeViewFace, setActiveViewFace] = useState(null);
  const [viewFaceRequest, setViewFaceRequest] = useState({ face: null, nonce: 0 });
  const [newType, setNewType] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState(null);
  const [selectedTempPointKey, setSelectedTempPointKey] = useState(null);
  const [draggingNodeId, setDraggingNodeId] = useState(null);
  const [edgeFrom, setEdgeFrom] = useState(null);
  const [edgeTo, setEdgeTo] = useState(null);
  const [addNodeMode, setAddNodeMode] = useState(false);
  const [fitNonce, setFitNonce] = useState(1);
  const [mapStatus, setMapStatus] = useState('');
  const [jsonFileName, setJsonFileName] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyState, setHistoryState] = useState(() => ({
    entries: [createHistoryEntry('Initial state', blankTopology, DEFAULT_SPACING, blankNodeTypes, blankNodeTypes[0])],
    cursor: 0,
  }));

  const mapInputRef = useRef(null);
  const jsonInputRef = useRef(null);
  const topologyRef = useRef(topology);
  const spacingRef = useRef(spacing);
  const nodeTypesRef = useRef(nodeTypes);
  const activeTypeRef = useRef(activeType);
  const dragStartRef = useRef(null);
  const tempPointDragStartRef = useRef(null);

  useEffect(() => {
    topologyRef.current = topology;
  }, [topology]);

  useEffect(() => {
    spacingRef.current = spacing;
  }, [spacing]);

  useEffect(() => {
    nodeTypesRef.current = nodeTypes;
  }, [nodeTypes]);

  useEffect(() => {
    activeTypeRef.current = activeType;
  }, [activeType]);

  const selectedNode = useMemo(
    () => topology.topology_nodes.find((node) => Number(node.id) === Number(selectedNodeId)),
    [topology.topology_nodes, selectedNodeId],
  );
  const selectedEdgeIndex = useMemo(
    () => getEdgeIndexByKey(topology.edges, selectedEdgeKey),
    [topology.edges, selectedEdgeKey],
  );
  const selectedEdge = selectedEdgeIndex >= 0 ? topology.edges[selectedEdgeIndex] : null;
  const selectedEdgeLocked = selectedEdge ? isPathLocked(selectedEdge) : false;
  const selectedNodeConnectedEdges = useMemo(
    () => (selectedNode ? getConnectedEdgeEntries(topology.edges, selectedNode.id) : []),
    [topology.edges, selectedNode],
  );
  const selectedNodeHasLockedEdges = selectedNodeConnectedEdges.some(({ edge }) => isPathLocked(edge));
  const canConvertSelectedNodeToPathPoint = selectedNodeConnectedEdges.length === 2 && !selectedNodeHasLockedEdges;
  const selectedTemporaryPoints = useMemo(
    () => (selectedEdge ? getTemporaryPoints(selectedEdge) : []),
    [selectedEdge],
  );

  const nodeOptions = useMemo(
    () =>
      topology.topology_nodes.map((node) => ({
        value: Number(node.id),
        label: `#${node.id} ${node.type || 'waypoint'}`,
      })),
    [topology.topology_nodes],
  );

  const typeOptions = useMemo(
    () => nodeTypes.map((type) => ({ value: type, label: type })),
    [nodeTypes],
  );

  const canUndo = historyState.cursor > 0;
  const canReverseRoute = topology.topology_nodes.length > 1 || topology.edges.length > 0;
  const currentHistoryEntry = historyState.entries[historyState.cursor];

  const applyBackgroundColor = (value) => {
    const nextColor = normalizeHexColor(value);
    if (!nextColor) return;
    setBackgroundColor(nextColor);
    setBackgroundColorInput(nextColor);
  };

  const handleBackgroundInput = (event) => {
    const value = event.target.value;
    setBackgroundColorInput(value);
    const nextColor = normalizeHexColor(value);
    if (nextColor) setBackgroundColor(nextColor);
  };

  const applyPointCloudColor = (value) => {
    const nextColor = normalizeHexColor(value);
    if (!nextColor) return;
    setPointCloudColor(nextColor);
    setPointCloudColorInput(nextColor);
  };

  const handlePointCloudColorInput = (event) => {
    const value = event.target.value;
    setPointCloudColorInput(value);
    const nextColor = normalizeHexColor(value);
    if (nextColor) setPointCloudColor(nextColor);
  };

  const changePointCloudSize = (value) => {
    setPointCloudSize(clampPointCloudSize(value));
  };

  const selectViewFace = (face) => {
    setActiveViewFace(face);
    setViewFaceRequest((current) => ({
      face,
      nonce: current.nonce + 1,
    }));
  };

  const remapTopologyNodeIds = useCallback((current, nextNodes, idMap) => {
    // Reordering/renumbering only touches ids; every existing edge (including
    // branches) is kept and just has its from/to translated through idMap.
    const mappedEdges = current.edges.map((edge) => ({
      ...edge,
      from: idMap.has(Number(edge.from)) ? idMap.get(Number(edge.from)) : Number(edge.from),
      to: idMap.has(Number(edge.to)) ? idMap.get(Number(edge.to)) : Number(edge.to),
    }));

    return refreshTopologyMetadata(
      {
        ...current,
        topology_nodes: nextNodes,
        edges: mappedEdges,
      },
      spacingRef.current,
    );
  }, []);

  const syncEndpointDrafts = (idMap) => {
    setEdgeFrom((value) => {
      if (value === null || value === undefined) return value;
      return idMap.has(Number(value)) ? idMap.get(Number(value)) : value;
    });
    setEdgeTo((value) => {
      if (value === null || value === undefined) return value;
      return idMap.has(Number(value)) ? idMap.get(Number(value)) : value;
    });
  };

  const pushHistoryEntry = useCallback((label, nextTopology, nextSpacing, nextNodeTypes, nextActiveType) => {
    const entry = createHistoryEntry(
      label,
      nextTopology,
      nextSpacing,
      nextNodeTypes,
      nextActiveType,
    );

    setHistoryState((current) => {
      const baseEntries = current.entries.slice(0, current.cursor + 1);
      const entries = [...baseEntries, entry];
      const trimmedEntries = entries.length > MAX_HISTORY_ENTRIES
        ? entries.slice(entries.length - MAX_HISTORY_ENTRIES)
        : entries;

      return {
        entries: trimmedEntries,
        cursor: trimmedEntries.length - 1,
      };
    });
  }, []);

  const commitEditorState = useCallback(
    (label, nextTopology, options = {}) => {
      const nextSpacing = options.spacing ?? spacingRef.current;
      const nextNodeTypes = options.nodeTypes ?? nodeTypesRef.current;
      const nextActiveType = options.activeType ?? activeTypeRef.current;
      const topologySnapshot = cloneValue(normalizeTopologyNodeRotations(nextTopology));

      topologyRef.current = topologySnapshot;
      spacingRef.current = nextSpacing;
      nodeTypesRef.current = [...nextNodeTypes];
      activeTypeRef.current = nextActiveType;

      setTopology(topologySnapshot);
      setSpacing(nextSpacing);
      setNodeTypes([...nextNodeTypes]);
      setActiveType(nextActiveType);
      pushHistoryEntry(label, topologySnapshot, nextSpacing, nextNodeTypes, nextActiveType);
    },
    [pushHistoryEntry],
  );

  const restoreHistoryIndex = useCallback(
    (index) => {
      const entry = historyState.entries[index];
      if (!entry) return;

      const nextTopology = normalizeTopologyNodeRotations(cloneValue(entry.snapshot.topology));
      const nextNodeTypes = [...entry.snapshot.nodeTypes];

      topologyRef.current = nextTopology;
      spacingRef.current = entry.snapshot.spacing;
      nodeTypesRef.current = nextNodeTypes;
      activeTypeRef.current = entry.snapshot.activeType;

      setTopology(nextTopology);
      setSpacing(entry.snapshot.spacing);
      setNodeTypes(nextNodeTypes);
      setActiveType(entry.snapshot.activeType);
      setHistoryState((current) => ({ ...current, cursor: index }));
      setSelectedNodeId(nextTopology.topology_nodes[0]?.id ?? null);
      setSelectedEdgeKey(null);
      setSelectedTempPointKey(null);
      setEdgeFrom(nextTopology.edges[0]?.from ?? nextTopology.topology_nodes[0]?.id ?? null);
      setEdgeTo(nextTopology.edges[0]?.to ?? nextTopology.topology_nodes[1]?.id ?? null);
      setAddNodeMode(false);
      setFitNonce((value) => value + 1);
    },
    [historyState.entries],
  );

  const undoLast = () => {
    if (!canUndo) return;
    restoreHistoryIndex(historyState.cursor - 1);
    message.success('Undone');
  };

  const handleMapFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      message.loading({ content: `Loading ${file.name}`, key: 'map' });
      const parsed = await parseMapFile(file);
      setMapData(parsed);
      setMapStatus(`${parsed.name} - ${parsed.format} - ${parsed.sampledCount.toLocaleString()} / ${parsed.originalCount.toLocaleString()} points`);
      setFitNonce((value) => value + 1);
      message.success({ content: 'Map loaded', key: 'map' });
    } catch (error) {
      message.error({ content: error.message, key: 'map' });
    }
  };

  const handleTopologyFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const loaded = await loadTopologyJson(file);
      const inferredSpacing = clampSpacing(loaded.metadata?.distance_threshold);
      const withPaths = ensurePathPoints(loaded, inferredSpacing);
      const discoveredTypes = getTypesFromTopology(withPaths);
      const nextActiveType = discoveredTypes.includes(activeTypeRef.current)
        ? activeTypeRef.current
        : discoveredTypes[0] || 'waypoint';
      commitEditorState(`Loaded ${file.name}`, withPaths, {
        spacing: inferredSpacing,
        nodeTypes: discoveredTypes,
        activeType: nextActiveType,
      });
      setSelectedNodeId(withPaths.topology_nodes[0]?.id ?? null);
      setSelectedEdgeKey(withPaths.edges[0] ? edgeKey(withPaths.edges[0], 0) : null);
      setEdgeFrom(withPaths.edges[0]?.from ?? withPaths.topology_nodes[0]?.id ?? null);
      setEdgeTo(withPaths.edges[0]?.to ?? withPaths.topology_nodes[1]?.id ?? null);
      setJsonFileName(file.name);
      setFitNonce((value) => value + 1);
      message.success(`Loaded ${file.name}`);
    } catch (error) {
      message.error(error.message);
    }
  };

  const selectNode = useCallback((nodeId) => {
    setSelectedNodeId(nodeId);
    setSelectedTempPointKey(null);
    if (nodeId !== null && nodeId !== undefined) {
      setAddNodeMode(false);
    }
  }, []);

  const selectEdge = useCallback((key) => {
    setSelectedEdgeKey(key);
    setSelectedTempPointKey(null);
    if (key) setAddNodeMode(false);
  }, []);

  const selectTempPoint = useCallback((key, pointIndex, tempPointKey) => {
    if (!key) {
      setSelectedTempPointKey(null);
      return;
    }
    setSelectedEdgeKey(key);
    setSelectedNodeId(null);
    setSelectedTempPointKey(tempPointKey);
    setAddNodeMode(false);
  }, []);

  const beginNodeMove = useCallback((nodeId) => {
    const node = topologyRef.current.topology_nodes.find((item) => Number(item.id) === Number(nodeId));
    dragStartRef.current = node
      ? { id: Number(nodeId), x: Number(node.x) || 0, y: Number(node.y) || 0, z: Number(node.z) || 0 }
      : null;
  }, []);

  const updateNodePosition = useCallback((nodeId, position) => {
    const current = topologyRef.current;
    const next = regenerateAffectedPaths(
      {
        ...current,
        topology_nodes: current.topology_nodes.map((node) =>
          Number(node.id) === Number(nodeId)
            ? { ...node, x: position.x, y: position.y, z: position.z }
            : node,
        ),
      },
      spacingRef.current,
      getEdgeIndexesForNode(current.edges, nodeId),
    );

    const normalizedNext = normalizeTopologyNodeRotations(next);
    topologyRef.current = normalizedNext;
    setTopology(normalizedNext);
  }, []);

  const finishNodeMove = useCallback(
    (nodeId, position) => {
      const start = dragStartRef.current;
      dragStartRef.current = null;
      if (!start || Number(start.id) !== Number(nodeId)) return;

      const movedDistance = Math.hypot(
        (Number(position.x) || 0) - start.x,
        (Number(position.y) || 0) - start.y,
        (Number(position.z) || 0) - start.z,
      );
      if (movedDistance < 0.0001) return;

      const current = topologyRef.current;
      const next = regenerateAffectedPaths(
        {
          ...current,
          topology_nodes: current.topology_nodes.map((node) =>
            Number(node.id) === Number(nodeId)
              ? { ...node, x: position.x, y: position.y, z: position.z }
              : node,
          ),
        },
        spacingRef.current,
        getEdgeIndexesForNode(current.edges, nodeId),
      );
      commitEditorState(`Moved node #${nodeId}`, next);
    },
    [commitEditorState],
  );

  const beginTempPointMove = useCallback((key, pointIndex) => {
    const current = topologyRef.current;
    const edgeIndex = getEdgeIndexByKey(current.edges, key);
    if (edgeIndex >= 0 && isPathLocked(current.edges[edgeIndex])) {
      tempPointDragStartRef.current = null;
      return;
    }
    const point = edgeIndex >= 0 ? getTemporaryPoints(current.edges[edgeIndex])[pointIndex] : null;
    tempPointDragStartRef.current = point
      ? { key, pointIndex, x: Number(point.x) || 0, y: Number(point.y) || 0, z: Number(point.z) || 0 }
      : null;
  }, []);

  const finishTempPointMove = useCallback(
    (key, pointIndex, position) => {
      const start = tempPointDragStartRef.current;
      tempPointDragStartRef.current = null;
      if (!start || start.key !== key || Number(start.pointIndex) !== Number(pointIndex)) return;

      const movedDistance = Math.hypot(
        (Number(position.x) || 0) - start.x,
        (Number(position.y) || 0) - start.y,
        (Number(position.z) || 0) - start.z,
      );
      if (movedDistance < 0.0001) return;

      const current = topologyRef.current;
      const edgeIndex = getEdgeIndexByKey(current.edges, key);
      if (edgeIndex < 0) return;
      if (isPathLocked(current.edges[edgeIndex])) {
        message.warning('Unlock this edge before moving its temp points');
        return;
      }

      const nextTopology = regenerateAffectedPaths(
        {
          ...current,
          edges: current.edges.map((edge, index) => {
            if (index !== edgeIndex) return edge;
            return {
              ...edge,
              [TEMPORARY_POINTS_FIELD]: getTemporaryPoints(edge).map((point, currentPointIndex) =>
                currentPointIndex === pointIndex ? { ...point, ...position } : point,
              ),
            };
          }),
        },
        spacingRef.current,
        [edgeIndex],
      );

      commitEditorState(`Moved temp point ${pointIndex + 1}`, nextTopology);
    },
    [commitEditorState],
  );

  const reorderNodesByDrag = (event, targetNodeId) => {
    event.preventDefault();
    const sourceNodeId = Number(draggingNodeId ?? event.dataTransfer.getData('text/plain'));
    if (!Number.isFinite(sourceNodeId) || Number(sourceNodeId) === Number(targetNodeId)) {
      setDraggingNodeId(null);
      return;
    }

    const current = topologyRef.current;
    const currentOrder = current.topology_nodes.map((node) => Number(node.id));
    const sourceIndex = currentOrder.indexOf(sourceNodeId);
    const targetIndex = currentOrder.indexOf(Number(targetNodeId));
    if (sourceIndex < 0 || targetIndex < 0) {
      setDraggingNodeId(null);
      return;
    }

    const nextOrder = [...currentOrder];
    nextOrder.splice(sourceIndex, 1);
    const targetIndexAfterRemoval = nextOrder.indexOf(Number(targetNodeId));
    const rect = event.currentTarget.getBoundingClientRect();
    const insertAfter = event.clientY > rect.top + rect.height / 2;
    const insertIndex = targetIndexAfterRemoval + (insertAfter ? 1 : 0);
    nextOrder.splice(insertIndex, 0, sourceNodeId);

    const nodesByOldId = new Map(current.topology_nodes.map((node) => [Number(node.id), node]));
    const idMap = new Map(nextOrder.map((oldId, index) => [Number(oldId), index]));
    const nextNodes = nextOrder.map((oldId, index) => ({
      ...nodesByOldId.get(Number(oldId)),
      id: index,
    }));

    const nextTopology = remapTopologyNodeIds(current, nextNodes, idMap);
    commitEditorState('Reordered nodes', nextTopology);
    setSelectedNodeId(idMap.get(sourceNodeId));
    setSelectedEdgeKey(null);
    setSelectedTempPointKey(null);
    setDraggingNodeId(null);
    syncEndpointDrafts(idMap);
  };

  const updateNodeId = (nodeId, value) => {
    const targetId = Math.max(0, Math.trunc(Number(value) || 0));
    const currentId = Number(nodeId);
    if (!Number.isFinite(currentId) || targetId === currentId) return;

    const current = topologyRef.current;
    const targetNode = current.topology_nodes.find((node) => Number(node.id) === currentId);
    if (!targetNode) return;

    const targetExists = current.topology_nodes.some(
      (node) => Number(node.id) === targetId && Number(node.id) !== currentId,
    );

    const idMap = new Map();
    const nextNodes = current.topology_nodes
      .map((node) => {
        const oldId = Number(node.id);
        let nextId = oldId;

        if (oldId === currentId) {
          nextId = targetId;
        } else if (targetExists && oldId >= targetId) {
          nextId = oldId + 1;
        }

        idMap.set(oldId, nextId);
        return { ...node, id: nextId };
      })
      .sort((first, second) => Number(first.id) - Number(second.id));

    const nextTopology = remapTopologyNodeIds(current, nextNodes, idMap);
    commitEditorState(`Changed node #${currentId} id to ${targetId}`, nextTopology);
    setSelectedNodeId(targetId);
    setSelectedEdgeKey(null);
    setSelectedTempPointKey(null);
    syncEndpointDrafts(idMap);
  };

  const updateNodeField = (nodeId, field, value) => {
    const current = topologyRef.current;
    const next = {
      ...current,
      topology_nodes: current.topology_nodes.map((node) =>
        Number(node.id) === Number(nodeId) ? { ...node, [field]: value } : node,
      ),
    };
    const nextTopology = ['x', 'y', 'z'].includes(field)
      ? regenerateAffectedPaths(next, spacingRef.current, getEdgeIndexesForNode(current.edges, nodeId))
      : refreshTopologyMetadata(next, spacingRef.current);
    commitEditorState(`Updated node #${nodeId} ${field}`, nextTopology);
  };

  const updateNodeRotation = (nodeId, source, value) => {
    const current = topologyRef.current;
    const nextTopology = refreshTopologyMetadata(
      {
        ...current,
        topology_nodes: current.topology_nodes.map((node) =>
          Number(node.id) === Number(nodeId)
            ? syncRotationFields({
                ...node,
                [ROTATION_MODE_FIELD]: MANUAL_ROTATION_MODE,
              }, source, value)
            : node,
        ),
      },
      spacingRef.current,
    );

    commitEditorState(`Updated node #${nodeId} rotation`, nextTopology);
  };

  const updateNodeQuaternionComponent = (nodeId, componentIndex, value) => {
    const current = topologyRef.current;
    const node = current.topology_nodes.find((item) => Number(item.id) === Number(nodeId));
    const quaternion = [...getQuaternionArray(node)];
    quaternion[componentIndex] = Number(value) || 0;
    updateNodeRotation(nodeId, 'quaternion', quaternion);
  };

  const resetNodeRotationToPath = (nodeId) => {
    const current = topologyRef.current;
    const nextTopology = refreshTopologyMetadata(
      {
        ...current,
        topology_nodes: current.topology_nodes.map((node) =>
          Number(node.id) === Number(nodeId)
            ? { ...node, [ROTATION_MODE_FIELD]: 'path' }
            : node,
        ),
      },
      spacingRef.current,
    );

    commitEditorState(`Reset node #${nodeId} rotation to path`, nextTopology);
  };

  const addNode = (position) => {
    const current = topologyRef.current;
    const id = getNextNodeId(current.topology_nodes);
    const selectedNodeForConnection = current.topology_nodes.find(
      (node) => Number(node.id) === Number(selectedNodeId),
    );
    const centroid = current.topology_nodes.length
      ? current.topology_nodes.reduce(
          (sum, node) => ({ x: sum.x + node.x, y: sum.y + node.y, z: sum.z + node.z }),
          { x: 0, y: 0, z: 0 },
        )
      : { x: 0, y: 0, z: 0 };
    const divisor = current.topology_nodes.length || 1;
    const nextNode = {
      id,
      x: position?.x ?? (selectedNodeForConnection ? selectedNodeForConnection.x + 0.6 : centroid.x / divisor),
      y: position?.y ?? (selectedNodeForConnection ? selectedNodeForConnection.y + 0.6 : centroid.y / divisor),
      z: position?.z ?? (selectedNodeForConnection ? selectedNodeForConnection.z : centroid.z / divisor),
      type: activeTypeRef.current,
    };
    const nextNodes = [...current.topology_nodes, nextNode];

    // Connect only to the selected node, as a new branch edge; every other
    // existing edge (including other branches out of that same node) is
    // left untouched instead of being folded back into a single chain.
    let nextTopology;
    if (selectedNodeForConnection) {
      const nextEdge = {
        from: Number(selectedNodeForConnection.id),
        to: id,
        [LOCKED_EDGE_FIELD]: false,
        path_points: [],
      };
      const nextEdgeIndex = current.edges.length;
      nextTopology = regenerateAffectedPaths(
        {
          ...current,
          topology_nodes: nextNodes,
          edges: [...current.edges, nextEdge],
        },
        spacingRef.current,
        [nextEdgeIndex],
      );
    } else {
      nextTopology = refreshTopologyMetadata(
        { ...current, topology_nodes: nextNodes },
        spacingRef.current,
      );
    }

    commitEditorState(`Added node #${id}`, nextTopology);
    setSelectedNodeId(id);
    setSelectedEdgeKey(null);
    setSelectedTempPointKey(null);
    setAddNodeMode(false);
    setEdgeFrom(nextTopology.edges[0]?.from ?? nextTopology.topology_nodes[0]?.id ?? null);
    setEdgeTo(nextTopology.edges[0]?.to ?? nextTopology.topology_nodes[1]?.id ?? null);
  };

  const deleteSelectedNode = () => {
    if (selectedNodeId === null || selectedNodeId === undefined) return;
    const current = topologyRef.current;
    // Drop the node and only the edges touching it; other edges (branches
    // elsewhere in the graph) are left as-is rather than bridged together.
    const nextTopology = refreshTopologyMetadata(
      {
        ...current,
        topology_nodes: current.topology_nodes.filter((node) => Number(node.id) !== Number(selectedNodeId)),
        edges: current.edges.filter(
          (edge) => Number(edge.from) !== Number(selectedNodeId) && Number(edge.to) !== Number(selectedNodeId),
        ),
      },
      spacingRef.current,
    );
    commitEditorState(`Deleted node #${selectedNodeId}`, nextTopology);
    setSelectedNodeId(null);
    setSelectedEdgeKey(null);
    setSelectedTempPointKey(null);
    setEdgeFrom(nextTopology.edges[0]?.from ?? nextTopology.topology_nodes[0]?.id ?? null);
    setEdgeTo(nextTopology.edges[0]?.to ?? nextTopology.topology_nodes[1]?.id ?? null);
  };

  const addType = () => {
    const cleaned = newType.trim();
    if (!cleaned) return;
    const nextTypes = nodeTypesRef.current.includes(cleaned) ? nodeTypesRef.current : [...nodeTypesRef.current, cleaned];
    commitEditorState(`Added type ${cleaned}`, topologyRef.current, {
      nodeTypes: nextTypes,
      activeType: cleaned,
    });
    setNewType('');
  };

  const changeActiveType = (value) => {
    commitEditorState(`Changed default type to ${value}`, topologyRef.current, {
      activeType: value,
    });
  };

  const deleteType = (type) => {
    if (nodeTypesRef.current.length <= 1) {
      message.warning('At least one type is required');
      return;
    }

    const nextTypes = nodeTypesRef.current.filter((item) => item !== type);
    const fallbackType = nextTypes.includes(activeTypeRef.current) ? activeTypeRef.current : nextTypes[0] || 'waypoint';
    const current = topologyRef.current;
    const nextTopology = refreshTopologyMetadata(
      {
        ...current,
        topology_nodes: current.topology_nodes.map((node) =>
          node.type === type ? { ...node, type: fallbackType } : node,
        ),
      },
      spacingRef.current,
    );

    commitEditorState(`Deleted type ${type}`, nextTopology, {
      nodeTypes: nextTypes,
      activeType: fallbackType,
    });
  };

  const changeSpacing = (value) => {
    const nextSpacing = clampSpacing(value);
    const nextTopology = regenerateAllPaths(topologyRef.current, nextSpacing);
    commitEditorState(`Changed spacing to ${nextSpacing.toFixed(2)}m`, nextTopology, {
      spacing: nextSpacing,
    });
  };

  const regeneratePaths = () => {
    const nextTopology = regenerateAllPaths(topologyRef.current, spacingRef.current);
    commitEditorState('Regenerated paths', nextTopology);
    const lockedCount = topologyRef.current.edges.filter((edge) => isPathLocked(edge)).length;
    message.success(lockedCount ? 'Unlocked paths regenerated; locked edges preserved' : 'Paths regenerated');
  };

  const reverseRoute = () => {
    const current = topologyRef.current;
    if ((current.topology_nodes?.length || 0) <= 1 && !(current.edges || []).length) {
      message.warning('Load or create a route before reversing it');
      return;
    }

    const previousSelectedEdgeIndex = getEdgeIndexByKey(current.edges, selectedEdgeKey);
    const nextTopology = reverseRouteTopology(current, spacingRef.current);
    const nextSelectedEdgeIndex = previousSelectedEdgeIndex >= 0
      ? nextTopology.edges.length - 1 - previousSelectedEdgeIndex
      : -1;
    const nextSelectedEdge = nextSelectedEdgeIndex >= 0
      ? nextTopology.edges[nextSelectedEdgeIndex]
      : null;
    const firstEdge = nextTopology.edges[0];

    commitEditorState('Reversed route', nextTopology);
    setSelectedEdgeKey(nextSelectedEdge ? edgeKey(nextSelectedEdge, nextSelectedEdgeIndex) : null);
    setSelectedTempPointKey(null);
    setEdgeFrom(nextSelectedEdge?.from ?? firstEdge?.from ?? nextTopology.topology_nodes[0]?.id ?? null);
    setEdgeTo(nextSelectedEdge?.to ?? firstEdge?.to ?? nextTopology.topology_nodes[1]?.id ?? null);
    setAddNodeMode(false);
    message.success('Route direction reversed');
  };

  const regenerateSelectedEdge = () => {
    if (!selectedEdge) return;
    if (selectedEdgeLocked) {
      message.warning('Unlock this edge before regenerating it');
      return;
    }

    const current = topologyRef.current;
    const edgeIndex = getEdgeIndexByKey(current.edges, selectedEdgeKey);
    if (edgeIndex < 0) return;

    const nextTopology = regenerateAffectedPaths(current, spacingRef.current, [edgeIndex]);
    commitEditorState(`Regenerated edge ${selectedEdge.from}->${selectedEdge.to}`, nextTopology);
    message.success('Edge regenerated');
  };

  const toggleSelectedEdgeLock = (checked) => {
    if (!selectedEdge) return;
    const current = topologyRef.current;
    const edgeIndex = getEdgeIndexByKey(current.edges, selectedEdgeKey);
    if (edgeIndex < 0) return;

    const nextTopology = refreshTopologyMetadata(
      {
        ...current,
        edges: current.edges.map((edge, index) =>
          index === edgeIndex ? { ...edge, [LOCKED_EDGE_FIELD]: checked } : edge,
        ),
      },
      spacingRef.current,
    );

    commitEditorState(
      `${checked ? 'Locked' : 'Unlocked'} edge ${selectedEdge.from}->${selectedEdge.to}`,
      nextTopology,
    );
  };

  const addEdge = () => {
    if (edgeFrom === null || edgeTo === null || Number(edgeFrom) === Number(edgeTo)) return;
    const current = topologyRef.current;
    const exists = current.edges.some(
      (edge) =>
        (Number(edge.from) === Number(edgeFrom) && Number(edge.to) === Number(edgeTo)) ||
        (Number(edge.from) === Number(edgeTo) && Number(edge.to) === Number(edgeFrom)),
    );
    if (exists) {
      message.warning('That edge already exists');
      return;
    }

    const nextEdge = { from: Number(edgeFrom), to: Number(edgeTo), [LOCKED_EDGE_FIELD]: false, path_points: [] };
    const nextIndex = current.edges.length;

    const nextTopology = regenerateAffectedPaths(
      {
        ...current,
        edges: [...current.edges, nextEdge],
      },
      spacingRef.current,
      [nextIndex],
    );
    commitEditorState(`Added edge ${edgeFrom}->${edgeTo}`, nextTopology);
    setSelectedEdgeKey(edgeKey(nextEdge, nextIndex));
    setSelectedNodeId(null);
    setSelectedTempPointKey(null);
  };

  const deleteSelectedEdge = () => {
    if (!selectedEdge) return;
    const current = topologyRef.current;
    const nextTopology = refreshTopologyMetadata(
      {
        ...current,
        edges: current.edges.filter((edge, index) => edgeKey(edge, index) !== selectedEdgeKey),
      },
      spacingRef.current,
    );
    commitEditorState(`Deleted edge ${selectedEdge.from}->${selectedEdge.to}`, nextTopology);
    setSelectedEdgeKey(null);
    setSelectedTempPointKey(null);
  };

  const updatePathPoint = (pointIndex, field, value) => {
    if (!selectedEdge) return;
    if (selectedEdgeLocked) {
      message.warning('Unlock this edge before editing path points');
      return;
    }
    const current = topologyRef.current;
    const nextTopology = refreshTopologyMetadata(
      {
        ...current,
        edges: current.edges.map((edge, index) => {
          if (index !== selectedEdgeIndex) return edge;
          return {
            ...edge,
            path_points: edge.path_points.map((point, currentPointIndex) =>
              currentPointIndex === pointIndex ? { ...point, [field]: Number(value) || 0 } : point,
            ),
          };
        }),
      },
      spacingRef.current,
    );
    commitEditorState(`Edited path point ${pointIndex + 1}`, nextTopology);
  };

  const updatePathPointRotation = (pointIndex, source, value) => {
    if (!selectedEdge) return;
    if (selectedEdgeLocked) {
      message.warning('Unlock this edge before editing path point rotations');
      return;
    }
    const current = topologyRef.current;
    const nextTopology = refreshTopologyMetadata(
      {
        ...current,
        edges: current.edges.map((edge, index) => {
          if (index !== selectedEdgeIndex) return edge;
          return {
            ...edge,
            path_points: edge.path_points.map((point, currentPointIndex) =>
              currentPointIndex === pointIndex ? syncRotationFields(point, source, value) : point,
            ),
          };
        }),
      },
      spacingRef.current,
    );
    commitEditorState(`Edited path point ${pointIndex + 1} rotation`, nextTopology);
  };

  const updatePathPointQuaternionComponent = (pointIndex, componentIndex, value) => {
    const current = topologyRef.current;
    const point = current.edges[selectedEdgeIndex]?.path_points?.[pointIndex];
    const quaternion = [...getQuaternionArray(point)];
    quaternion[componentIndex] = Number(value) || 0;
    updatePathPointRotation(pointIndex, 'quaternion', quaternion);
  };

  const insertPathPoint = () => {
    if (!selectedEdge) return;
    if (selectedEdgeLocked) {
      message.warning('Unlock this edge before adding path points');
      return;
    }
    const points = selectedEdge.path_points || [];
    const last = points[points.length - 1];
    const beforeLast = points[points.length - 2];
    const fromNode = topology.topology_nodes.find((node) => Number(node.id) === Number(selectedEdge.from));
    const toNode = topology.topology_nodes.find((node) => Number(node.id) === Number(selectedEdge.to));
    const baseA = beforeLast || fromNode || { x: 0, y: 0, z: 0 };
    const baseB = last || toNode || baseA;
    const lastSeq = Number(last?.seq);
    const inserted = {
      seq: Number.isFinite(lastSeq) ? lastSeq + 1 : points.length + 1,
      x: (Number(baseA.x) + Number(baseB.x)) / 2,
      y: (Number(baseA.y) + Number(baseB.y)) / 2,
      z: (Number(baseA.z) + Number(baseB.z)) / 2,
    };

    const current = topologyRef.current;
    const nextTopology = refreshTopologyMetadata(
      {
        ...current,
        edges: current.edges.map((edge, index) =>
          index === selectedEdgeIndex ? { ...edge, path_points: [...(edge.path_points || []), inserted] } : edge,
        ),
      },
      spacingRef.current,
    );
    commitEditorState('Inserted path point', nextTopology);
  };

  const addTemporaryPoint = () => {
    if (!selectedEdge) {
      message.warning('Select an edge first');
      return;
    }
    if (selectedEdgeLocked) {
      message.warning('Unlock this edge before adding temp points');
      return;
    }

    const current = topologyRef.current;
    const edgeIndex = getEdgeIndexByKey(current.edges, selectedEdgeKey);
    if (edgeIndex < 0) return;

    const edge = current.edges[edgeIndex];
    const pathPoints = edge.path_points || [];
    const midpoint = pathPoints[Math.floor(pathPoints.length / 2)];
    const fromNode = current.topology_nodes.find((node) => Number(node.id) === Number(edge.from));
    const toNode = current.topology_nodes.find((node) => Number(node.id) === Number(edge.to));
    const fallbackPoint = fromNode && toNode
      ? {
          x: (Number(fromNode.x) + Number(toNode.x)) / 2,
          y: (Number(fromNode.y) + Number(toNode.y)) / 2,
          z: (Number(fromNode.z) + Number(toNode.z)) / 2,
        }
      : { x: 0, y: 0, z: 0 };
    const nextPoint = {
      id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      x: midpoint?.x ?? fallbackPoint.x,
      y: midpoint?.y ?? fallbackPoint.y,
      z: midpoint?.z ?? fallbackPoint.z,
    };

    const nextTopology = regenerateAffectedPaths(
      {
        ...current,
        edges: current.edges.map((item, index) =>
          index === edgeIndex
            ? { ...item, [TEMPORARY_POINTS_FIELD]: [...getTemporaryPoints(item), nextPoint] }
            : item,
        ),
      },
      spacingRef.current,
      [edgeIndex],
    );

    commitEditorState(`Added temp point to edge ${edge.from}->${edge.to}`, nextTopology);
    const nextEdge = nextTopology.edges[edgeIndex];
    const nextPointIndex = getTemporaryPoints(nextEdge).length - 1;
    setSelectedTempPointKey(temporaryPointKey(nextEdge, edgeIndex, nextPointIndex));
    setSelectedEdgeKey(edgeKey(nextEdge, edgeIndex));
    setSelectedNodeId(null);
  };

  const updateTemporaryPointField = (pointIndex, field, value) => {
    if (!selectedEdge) return;
    if (selectedEdgeLocked) {
      message.warning('Unlock this edge before editing temp points');
      return;
    }
    const current = topologyRef.current;
    const edgeIndex = getEdgeIndexByKey(current.edges, selectedEdgeKey);
    if (edgeIndex < 0) return;

    const nextTopology = regenerateAffectedPaths(
      {
        ...current,
        edges: current.edges.map((edge, index) => {
          if (index !== edgeIndex) return edge;
          return {
            ...edge,
            [TEMPORARY_POINTS_FIELD]: getTemporaryPoints(edge).map((point, currentPointIndex) =>
              currentPointIndex === pointIndex ? { ...point, [field]: Number(value) || 0 } : point,
            ),
          };
        }),
      },
      spacingRef.current,
      [edgeIndex],
    );

    commitEditorState(`Edited temp point ${pointIndex + 1}`, nextTopology);
  };

  const deleteTemporaryPoint = (pointIndex) => {
    if (!selectedEdge) return;
    if (selectedEdgeLocked) {
      message.warning('Unlock this edge before deleting temp points');
      return;
    }
    const current = topologyRef.current;
    const edgeIndex = getEdgeIndexByKey(current.edges, selectedEdgeKey);
    if (edgeIndex < 0) return;

    const nextTopology = regenerateAffectedPaths(
      {
        ...current,
        edges: current.edges.map((edge, index) =>
          index === edgeIndex
            ? { ...edge, [TEMPORARY_POINTS_FIELD]: getTemporaryPoints(edge).filter((_, currentPointIndex) => currentPointIndex !== pointIndex) }
            : edge,
        ),
      },
      spacingRef.current,
      [edgeIndex],
    );

    commitEditorState(`Deleted temp point ${pointIndex + 1}`, nextTopology);
    setSelectedTempPointKey(null);
  };

  const deletePathPoint = (pointIndex) => {
    if (!selectedEdge || selectedEdge.path_points.length <= 1) return;
    if (selectedEdgeLocked) {
      message.warning('Unlock this edge before deleting path points');
      return;
    }
    const current = topologyRef.current;
    const nextTopology = refreshTopologyMetadata(
      {
        ...current,
        edges: current.edges.map((edge, index) =>
          index === selectedEdgeIndex
            ? { ...edge, path_points: edge.path_points.filter((_, currentPointIndex) => currentPointIndex !== pointIndex) }
            : edge,
        ),
      },
      spacingRef.current,
    );
    commitEditorState(`Deleted path point ${pointIndex + 1}`, nextTopology);
  };

  const convertPathPointToTopologyNode = (pointIndex) => {
    if (!selectedEdge) return;
    if (selectedEdgeLocked) {
      message.warning('Unlock this edge before converting path points');
      return;
    }

    const current = topologyRef.current;
    const edgeIndex = getEdgeIndexByKey(current.edges, selectedEdgeKey);
    const edge = current.edges[edgeIndex];
    const pathPoints = edge?.path_points || [];
    if (edgeIndex < 0 || pointIndex <= 0 || pointIndex >= pathPoints.length - 1) {
      message.warning('Only inner path points can be converted to topo points');
      return;
    }

    const sourcePoint = pathPoints[pointIndex];
    const sourceRotation = normalizePointRotation(sourcePoint, getPointRotationRadians(sourcePoint, 0));
    const newNodeId = getNextNodeId(current.topology_nodes);
    const nextNode = {
      id: newNodeId,
      x: Number(sourcePoint.x) || 0,
      y: Number(sourcePoint.y) || 0,
      z: Number(sourcePoint.z) || 0,
      angle: sourceRotation.angle,
      radian: sourceRotation.radian,
      quaternion: sourceRotation.quaternion,
      type: activeTypeRef.current,
    };
    const [firstTemporaryPoints, secondTemporaryPoints] = splitTemporaryPoints(edge, pointIndex);
    const firstEdge = makeSplitEdge(
      edge,
      edge.from,
      newNodeId,
      pathPoints.slice(0, pointIndex + 1),
      firstTemporaryPoints,
    );
    const secondEdge = makeSplitEdge(
      edge,
      newNodeId,
      edge.to,
      pathPoints.slice(pointIndex),
      secondTemporaryPoints,
    );
    const nextEdges = current.edges.flatMap((item, index) =>
      index === edgeIndex ? [firstEdge, secondEdge] : [item],
    );
    const nextTopology = resequencePathPoints(
      {
        ...current,
        topology_nodes: insertNodeBetweenEdgeEndpoints(current.topology_nodes, edge, nextNode),
        edges: nextEdges,
      },
      spacingRef.current,
    );

    commitEditorState(`Converted path point ${pointIndex + 1} to topo point #${newNodeId}`, nextTopology);
    setSelectedNodeId(newNodeId);
    setSelectedEdgeKey(null);
    setSelectedTempPointKey(null);
    setEdgeFrom(firstEdge.from);
    setEdgeTo(secondEdge.to);
  };

  const convertSelectedNodeToPathPoint = () => {
    if (!selectedNode) return;

    const current = topologyRef.current;
    const currentNode = current.topology_nodes.find((node) => Number(node.id) === Number(selectedNode.id));
    const connectedEdges = getConnectedEdgeEntries(current.edges, selectedNode.id);
    if (!currentNode || connectedEdges.length !== 2) {
      message.warning('A topo point must have exactly two connected edges before it can become a path point');
      return;
    }
    if (connectedEdges.some(({ edge }) => isPathLocked(edge))) {
      message.warning('Unlock the connected edges before converting this topo point');
      return;
    }

    const [firstSegment, secondSegment] = pickDemotionSegments(
      current.topology_nodes,
      currentNode.id,
      connectedEdges,
    );
    const firstNeighborId = firstSegment.neighborId;
    const secondNeighborId = secondSegment.neighborId;
    if (firstNeighborId === null || secondNeighborId === null || Number(firstNeighborId) === Number(secondNeighborId)) {
      message.warning('The selected topo point cannot be converted with its current edge connections');
      return;
    }

    const removeIndexes = new Set([firstSegment.index, secondSegment.index]);
    const hasDuplicateMergedEdge = current.edges.some((edge, index) =>
      !removeIndexes.has(index) && isSameUndirectedEdge(edge, firstNeighborId, secondNeighborId),
    );
    if (hasDuplicateMergedEdge) {
      message.warning('A direct edge between the neighboring topo points already exists');
      return;
    }

    const nodesById = new Map(current.topology_nodes.map((node) => [Number(node.id), node]));
    const firstPathPoints = orientPathPoints(firstSegment.edge, firstNeighborId, currentNode.id, nodesById);
    const secondPathPoints = orientPathPoints(secondSegment.edge, currentNode.id, secondNeighborId, nodesById);
    const mergedPathPoints = [...firstPathPoints, ...secondPathPoints.slice(1)];
    const mergedTemporaryPoints = [
      ...orientTemporaryPoints(firstSegment.edge, firstNeighborId, currentNode.id),
      ...orientTemporaryPoints(secondSegment.edge, currentNode.id, secondNeighborId),
    ];
    const mergedEdge = {
      ...getBaseEdgeFields(firstSegment.edge),
      from: Number(firstNeighborId),
      to: Number(secondNeighborId),
      [TEMPORARY_POINTS_FIELD]: mergedTemporaryPoints,
      [LOCKED_EDGE_FIELD]: false,
      path_points: mergedPathPoints,
    };
    const replaceIndex = Math.min(firstSegment.index, secondSegment.index);
    let mergedEdgeIndex = -1;
    const nextEdges = [];

    current.edges.forEach((edge, index) => {
      if (index === replaceIndex) {
        mergedEdgeIndex = nextEdges.length;
        nextEdges.push(mergedEdge);
        return;
      }
      if (removeIndexes.has(index)) return;
      nextEdges.push(edge);
    });

    const nextTopology = resequencePathPoints(
      {
        ...current,
        topology_nodes: current.topology_nodes.filter((node) => Number(node.id) !== Number(currentNode.id)),
        edges: nextEdges,
      },
      spacingRef.current,
    );

    commitEditorState(`Converted topo point #${currentNode.id} to path point`, nextTopology);
    setSelectedNodeId(null);
    setSelectedTempPointKey(null);
    setSelectedEdgeKey(mergedEdgeIndex >= 0 ? edgeKey(nextTopology.edges[mergedEdgeIndex], mergedEdgeIndex) : null);
    setEdgeFrom(mergedEdge.from);
    setEdgeTo(mergedEdge.to);
  };

  const exportJson = () => {
    downloadTopologyJson(topology, spacing, makeExportName(jsonFileName));
    message.success('Topology JSON exported');
  };

  return (
    <div className="app-shell" style={{ '--page-background': backgroundColor }}>
      <aside className="left-panel">
        <div className="brand-row">
          <div>
            <h1>Topology Path Editor</h1>
            <p>{topology.topology_nodes.length} nodes - {topology.edges.length} edges</p>
          </div>
          <div className="brand-actions">
            <Tooltip title="Undo">
              <Button shape="circle" icon={<Undo2 size={16} />} onClick={undoLast} disabled={!canUndo} />
            </Tooltip>
            <Tooltip title="History">
              <Button shape="circle" icon={<HistoryIcon size={16} />} onClick={() => setHistoryOpen(true)} />
            </Tooltip>
            <Tooltip title="Fit view">
              <Button
                shape="circle"
                icon={<Focus size={16} />}
                onClick={() => setFitNonce((value) => value + 1)}
              />
            </Tooltip>
          </div>
        </div>

        <section className="panel-section compact-section">
          <div className="history-current">
            <div>
              <span className="field-label">Current step</span>
              <strong>{currentHistoryEntry?.label || 'Initial state'}</strong>
            </div>
            <span>{historyState.cursor + 1}/{historyState.entries.length}</span>
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <MapIcon size={16} />
            <span>Files</span>
          </div>
          <Space.Compact block>
            <Button block icon={<UploadCloud size={16} />} onClick={() => mapInputRef.current?.click()}>
              Load Map
            </Button>
            <Button block icon={<FileJson size={16} />} onClick={() => jsonInputRef.current?.click()}>
              Load JSON
            </Button>
          </Space.Compact>
          <input data-testid="map-input" ref={mapInputRef} hidden type="file" accept=".pcd,.ply,.xyz,.txt,.csv" onChange={handleMapFile} />
          <input data-testid="topology-input" ref={jsonInputRef} hidden type="file" accept=".json,application/json" onChange={handleTopologyFile} />
          {mapStatus ? <div className="status-line">{mapStatus}</div> : null}
          {jsonFileName ? <div className="status-line">{jsonFileName}</div> : null}
          <Button type="primary" block icon={<Download size={16} />} onClick={exportJson}>
            Export JSON
          </Button>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <Palette size={16} />
            <span>Appearance</span>
          </div>
          <label className="field-label">Background</label>
          <div className="background-row">
            <ColorPicker
              value={backgroundColor}
              showText
              onChangeComplete={(color) => applyBackgroundColor(color.toHexString())}
            />
            <Input
              value={backgroundColorInput}
              onChange={handleBackgroundInput}
              onBlur={() => setBackgroundColorInput(backgroundColor)}
              className="background-input"
            />
          </div>
          <div className="background-swatches">
            {BACKGROUND_PRESETS.map((color) => (
              <Tooltip key={color} title={color}>
                <button
                  type="button"
                  className={`background-swatch ${backgroundColor === color ? 'is-active' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => applyBackgroundColor(color)}
                  aria-label={`Set background ${color}`}
                />
              </Tooltip>
            ))}
          </div>
          <label className="field-label">Point cloud</label>
          <div className="point-cloud-controls">
            <label>
              <span>Size</span>
              <InputNumber
                min={0.001}
                max={1}
                step={0.005}
                precision={3}
                value={pointCloudSize}
                onChange={changePointCloudSize}
              />
            </label>
            <label>
              <span>Color</span>
              <div className="background-row">
                <ColorPicker
                  value={pointCloudColor}
                  showText
                  onChangeComplete={(color) => applyPointCloudColor(color.toHexString())}
                />
                <Input
                  value={pointCloudColorInput}
                  onChange={handlePointCloudColorInput}
                  onBlur={() => setPointCloudColorInput(pointCloudColor)}
                  className="background-input"
                />
              </div>
            </label>
          </div>
          <label className="field-label">Viewpoint</label>
          <div className="view-face-grid" role="group" aria-label="Cube face viewpoint">
            {VIEW_FACE_OPTIONS.map((option) => (
              <Tooltip key={option.value} title={option.title}>
                <Button
                  size="small"
                  type={activeViewFace === option.value ? 'primary' : 'default'}
                  onClick={() => selectViewFace(option.value)}
                >
                  {option.label}
                </Button>
              </Tooltip>
            ))}
          </div>
        </section>

        <Divider />

        <section className="panel-section">
          <div className="section-title">
            <Route size={16} />
            <span>Path Generation</span>
          </div>
          <label className="field-label">Spacing</label>
          <Space.Compact block>
            <InputNumber
              min={0.01}
              step={0.05}
              precision={2}
              value={spacing}
              addonAfter="m"
              onChange={changeSpacing}
              className="full-input"
            />
            <Tooltip title="Regenerate unlocked paths">
              <Button icon={<RefreshCw size={16} />} onClick={regeneratePaths} />
            </Tooltip>
            <Tooltip title="Reverse route direction">
              <Button
                icon={<ArrowRightLeft size={16} />}
                onClick={reverseRoute}
                disabled={!canReverseRoute}
              />
            </Tooltip>
          </Space.Compact>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <MousePointer2 size={16} />
            <span>Types</span>
          </div>
          <label className="field-label">Default type</label>
          <Select value={activeType} options={typeOptions} onChange={changeActiveType} className="full-input" />
          <Space.Compact block>
            <Input value={newType} onChange={(event) => setNewType(event.target.value)} onPressEnter={addType} placeholder="new type" />
            <Button icon={<Plus size={16} />} onClick={addType} />
          </Space.Compact>
          <div className="type-cloud">
            {nodeTypes.map((type) => (
              <Tag
                key={type}
                color={getTypeColor(type)}
                closable={nodeTypes.length > 1}
                onClose={(event) => {
                  event.preventDefault();
                  deleteType(type);
                }}
              >
                {type}
              </Tag>
            ))}
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <Plus size={16} />
            <span>Nodes</span>
          </div>
          <Space.Compact block>
            <Button block icon={<Plus size={16} />} onClick={() => addNode()}>
              Add Node
            </Button>
            <Tooltip title="Place node on map">
              <Button
                type={addNodeMode ? 'primary' : 'default'}
                icon={<MousePointer2 size={16} />}
                onClick={() => setAddNodeMode((value) => !value)}
              />
            </Tooltip>
            <Button danger icon={<Trash2 size={16} />} onClick={deleteSelectedNode} disabled={!selectedNode}>
              Delete
            </Button>
          </Space.Compact>
          <div className="list-box node-list">
            {topology.topology_nodes.length ? (
              topology.topology_nodes.map((node) => (
                <button
                  key={node.id}
                  draggable
                  className={`list-row node-row ${Number(selectedNodeId) === Number(node.id) ? 'is-active' : ''} ${Number(draggingNodeId) === Number(node.id) ? 'is-dragging' : ''}`}
                  onDragStart={(event) => {
                    setDraggingNodeId(Number(node.id));
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', String(node.id));
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => reorderNodesByDrag(event, node.id)}
                  onDragEnd={() => setDraggingNodeId(null)}
                  onClick={() => {
                    setSelectedNodeId(node.id);
                    setSelectedEdgeKey(null);
                    setSelectedTempPointKey(null);
                  }}
                >
                  <span className="node-drag-handle" aria-hidden="true">
                    <GripVertical size={15} />
                  </span>
                  <span className="color-dot" style={{ background: getTypeColor(node.type) }} />
                  <span className="list-row-main">
                    <strong>#{node.id} {node.type}</strong>
                    <small>{formatNumber(node.x)}, {formatNumber(node.y)}, {formatNumber(node.z)}</small>
                  </span>
                </button>
              ))
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No nodes" />
            )}
          </div>
        </section>

        {selectedNode ? (
          <section className="panel-section compact-section">
            <div className="section-title">
              <MousePointer2 size={16} />
              <span>Selected Node #{selectedNode.id}</span>
            </div>
            <label className="field-label">Node ID</label>
            <InputNumber
              min={0}
              step={1}
              precision={0}
              value={selectedNode.id}
              onChange={(value) => updateNodeId(selectedNode.id, value)}
              className="full-input"
            />
            <div className="coord-grid">
              {['x', 'y', 'z'].map((field) => (
                <label key={field}>
                  <span>{field.toUpperCase()}</span>
                  <InputNumber
                    value={selectedNode[field]}
                    step={0.05}
                    precision={4}
                    onChange={(value) => updateNodeField(selectedNode.id, field, Number(value) || 0)}
                  />
                </label>
              ))}
            </div>
            <div className="rotation-section-heading">
              <div className="subsection-title">Rotation Z</div>
              <Tooltip title="Use path direction">
                <Button
                  shape="circle"
                  size="small"
                  icon={<RefreshCw size={13} />}
                  disabled={!isManualNodeRotation(selectedNode)}
                  onClick={() => resetNodeRotationToPath(selectedNode.id)}
                />
              </Tooltip>
            </div>
            <div className="rotation-value-grid">
              <label>
                <span>Angle (deg)</span>
                <InputNumber
                  value={getRotationField(selectedNode, 'angle')}
                  step={1}
                  precision={4}
                  onChange={(value) => updateNodeRotation(selectedNode.id, 'angle', value)}
                />
              </label>
              <label>
                <span>Radian (rad)</span>
                <InputNumber
                  value={getRotationField(selectedNode, 'radian')}
                  step={0.05}
                  precision={6}
                  onChange={(value) => updateNodeRotation(selectedNode.id, 'radian', value)}
                />
              </label>
            </div>
            <div className="quaternion-value-grid">
              {['x', 'y', 'z', 'w'].map((component, componentIndex) => (
                <label key={component}>
                  <span>Q[{component}]</span>
                  <InputNumber
                    value={getQuaternionArray(selectedNode)[componentIndex]}
                    step={0.01}
                    precision={6}
                    onChange={(value) => updateNodeQuaternionComponent(selectedNode.id, componentIndex, value)}
                  />
                </label>
              ))}
            </div>
            <label className="field-label">Type</label>
            <Select
              value={selectedNode.type}
              options={typeOptions}
              onChange={(value) => updateNodeField(selectedNode.id, 'type', value)}
              className="full-input"
            />
            <Tooltip
              title={
                selectedNodeHasLockedEdges
                  ? 'Unlock connected edges first'
                  : selectedNodeConnectedEdges.length === 2
                    ? 'Convert this topo point into a normal path point'
                    : 'Requires exactly two connected edges'
              }
            >
              <Button
                block
                icon={<Spline size={16} />}
                onClick={convertSelectedNodeToPathPoint}
                disabled={!canConvertSelectedNodeToPathPoint}
              >
                Convert to Path Point
              </Button>
            </Tooltip>
          </section>
        ) : null}

        <section className="panel-section">
          <div className="section-title">
            <Link2 size={16} />
            <span>Edges</span>
          </div>
          <div className="edge-create">
            <Select value={edgeFrom} options={nodeOptions} onChange={setEdgeFrom} placeholder="from" />
            <Select value={edgeTo} options={nodeOptions} onChange={setEdgeTo} placeholder="to" />
            <Button icon={<Plus size={16} />} onClick={addEdge} disabled={nodeOptions.length < 2} />
          </div>
          <div className="list-box edge-list">
            {topology.edges.length ? (
              topology.edges.map((edge, index) => {
                const key = edgeKey(edge, index);
                return (
                  <button
                    key={key}
                    className={`list-row edge-row ${selectedEdgeKey === key ? 'is-active' : ''} ${isPathLocked(edge) ? 'is-locked' : ''}`}
                    onClick={() => {
                      setSelectedEdgeKey(key);
                      setSelectedNodeId(null);
                      setSelectedTempPointKey(null);
                      setEdgeFrom(edge.from);
                      setEdgeTo(edge.to);
                    }}
                  >
                    <span className="edge-dot">{index + 1}</span>
                    <span className="list-row-main">
                      <strong>
                        {edge.from} -&gt; {edge.to}
                        {isPathLocked(edge) ? <Lock className="inline-lock" size={13} /> : null}
                      </strong>
                      <small>
                        {edge.path_points?.length || 0} path points - {getTemporaryPoints(edge).length} temp points
                        {isPathLocked(edge) ? ' - locked' : ''}
                      </small>
                    </span>
                  </button>
                );
              })
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No edges" />
            )}
          </div>
          <Button danger block icon={<Trash2 size={16} />} onClick={deleteSelectedEdge} disabled={!selectedEdge}>
            Delete Edge
          </Button>
        </section>

        {selectedEdge ? (
          <section className="panel-section path-editor">
            <div className="section-title">
              <Route size={16} />
              <span>Edge {selectedEdge.from} -&gt; {selectedEdge.to}</span>
            </div>
            <div className={`edge-lock-row ${selectedEdgeLocked ? 'is-locked' : ''}`}>
              <span>
                {selectedEdgeLocked ? <Lock size={14} /> : <Unlock size={14} />}
                Path lock
              </span>
              <Switch
                size="small"
                checked={selectedEdgeLocked}
                onChange={toggleSelectedEdgeLock}
                checkedChildren={<Lock size={11} />}
                unCheckedChildren={<Unlock size={11} />}
              />
            </div>
            <div className="edge-action-grid">
              <Button icon={<Plus size={16} />} onClick={addTemporaryPoint} disabled={selectedEdgeLocked}>
                Temp Point
              </Button>
              <Button icon={<Plus size={16} />} onClick={insertPathPoint} disabled={selectedEdgeLocked}>
                Path Point
              </Button>
              <Button icon={<RefreshCw size={16} />} onClick={regenerateSelectedEdge} disabled={selectedEdgeLocked}>
                Regenerate
              </Button>
            </div>
            <div className="subsection-title">Temporary topo points</div>
            {selectedTemporaryPoints.length ? (
              <div className="temp-point-list">
                {selectedTemporaryPoints.map((point, index) => {
                  const key = temporaryPointKey(selectedEdge, selectedEdgeIndex, index);
                  return (
                    <div
                      className={`temp-point-row ${key === selectedTempPointKey ? 'is-active' : ''}`}
                      key={key}
                      onClick={() => {
                        setSelectedTempPointKey(key);
                        setSelectedNodeId(null);
                      }}
                    >
                      <span>T{index + 1}</span>
                      {['x', 'y', 'z'].map((field) => (
                        <InputNumber
                          key={field}
                          value={point[field]}
                          step={0.05}
                          precision={4}
                          disabled={selectedEdgeLocked}
                          onChange={(value) => updateTemporaryPointField(index, field, value)}
                        />
                      ))}
                      <Tooltip title="Delete temp point">
                        <Button
                          shape="circle"
                          size="small"
                          icon={<Trash2 size={13} />}
                          disabled={selectedEdgeLocked}
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteTemporaryPoint(index);
                          }}
                        />
                      </Tooltip>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-inline">No temporary topo points</div>
            )}
            <div className="subsection-title">Path points</div>
            <div className="path-point-list">
              {(selectedEdge.path_points || []).map((point, index) => {
                const isEndpoint = index === 0 || index === (selectedEdge.path_points || []).length - 1;
                const quaternion = getQuaternionArray(point);
                return (
                  <div className="path-point-row" key={`${point.seq}-${index}`}>
                    <div className="path-point-row-header">
                      <span className="path-point-seq">Seq {point.seq}</span>
                      <span className="point-actions">
                        <Tooltip title={isEndpoint ? 'Endpoint is already a topo point' : 'Convert to topo point'}>
                          <Button
                            shape="circle"
                            size="small"
                            icon={<GitBranchPlus size={13} />}
                            onClick={() => convertPathPointToTopologyNode(index)}
                            disabled={selectedEdgeLocked || isEndpoint}
                          />
                        </Tooltip>
                        <Tooltip title="Delete point">
                          <Button
                            shape="circle"
                            size="small"
                            icon={<Trash2 size={13} />}
                            onClick={() => deletePathPoint(index)}
                            disabled={selectedEdgeLocked || (selectedEdge.path_points || []).length <= 1}
                          />
                        </Tooltip>
                      </span>
                    </div>
                    <div className="point-value-grid">
                      {['x', 'y', 'z'].map((field) => (
                        <label key={field}>
                          <span>{field.toUpperCase()} (m)</span>
                          <InputNumber
                            value={point[field]}
                            step={0.05}
                            precision={4}
                            disabled={selectedEdgeLocked}
                            onChange={(value) => updatePathPoint(index, field, value)}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="rotation-value-grid">
                      <label>
                        <span>Angle (deg)</span>
                        <InputNumber
                          value={getRotationField(point, 'angle')}
                          step={1}
                          precision={4}
                          disabled={selectedEdgeLocked}
                          onChange={(value) => updatePathPointRotation(index, 'angle', value)}
                        />
                      </label>
                      <label>
                        <span>Radian (rad)</span>
                        <InputNumber
                          value={getRotationField(point, 'radian')}
                          step={0.05}
                          precision={6}
                          disabled={selectedEdgeLocked}
                          onChange={(value) => updatePathPointRotation(index, 'radian', value)}
                        />
                      </label>
                    </div>
                    <div className="quaternion-value-grid">
                      {['x', 'y', 'z', 'w'].map((component, componentIndex) => (
                        <label key={component}>
                          <span>Q[{component}]</span>
                          <InputNumber
                            value={quaternion[componentIndex]}
                            step={0.01}
                            precision={6}
                            disabled={selectedEdgeLocked}
                            onChange={(value) => updatePathPointQuaternionComponent(index, componentIndex, value)}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </aside>

      <main className="viewer-panel">
        {addNodeMode ? (
          <Alert
            className="floating-alert"
            type="info"
            showIcon
            message="Placement mode"
          />
        ) : null}
        <TopologyViewer
          mapData={mapData}
          topology={topology}
          spacing={spacing}
          backgroundColor={backgroundColor}
          pointCloudColor={pointCloudColor}
          pointCloudSize={pointCloudSize}
          selectedNodeId={selectedNodeId}
          selectedEdgeKey={selectedEdgeKey}
          selectedTempPointKey={selectedTempPointKey}
          addNodeMode={addNodeMode}
          fitNonce={fitNonce}
          viewFaceRequest={viewFaceRequest}
          onNodeSelect={selectNode}
          onEdgeSelect={selectEdge}
          onTempPointSelect={selectTempPoint}
          onNodeMoveStart={beginNodeMove}
          onNodeMove={updateNodePosition}
          onNodeMoveEnd={finishNodeMove}
          onTempPointMoveStart={beginTempPointMove}
          onTempPointMoveEnd={finishTempPointMove}
          onAddNodeAt={addNode}
        />
      </main>

      <Drawer
        title="History"
        placement="right"
        width={420}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      >
        <div className="history-drawer">
          <Space.Compact block>
            <Button block icon={<Undo2 size={16} />} onClick={undoLast} disabled={!canUndo}>
              Undo
            </Button>
            <Button block icon={<RefreshCw size={16} />} onClick={() => restoreHistoryIndex(historyState.cursor)}>
              Restore Current
            </Button>
          </Space.Compact>

          <div className="history-list">
            {historyState.entries.map((entry, index) => {
              const isCurrent = index === historyState.cursor;
              const { snapshot } = entry;

              return (
                <button
                  key={entry.id}
                  className={`history-row ${isCurrent ? 'is-active' : ''}`}
                  onClick={() => restoreHistoryIndex(index)}
                >
                  <span className="history-index">#{index + 1}</span>
                  <span className="history-main">
                    <strong>{entry.label}</strong>
                    <small>
                      {formatHistoryTime(entry.timestamp)} - {snapshot.topology.topology_nodes.length} nodes - {snapshot.topology.edges.length} edges - {snapshot.spacing.toFixed(2)}m
                    </small>
                  </span>
                  <span className="history-state">{isCurrent ? 'Current' : 'Restore'}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Drawer>
    </div>
  );
}
