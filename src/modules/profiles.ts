export type VisualProfile = {
	name: string;
	colorA: string;
	colorB: string;
	pointSize: number;
	damping: number;
	noiseScale: number;
}

const palettes: [string, string][]= [
	['#8ec5ff', '#b388ff'],
	['#ff9a9e', '#fad0c4'],
	['#a1c4fd', '#c2e9fb'],
	['#f6d365', '#fda085'],
	['#84fab0', '#8fd3f4'],
	['#fccb90', '#d57eeb'],
	['#f093fb', '#f5576c'],
	['#4facfe', '#00f2fe'],
	['#43e97b', '#38f9d7'],
	['#fa709a', '#fee140'],
	['#30cfd0', '#330867'],
	['#5ee7df', '#b490ca'],
	['#a18cd1', '#fbc2eb'],
	['#fddb92', '#d1fdff'],
	['#ee9ca7', '#ffdde1'],
	['#89f7fe', '#66a6ff'],
	['#ff758c', '#ff7eb3'],
	['#c471ed', '#f64f59'],
	['#fdcbf1', '#e6dee9'],
	['#a8edea', '#fed6e3'],
	['#13547a', '#80d0c7'],
	['#0cebeb', '#29ffc6'],
	['#f0c27b', '#4b1248'],
	['#5f2c82', '#49a09d'],
	['#3a1c71', '#d76d77'],
	['#c6ffdd', '#fbd786'],
	['#12c2e9', '#c471ed'],
	['#2af598', '#009efd'],
	['#f7971e', '#ffd200'],
	['#2b86c5', '#784ba0'],
];

function rand(min: number, max: number){ return Math.random()*(max-min)+min; }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random()*arr.length)]; }

export function randomizeProfile(i: number): VisualProfile {
	const [a,b] = pick(palettes);
	return {
		name: `${i+1}`,
		colorA: a,
		colorB: b,
		pointSize: rand(1.2, 3.6),
		damping: rand(0.90, 0.99),
		noiseScale: rand(0.4, 2.2),
	};
}

export function createProfiles(count = 100): VisualProfile[] {
	const result: VisualProfile[] = [];
	for (let i = 0; i < count; i++) result.push(randomizeProfile(i));
	return result;
} 