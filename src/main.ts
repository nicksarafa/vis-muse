import * as THREE from 'three';
import { GPUComputationRenderer } from './three/GPUComputationRenderer';
import { createAudioEngine, AudioEngine } from './modules/audio';
import { createProfiles, VisualProfile, randomizeProfile } from './modules/profiles';

const canvas = document.getElementById('webgl') as HTMLCanvasElement;
const hudProfileName = document.getElementById('profileName') as HTMLSpanElement;
const micBtn = document.getElementById('micBtn') as HTMLButtonElement;
const sysBtn = document.getElementById('sysBtn') as HTMLButtonElement;
const fileBtn = document.getElementById('fileBtn') as HTMLButtonElement;
const fileInput = document.getElementById('fileInput') as HTMLInputElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 0, 3);

const clock = new THREE.Clock();

// Particle simulation settings
const PARTICLES_SIDE = 512; // 262,144 particles
const PARTICLE_COUNT = PARTICLES_SIDE * PARTICLES_SIDE;

// Mouse/Finger interaction state
const pointer = new THREE.Vector2(0, 0);
let pointerDown = false;

const raycaster = new THREE.Raycaster();
const pointerPlane = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshBasicMaterial({ visible: false }));
scene.add(pointerPlane);

// GPU Computation
const gpu = new GPUComputationRenderer(PARTICLES_SIDE, PARTICLES_SIDE, renderer);
const dtPosition = gpu.createTexture();
const dtVelocity = gpu.createTexture();

// Initialize position/velocity
(function initTextures() {
	const posArray = dtPosition.image.data;
	const velArray = dtVelocity.image.data;
	for (let i = 0; i < posArray.length; i += 4) {
		const x = (Math.random() - 0.5) * 2.0;
		const y = (Math.random() - 0.5) * 2.0;
		const z = (Math.random() - 0.5) * 2.0;
		posArray[i + 0] = x;
		posArray[i + 1] = y;
		posArray[i + 2] = z;
		posArray[i + 3] = 1;
		velArray[i + 0] = 0;
		velArray[i + 1] = 0;
		velArray[i + 2] = 0;
		velArray[i + 3] = 1;
	}
})();

const positionVariable = gpu.addVariable('texturePosition', /* glsl */`
	uniform float time;
	uniform vec3 attractor;
	uniform float interactionStrength;
	uniform float damping;
	uniform float noiseScale;
	uniform float audioKick;
	uniform float audioEnergy;
	uniform sampler2D texturePosition;
	uniform sampler2D textureVelocity;
	uniform vec2 resolution;
	
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
	
	void main() {
		vec2 uv = gl_FragCoord.xy / resolution.xy;
		vec4 pos = texture2D(texturePosition, uv);
		vec4 vel = texture2D(textureVelocity, uv);
		
		// Interaction force towards/away from pointer attractor
		vec3 dir = attractor - pos.xyz;
		float dist = length(dir) + 1e-4;
		vec3 force = normalize(dir) * interactionStrength / (1.0 + dist*dist);
		
		// Curl-like noise drift affected by audio
		vec3 n = vec3(
			noise(pos.xyz * noiseScale + time*0.15),
			noise(pos.yzx * noiseScale + time*0.17),
			noise(pos.zxy * noiseScale + time*0.13)
		);
		force += (n - 0.5) * (0.6 + audioEnergy*0.8);
		
		// Velocity update
		vel.xyz = mix(vel.xyz + force, vel.xyz * damping, 0.0);
		
		// Apply kick bursts
		vel.xyz += normalize(force + n - 0.5) * (audioKick*0.5);
		
		// Integrate
		pos.xyz += vel.xyz * 0.016;
		
		// Soft bounds
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
(positionVariable.material.uniforms as any).attractor = { value: new THREE.Vector3() };
(positionVariable.material.uniforms as any).interactionStrength = { value: 0.0 };
(positionVariable.material.uniforms as any).damping = { value: 0.96 };
(positionVariable.material.uniforms as any).noiseScale = { value: 0.8 };
(positionVariable.material.uniforms as any).audioKick = { value: 0.0 };
(positionVariable.material.uniforms as any).audioEnergy = { value: 0.0 };

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
			gl_PointSize = pointSize * (300.0 / max(60.0, -mvPosition.z));
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
			gl_FragColor = vec4(color, falloff*0.9);
		}
	`
});

