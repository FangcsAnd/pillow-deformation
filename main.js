import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// ============================================================
// CONFIGURATION & CONSTANTS
// ============================================================

const PILLOW = {
    width: 60,    // cm
    length: 40,   // cm
    height: 12,   // cm
    segX: 40,     // subdivisions along width
    segZ: 28,     // subdivisions along length
};

const HEAD = {
    radius: 9,        // cm (adult head ~9cm radius)
    radiusY: 9.5,     // slightly taller
    radiusX: 8.5,     // slightly narrower
    weight: 5,        // kg (default)
};

// LX-F hardness → foam modulus mapping
// LX-F 0 = very soft sponge, LX-F 100 = very firm
function lxfToModulus(lxf) {
    return 5000 + lxf * 1800;
}

function lxfToDamping(lxf) {
    return 15 + lxf * 0.3;
}

// ============================================================
// PILLOW GEOMETRY CREATION
// ============================================================

function createPillowGeometry(w, l, h, segX, segZ) {
    const hw = w / 2;
    const hl = l / 2;
    const hh = h / 2;
    const domeAmount = h * 0.04;

    const nx = segX + 1;
    const nz = segZ + 1;
    const topCount = nx * nz;
    const bottomCount = nx * nz;

    // Side face vertex counts
    const sideFrontBack = (segX + 1) * 2;
    const sideLeftRight = (segZ + 1) * 2;
    const totalSide = sideFrontBack * 2 + sideLeftRight * 2;

    const totalVertices = topCount + bottomCount + totalSide;
    const positions = new Float32Array(totalVertices * 3);
    const normals = new Float32Array(totalVertices * 3);
    const uvs = new Float32Array(totalVertices * 2);
    const indices = [];

    let vi = 0;

    // --- Top face vertices (deformable) ---
    // Layout: iterate z then x, so grid[iz][ix] maps to topStart + iz*nx + ix
    const topStart = vi;
    for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
            const fx = ix / segX;
            const fz = iz / segZ;
            const x = -hw + fx * w;
            const z = -hl + fz * l;
            const dome = domeAmount * (1 - Math.abs(fx - 0.5) * 2) * (1 - Math.abs(fz - 0.5) * 2);
            const y = hh + dome;

            positions[vi * 3] = x;
            positions[vi * 3 + 1] = y;
            positions[vi * 3 + 2] = z;
            normals[vi * 3] = 0;
            normals[vi * 3 + 1] = 1;
            normals[vi * 3 + 2] = 0;
            uvs[vi * 2] = fx;
            uvs[vi * 2 + 1] = fz;
            vi++;
        }
    }

    // Top face indices
    for (let iz = 0; iz < segZ; iz++) {
        for (let ix = 0; ix < segX; ix++) {
            const a = topStart + iz * nx + ix;
            const b = a + 1;
            const c = a + nx;
            const d = c + 1;
            indices.push(a, b, d);
            indices.push(a, d, c);
        }
    }

    // --- Bottom face vertices ---
    const bottomStart = vi;
    for (let iz = 0; iz < nz; iz++) {
        for (let iy = 0; iy < nx; iy++) {
            const fx = iy / segX;
            const fz = iz / segZ;
            positions[vi * 3] = -hw + fx * w;
            positions[vi * 3 + 1] = -hh;
            positions[vi * 3 + 2] = -hl + fz * l;
            normals[vi * 3] = 0;
            normals[vi * 3 + 1] = -1;
            normals[vi * 3 + 2] = 0;
            uvs[vi * 2] = fx;
            uvs[vi * 2 + 1] = fz;
            vi++;
        }
    }

    // Bottom face indices (reverse winding)
    for (let iz = 0; iz < segZ; iz++) {
        for (let ix = 0; ix < segX; ix++) {
            const a = bottomStart + iz * nx + ix;
            const b = a + 1;
            const c = a + nx;
            const d = c + 1;
            indices.push(a, d, b);
            indices.push(a, c, d);
        }
    }

    // --- Side faces ---
    function addSideVertices(x1, z1, x2, z2, count, normalX, normalZ, swapU) {
        const start = vi;
        for (let i = 0; i < count; i++) {
            const t = i / (count - 1);
            const x = x1 + (x2 - x1) * t;
            const z = z1 + (z2 - z1) * t;

            // Top vertex
            positions[vi * 3] = x;
            positions[vi * 3 + 1] = hh;
            positions[vi * 3 + 2] = z;
            normals[vi * 3] = normalX;
            normals[vi * 3 + 1] = 0;
            normals[vi * 3 + 2] = normalZ;
            uvs[vi * 2] = swapU ? (1 - t) : t;
            uvs[vi * 2 + 1] = 1;
            vi++;

            // Bottom vertex
            positions[vi * 3] = x;
            positions[vi * 3 + 1] = -hh;
            positions[vi * 3 + 2] = z;
            normals[vi * 3] = normalX;
            normals[vi * 3 + 1] = 0;
            normals[vi * 3 + 2] = normalZ;
            uvs[vi * 2] = swapU ? (1 - t) : t;
            uvs[vi * 2 + 1] = 0;
            vi++;
        }

        // Triangles
        for (let i = 0; i < count - 1; i++) {
            const t0 = start + i * 2;
            const t1 = start + i * 2 + 1;
            const t2 = start + (i + 1) * 2;
            const t3 = start + (i + 1) * 2 + 1;
            indices.push(t0, t2, t3);
            indices.push(t0, t3, t1);
        }

        return [start, vi];
    }

    // Front (+Z)
    const [frontStart] = addSideVertices(-hw, hl, hw, hl, segX + 1, 0, 1, false);
    // Back (-Z) - reverse winding
    const [backStart] = addSideVertices(hw, -hl, -hw, -hl, segX + 1, 0, -1, true);
    // Right (+X)
    const [rightStart] = addSideVertices(hw, hl, hw, -hl, segZ + 1, 1, 0, false);
    // Left (-X)
    const [leftStart] = addSideVertices(-hw, -hl, -hw, hl, segZ + 1, -1, 0, true);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return {
        geometry,
        topStart,
        topCount,
        nx,
        nz,
        hw,
        hl,
        hh,
    };
}

