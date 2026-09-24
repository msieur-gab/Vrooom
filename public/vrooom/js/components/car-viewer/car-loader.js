/**
 * car-loader.js — STL parsing + loading, materials, Z-up to Y-up, auto-scale.
 */
import * as THREE from 'three';

// ── Inline STL parser (binary + ASCII) ──────────────────

function parseSTL(buffer) {
  const isBinary = () => {
    const dv = new DataView(buffer);
    if (dv.byteLength < 84) return false;
    const faceCount = dv.getUint32(80, true);
    const expected = 80 + 4 + faceCount * 50;
    return Math.abs(expected - dv.byteLength) < 10;
  };

  if (isBinary()) return parseBinary(buffer);
  return parseASCII(new TextDecoder().decode(buffer));
}

function parseBinary(data) {
  const dv = new DataView(data);
  const faceCount = dv.getUint32(80, true);
  const vertices = new Float32Array(faceCount * 9);
  const normals = new Float32Array(faceCount * 9);

  let offset = 84;
  for (let i = 0; i < faceCount; i++) {
    const nx = dv.getFloat32(offset, true);
    const ny = dv.getFloat32(offset + 4, true);
    const nz = dv.getFloat32(offset + 8, true);
    offset += 12;

    for (let v = 0; v < 3; v++) {
      const idx = i * 9 + v * 3;
      vertices[idx] = dv.getFloat32(offset, true);
      vertices[idx + 1] = dv.getFloat32(offset + 4, true);
      vertices[idx + 2] = dv.getFloat32(offset + 8, true);
      normals[idx] = nx;
      normals[idx + 1] = ny;
      normals[idx + 2] = nz;
      offset += 12;
    }
    offset += 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geo;
}

function parseASCII(text) {
  const vertices = [];
  const normals = [];
  const faceNormal = [0, 0, 0];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('facet normal')) {
      const parts = line.split(/\s+/);
      faceNormal[0] = parseFloat(parts[2]);
      faceNormal[1] = parseFloat(parts[3]);
      faceNormal[2] = parseFloat(parts[4]);
    } else if (line.startsWith('vertex')) {
      const parts = line.split(/\s+/);
      vertices.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
      normals.push(faceNormal[0], faceNormal[1], faceNormal[2]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geo;
}

// ── Load car from config ────────────────────────────────

export async function loadCar(config) {
  const carGroup = new THREE.Group();
  const partMap = new Map();
  let wheelsMesh = null;

  // Load all STL parts in parallel
  const promises = config.parts.map(async (part) => {
    const res = await fetch(part.stlUrl);
    if (!res.ok) throw new Error(`Failed to load ${part.stlUrl}: ${res.status}`);
    const buffer = await res.arrayBuffer();
    const geometry = parseSTL(buffer);
    geometry.computeBoundingBox();

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(part.defaultColor || '#cccccc'),
      metalness: 0.1,
      roughness: 0.8,
      transparent: part.transparent || false,
      opacity: part.opacity !== undefined ? part.opacity : 1.0,
      flatShading: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.partName = part.name;

    carGroup.add(mesh);
    partMap.set(part.name, { mesh, config: part });

    if (part.name.toLowerCase() === 'wheels') {
      wheelsMesh = mesh;
    }
  });

  await Promise.all(promises);

  // Z-up to Y-up
  carGroup.rotation.set(-Math.PI / 2, 0, 0);
  carGroup.updateMatrixWorld(true);

  // Compute world-space bounding box
  const box = new THREE.Box3();
  carGroup.traverse((child) => {
    if (child.isMesh) {
      child.geometry.computeBoundingBox();
      const childBox = child.geometry.boundingBox.clone();
      child.updateWorldMatrix(true, false);
      childBox.applyMatrix4(child.matrixWorld);
      box.union(childBox);
    }
  });

  if (!box.isEmpty()) {
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    // Scale to ~2 units
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 2.0 / maxDim;
    carGroup.scale.set(scale, scale, scale);

    // Recompute after scale
    carGroup.updateMatrixWorld(true);
    box.makeEmpty();
    carGroup.traverse((child) => {
      if (child.isMesh) {
        const childBox = child.geometry.boundingBox.clone();
        child.updateWorldMatrix(true, false);
        childBox.applyMatrix4(child.matrixWorld);
        box.union(childBox);
      }
    });

    box.getCenter(center);
    // Sit on ground (y=0), center horizontally
    carGroup.position.set(-center.x, -box.min.y, -center.z);
  }

  return { carGroup, partMap, wheelsMesh };
}