const points = new THREE.Points(particleGeometry, particleMaterial);
scene.add(points);

// Profiles
const profiles: VisualProfile[] = createProfiles(100);
let current = 0;
applyProfile(profiles[current]);

function applyProfile(pf: VisualProfile){
	particleMaterial.uniforms.colorA.value.set(pf.colorA);
	particleMaterial.uniforms.colorB.value.set(pf.colorB);
	particleMaterial.uniforms.pointSize.value = pf.pointSize;
	(positionVariable.material.uniforms as any).damping.value = pf.damping;
	(positionVariable.material.uniforms as any).noiseScale.value = pf.noiseScale;
	hudProfileName.textContent = `Profile ${pf.name}`;
}

// Audio Engine
let audio: AudioEngine | null = null;
(async function setupAudio(){
	audio = await createAudioEngine();
})();

// Controls
window.addEventListener('resize', () => {
	renderer.setSize(window.innerWidth, window.innerHeight);
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
});

window.addEventListener('keydown', (e) => {
	if (e.code === 'Space') {
		current = (current + 1) % profiles.length;
		applyProfile(profiles[current]);
	}
	if (e.code === 'KeyM' && audio) {
		audio.toggleMute();
	}
});

// Mouse / touch
function updatePointerFromEvent(clientX: number, clientY: number){
	pointer.x = (clientX / window.innerWidth) * 2 - 1;
	pointer.y = - (clientY / window.innerHeight) * 2 + 1;
	raycaster.setFromCamera(pointer, camera);
	const hit = raycaster.intersectObject(pointerPlane)[0];
	if (hit) {
		(positionVariable.material.uniforms as any).attractor.value.copy(hit.point);
	}
}

window.addEventListener('mousemove', (e) => updatePointerFromEvent(e.clientX, e.clientY));
window.addEventListener('touchstart', (e) => { pointerDown = true; const t = e.touches[0]; updatePointerFromEvent(t.clientX, t.clientY); });
window.addEventListener('touchmove', (e) => { const t = e.touches[0]; updatePointerFromEvent(t.clientX, t.clientY); });
window.addEventListener('touchend', () => { pointerDown = false; });
window.addEventListener('mousedown', (e) => { pointerDown = true; updatePointerFromEvent(e.clientX, e.clientY); });
window.addEventListener('mouseup', () => { pointerDown = false; });

micBtn.addEventListener('click', async () => { if (audio) await audio.useMic(); });
sysBtn.addEventListener('click', async () => { if (audio) await audio.useSystemAudio(); });
fileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
	if (!audio || !fileInput.files || fileInput.files.length === 0) return;
	await audio.useFile(fileInput.files[0]);
});

// Animate
function animate(){
	requestAnimationFrame(animate);
	const t = clock.getElapsedTime();
	(positionVariable.material.uniforms as any).time.value = t;
	(positionVariable.material.uniforms as any).interactionStrength.value = pointerDown ? 6.0 : 2.6;
	
	let energy = 0, kick = 0;
	if (audio) {
		const a = audio.getAnalysis();
		energy = a.energy;
		kick = a.kick;
	}
	(positionVariable.material.uniforms as any).audioEnergy.value = energy;
	(positionVariable.material.uniforms as any).audioKick.value = kick;
	
	gpu.compute();
	particleMaterial.uniforms.time.value = t;
	particleMaterial.uniforms.texPosition.value = gpu.getCurrentRenderTarget(positionVariable).texture;
	renderer.render(scene, camera);
}
animate(); 