// ============================================================
// PHYSICS
// ============================================================

class DeformationPhysics {
    constructor(pillowInfo) {
        const { topCount, nx, nz, hw, hl, hh } = pillowInfo;
        this.isStlMode = false;
        this.nx = nx;
        this.nz = nz;
        this.topCount = topCount;
        this.hw = hw;
        this.hl = hl;
        this.hh = hh;

        this.restY = new Float32Array(topCount);
        this.currentY = new Float32Array(topCount);
        this.velocityY = new Float32Array(topCount);
        this.masses = new Float32Array(topCount);
        this.vertexXArr = null;
        this.vertexZArr = null;
        this.geomToControl = null; // STL mode: maps geom vertex idx -> control point idx
        this.pillowGeomPositions = null; // STL mode: reference to position attribute

        // Initialize rest positions
        for (let iz = 0; iz < nz; iz++) {
            for (let ix = 0; ix < nx; ix++) {
                const idx = iz * nx + ix;
                const y = this.getRestY(ix, iz, hh);
                this.restY[idx] = y;
                this.currentY[idx] = y;
                this.velocityY[idx] = 0;
            }
        }

        // Vertex mass = proportional to cell area * pillow height * foam density
        const cellArea = (2 * hw / (nx - 1)) * (2 * hl / (nz - 1));
        const foamDensity = 0.00008; // kg/cm³ ≈ 80 kg/m³
        const perVertexMass = cellArea * (hh * 2) * foamDensity * 2.0;
        this.masses.fill(Math.max(perVertexMass, 0.00001));

        // Build neighbor list
        this.neighbors = this.buildNeighborList();

        // Head state
        this.headX = 0;
        this.headZ = 0;
        this.headY = hh + HEAD.radius;
        this.headVelY = 0;
        this.headMass = HEAD.weight;
        this.headRadius = HEAD.radius;

        // Spring/damping parameters
        this.hardness = 30;
        this.updateSpringParams();
    }

    getRestY(ix, iz, hh) {
        const fx = ix / (this.nx - 1);
        const fz = iz / (this.nz - 1);
        const domeAmount = this.hh * 2 * 0.04;
        const dome = domeAmount * (1 - Math.abs(fx - 0.5) * 2) * (1 - Math.abs(fz - 0.5) * 2);
        return hh + dome;
    }

    buildNeighborList() {
        const { nx, nz } = this;
        const neighborList = [];
        for (let iz = 0; iz < nz; iz++) {
            for (let ix = 0; ix < nx; ix++) {
                const idx = iz * nx + ix;
                const nbrs = [];
                if (ix > 0) nbrs.push(idx - 1);
                if (ix < nx - 1) nbrs.push(idx + 1);
                if (iz > 0) nbrs.push(idx - nx);
                if (iz < nz - 1) nbrs.push(idx + nx);
                neighborList[idx] = nbrs;
            }
        }
        return neighborList;
    }

    updateSpringParams() {
        const modulus = lxfToModulus(this.hardness);
        let cellArea;
        if (this.isStlMode) {
            const totalArea = (2 * this.hw) * (2 * this.hl);
            cellArea = totalArea / Math.max(this.topCount, 1);
        } else {
            cellArea = (2 * this.hw / (this.nx - 1)) * (2 * this.hl / (this.nz - 1));
        }
        const foamHeight = this.hh * 2;
        // Spring constant per vertex: E * area / height
        this.K_rest = modulus * cellArea / foamHeight;
        // Bending spring (neighbor coupling)
        this.K_bend = this.K_rest * 0.8;
        // Damping: overdamped for memory foam
        this.damping = lxfToDamping(this.hardness);

        // Head dynamics params
        const contactArea = Math.PI * this.headRadius * this.headRadius;
        const K_eff = this.K_rest * contactArea / cellArea;
        // Overdamped: damping > 2*sqrt(K*m) for slow memory foam recovery
        this.headDamping = 3.5 * Math.sqrt(K_eff * this.headMass);
        this.headK = K_eff;
    }

    setHardness(lxf) {
        this.hardness = lxf;
        this.updateSpringParams();
    }

    setHeadWeight(kg) {
        this.headMass = kg;
        this.updateSpringParams();
    }

    setHeadPosition(x, z) {
        this.headX = x;
        this.headZ = z;
    }

    setHeadYOffset(offset) {
        // Manual Y override
        const autoY = this.computeEquilibriumY();
        this.headY = autoY + offset;
        this.headVelY = 0;
    }

    computeEquilibriumY() {
        const g = 981; // cm/s²
        const cellArea = (2 * this.hw / (this.nx - 1)) * (2 * this.hl / (this.nz - 1));
        const contactArea = Math.PI * this.headRadius * this.headRadius;
        const K_eff = this.K_rest * contactArea / cellArea;
        const depth = Math.min(this.headMass * g / (K_eff + 1), this.hh * 1.8);
        return this.hh + this.headRadius - depth;
    }

    getHeadTargetY(manualOffset) {
        const eqY = this.computeEquilibriumY();
        return eqY + manualOffset;
    }

    vertexX(idx) {
        if (this.isStlMode && this.vertexXArr) return this.vertexXArr[idx];
        const ix = idx % this.nx;
        return -this.hw + (ix / (this.nx - 1)) * 2 * this.hw;
    }

    vertexZ(idx) {
        if (this.isStlMode && this.vertexZArr) return this.vertexZArr[idx];
        const iz = Math.floor(idx / this.nx);
        return -this.hl + (iz / (this.nz - 1)) * 2 * this.hl;
    }

