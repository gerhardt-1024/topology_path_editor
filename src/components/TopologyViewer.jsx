import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  edgeKey,
  getTemporaryPoints,
  interpolatePolylinePathPoints,
  isPathLocked,
  temporaryPointKey,
} from '../helpers/pathInterpolation';
import { getTypeColor } from '../helpers/colors';
import { getPointRotationRadians } from '../helpers/rotation';

const NODE_RADIUS = 0.18;
const TEMP_POINT_RADIUS = 0.14;
const LABEL_SCALE = 0.45;
const PATH_ARROW_LIMIT = 90;
const VIEW_FACE_PRESETS = {
  top: {
    direction: new THREE.Vector3(0, 0, 1),
    up: new THREE.Vector3(0, 1, 0),
  },
  bottom: {
    direction: new THREE.Vector3(0, 0, -1),
    up: new THREE.Vector3(0, 1, 0),
  },
  front: {
    direction: new THREE.Vector3(0, -1, 0),
    up: new THREE.Vector3(0, 0, 1),
  },
  back: {
    direction: new THREE.Vector3(0, 1, 0),
    up: new THREE.Vector3(0, 0, 1),
  },
  left: {
    direction: new THREE.Vector3(-1, 0, 0),
    up: new THREE.Vector3(0, 0, 1),
  },
  right: {
    direction: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 0, 1),
  },
};

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose());
    } else if (child.material) {
      child.material.dispose();
    }
    if (child.material?.map) child.material.map.dispose();
  });
}

function createNodeLabel(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(255, 255, 255, 0.9)';
  context.strokeStyle = color;
  context.lineWidth = 4;
  roundRect(context, 20, 12, 88, 40, 18);
  context.fill();
  context.stroke();
  context.fillStyle = '#111827';
  context.font = '700 24px Inter, Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(String(text), 64, 33);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(LABEL_SCALE, LABEL_SCALE * 0.5, 1);
  sprite.position.set(0, 0, NODE_RADIUS * 2.9);
  return sprite;
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function makePointCloud(mapData, pointCloudStyle = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mapData.positions, 3));
  geometry.computeBoundingBox();

  const material = new THREE.PointsMaterial({
    color: pointCloudStyle.color || '#38bdf8',
    size: Number(pointCloudStyle.size) || 0.035,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.82,
  });

  const points = new THREE.Points(geometry, material);
  points.userData.kind = 'map';
  return points;
}

function makeRotationArrow(point, options = {}) {
  const {
    color = '#0f766e',
    length = 0.34,
    opacity = 0.9,
    zOffset = 0.08,
    local = false,
  } = options;
  const radians = getPointRotationRadians(point, 0);
  const direction = new THREE.Vector3(Math.cos(radians), Math.sin(radians), 0).normalize();
  const origin = local
    ? new THREE.Vector3(0, 0, zOffset)
    : new THREE.Vector3(
        Number(point?.x) || 0,
        Number(point?.y) || 0,
        (Number(point?.z) || 0) + zOffset,
      );
  const arrow = new THREE.ArrowHelper(
    direction,
    origin,
    length,
    new THREE.Color(color).getHex(),
    length * 0.38,
    length * 0.22,
  );
  arrow.userData = { kind: 'rotationArrow' };
  arrow.line.material.transparent = true;
  arrow.line.material.opacity = opacity;
  arrow.cone.material.transparent = true;
  arrow.cone.material.opacity = opacity;
  return arrow;
}

