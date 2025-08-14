import * as THREE from 'three';

export class GPUComputationRenderer {
	private sizeX: number;
	private sizeY: number;
	private renderer: THREE.WebGLRenderer;
	private dataType: number;
	private scene: THREE.Scene;
	private camera: THREE.Camera;
	private variables: Array<{ name: string; initialValueTexture: THREE.DataTexture; material: THREE.ShaderMaterial; renderTargets: THREE.WebGLRenderTarget[] }>; 
	private currentTextureIndex: number;

	constructor(sizeX: number, sizeY: number, renderer: THREE.WebGLRenderer) {
		this.sizeX = sizeX;
		this.sizeY = sizeY;
		this.renderer = renderer;
		this.dataType = THREE.FloatType;
		this.scene = new THREE.Scene();
		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
		this.variables = [];
		this.currentTextureIndex = 0;
	}

	createTexture(): THREE.DataTexture {
		const a = new Float32Array(this.sizeX * this.sizeY * 4);
		const t = new THREE.DataTexture(a, this.sizeX, this.sizeY, THREE.RGBAFormat, this.dataType);
		t.needsUpdate = true;
		return t;
	}

	addVariable(name: string, fragmentShader: string, initialValueTexture: THREE.DataTexture) {
		const material = new THREE.ShaderMaterial({
			uniforms: {
				resolution: { value: new THREE.Vector2(this.sizeX, this.sizeY) },
				texturePosition: { value: null },
				textureVelocity: { value: null },
			},
			vertexShader: /* glsl */`
				void main(){
					gl_Position = vec4(position, 1.0);
				}
			`,
			fragmentShader,
			blending: THREE.NoBlending,
			depthWrite: false,
			depthTest: false,
			transparent: false,
		});
		const rt0 = new THREE.WebGLRenderTarget(this.sizeX, this.sizeY, { type: this.dataType, format: THREE.RGBAFormat });
		const rt1 = new THREE.WebGLRenderTarget(this.sizeX, this.sizeY, { type: this.dataType, format: THREE.RGBAFormat });
		this.variables.push({ name, initialValueTexture, material, renderTargets: [rt0, rt1] });
		return this.variables[this.variables.length - 1];
	}

	setVariableDependencies(variable: any, deps: any[]) {
		// Keep reference; in this simplified version we just pass current RTs into uniforms before compute.
		(variable as any).dependencies = deps;
	}

	init() {
		for (const v of this.variables) {
			this.renderTexture(v.initialValueTexture, v.renderTargets[0]);
			this.renderTexture(v.initialValueTexture, v.renderTargets[1]);
		}
	}

	getCurrentRenderTarget(variable: any) {
		return variable.renderTargets[this.currentTextureIndex];
	}

	compute() {
		const passMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
		this.scene.clear();
		this.scene.add(passMesh);
		for (const v of this.variables) {
			(passMesh.material as any) = v.material;
			// Bind dependencies: textures from variables current/prev
			for (const dep of (v as any).dependencies || []) {
				if (dep.name === 'texturePosition') {
					v.material.uniforms.texturePosition.value = dep.renderTargets[this.currentTextureIndex].texture;
				}
				if (dep.name === 'textureVelocity') {
					v.material.uniforms.textureVelocity.value = dep.renderTargets[this.currentTextureIndex].texture;
				}
			}
			const nextIndex = (this.currentTextureIndex + 1) % 2;
			this.renderer.setRenderTarget(v.renderTargets[nextIndex]);
			this.renderer.render(this.scene, this.camera);
		}
		this.renderer.setRenderTarget(null);
		this.currentTextureIndex = (this.currentTextureIndex + 1) % 2;
	}

	renderTexture(input: THREE.Texture, output: THREE.WebGLRenderTarget){
		const mat = new THREE.MeshBasicMaterial({ map: input });
		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
		this.scene.clear();
		this.scene.add(mesh);
		this.renderer.setRenderTarget(output);
		this.renderer.render(this.scene, this.camera);
		this.renderer.setRenderTarget(null);
	}
} 