    step(dt, freezeHeadY = null) {
        dt = Math.min(dt, 0.033); // cap at ~30fps for stability

        const subSteps = 6;
        const subDt = dt / subSteps;
        const g = 981; // cm/s² (gravity)

        // If head Y is frozen, lock it for the entire step
        if (freezeHeadY !== null) {
            this.headY = freezeHeadY;
            this.headVelY = 0;
        }

        for (let s = 0; s < subSteps; s++) {
            const hx = this.headX;
            const hz = this.headZ;
            const hr = this.headRadius;

            // --- Update vertices: spring-damper forces ---
            for (let i = 0; i < this.topCount; i++) {
                let forceY = 0;

                // Spring toward rest position
                forceY += -this.K_rest * (this.currentY[i] - this.restY[i]);

                // Damping
                forceY += -this.damping * this.velocityY[i];

                // Neighbor spring forces (bending resistance)
                const nbrs = this.neighbors[i];
                for (let n = 0; n < nbrs.length; n++) {
                    forceY += -this.K_bend * (this.currentY[i] - this.currentY[nbrs[n]]);
                }

                // Integrate velocity + position
                const accel = forceY / this.masses[i];
                this.velocityY[i] += accel * subDt;
                this.currentY[i] += this.velocityY[i] * subDt;

                // Prevent going below pillow bottom
                const minY = -this.hh + 0.02;
                if (this.currentY[i] < minY) {
                    this.currentY[i] = minY;
                    if (this.velocityY[i] < 0) this.velocityY[i] = 0;
                }

                // Prevent excessive upward bounce
                const maxY = this.restY[i] + 0.5;
                if (this.currentY[i] > maxY) {
                    this.currentY[i] = maxY;
                    if (this.velocityY[i] > 0) this.velocityY[i] = 0;
                }
            }

            // --- Position-based head contact: clamp vertices to head surface ---
            for (let i = 0; i < this.topCount; i++) {
                const vx = this.vertexX(i);
                const vz = this.vertexZ(i);
                const dx = vx - hx;
                const dz = vz - hz;
                const dist = Math.sqrt(dx * dx + dz * dz);

                if (dist < hr * 0.98) {
                    // Directly under head – clamp to head surface
                    const headSurfY = this.headY - Math.sqrt(Math.max(0, hr * hr - dist * dist));
                    if (this.currentY[i] > headSurfY) {
                        this.currentY[i] = headSurfY;
                        if (this.velocityY[i] > 0) this.velocityY[i] = 0;
                    }
                } else if (dist < hr + 2.0) {
                    // Transition zone – smooth blend toward head indentation
                    const t = (dist - hr) / 2.0;
                    const smoothT = t < 0.5
                        ? 2 * t * t
                        : 1 - Math.pow(-2 * t + 2, 2) / 2;
                    const headBottom = this.headY - hr;
                    const blendTarget = headBottom * (1 - smoothT) + this.restY[i] * smoothT;
                    if (this.currentY[i] > blendTarget) {
                        const correction = this.currentY[i] - blendTarget;
                        this.velocityY[i] += -this.K_rest * 0.5 * correction / this.masses[i] * subDt;
                    }
                }
            }

            // --- Update head Y (skip if frozen) ---
            if (freezeHeadY === null) {
                // Compute upward force from compressed vertices in contact zone
                let upwardForce = 0;
                for (let i = 0; i < this.topCount; i++) {
                    if (this.currentY[i] < this.restY[i] - 0.001) {
                        const vx = this.vertexX(i);
                        const vz = this.vertexZ(i);
                        const dx = vx - hx;
                        const dz = vz - hz;
                        const dist = Math.sqrt(dx * dx + dz * dz);
                        if (dist < hr + 1.0) {
                            const compression = this.restY[i] - this.currentY[i];
                            upwardForce += this.K_rest * compression;
                        }
                    }
                }

                const gravityForce = this.headMass * g;
                const netForceY = -gravityForce + upwardForce;
                const headAccel = netForceY / this.headMass;
                this.headVelY += headAccel * subDt;
                this.headVelY *= Math.exp(-this.headDamping / this.headMass * subDt);
                this.headY += this.headVelY * subDt;

                // Clamp head
                this.headY = Math.max(this.headY, -this.hh + hr * 0.3);
                this.headY = Math.min(this.headY, this.hh + hr + 10);
            }
        }
    }

    computeMaxDepth() {
        let maxDepth = 0;
        for (let i = 0; i < this.topCount; i++) {
            const depth = this.restY[i] - this.currentY[i];
            if (depth > maxDepth) maxDepth = depth;
        }
        return maxDepth;
    }

