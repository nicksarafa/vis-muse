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
	const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
	const ctx = new AudioCtx();
	const analyser = ctx.createAnalyser();
	analyser.fftSize = 2048;
	analyser.smoothingTimeConstant = 0.85;
	const freq = new Uint8Array(analyser.frequencyBinCount);
	const time = new Uint8Array(analyser.fftSize);

	// Do NOT route to destination (no audio output)
	// analyser.connect(ctx.destination);

	let currentSrc: MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null = null;
	let currentStream: MediaStream | null = null;
	let mediaEl: HTMLAudioElement | null = null;

	function cleanupSource() {
		if (currentSrc) {
			try { currentSrc.disconnect(); } catch {}
			currentSrc = null;
		}
		if (currentStream) {
			try { currentStream.getTracks().forEach(t => t.stop()); } catch {}
			currentStream = null;
		}
		if (mediaEl) {
			try { mediaEl.pause(); } catch {}
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
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true,
				channelCount: 1
			}
		});
		const src = ctx.createMediaStreamSource(stream);
		src.connect(analyser);
		currentSrc = src;
		currentStream = stream;
	}

	async function useSystemAudio() {
		await ensureRunning();
		cleanupSource();
		if ((navigator.mediaDevices as any).getDisplayMedia) {
			try {
				const stream = await (navigator.mediaDevices as any).getDisplayMedia({
					video: true,
					audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
				});
				const audioTracks = stream.getAudioTracks();
				if (audioTracks.length === 0) throw new Error('No system audio track');
				const audioStream = new MediaStream([audioTracks[0]]);
				const src = ctx.createMediaStreamSource(audioStream);
				src.connect(analyser);
				currentSrc = src;
				currentStream = audioStream;
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
		mediaEl.muted = true;
		mediaEl.volume = 0.0;
		mediaEl.src = URL.createObjectURL(file);
		await mediaEl.play();
		const src = ctx.createMediaElementSource(mediaEl);
		src.connect(analyser);
		currentSrc = src;
		currentStream = null;
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
		const deltaBass = Math.max(0, bass - lastBass);
		const deltaEnergy = Math.max(0, energy - lastEnergy);
		kickValue = Math.max(kickValue * 0.88, deltaBass * 5.0 + deltaEnergy * 1.5);
		lastBass = bass * 0.98 + lastBass * 0.02;
		lastEnergy = energy * 0.98 + lastEnergy * 0.02;
		return { energy, bass, kick: kickValue };
	}

	function toggleMute(){ /* no-op, nothing is routed */ }

	return { useMic, useSystemAudio, useFile, getAnalysis, toggleMute };
} 