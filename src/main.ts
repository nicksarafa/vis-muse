import * as THREE from 'three';
import { GPUComputationRenderer } from './three/GPUComputationRenderer';
import { createAudioEngine, AudioEngine } from './modules/audio';
import { createProfiles, VisualProfile } from './modules/profiles';

const canvas = document.getElementById('webgl') as HTMLCanvasElement;
const hudProfileName = document.getElementById('profileName') as HTMLSpanElement;
const micBtn = document.getElementById('micBtn') as HTMLButtonElement;
const sysBtn = document.getElementById('sysBtn') as HTMLButtonElement;
const fileBtn = document.getElementById('fileBtn') as HTMLButtonElement;
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const statsEl = document.getElementById('stats') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
// Orthographic camera sized to viewport
let ortho: THREE.OrthographicCamera;
function setupCamera(){
	const aspect = window.innerWidth / window.innerHeight;
	const halfH = 1.0;
	const halfW = halfH * aspect;
	ortho = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, 100);
	ortho.position.set(0, 0, 10);
	ortho.lookAt(0, 0, 0);
}
setupCamera();

function getViewRadius(){
	const halfH = ortho.top;
	const halfW = ortho.right;
	return Math.min(halfH, halfW) * 0.95;
}

const clock = new THREE.Clock();

// Particle simulation settings
const PARTICLES_SIDE = 512; // 262,144 particles
const PARTICLE_COUNT = PARTICLES_SIDE * PARTICLES_SIDE;

// GPU Computation
const gpu = new GPUComputationRenderer(PARTICLES_SIDE, PARTICLES_SIDE, renderer);
const dtPosition = gpu.createTexture();
const dtVelocity = gpu.createTexture();

function seedTextures(radius: number) {
	const posArray = dtPosition.image.data;
	const velArray = dtVelocity.image.data;
	for (let i = 0; i < posArray.length; i += 4) {
		// Distribute across a disc filling the view, with shallow depth for layering
		const a = Math.random() * Math.PI * 2;
		const r = Math.sqrt(Math.random()) * radius;
		const x = Math.cos(a) * r;
		const y = Math.sin(a) * r;
		const z = (Math.random() - 0.5) * radius * 0.15;
		posArray[i + 0] = x;
		posArray[i + 1] = y;
		posArray[i + 2] = z;
		posArray[i + 3] = 1;
		velArray[i + 0] = 0;
		velArray[i + 1] = 0;
		velArray[i + 2] = 0;
		velArray[i + 3] = 1;
	}
	dtPosition.needsUpdate = true;
	dtVelocity.needsUpdate = true;
}
seedTextures(getViewRadius());