    computeContactArea() {
        const hr = this.headRadius;
        const hx = this.headX;
        const hz = this.headZ;
        let contactVerts = 0;
        let cellArea;
        if (this.isStlMode) {
            const totalArea = (2 * this.hw) * (2 * this.hl);
            cellArea = totalArea / Math.max(this.topCount, 1);
        } else {
            cellArea = (2 * this.hw / (this.nx - 1)) * (2 * this.hl / (this.nz - 1));
        }

        for (let i = 0; i < this.topCount; i++) {
            const vx = this.vertexX(i);
            const vz = this.vertexZ(i);
            const dx = vx - hx;
            const dz = vz - hz;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < hr && this.currentY[i] < this.restY[i] - 0.01) {
                contactVerts++;
            }
        }
        return contactVerts * cellArea;
    }

    initFromSTL(stlGeometry) {
        const positions = stlGeometry.getAttribute('position');
        const totalVerts = positions.count;

        // Compute bounding box and Y range
        let minY = Infinity, maxY = -Infinity;
        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        for (let i = 0; i < totalVerts; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const z = positions.getZ(i);
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }

        // Store pillow dimensions from STL bounds
        this.hw = Math.max(Math.abs(minX), Math.abs(maxX));
        this.hl = Math.max(Math.abs(minZ), Math.abs(maxZ));
        this.hh = Math.max(Math.abs(minY), Math.abs(maxY));

        const heightRange = maxY - minY;
        const topThreshold = maxY - heightRange * 0.12;

        // Weld vertices using spatial grid
        const cellSize = Math.max(heightRange * 0.03, 0.3);
        const cellMap = new Map();

        for (let i = 0; i < totalVerts; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const z = positions.getZ(i);

            if (y < topThreshold) continue;

            const cx = Math.round(x / cellSize);
            const cz = Math.round(z / cellSize);
            const key = `${cx},${cz}`;

            if (!cellMap.has(key)) {
                cellMap.set(key, { sumX: 0, sumZ: 0, maxY: -Infinity, count: 0, geomIndices: [] });
            }
            const cell = cellMap.get(key);
            cell.sumX += x;
            cell.sumZ += z;
            cell.count++;
            cell.geomIndices.push(i);
            if (y > cell.maxY) cell.maxY = y;
        }

        // Build control points
        const controlPoints = [];
        const geomToControl = new Map();

        for (const [key, cell] of cellMap) {
            const idx = controlPoints.length;
            controlPoints.push({
                x: cell.sumX / cell.count,
                z: cell.sumZ / cell.count,
                restY: cell.maxY,
                currentY: cell.maxY,
                velY: 0,
                mass: 0.002,
                geomIndices: cell.geomIndices,
            });
            for (const gi of cell.geomIndices) {
                geomToControl.set(gi, idx);
            }
        }

        // Build spatial neighbor list (proximity-based)
        const N = controlPoints.length;
        const neighbors = new Array(N);
        const searchRadius = cellSize * 2.8;

        for (let i = 0; i < N; i++) {
            const pi = controlPoints[i];
            const nbrs = [];
            for (let j = 0; j < N; j++) {
                if (i === j) continue;
                const pj = controlPoints[j];
                const dx = pi.x - pj.x;
                const dz = pi.z - pj.z;
                if (dx * dx + dz * dz < searchRadius * searchRadius) {
                    nbrs.push(j);
                }
            }
            neighbors[i] = nbrs;
        }

        // Store in physics arrays
        this.topCount = N;
        this.restY = new Float32Array(N);
        this.currentY = new Float32Array(N);
        this.velocityY = new Float32Array(N);
        this.masses = new Float32Array(N);
        this.vertexXArr = new Float32Array(N);
        this.vertexZArr = new Float32Array(N);
        this.neighbors = neighbors;
        this.geomToControl = geomToControl;
        this.pillowGeomPositions = positions;
        this.isStlMode = true;

        const foamDensity = 0.00008;
        const totalArea = (maxX - minX) * (maxZ - minZ);
        const cellArea = totalArea / Math.max(N, 1);
        const perVertexMass = cellArea * heightRange * foamDensity * 2.0;

        for (let i = 0; i < N; i++) {
            const cp = controlPoints[i];
            this.restY[i] = cp.restY;
            this.currentY[i] = cp.currentY;
            this.velocityY[i] = cp.velY;
            this.masses[i] = Math.max(perVertexMass, 0.00001);
            this.vertexXArr[i] = cp.x;
            this.vertexZArr[i] = cp.z;
        }

        this.updateSpringParams();

        // Reset head to above pillow
        this.headY = this.hh + this.headRadius;
        this.headVelY = 0;

        return controlPoints.length;
    }
}

// ============================================================
// SCENE SETUP
// ============================================================

