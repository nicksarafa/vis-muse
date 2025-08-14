export type AudioAnalysis = {
	energy: number;
	bass: number;
	kick: number;
}

export type AudioEngine = {
	useMic: () => Promise<void>;
	useSystemAudio: () => Promise<void>;
	useFile: (file: File) => Promise<void>;
	getAnalysis: () => AudioAnalysis;
	toggleMute: () => void;
}

export async function createAudioEngine(): Promise<AudioEngine> {
	const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
	const ctx = new AudioCtx();
	const analyser = ctx.createAnalyser();
	analyser.fftSize = 2048;
	const freq = new Uint8Array(analyser.frequencyBinCount);
	const time = new Uint8Array(analyser.fftSize);
	const gain = ctx.createGain();
	gain.gain.value = 1;
	analyser.connect(gain).connect(ctx.destination);

	let currentSrc: MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null = null;
	let mediaEl: HTMLAudioElement | null = null;

	function cleanupSource() {
		if (currentSrc) {
			try { currentSrc.disconnect(); } catch {}
			currentSrc = null;
		}
		if (mediaEl) {
			mediaEl.pause();
			mediaEl.srcObject = null;
			mediaEl.src = '';
			mediaEl.remove();
			mediaEl = null;
		}
	}

	async function ensureRunning() {
		if (ctx.state !== 'running') await ctx.resume();
	}

	async function useMic() {
		await ensureRunning();
		cleanupSource();
		const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
		const src = ctx.createMediaStreamSource(stream);
		src.connect(analyser);
		currentSrc = src;
	}

	// Note: true system audio capture requires a virtual device or Chrome's tab capture; we attempt tab capture fallback.
	async function useSystemAudio() {
		await ensureRunning();
		cleanupSource();
		if ((navigator.mediaDevices as any).getDisplayMedia) {
			try {
				const stream = await (navigator.mediaDevices as any).getDisplayMedia({
					video: true,
					audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
				});
				const audioTracks = stream.getAudioTracks();
				if (audioTracks.length === 0) throw new Error('No system audio track');
				const audioStream = new MediaStream([audioTracks[0]]);
				const src = ctx.createMediaStreamSource(audioStream);
				src.connect(analyser);
				currentSrc = src;
				return;
			} catch (e) {
				console.warn('System audio capture failed, falling back to file/mic', e);
			}
		}
		throw new Error('System audio not available. Use Mic or File.');
	}

	async function useFile(file: File) {
		await ensureRunning();
		cleanupSource();
		mediaEl = new Audio();
		mediaEl.crossOrigin = 'anonymous';
		mediaEl.controls = false;
		mediaEl.loop = true;
		mediaEl.src = URL.createObjectURL(file);
		await mediaEl.play();
		const src = ctx.createMediaElementSource(mediaEl);
		src.connect(analyser);
		currentSrc = src;
	}

	// Analysis
	let lastEnergy = 0;
	let lastBass = 0;
	let kickValue = 0;
	function getAnalysis(): AudioAnalysis {
		analyser.getByteFrequencyData(freq);
		analyser.getByteTimeDomainData(time);
		let sum = 0;
		for (let i = 0; i < freq.length; i++) sum += freq[i];
		const energy = sum / (freq.length * 255);
		const bassBins = Math.max(8, Math.floor(freq.length * 0.04));
		let bassSum = 0;
		for (let i = 0; i < bassBins; i++) bassSum += freq[i];
		const bass = bassSum / (bassBins * 255);
		// Kick from bass energy rise and global energy delta
		const deltaBass = Math.max(0, bass - lastBass);
		const deltaEnergy = Math.max(0, energy - lastEnergy);
		kickValue = Math.max(kickValue * 0.88, deltaBass * 5.0 + deltaEnergy * 1.5);
		lastBass = bass * 0.98 + lastBass * 0.02;
		lastEnergy = energy * 0.98 + lastEnergy * 0.02;
		return { energy, bass, kick: kickValue };
	}

	function toggleMute(){
		gain.gain.value = gain.gain.value > 0 ? 0 : 1;
	}

	return { useMic, useSystemAudio, useFile, getAnalysis, toggleMute };
} 