function makeNode(node, selectedNodeId) {
  const color = getTypeColor(node.type);
  const selected = Number(selectedNodeId) === Number(node.id);
  const group = new THREE.Group();
  group.position.set(Number(node.x) || 0, Number(node.y) || 0, Number(node.z) || 0);
  group.userData = { kind: 'nodeGroup', id: Number(node.id) };

  const geometry = new THREE.SphereGeometry(NODE_RADIUS, 24, 16);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.45,
    metalness: 0.05,
    emissive: selected ? color : '#000000',
    emissiveIntensity: selected ? 0.35 : 0,
  });
  const sphere = new THREE.Mesh(geometry, material);
  sphere.userData = { kind: 'node', id: Number(node.id), parentGroup: group };
  group.add(sphere);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(NODE_RADIUS * 1.35, 0.018, 8, 36),
    new THREE.MeshBasicMaterial({
      color: Number(selectedNodeId) === Number(node.id) ? '#111827' : color,
      transparent: true,
      opacity: selected ? 0.95 : 0.38,
    }),
  );
  ring.userData = { kind: 'nodeRing', id: Number(node.id), parentGroup: group };
  group.add(ring);

  group.add(makeRotationArrow(node, {
    color: selected ? '#dc2626' : color,
    length: selected ? NODE_RADIUS * 3 : NODE_RADIUS * 2.35,
    opacity: selected ? 1 : 0.72,
    zOffset: NODE_RADIUS * 1.35,
    local: true,
  }));
  group.add(createNodeLabel(node.id, color));
  return group;
}

function makeTemporaryPoint(edge, edgeIndex, point, pointIndex, selectedEdgeKey, selectedTempPointKey) {
  const edgeSelectionKey = edgeKey(edge, edgeIndex);
  const key = temporaryPointKey(edge, edgeIndex, pointIndex);
  const selected = key === selectedTempPointKey;
  const edgeSelected = selected || edgeSelectionKey === selectedEdgeKey;
  const locked = isPathLocked(edge);
  const group = new THREE.Group();
  group.position.set(Number(point.x) || 0, Number(point.y) || 0, Number(point.z) || 0);
  group.userData = { kind: 'temporaryPointGroup', key, edgeKey: edgeSelectionKey, edgeIndex, pointIndex, locked };

  const material = new THREE.MeshStandardMaterial({
    color: locked ? '#94a3b8' : selected ? '#ea580c' : '#fb923c',
    roughness: 0.42,
    metalness: 0.04,
    emissive: edgeSelected && !locked ? '#fb923c' : '#000000',
    emissiveIntensity: edgeSelected ? 0.28 : 0,
  });
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(TEMP_POINT_RADIUS, 0), material);
  diamond.userData = {
    kind: 'temporaryPoint',
    key,
    edgeKey: edgeSelectionKey,
    edgeIndex,
    pointIndex,
    locked,
    parentGroup: group,
  };
  group.add(diamond);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(TEMP_POINT_RADIUS * 1.55, 0.015, 8, 36),
    new THREE.MeshBasicMaterial({
      color: locked ? '#64748b' : selected ? '#7c2d12' : '#fb923c',
      transparent: true,
      opacity: edgeSelected ? 0.9 : 0.46,
    }),
  );
  ring.userData = {
    kind: 'temporaryPointRing',
    key,
    edgeKey: edgeSelectionKey,
    edgeIndex,
    pointIndex,
    locked,
    parentGroup: group,
  };
  group.add(ring);

  return group;
}

function makeEdge(edge, index, selectedEdgeKey) {
  const key = edgeKey(edge, index);
  const selected = key === selectedEdgeKey;
  const locked = isPathLocked(edge);
  const points = edge.path_points || [];
  const positions = new Float32Array(points.length * 3);

  points.forEach((point, pointIndex) => {
    const offset = pointIndex * 3;
    positions[offset] = Number(point.x) || 0;
    positions[offset + 1] = Number(point.y) || 0;
    positions[offset + 2] = Number(point.z) || 0;
  });

  const group = new THREE.Group();
  group.userData = { kind: 'edgeGroup', key, index };

  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const line = new THREE.Line(
    lineGeometry,
    new THREE.LineBasicMaterial({
      color: locked ? '#64748b' : selected ? '#ef4444' : '#1f2937',
      transparent: true,
      opacity: selected || locked ? 1 : 0.72,
    }),
  );
  line.userData = { kind: 'edge', key, index, role: 'line' };
  group.add(line);

  const markerGeometry = new THREE.BufferGeometry();
  markerGeometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
  const markers = new THREE.Points(
    markerGeometry,
    new THREE.PointsMaterial({
      color: locked ? '#94a3b8' : selected ? '#f97316' : '#374151',
      size: selected ? 0.095 : 0.055,
      sizeAttenuation: true,
      transparent: true,
      opacity: selected || locked ? 0.95 : 0.58,
    }),
  );
  markers.userData = { kind: 'edge', key, index, role: 'markers' };
  group.add(markers);
  group.userData.line = line;
  group.userData.markers = markers;

  const arrowStep = selected ? 1 : Math.max(1, Math.ceil(points.length / PATH_ARROW_LIMIT));
  points.forEach((point, pointIndex) => {
    const isEndpoint = pointIndex === 0 || pointIndex === points.length - 1;
    if (!selected && !isEndpoint && pointIndex % arrowStep !== 0) return;
    group.add(makeRotationArrow(point, {
      color: locked ? '#94a3b8' : selected ? '#dc2626' : '#0f766e',
      length: selected ? 0.34 : 0.26,
      opacity: selected || isEndpoint ? 0.95 : 0.58,
      zOffset: selected ? 0.11 : 0.075,
    }));
  });

  return group;
}