function createScene() {
    const container = document.getElementById('canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 1, 500);
    camera.position.set(45, 38, 65);
    camera.lookAt(0, 4, -3);

    // Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 4, -3);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 20;
    controls.maxDistance = 180;
    controls.maxPolarAngle = Math.PI * 0.75;
    controls.update();

    // Scene
    const scene = new THREE.Scene();

    // Background gradient
    const bgColor = new THREE.Color('#1a1a2e');
    scene.background = bgColor;
    scene.fog = new THREE.Fog(bgColor, 80, 250);

    // Lighting
    const ambientLight = new THREE.AmbientLight('#8899cc', 1.5);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight('#ffffff', 4);
    keyLight.position.set(40, 60, 30);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 200;
    keyLight.shadow.camera.left = -80;
    keyLight.shadow.camera.right = 80;
    keyLight.shadow.camera.top = 80;
    keyLight.shadow.camera.bottom = -80;
    keyLight.shadow.bias = -0.0003;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight('#8899dd', 1.5);
    fillLight.position.set(-20, 15, -10);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight('#ffffff', 2);
    rimLight.position.set(0, 10, -40);
    scene.add(rimLight);

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(300, 300);
    const groundMat = new THREE.MeshStandardMaterial({
        color: '#2a2a3a',
        roughness: 0.7,
        metalness: 0.1,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -8;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid on ground for reference
    const grid = new THREE.GridHelper(120, 60, '#444466', '#2a2a3a');
    grid.position.y = -7.95;
    scene.add(grid);

    // Bed surface (elevated)
    const bedGeo = new THREE.BoxGeometry(90, 4, 70);
    const bedMat = new THREE.MeshStandardMaterial({
        color: '#3d3d50',
        roughness: 0.6,
        metalness: 0.05,
    });
    const bed = new THREE.Mesh(bedGeo, bedMat);
    bed.position.y = -6;
    bed.receiveShadow = true;
    bed.castShadow = true;
    scene.add(bed);

    return { renderer, camera, scene, controls, container };
}

// ============================================================
// HEAD MODEL
// ============================================================

function createHeadModel() {
    const group = new THREE.Group();

    // Main head (ellipsoid)
    const headGeo = new THREE.SphereGeometry(HEAD.radius, 48, 40);
    const headMat = new THREE.MeshStandardMaterial({
        color: '#e8b88a',
        roughness: 0.42,
        metalness: 0.05,
    });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.scale.set(HEAD.radiusX / HEAD.radius, 1, HEAD.radiusX / HEAD.radius);
    headMesh.castShadow = true;
    group.add(headMesh);

    // Eyes (two small spheres)
    const eyeGeo = new THREE.SphereGeometry(0.8, 16, 12);
    const eyeMat = new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.3, metalness: 0.5 });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(2.8, 1.8, -HEAD.radius + 0.5);
    group.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(-2.8, 1.8, -HEAD.radius + 0.5);
    group.add(rightEye);

    // Nose bump
    const noseGeo = new THREE.SphereGeometry(1.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, headMat);
    nose.position.set(0, 0, -HEAD.radius + 0.2);
    nose.rotation.x = Math.PI;
    nose.scale.set(0.8, 0.7, 0.5);
    group.add(nose);

    // Neck cylinder
    const neckGeo = new THREE.CylinderGeometry(3.5, 4.2, 6, 24);
    const neckMat = new THREE.MeshStandardMaterial({
        color: '#d4a57a',
        roughness: 0.5,
        metalness: 0.05,
    });
    const neck = new THREE.Mesh(neckGeo, neckMat);
    neck.position.y = -HEAD.radius * 0.9;
    neck.castShadow = true;
    group.add(neck);

    return group;
}

// ============================================================
// APPLICATION
// ============================================================

function init() {
    const { renderer, camera, scene, controls, container } = createScene();

    // Build pillow geometry
    const pillowInfo = createPillowGeometry(PILLOW.width, PILLOW.length, PILLOW.height, PILLOW.segX, PILLOW.segZ);
    const pillowGeometry = pillowInfo.geometry;

    // Pillow material
    const pillowMaterial = new THREE.MeshStandardMaterial({
        color: '#a8c8e8',
        roughness: 0.65,
        metalness: 0.02,
        side: THREE.FrontSide,
    });

    // Pillow world Y: position the pillow so its bottom sits on the bed (bed top at y=-4)
    let pillowWorldY = 2;

    const pillowMesh = new THREE.Mesh(pillowGeometry, pillowMaterial);
    pillowMesh.castShadow = true;
    pillowMesh.receiveShadow = true;
    pillowMesh.position.y = pillowWorldY;
    scene.add(pillowMesh);

    // Wireframe overlay
    const wireframeMat = new THREE.MeshBasicMaterial({
        color: '#336699',
        wireframe: true,
        transparent: true,
        opacity: 0.15,
        depthTest: true,
    });
    const wireframeMesh = new THREE.Mesh(pillowGeometry.clone(), wireframeMat);
    wireframeMesh.position.copy(pillowMesh.position);
    wireframeMesh.visible = false;
    scene.add(wireframeMesh);

    // Head model
    const headModel = createHeadModel();
    scene.add(headModel);
    let currentHeadModel = headModel;

    // Physics
    const physics = new DeformationPhysics(pillowInfo);
    const topStart = pillowInfo.topStart;

    // Store reference to position attribute for quick access
    const positionAttr = pillowGeometry.getAttribute('position');

    // Default rotations
    // Pillow: X -90° (lay flat)
    const rotHelper = (geo, axis, deg) => {
        const rad = deg * Math.PI / 180;
        const cos = Math.round(Math.cos(rad));
        const sin = Math.round(Math.sin(rad));
        const pos = geo.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            if (axis === 'x') { pos.setXYZ(i, x, y * cos - z * sin, y * sin + z * cos); }
            else if (axis === 'y') { pos.setXYZ(i, x * cos + z * sin, y, -x * sin + z * cos); }
            else { pos.setXYZ(i, x * cos - y * sin, x * sin + y * cos, z); }
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
    };
    rotHelper(pillowGeometry, 'x', -90);
    rotHelper(wireframeMesh.geometry, 'x', -90);
    // Refresh pillow position + physics after rotation
    let geoMinY = Infinity;
    for (let i = 0; i < pillowGeometry.getAttribute('position').count; i++) {
        const y = pillowGeometry.getAttribute('position').getY(i);
        if (y < geoMinY) geoMinY = y;
    }
    pillowWorldY = -4 - geoMinY;
    pillowMesh.position.y = pillowWorldY;
    wireframeMesh.position.y = pillowWorldY;
    physics.initFromSTL(pillowGeometry);
    physics.setHardness(30);
    physics.setHeadWeight(5);

    // Head: X -90° (lay flat)
    currentHeadModel.rotateX(-Math.PI / 2);

    // Initial head placement – start above pillow to show settling
    physics.setHeadPosition(0, 0);
    const initY = physics.computeEquilibriumY();
    physics.headY = initY + 8; // start 8cm above equilibrium, will settle
    currentHeadModel.position.set(0, pillowWorldY + initY + 8, 0);

    // ============================================================
    // GUI BINDINGS
    // ============================================================

    const hardnessSlider = document.getElementById('hardness');
    const weightSlider = document.getElementById('weight');
    const posZSlider = document.getElementById('posZ');
    const posXSlider = document.getElementById('posX');
    const posYSlider = document.getElementById('posY');
    const wireframeCheck = document.getElementById('wireframe');
    const autoModeCheck = document.getElementById('autoMode');

    const valHardness = document.getElementById('val-hardness');
    const valWeight = document.getElementById('val-weight');
    const valPosZ = document.getElementById('val-posZ');
    const valPosX = document.getElementById('val-posX');
    const valPosY = document.getElementById('val-posY');

    const infoDepth = document.getElementById('info-depth');
    const infoArea = document.getElementById('info-area');
    const infoStiffness = document.getElementById('info-stiffness');

    let manualYOffset = 0;

    hardnessSlider.addEventListener('input', () => {
        const v = parseInt(hardnessSlider.value);
        valHardness.textContent = v + '°';
        physics.setHardness(v);
    });

    weightSlider.addEventListener('input', () => {
        const v = parseFloat(weightSlider.value);
        valWeight.textContent = v.toFixed(1) + ' kg';
        physics.setHeadWeight(v);
    });

    posZSlider.addEventListener('input', () => {
        const v = parseFloat(posZSlider.value);
        valPosZ.textContent = v.toFixed(1) + ' cm';
        physics.setHeadPosition(physics.headX, v);
        currentHeadModel.position.z = v;
    });

    posXSlider.addEventListener('input', () => {
        const v = parseFloat(posXSlider.value);
        valPosX.textContent = v.toFixed(1) + ' cm';
        physics.setHeadPosition(v, physics.headZ);
        currentHeadModel.position.x = v;
    });

    posYSlider.addEventListener('input', () => {
        const v = parseFloat(posYSlider.value);
        valPosY.textContent = v.toFixed(1) + ' cm';
        manualYOffset = v;
        if (!autoModeCheck.checked) {
            physics.setHeadYOffset(v);
            currentHeadModel.position.y = pillowWorldY + physics.headY;
        }
    });

    wireframeCheck.addEventListener('change', () => {
        currentWireframeMesh.visible = wireframeCheck.checked;
    });

    // Reset button
    document.getElementById('reset-btn').addEventListener('click', () => {
        camera.position.set(45, 38, 65);
        controls.target.set(0, 4, -3);
        controls.update();
    });

    // ============================================================
    // STL FILE IMPORT
    // ============================================================

    let stlLoader = null;
    try {
        stlLoader = new STLLoader();
    } catch (e) {
        console.error('STLLoader 创建失败:', e);
    }

    const importStatus = document.getElementById('import-status');
    const pillowFileInput = document.getElementById('pillow-file');
    const headFileInput = document.getElementById('head-file');

    let currentPillowGeometry = pillowGeometry;
    let currentPillowMesh = pillowMesh;
    let currentWireframeMesh = wireframeMesh;

    // Label elements natively trigger file inputs via "for" attribute,
    // so no click listeners needed on buttons.

    pillowFileInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!stlLoader) {
            importStatus.textContent = 'STL 加载器未就绪，请刷新页面';
            return;
        }
        console.log('枕头文件:', file.name, file.size, 'bytes');
        importStatus.textContent = '读取中...';
        importStatus.style.color = '#ff9944';

        const reader = new FileReader();
        reader.onload = (evt) => {
            console.log('文件读取完成，开始解析...');
            importStatus.textContent = '解析中...';
            try {
                const stlGeo = stlLoader.parse(evt.target.result);
                console.log('STL 解析成功，顶点数:', stlGeo.getAttribute('position').count);

                // Compute bounding box for auto-centering and scaling
                const pos = stlGeo.getAttribute('position');
                let minX = Infinity, maxX = -Infinity;
                let minY = Infinity, maxY = -Infinity;
                let minZ = Infinity, maxZ = -Infinity;
                for (let i = 0; i < pos.count; i++) {
                    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
                }
                const stlW = maxX - minX;
                const stlL = maxZ - minZ;
                const stlH = maxY - minY;
                const cx = (minX + maxX) / 2;
                const cy = (minY + maxY) / 2;
                const cz = (minZ + maxZ) / 2;
                console.log('STL 尺寸:', stlW.toFixed(1), 'x', stlL.toFixed(1), 'x', stlH.toFixed(1));

                // Scale to match expected pillow size (60 x 40 cm)
                const targetW = PILLOW.width;
                const targetL = PILLOW.length;
                const scale = Math.min(targetW / Math.max(stlW, 0.01), targetL / Math.max(stlL, 0.01));
                console.log('缩放倍数:', scale.toFixed(3));

                // Center + scale geometry in place
                for (let i = 0; i < pos.count; i++) {
                    pos.setX(i, (pos.getX(i) - cx) * scale);
                    pos.setY(i, (pos.getY(i) - cy) * scale);
                    pos.setZ(i, (pos.getZ(i) - cz) * scale);
                }
                pos.needsUpdate = true;
                stlGeo.computeVertexNormals();

                // Recompute pillow world Y from actual geometry bounds
                let geoMinY = Infinity, geoMaxY = -Infinity;
                for (let i = 0; i < pos.count; i++) {
                    const y = pos.getY(i);
                    if (y < geoMinY) geoMinY = y;
                    if (y > geoMaxY) geoMaxY = y;
                }
                const bedTopY = -4;
                pillowWorldY = bedTopY - geoMinY;
                console.log('枕头几何体 Y 范围: ' + geoMinY.toFixed(1) + ' ~ ' + geoMaxY.toFixed(1) + ', 世界偏移=' + pillowWorldY.toFixed(1));

                // Replace pillow mesh — use DoubleSide to avoid backface culling with STL normals
                const stlMaterial = new THREE.MeshStandardMaterial({
                    color: '#a8c8e8',
                    roughness: 0.65,
                    metalness: 0.02,
                    side: THREE.DoubleSide,
                });
                scene.remove(currentPillowMesh);
                scene.remove(currentWireframeMesh);

                const newPillowMesh = new THREE.Mesh(stlGeo, stlMaterial);
                newPillowMesh.castShadow = true;
                newPillowMesh.receiveShadow = true;
                newPillowMesh.position.y = pillowWorldY;
                scene.add(newPillowMesh);
                currentPillowMesh = newPillowMesh;
                currentPillowGeometry = stlGeo;

                // New wireframe with DoubleSide too
                const stlWireframeMat = new THREE.MeshBasicMaterial({
                    color: '#336699',
                    wireframe: true,
                    transparent: true,
                    opacity: 0.15,
                    depthTest: true,
                    side: THREE.DoubleSide,
                });
                const newWireframeMesh = new THREE.Mesh(stlGeo.clone(), stlWireframeMat);
                newWireframeMesh.position.copy(newPillowMesh.position);
                newWireframeMesh.visible = wireframeCheck.checked;
                scene.add(newWireframeMesh);
                currentWireframeMesh = newWireframeMesh;

                // Re-initialize physics for STL geometry
                console.log('初始化形变物理...');
                const numPoints = physics.initFromSTL(stlGeo);
                console.log('控制点数:', numPoints);
                physics.setHeadWeight(parseFloat(weightSlider.value));
                physics.setHardness(parseInt(hardnessSlider.value));
                physics.setHeadPosition(
                    parseFloat(posXSlider.value),
                    parseFloat(posZSlider.value)
                );
                physics.headY = physics.computeEquilibriumY() + 8;

                importStatus.textContent = '枕头加载成功: ' + numPoints + ' 控制点';
                importStatus.style.color = '#66cc88';
            } catch (err) {
                console.error('解析失败:', err);
                importStatus.textContent = '解析失败: ' + (err.message || String(err));
                importStatus.style.color = '#ff4444';
            }
        };
        reader.onerror = () => {
            console.error('文件读取失败:', reader.error);
            importStatus.textContent = '文件读取失败';
            importStatus.style.color = '#ff4444';
        };
        reader.readAsArrayBuffer(file);
    });

    headFileInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!stlLoader) {
            importStatus.textContent = 'STL 加载器未就绪';
            return;
        }
        console.log('头部文件:', file.name, file.size, 'bytes');
        importStatus.textContent = '读取中...';
        importStatus.style.color = '#ff9944';

        const reader = new FileReader();
        reader.onload = (evt) => {
            console.log('文件读取完成，开始解析...');
            importStatus.textContent = '解析中...';
            try {
                const stlGeo = stlLoader.parse(evt.target.result);
                console.log('STL 解析成功，顶点数:', stlGeo.getAttribute('position').count);

                // Compute bounding box + auto-center & scale
                const pos = stlGeo.getAttribute('position');
                let minX = Infinity, maxX = -Infinity;
                let minY = Infinity, maxY = -Infinity;
                let minZ = Infinity, maxZ = -Infinity;
                for (let i = 0; i < pos.count; i++) {
                    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
                }
                const stlW = maxX - minX;
                const stlH = maxY - minY;
                const stlD = maxZ - minZ;
                const cx = (minX + maxX) / 2;
                const cy = (minY + maxY) / 2;
                const cz = (minZ + maxZ) / 2;
                console.log('头部STL尺寸:', stlW.toFixed(1), 'x', stlH.toFixed(1), 'x', stlD.toFixed(1));

                // Scale to roughly head size (~18 cm diameter)
                const targetSize = HEAD.radius * 2;
                const maxDim = Math.max(stlW, stlH, stlD);
                const scale = targetSize / Math.max(maxDim, 0.01);
                console.log('缩放倍数:', scale.toFixed(3));

                for (let i = 0; i < pos.count; i++) {
                    pos.setX(i, (pos.getX(i) - cx) * scale);
                    pos.setY(i, (pos.getY(i) - cy) * scale);
                    pos.setZ(i, (pos.getZ(i) - cz) * scale);
                }
                pos.needsUpdate = true;
                stlGeo.computeVertexNormals();

                // Compute bounding sphere after centering
                let r2max = 0;
                for (let i = 0; i < pos.count; i++) {
                    const dx = pos.getX(i);
                    const dy = pos.getY(i);
                    const dz = pos.getZ(i);
                    const r2 = dx * dx + dy * dy + dz * dz;
                    if (r2 > r2max) r2max = r2;
                }
                const boundingRadius = Math.sqrt(r2max);
                console.log('头部包围球半径:', boundingRadius.toFixed(1), 'cm');

                // Replace head model
                scene.remove(currentHeadModel);
                const headMat = new THREE.MeshStandardMaterial({
                    color: '#e8b88a',
                    roughness: 0.42,
                    metalness: 0.05,
                    side: THREE.DoubleSide,
                });
                const newHeadMesh = new THREE.Mesh(stlGeo, headMat);
                newHeadMesh.castShadow = true;
                const newHeadGroup = new THREE.Group();
                newHeadGroup.add(newHeadMesh);
                currentHeadModel = newHeadGroup;
                scene.add(currentHeadModel);

                // Update physics head radius
                physics.headRadius = boundingRadius * 0.85;
                physics.updateSpringParams();
                physics.headY = physics.computeEquilibriumY() + 8;

                importStatus.textContent = '头部加载成功: r≈' + boundingRadius.toFixed(1) + 'cm';
                importStatus.style.color = '#66cc88';
            } catch (err) {
                console.error('解析失败:', err);
                importStatus.textContent = '解析失败: ' + (err.message || String(err));
                importStatus.style.color = '#ff4444';
            }
        };
        reader.onerror = () => {
            console.error('文件读取失败:', reader.error);
            importStatus.textContent = '文件读取失败';
            importStatus.style.color = '#ff4444';
        };
        reader.readAsArrayBuffer(file);
    });

    // Clear file input so same file can be re-selected
    pillowFileInput.addEventListener('click', (e) => { e.target.value = ''; });
    headFileInput.addEventListener('click', (e) => { e.target.value = ''; });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
        switch (e.key.toLowerCase()) {
            case 'w':
                wireframeCheck.checked = !wireframeCheck.checked;
                currentWireframeMesh.visible = wireframeCheck.checked;
                break;
            case 'r':
                camera.position.set(45, 38, 65);
                controls.target.set(0, 4, -3);
                controls.update();
                break;
            case 'a':
                autoModeCheck.checked = !autoModeCheck.checked;
                break;
            case 'arrowleft':
            case 'arrowright':
            case 'arrowup':
            case 'arrowdown':
                // Arrow keys have 'Arrow' prefix in modern browsers
                // eslint doesn't handle fallthrough patterns but this is correct
                break;
            default:
                break;
        }
        // Handle arrow keys separately
        if (e.key === 'ArrowLeft' || e.key === 'Left' || e.key === 'ArrowRight' || e.key === 'Right' ||
            e.key === 'ArrowUp' || e.key === 'Up' || e.key === 'ArrowDown' || e.key === 'Down') {
            e.preventDefault();
            if (e.key === 'ArrowLeft' || e.key === 'Left') {
                posXSlider.value = Math.max(-20, parseFloat(posXSlider.value) - 1);
                posXSlider.dispatchEvent(new Event('input'));
            } else if (e.key === 'ArrowRight' || e.key === 'Right') {
                posXSlider.value = Math.min(20, parseFloat(posXSlider.value) + 1);
                posXSlider.dispatchEvent(new Event('input'));
            } else if (e.key === 'ArrowUp' || e.key === 'Up') {
                posZSlider.value = Math.min(15, parseFloat(posZSlider.value) + 1);
                posZSlider.dispatchEvent(new Event('input'));
            } else if (e.key === 'ArrowDown' || e.key === 'Down') {
                posZSlider.value = Math.max(-15, parseFloat(posZSlider.value) - 1);
                posZSlider.dispatchEvent(new Event('input'));
            }
        }
    });

    // ============================================================
    // ROTATION CONTROLS (90° steps)
    // ============================================================

    function rotateGeometry(geometry, axis, angleDeg) {
        const rad = angleDeg * Math.PI / 180;
        const cos = Math.round(Math.cos(rad)); // 90° increments → cos/sin are exactly 0,±1
        const sin = Math.round(Math.sin(rad));
        const pos = geometry.getAttribute('position');

        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            let nx, ny, nz;
            if (axis === 'x') {
                nx = x;
                ny = y * cos - z * sin;
                nz = y * sin + z * cos;
            } else if (axis === 'y') {
                nx = x * cos + z * sin;
                ny = y;
                nz = -x * sin + z * cos;
            } else {
                nx = x * cos - y * sin;
                ny = x * sin + y * cos;
                nz = z;
            }
            pos.setXYZ(i, nx, ny, nz);
        }
        pos.needsUpdate = true;
        geometry.computeVertexNormals();
    }

    function refreshPillowAfterRotation() {
        // Recompute pillow world Y offset from new geometry bounds
        const pos = currentPillowGeometry.getAttribute('position');
        let geoMinY = Infinity;
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            if (y < geoMinY) geoMinY = y;
        }
        const bedTopY = -4;
        pillowWorldY = bedTopY - geoMinY;

        currentPillowMesh.position.y = pillowWorldY;
        currentWireframeMesh.position.y = pillowWorldY;

        // Re-init physics
        if (physics.isStlMode) {
            physics.initFromSTL(currentPillowGeometry);
        }
        physics.setHeadWeight(parseFloat(weightSlider.value));
        physics.setHardness(parseInt(hardnessSlider.value));
        physics.setHeadPosition(
            parseFloat(posXSlider.value),
            parseFloat(posZSlider.value)
        );
        physics.headY = physics.computeEquilibriumY() + 2;
    }

    document.querySelectorAll('.rot-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.target;
            const axis = btn.dataset.axis;
            const dir = parseInt(btn.dataset.dir);
            const angle = 90 * dir;

            if (target === 'pillow') {
                rotateGeometry(currentPillowGeometry, axis, angle);
                // Also rotate the wireframe clone
                rotateGeometry(currentWireframeMesh.geometry, axis, angle);
                refreshPillowAfterRotation();
                importStatus.textContent = '枕头旋转: ' + axis.toUpperCase() + (dir > 0 ? '+' : '-') + '90°';
                importStatus.style.color = '#ff9944';
            } else if (target === 'head') {
                const halfPi = Math.PI / 2;
                const dirSign = dir > 0 ? 1 : -1;
                if (axis === 'x') currentHeadModel.rotateX(halfPi * dirSign);
                else if (axis === 'y') currentHeadModel.rotateY(halfPi * dirSign);
                else currentHeadModel.rotateZ(halfPi * dirSign);

                // Recompute head bounding radius from the first mesh found
                const meshChild = currentHeadModel.children.find(c => c.isMesh);
                if (meshChild && meshChild.geometry) {
                    const pos = meshChild.geometry.getAttribute('position');
                    let r2max = 0;
                    for (let i = 0; i < pos.count; i++) {
                        const dx = pos.getX(i), dy = pos.getY(i), dz = pos.getZ(i);
                        const r2 = dx * dx + dy * dy + dz * dz;
                        if (r2 > r2max) r2max = r2;
                    }
                    const newRadius = Math.sqrt(r2max) * 0.85;
                    if (newRadius > 0.5) {
                        physics.headRadius = newRadius;
                        physics.updateSpringParams();
                        physics.headY = physics.computeEquilibriumY() + 2;
                    }
                }
                importStatus.textContent = '头部旋转: ' + axis.toUpperCase() + (dir > 0 ? '+' : '-') + '90°';
                importStatus.style.color = '#ff9944';
            }
        });
    });

    // ============================================================
    // ANIMATION LOOP
    // ============================================================

    let lastTime = performance.now();
    let elapsedTotal = 0;

    function animate(timestamp) {
        requestAnimationFrame(animate);

        let dt = (timestamp - lastTime) / 1000;
        lastTime = timestamp;

        if (dt <= 0) dt = 0.016;
        if (dt > 0.1) dt = 0.1;

        elapsedTotal += dt;

        controls.update();

        // In auto mode, head Y is simulated naturally
        // In manual mode, head Y is locked to the manually chosen offset
        const eqY = physics.computeEquilibriumY();
        if (autoModeCheck.checked) {
            physics.step(dt, null);
            // Reflect actual head position on the Y-offset slider
            const offset = parseFloat((physics.headY - eqY).toFixed(1));
            if (Math.abs(offset - manualYOffset) > 0.05) {
                posYSlider.value = offset;
                valPosY.textContent = offset + ' cm';
                manualYOffset = offset;
            }
        } else {
            const targetHeadY = eqY + manualYOffset;
            physics.step(dt, targetHeadY);
        }

        // Update head model position (world = pillow world offset + physics local)
        currentHeadModel.position.x = physics.headX;
        currentHeadModel.position.y = pillowWorldY + physics.headY;
        currentHeadModel.position.z = physics.headZ;

        // Update pillow geometry vertices
        if (physics.isStlMode && physics.geomToControl) {
            const posArr = currentPillowGeometry.getAttribute('position').array;
            for (const [geomIdx, controlIdx] of physics.geomToControl) {
                posArr[geomIdx * 3 + 1] = physics.currentY[controlIdx];
            }
            currentPillowGeometry.getAttribute('position').needsUpdate = true;
            currentPillowGeometry.computeVertexNormals();

            // Wireframe
            if (currentWireframeMesh.visible) {
                const wPos = currentWireframeMesh.geometry.getAttribute('position');
                const wArr = wPos.array;
                for (const [geomIdx, controlIdx] of physics.geomToControl) {
                    wArr[geomIdx * 3 + 1] = physics.currentY[controlIdx];
                }
                wPos.needsUpdate = true;
                currentWireframeMesh.geometry.computeVertexNormals();
            }
        } else {
            const posArr = positionAttr.array;
            for (let i = 0; i < physics.topCount; i++) {
                const vi = topStart + i;
                posArr[vi * 3 + 1] = physics.currentY[i];
            }
            positionAttr.needsUpdate = true;
            pillowGeometry.computeVertexNormals();

            // Wireframe
            if (wireframeMesh.visible) {
                const wPos = wireframeMesh.geometry.getAttribute('position');
                const wArr = wPos.array;
                for (let i = 0; i < physics.topCount; i++) {
                    const vi = topStart + i;
                    wArr[vi * 3 + 1] = physics.currentY[i];
                }
                wPos.needsUpdate = true;
                wireframeMesh.geometry.computeVertexNormals();
            }
        }

        // Update info bar
        const maxDepth = physics.computeMaxDepth();
        const contactArea = physics.computeContactArea();
        infoDepth.textContent = maxDepth.toFixed(2) + ' cm';
        infoArea.textContent = contactArea.toFixed(1) + ' cm²';
        infoStiffness.textContent = lxfToModulus(physics.hardness).toFixed(0) + ' Pa';

        renderer.render(scene, camera);
    }

    // Handle resize
    window.addEventListener('resize', () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    });

    // Start
    requestAnimationFrame(animate);
}

// ============================================================
// BOOT
// ============================================================

init();