const positionVariable = gpu.addVariable('texturePosition', /* glsl */`
	uniform float time;
	uniform float interactionStrength;
	uniform float damping;
	uniform float noiseScale;
	uniform float audioKick;
	uniform float audioEnergy;
	uniform float audioBass;
	uniform sampler2D texturePosition;
	uniform sampler2D textureVelocity;
	uniform vec2 resolution;
	// Sacred geometry target params
	uniform float shapeType;
	uniform float shapeA;
	uniform float shapeB;
	uniform float shapeC;
	uniform float boundsRadius;
	uniform float centerAttract;
	uniform float swirl;
	
	vec3 hash3(vec3 p){
		p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6)));
		return -1.0 + 2.0*fract(sin(p)*43758.5453123);
	}
	
	float noise(vec3 p){
		vec3 i = floor(p);
		vec3 f = fract(p);
		vec3 u = f*f*(3.0-2.0*f);
		float n000 = dot(hash3(i+vec3(0,0,0)), f-vec3(0,0,0));
		float n100 = dot(hash3(i+vec3(1,0,0)), f-vec3(1,0,0));
		float n010 = dot(hash3(i+vec3(0,1,0)), f-vec3(0,1,0));
		float n110 = dot(hash3(i+vec3(1,1,0)), f-vec3(1,1,0));
		float n001 = dot(hash3(i+vec3(0,0,1)), f-vec3(0,0,1));
		float n101 = dot(hash3(i+vec3(1,0,1)), f-vec3(1,0,1));
		float n011 = dot(hash3(i+vec3(0,1,1)), f-vec3(0,1,1));
		float n111 = dot(hash3(i+vec3(1,1,1)), f-vec3(1,1,1));
		float nx00 = mix(n000, n100, u.x);
		float nx10 = mix(n010, n110, u.x);
		float nx01 = mix(n001, n101, u.x);
		float nx11 = mix(n011, n111, u.x);
		float nxy0 = mix(nx00, nx10, u.y);
		float nxy1 = mix(nx01, nx11, u.y);
		return mix(nxy0, nxy1, u.z);
	}
	
	// Parametric targets based on UV covering full screen
	vec3 targetSphereUV(vec2 q){
		float r = shapeA;
		float theta = q.x * 6.28318530718; // 2pi
		float phi = q.y * 3.14159265359;   // pi
		float sr = sin(phi);
		return vec3(r * sr * cos(theta), r * cos(phi), r * sr * sin(theta));
	}
	vec3 targetTorusUV(vec2 q){
		float R = shapeA; float r = max(0.01, shapeB);
		float a = q.x * 6.28318530718;
		float b = q.y * 6.28318530718;
		float x = (R + r * cos(b)) * cos(a);
		float z = (R + r * cos(b)) * sin(a);
		float y = r * sin(b);
		return vec3(x,y,z);
	}
	vec3 targetRoseUV(vec2 q){
		float k = max(1.0, shapeC);
		float theta = q.x * 6.28318530718;
		float r = shapeA * cos(k * theta);
		return vec3(r * cos(theta), (q.y - 0.5) * shapeB, r * sin(theta));
	}
	vec3 targetLissajousUV(vec2 q){
		float ax = max(0.5, shapeA); float ay = max(0.5, shapeB); float az = 1.0;
		float t = q.x * 6.28318530718 + time*0.3;
		return vec3(sin(ax*t), sin(ay*t+1.57), sin(az*t+0.78)) * 0.9;
	}
	vec3 targetSpiralUV(vec2 q){
		float theta = q.x * 6.28318530718 * max(1.0, shapeC);
		float h = (q.y - 0.5) * shapeB;
		float r = shapeA * (0.6 + 0.4*q.y);
		return vec3(r*cos(theta), h, r*sin(theta));
	}
	vec3 targetPhylloUV(vec2 q){
		float phi = 2.39996323; // golden angle
		float i = floor(q.y * 600.0) + q.x * 600.0;
		float r = shapeA * sqrt(i/600.0);
		float a = i * phi;
		return vec3(r*cos(a), (q.y-0.5)*shapeB, r*sin(a));
	}
	
	vec2 hash2(vec2 p){
		p = vec2(dot(p, vec2(127.1,311.7)), dot(p, vec2(269.5,183.3)));
		return fract(sin(p)*43758.5453);
	}
	
	vec3 getTargetUV(vec2 q){
		if (shapeType < 0.5) return targetSphereUV(q);
		else if (shapeType < 1.5) return targetTorusUV(q);
		else if (shapeType < 2.5) return targetPhylloUV(q);
		else if (shapeType < 3.5) return targetRoseUV(q);
		else if (shapeType < 4.5) return targetLissajousUV(q);
		else return targetSpiralUV(q);
	}
	
	void main() {
		vec2 uv = gl_FragCoord.xy / resolution.xy;
		vec4 pos = texture2D(texturePosition, uv);
		vec4 vel = texture2D(textureVelocity, uv);
		
		// Base forces (no pointer interactivity)
		vec3 force = vec3(0.0);
		
		// Sacred geometry attraction (morphs with audio) using param UVs
		vec2 jitter = (hash2(uv*4375.85)*2.0-1.0) / resolution * 3.0;
		vec2 q = clamp(uv + jitter, 0.0, 1.0);
		vec3 target = getTargetUV(q);
		float breath = 1.0 + audioEnergy*0.4 + audioBass*0.3 + sin(time*0.5)*0.05;
		target *= breath;
		vec3 towardTarget = (target - pos.xyz);
		float morph = clamp(0.35 + audioEnergy*1.0 + audioBass*1.0, 0.0, 2.0);
		force += normalize(towardTarget) * morph * 0.9;
		
		// Confinement: centripetal pull to keep within boundsRadius
		float rad = boundsRadius + audioEnergy*0.6 + audioBass*0.6;
		float dCenter = max(0.0, length(pos.xyz) - rad);
		force += -normalize(pos.xyz) * dCenter * centerAttract;
		
		// Swirl for flow
		float w = swirl * (0.25 + audioEnergy*0.8 + audioBass*0.6);
		force += vec3(-pos.z, 0.0, pos.x) * w * 0.05;
		
		// Organic drift
		vec3 n = vec3(
			noise(pos.xyz * noiseScale + time*0.15),
			noise(pos.yzx * noiseScale + time*0.17),
			noise(pos.zxy * noiseScale + time*0.13)
		);
		float audioScale = 1.0 + audioEnergy*1.6 + audioBass*1.8;
		force += (n - 0.5) * audioScale;
		
		// Velocity update
		vel.xyz = mix(vel.xyz + force, vel.xyz * damping, 0.0);
		
		// Apply kick bursts
		vel.xyz += normalize(force + n - 0.5) * (audioKick*1.6 + audioBass*0.8);
		
		// Integrate
		pos.xyz += vel.xyz * 0.016;
		
		// Safety clamp
		pos.xyz = clamp(pos.xyz, vec3(-8.0), vec3(8.0));
		
		gl_FragColor = pos;
	}
`, dtPosition);

