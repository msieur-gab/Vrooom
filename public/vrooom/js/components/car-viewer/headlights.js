/**
 * headlights.js — SpotLights, volumetric cones, emissive toggle.
 */
import * as THREE from 'three';

const BLENDING_MAP = {
  normal: THREE.NormalBlending,
  additive: THREE.AdditiveBlending,
  multiply: THREE.MultiplyBlending,
  subtractive: THREE.SubtractiveBlending
};

const DEFAULT_PARAMS = {
  front: { color: '#ebfb04', intensity: 10, length: 1.4, angle: 15, opacity: 0.10, push: -0.1, yDrop: 0.2, blending: 'additive' },
  rear:  { color: '#d30303', intensity: 20, length: 0.6, angle: 10, opacity: 0.18, push: -0.2, yDrop: 0, blending: 'normal' }
};

export function createHeadlights(carGroup, partMap) {
  let lightsOn = false;
  const addedObjects = [];  // spotlights + cones + targets to remove on toggle off

  function toggle(on, params) {
    lightsOn = on;
    const lp = params || DEFAULT_PARAMS;

    // Remove existing
    for (const obj of addedObjects) {
      obj.parent && obj.parent.remove(obj);
      if (obj.target) obj.target.parent && obj.target.parent.remove(obj.target);
    }
    addedObjects.length = 0;

    // Toggle emissive on all light parts
    for (const [name, { mesh }] of partMap) {
      if (!name.toLowerCase().includes('light')) continue;
      mesh.material.emissiveIntensity = on ? 0.8 : 0;
      mesh.material.emissive = on ? new THREE.Color(mesh.material.color) : new THREE.Color(0x000000);
      mesh.material.toneMapped = !on;
    }

    if (!on) return;

    // Create spotlights + cones for each light part
    for (const [name, { mesh }] of partMap) {
      if (!name.toLowerCase().includes('light')) continue;

      const isFront = name.toLowerCase().includes('front');
      const p = isFront ? lp.front : lp.rear;
      const lightColor = new THREE.Color(p.color);
      const angleRad = (p.angle * Math.PI) / 180;

      mesh.geometry.computeBoundingBox();
      mesh.updateWorldMatrix(true, false);
      const worldMatrix = mesh.matrixWorld;
      const carInverse = new THREE.Matrix4().copy(carGroup.matrixWorld).invert();
      const toLocal = (wp) => wp.clone().applyMatrix4(carInverse);

      // World-space bbox center
      const bbox = mesh.geometry.boundingBox.clone().applyMatrix4(worldMatrix);
      const center = new THREE.Vector3();
      bbox.getCenter(center);

      // Split vertices into left/right clusters for lamp centroids
      const positions = mesh.geometry.attributes.position;
      const leftVerts = [], rightVerts = [];
      const v = new THREE.Vector3();

      for (let i = 0; i < positions.count; i++) {
        v.set(positions.getX(i), positions.getY(i), positions.getZ(i)).applyMatrix4(worldMatrix);
        (v.x < center.x ? leftVerts : rightVerts).push(v.clone());
      }

      const centroidOf = (verts) => {
        const c = new THREE.Vector3();
        for (const vt of verts) c.add(vt);
        return c.divideScalar(verts.length || 1);
      };

      const leftCenter = centroidOf(leftVerts);
      const rightCenter = centroidOf(rightVerts);

      const leftOriginZ = isFront
        ? Math.max(...leftVerts.map(v => v.z)) + p.push
        : Math.min(...leftVerts.map(v => v.z)) - p.push;
      const rightOriginZ = isFront
        ? Math.max(...rightVerts.map(v => v.z)) + p.push
        : Math.min(...rightVerts.map(v => v.z)) - p.push;

      const lampData = [
        { x: leftCenter.x,  y: leftCenter.y,  originZ: leftOriginZ },
        { x: rightCenter.x, y: rightCenter.y, originZ: rightOriginZ }
      ];

      for (const lamp of lampData) {
        const wOrigin = new THREE.Vector3(lamp.x, lamp.y, lamp.originZ);
        const zEnd = isFront ? lamp.originZ + p.length : lamp.originZ - p.length;
        const wTarget = new THREE.Vector3(lamp.x, lamp.y - p.yDrop, zEnd);

        const lOrigin = toLocal(wOrigin);
        const lTarget = toLocal(wTarget);

        // SpotLight
        const spot = new THREE.SpotLight(lightColor, p.intensity);
        spot.angle = angleRad;
        spot.penumbra = 0.4;
        spot.distance = p.length / carGroup.scale.x;
        spot.decay = 1.0;
        spot.castShadow = false;
        spot.position.copy(lOrigin);

        const target = new THREE.Object3D();
        target.position.copy(lTarget);
        spot.target = target;

        carGroup.add(spot);
        carGroup.add(target);
        addedObjects.push(spot, target);

        // Volumetric cone
        const wDir = new THREE.Vector3(0, -p.yDrop, zEnd - lamp.originZ).normalize();
        const wMid = new THREE.Vector3(
          lamp.x,
          lamp.y + wDir.y * p.length / 2,
          lamp.originZ + wDir.z * p.length / 2
        );
        const lMid = toLocal(wMid);

        const localScale = carGroup.scale.x;
        const localLength = p.length / localScale;
        const coneRadius = Math.tan(angleRad) * localLength;
        const coneGeo = new THREE.ConeGeometry(coneRadius, localLength, 16, 1, true);
        const coneMat = new THREE.MeshBasicMaterial({
          color: lightColor,
          transparent: true,
          opacity: p.opacity,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: BLENDING_MAP[p.blending] || THREE.NormalBlending
        });

        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.copy(lMid);

        // Orient cone along beam direction
        const lOriginDir = toLocal(new THREE.Vector3(lamp.x, lamp.y, lamp.originZ));
        const lEndDir = toLocal(new THREE.Vector3(lamp.x, lamp.y - p.yDrop, zEnd));
        const localDir = new THREE.Vector3().subVectors(lEndDir, lOriginDir).normalize();
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), localDir.clone().negate());

        carGroup.add(cone);
        addedObjects.push(cone);
      }
    }
  }

  return {
    toggle,
    get isOn() { return lightsOn; },
    getAddedObjects() { return addedObjects; }
  };
}