function pathPointsToPositions(pathPoints = []) {
  const positions = new Float32Array(pathPoints.length * 3);
  pathPoints.forEach((point, index) => {
    const offset = index * 3;
    positions[offset] = Number(point.x) || 0;
    positions[offset + 1] = Number(point.y) || 0;
    positions[offset + 2] = Number(point.z) || 0;
  });
  return positions;
}

function applyPositionsToGeometry(object, positions) {
  if (!object?.geometry) return;
  object.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  object.geometry.computeBoundingSphere();
}

function updateTemporaryPointEdgePreview(drag, position, spacing) {
  if (!drag?.previewVisual || !drag.previewFromNode || !drag.previewToNode || !drag.previewEdge) return;

  const temporaryPoints = drag.previewTemporaryPoints.map((point, index) =>
    index === drag.pointIndex
      ? {
          ...point,
          x: position.x,
          y: position.y,
          z: position.z,
        }
      : point,
  );
  const startSeq = Number.isFinite(Number(drag.previewEdge.path_points?.[0]?.seq))
    ? Number(drag.previewEdge.path_points[0].seq)
    : 1;
  const pathPoints = interpolatePolylinePathPoints(
    [drag.previewFromNode, ...temporaryPoints, drag.previewToNode],
    spacing,
    startSeq,
  );
  const positions = pathPointsToPositions(pathPoints);

  applyPositionsToGeometry(drag.previewVisual.line, positions);
  applyPositionsToGeometry(drag.previewVisual.markers, positions.slice());
}

function getContentBounds(mapObject, topologyGroup) {
  const box = new THREE.Box3();
  let hasContent = false;

  if (mapObject) {
    box.expandByObject(mapObject);
    hasContent = true;
  }
  if (topologyGroup?.children.length) {
    box.expandByObject(topologyGroup);
    hasContent = true;
  }

  if (!hasContent || box.isEmpty()) {
    box.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(8, 8, 3));
  }

  return box;
}

function getContentCameraMetrics(mapObject, topologyGroup) {
  const box = getContentBounds(mapObject, topologyGroup);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 2);

  return { center, maxDim };
}