const velocityVariable = gpu.addVariable('textureVelocity', /* glsl */`
	uniform sampler2D textureVelocity;
	uniform vec2 resolution;
	void main(){
		gl_FragColor = texture2D(textureVelocity, gl_FragCoord.xy / resolution.xy);
	}
`, dtVelocity);

gpu.setVariableDependencies(positionVariable, [positionVariable, velocityVariable]);
gpu.setVariableDependencies(velocityVariable, [positionVariable, velocityVariable]);

(positionVariable.material.uniforms as any).time = { value: 0 };
(positionVariable.material.uniforms as any).interactionStrength = { value: 0.0 };
(positionVariable.material.uniforms as any).damping = { value: 0.96 };
(positionVariable.material.uniforms as any).noiseScale = { value: 0.8 };
(positionVariable.material.uniforms as any).audioKick = { value: 0.0 };
(positionVariable.material.uniforms as any).audioEnergy = { value: 0.0 };
(positionVariable.material.uniforms as any).audioBass = { value: 0.0 };
(positionVariable.material.uniforms as any).shapeType = { value: 0.0 };
(positionVariable.material.uniforms as any).shapeA = { value: 0.9 };
(positionVariable.material.uniforms as any).shapeB = { value: 0.5 };
(positionVariable.material.uniforms as any).shapeC = { value: 3.0 };
(positionVariable.material.uniforms as any).boundsRadius = { value: 0.95 };
(positionVariable.material.uniforms as any).centerAttract = { value: 1.0 };
(positionVariable.material.uniforms as any).swirl = { value: 0.5 };

gpu.init();

// Particle render material
const particleGeometry = new THREE.BufferGeometry();
const positions = new Float32Array(PARTICLE_COUNT * 3);
const uvs = new Float32Array(PARTICLE_COUNT * 2);
let p = 0, u = 0;
for (let y = 0; y < PARTICLES_SIDE; y++) {
	for (let x = 0; x < PARTICLES_SIDE; x++) {
		positions[p++] = 0;
		positions[p++] = 0;
		positions[p++] = 0;
		uvs[u++] = x / (PARTICLES_SIDE - 1);
		uvs[u++] = y / (PARTICLES_SIDE - 1);
	}
}
particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
particleGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

const particleMaterial = new THREE.ShaderMaterial({
	transparent: true,
	depthWrite: false,
	blending: THREE.AdditiveBlending,
	uniforms: {
		time: { value: 0 },
		pointSize: { value: 2.0 },
		colorA: { value: new THREE.Color('#66ccff') },
		colorB: { value: new THREE.Color('#ff66cc') },
		texPosition: { value: null }
	},
	vertexShader: /* glsl */`
		uniform float time;
		uniform float pointSize;
		uniform sampler2D texPosition;
		varying float vDepth;
		varying vec2 vUv2;
		void main(){
			vec3 pos = texture2D(texPosition, uv).xyz;
			vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
			vDepth = -mvPosition.z;
			vUv2 = uv;
			gl_PointSize = pointSize;
			gl_Position = projectionMatrix * mvPosition;
		}
	`,
	fragmentShader: /* glsl */`
		uniform vec3 colorA;
		uniform vec3 colorB;
		varying float vDepth;
		varying vec2 vUv2;
		void main(){
			vec2 c = gl_PointCoord - 0.5;
			float r = dot(c,c);
			if(r>0.25) discard;
			float falloff = smoothstep(0.25, 0.0, r);
			vec3 color = mix(colorA, colorB, vUv2.x);
			gl_FragColor = vec4(color, falloff*0.85);
		}
	`
});

const points = new THREE.Points(particleGeometry, particleMaterial);
scene.add(points);

// Profiles
let basePointSize = particleMaterial.uniforms.pointSize.value as number;
let baseDamping = (positionVariable.material.uniforms as any).damping.value as number;
const profiles: VisualProfile[] = createProfiles(100);
let current = 0;
applyProfile(profiles[current]);

function applyProfile(pf: VisualProfile){
	const rad = getViewRadius();
	particleMaterial.uniforms.colorA.value.set(pf.colorA);
	particleMaterial.uniforms.colorB.value.set(pf.colorB);
	particleMaterial.uniforms.pointSize.value = pf.pointSize;
	(positionVariable.material.uniforms as any).damping.value = pf.damping;
	(positionVariable.material.uniforms as any).noiseScale.value = pf.noiseScale;
	(positionVariable.material.uniforms as any).shapeType.value = pf.shapeType;
	(positionVariable.material.uniforms as any).shapeA.value = pf.shapeA * rad;
	(positionVariable.material.uniforms as any).shapeB.value = pf.shapeB * rad;
	(positionVariable.material.uniforms as any).shapeC.value = pf.shapeC;
	(positionVariable.material.uniforms as any).boundsRadius.value = pf.boundsRadius * rad;
	(positionVariable.material.uniforms as any).centerAttract.value = pf.centerAttract;
	(positionVariable.material.uniforms as any).swirl.value = pf.swirl;
	hudProfileName.textContent = `Profile ${pf.name}`;
	basePointSize = pf.pointSize;
	baseDamping = pf.damping;
}

function resetSimulation(){
	seedTextures(getViewRadius());
	gpu.init();
}

// Audio Engine
let audio: AudioEngine | null = null;
(async function setupAudio(){
	audio = await createAudioEngine();
})();

// Controls
function resize(){
	renderer.setSize(window.innerWidth, window.innerHeight);
	setupCamera();
}
window.addEventListener('resize', resize);

window.addEventListener('keydown', (e) => {
	if (e.code === 'Space') {
		current = (current + 1) % profiles.length;
		applyProfile(profiles[current]);
		resetSimulation();
	}
	if (e.code === 'KeyM' && audio) {
		audio.toggleMute();
	}
});

// Audio input buttons (restored)
micBtn.addEventListener('click', async () => { try { if (audio) await audio.useMic(); } catch(e) { console.warn(e); } });
sysBtn.addEventListener('click', async () => { try { if (audio) await audio.useSystemAudio(); } catch(e) { console.warn(e); } });
fileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
	try {
		if (!audio || !fileInput.files || fileInput.files.length === 0) return;
		await audio.useFile(fileInput.files[0]);
	} catch(e) { console.warn(e); }
});

// FPS / stats
let fps = 0;
let lastNow = performance.now();
let lastStats = 0;

// Animate
function animate(){
	requestAnimationFrame(animate);
	const t = clock.getElapsedTime();
	(positionVariable.material.uniforms as any).time.value = t;
	(positionVariable.material.uniforms as any).interactionStrength.value = 0.0;
	
	const now = performance.now();
	const dt = now - lastNow; lastNow = now;
	const inst = dt > 0 ? 1000 / dt : 60;
	fps = fps * 0.9 + inst * 0.1;
	if (now - lastStats > 250) {
		if (statsEl) statsEl.textContent = `FPS: ${Math.round(fps)} • Particles: ${PARTICLE_COUNT.toLocaleString()}`;
		lastStats = now;
	}
	
	let energy = 0, kick = 0, bass = 0;
	if (audio) {
		const a = audio.getAnalysis();
		energy = a.energy;
		kick = a.kick;
		bass = a.bass;
	}
	(positionVariable.material.uniforms as any).audioEnergy.value = energy;
	(positionVariable.material.uniforms as any).audioKick.value = kick;
	(positionVariable.material.uniforms as any).audioBass.value = bass;
	// Pump point size and reduce damping slightly with energy/bass
	particleMaterial.uniforms.pointSize.value = basePointSize * (1.0 + energy*0.8 + kick*0.6);
	(positionVariable.material.uniforms as any).damping.value = Math.max(0.85, baseDamping - (energy*0.06 + bass*0.08));
	
	gpu.compute();
	particleMaterial.uniforms.time.value = t;
	particleMaterial.uniforms.texPosition.value = gpu.getCurrentRenderTarget(positionVariable).texture;
	renderer.render(scene, ortho);
}
animate(); 