function applyCameraPose({ camera, controls, center, distance, direction, up }) {
  camera.up.copy(up);
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(0.01, distance / 1000);
  camera.far = Math.max(1000, distance * 8);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function fitCameraToContent({ camera, controls, mapObject, topologyGroup }) {
  const { center, maxDim } = getContentCameraMetrics(mapObject, topologyGroup);
  const distance = maxDim * 1.25;

  applyCameraPose({
    camera,
    controls,
    center,
    distance,
    direction: new THREE.Vector3(1, -1, 0.65).normalize(),
    up: new THREE.Vector3(0, 0, 1),
  });
}

function applyViewFace({ face, camera, controls, mapObject, topologyGroup }) {
  const preset = VIEW_FACE_PRESETS[face];
  if (!preset) return;

  const { center, maxDim } = getContentCameraMetrics(mapObject, topologyGroup);
  const distance = maxDim * 1.35;

  applyCameraPose({
    camera,
    controls,
    center,
    distance,
    direction: preset.direction,
    up: preset.up,
  });
}

export default function TopologyViewer({
  mapData,
  topology,
  spacing,
  backgroundColor,
  pointCloudColor,
  pointCloudSize,
  selectedNodeId,
  selectedEdgeKey,
  selectedTempPointKey,
  addNodeMode,
  fitNonce,
  viewFaceRequest,
  onNodeSelect,
  onEdgeSelect,
  onTempPointSelect,
  onNodeMoveStart,
  onNodeMove,
  onNodeMoveEnd,
  onTempPointMoveStart,
  onTempPointMoveEnd,
  onAddNodeAt,
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const mapObjectRef = useRef(null);
  const topologyGroupRef = useRef(new THREE.Group());
  const nodeMeshesRef = useRef([]);
  const tempPointMeshesRef = useRef([]);
  const edgeObjectsRef = useRef([]);
  const edgeVisualsRef = useRef(new Map());
  const dragRef = useRef(null);
  const propsRef = useRef({
    addNodeMode,
    topology,
    spacing,
    onNodeSelect,
    onEdgeSelect,
    onTempPointSelect,
    onNodeMoveStart,
    onNodeMove,
    onNodeMoveEnd,
    onTempPointMoveStart,
    onTempPointMoveEnd,
    onAddNodeAt,
  });

  useEffect(() => {
    propsRef.current = {
      addNodeMode,
      topology,
      spacing,
      onNodeSelect,
      onEdgeSelect,
      onTempPointSelect,
      onNodeMoveStart,
      onNodeMove,
      onNodeMoveEnd,
      onTempPointMoveStart,
      onTempPointMoveEnd,
      onAddNodeAt,
    };
  }, [
    addNodeMode,
    topology,
    spacing,
    onNodeSelect,
    onEdgeSelect,
    onTempPointSelect,
    onNodeMoveStart,
    onNodeMove,
    onNodeMoveEnd,
    onTempPointMoveStart,
    onTempPointMoveEnd,
    onAddNodeAt,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(backgroundColor || '#0f172a');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 2000);
    camera.up.set(0, 0, 1);
    camera.position.set(5, -7, 5);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controlsRef.current = controls;

    const ambient = new THREE.AmbientLight('#ffffff', 0.72);
    scene.add(ambient);
    const directional = new THREE.DirectionalLight('#ffffff', 0.85);
    directional.position.set(4, -5, 8);
    scene.add(directional);

    const grid = new THREE.GridHelper(40, 40, '#94a3b8', '#d1d5db');
    grid.rotation.x = Math.PI / 2;
    grid.material.transparent = true;
    grid.material.opacity = 0.42;
    scene.add(grid);

    const axes = new THREE.AxesHelper(1.4);
    scene.add(axes);

    const topologyGroup = topologyGroupRef.current;
    scene.add(topologyGroup);

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line.threshold = 0.25;
    raycaster.params.Points.threshold = 0.18;
    const pointer = new THREE.Vector2();
    const plane = new THREE.Plane();
    const planeHit = new THREE.Vector3();
    const offset = new THREE.Vector3();

    const setPointer = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    };

    const getDefaultAddZ = () => {
      const nodes = propsRef.current.topology?.topology_nodes || [];
      if (!nodes.length) return 0;
      return nodes.reduce((sum, node) => sum + (Number(node.z) || 0), 0) / nodes.length;
    };

    const pointerDown = (event) => {
      if (event.button !== 0) return;
      setPointer(event);

      const tempPointHit = raycaster.intersectObjects(tempPointMeshesRef.current, false)[0];
      if (tempPointHit) {
        const group = tempPointHit.object.userData.parentGroup;
        const tempPointSelection = {
          edgeKey: tempPointHit.object.userData.edgeKey,
          edgeIndex: tempPointHit.object.userData.edgeIndex,
          pointIndex: tempPointHit.object.userData.pointIndex,
          key: tempPointHit.object.userData.key,
        };
        if (tempPointHit.object.userData.locked) {
          propsRef.current.onTempPointSelect?.(
            tempPointSelection.edgeKey,
            tempPointSelection.pointIndex,
            tempPointSelection.key,
          );
          return;
        }
        propsRef.current.onTempPointMoveStart?.(
          tempPointSelection.edgeKey,
          tempPointSelection.pointIndex,
        );

        const normal = camera.getWorldDirection(new THREE.Vector3()).normalize();
        plane.setFromNormalAndCoplanarPoint(normal, group.position);
        raycaster.ray.intersectPlane(plane, planeHit);
        offset.copy(planeHit).sub(group.position);
        const currentTopology = propsRef.current.topology || {};
        const previewEdge = currentTopology.edges?.[tempPointSelection.edgeIndex];
        const nodesById = new Map((currentTopology.topology_nodes || []).map((node) => [Number(node.id), node]));
        dragRef.current = {
          kind: 'temporaryPoint',
          edgeKey: tempPointSelection.edgeKey,
          pointIndex: tempPointSelection.pointIndex,
          selectionKey: tempPointSelection.key,
          group,
          plane,
          offset: offset.clone(),
          previewEdge,
          previewFromNode: previewEdge ? nodesById.get(Number(previewEdge.from)) : null,
          previewToNode: previewEdge ? nodesById.get(Number(previewEdge.to)) : null,
          previewTemporaryPoints: previewEdge ? getTemporaryPoints(previewEdge) : [],
          previewVisual: edgeVisualsRef.current.get(tempPointSelection.edgeKey),
        };
        controls.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
        return;
      }

      const nodeHit = raycaster.intersectObjects(nodeMeshesRef.current, false)[0];
      if (nodeHit) {
        const group = nodeHit.object.userData.parentGroup;
        propsRef.current.onNodeSelect?.(nodeHit.object.userData.id);
        propsRef.current.onEdgeSelect?.(null);
        propsRef.current.onTempPointSelect?.(null, null, null);
        propsRef.current.onNodeMoveStart?.(nodeHit.object.userData.id);

        const normal = camera.getWorldDirection(new THREE.Vector3()).normalize();
        plane.setFromNormalAndCoplanarPoint(normal, group.position);
        raycaster.ray.intersectPlane(plane, planeHit);
        offset.copy(planeHit).sub(group.position);
        dragRef.current = { kind: 'node', id: nodeHit.object.userData.id, group, plane, offset: offset.clone() };
        controls.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
        return;
      }

      const edgeHit = raycaster.intersectObjects(edgeObjectsRef.current, false)[0];
      if (edgeHit) {
        propsRef.current.onEdgeSelect?.(edgeHit.object.userData.key);
        propsRef.current.onNodeSelect?.(null);
        propsRef.current.onTempPointSelect?.(null, null, null);
        return;
      }

      if (propsRef.current.addNodeMode) {
        const z = getDefaultAddZ();
        plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, z));
        if (raycaster.ray.intersectPlane(plane, planeHit)) {
          propsRef.current.onAddNodeAt?.({ x: planeHit.x, y: planeHit.y, z });
        }
      }
    };

    const pointerMove = (event) => {
      if (!dragRef.current) return;
      setPointer(event);
      if (!raycaster.ray.intersectPlane(dragRef.current.plane, planeHit)) return;
      const next = planeHit.clone().sub(dragRef.current.offset);
      dragRef.current.group.position.copy(next);
      if (dragRef.current.kind === 'temporaryPoint') {
        updateTemporaryPointEdgePreview(dragRef.current, next, propsRef.current.spacing);
        return;
      }
      propsRef.current.onNodeMove?.(dragRef.current.id, {
        x: next.x,
        y: next.y,
        z: next.z,
      });
    };

    const pointerUp = (event) => {
      if (!dragRef.current) return;
      if (dragRef.current.kind === 'temporaryPoint') {
        propsRef.current.onTempPointMoveEnd?.(dragRef.current.edgeKey, dragRef.current.pointIndex, {
          x: dragRef.current.group.position.x,
          y: dragRef.current.group.position.y,
          z: dragRef.current.group.position.z,
        });
        propsRef.current.onTempPointSelect?.(
          dragRef.current.edgeKey,
          dragRef.current.pointIndex,
          dragRef.current.selectionKey,
        );
      } else {
        propsRef.current.onNodeMoveEnd?.(dragRef.current.id, {
          x: dragRef.current.group.position.x,
          y: dragRef.current.group.position.y,
          z: dragRef.current.group.position.z,
        });
      }
      dragRef.current = null;
      controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };

    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', pointerUp);

    const resizeObserver = new ResizeObserver(() => {
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(container);

    let frameId = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerUp);
      controls.dispose();
      disposeObject(topologyGroup);
      if (mapObjectRef.current) disposeObject(mapObjectRef.current);
      scene.clear();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    if (!sceneRef.current) return;
    sceneRef.current.background = new THREE.Color(backgroundColor || '#0f172a');
  }, [backgroundColor]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (mapObjectRef.current) {
      scene.remove(mapObjectRef.current);
      disposeObject(mapObjectRef.current);
      mapObjectRef.current = null;
    }

    if (mapData?.positions?.length) {
      const mapObject = makePointCloud(mapData, {
        color: pointCloudColor,
        size: pointCloudSize,
      });
      mapObjectRef.current = mapObject;
      scene.add(mapObject);
    }
  }, [mapData, pointCloudColor, pointCloudSize]);

  useEffect(() => {
    const topologyGroup = topologyGroupRef.current;
    topologyGroup.children.forEach((child) => disposeObject(child));
    topologyGroup.clear();
    nodeMeshesRef.current = [];
    tempPointMeshesRef.current = [];
    edgeObjectsRef.current = [];
    edgeVisualsRef.current.clear();

    (topology.edges || []).forEach((edge, index) => {
      const edgeGroup = makeEdge(edge, index, selectedEdgeKey);
      topologyGroup.add(edgeGroup);
      edgeGroup.children.forEach((child) => edgeObjectsRef.current.push(child));
      edgeVisualsRef.current.set(edgeKey(edge, index), {
        line: edgeGroup.userData.line,
        markers: edgeGroup.userData.markers,
      });

      getTemporaryPoints(edge).forEach((point, pointIndex) => {
        const tempPointGroup = makeTemporaryPoint(edge, index, point, pointIndex, selectedEdgeKey, selectedTempPointKey);
        topologyGroup.add(tempPointGroup);
        const diamond = tempPointGroup.children.find((child) => child.userData.kind === 'temporaryPoint');
        if (diamond) tempPointMeshesRef.current.push(diamond);
      });
    });

    (topology.topology_nodes || []).forEach((node) => {
      const nodeGroup = makeNode(node, selectedNodeId);
      topologyGroup.add(nodeGroup);
      const sphere = nodeGroup.children.find((child) => child.userData.kind === 'node');
      if (sphere) nodeMeshesRef.current.push(sphere);
    });
  }, [topology, selectedNodeId, selectedEdgeKey, selectedTempPointKey]);

  useEffect(() => {
    if (!fitNonce || !cameraRef.current || !controlsRef.current) return;
    requestAnimationFrame(() => {
      fitCameraToContent({
        camera: cameraRef.current,
        controls: controlsRef.current,
        mapObject: mapObjectRef.current,
        topologyGroup: topologyGroupRef.current,
      });
    });
  }, [fitNonce]);

  useEffect(() => {
    if (!viewFaceRequest?.face || !cameraRef.current || !controlsRef.current) return;
    requestAnimationFrame(() => {
      applyViewFace({
        face: viewFaceRequest.face,
        camera: cameraRef.current,
        controls: controlsRef.current,
        mapObject: mapObjectRef.current,
        topologyGroup: topologyGroupRef.current,
      });
    });
  }, [viewFaceRequest]);

  return <div ref={containerRef} className={`viewer-canvas ${addNodeMode ? 'is-placing' : ''}`} />;
}
