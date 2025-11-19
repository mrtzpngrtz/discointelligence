import { GoogleGenAI } from 'https://esm.run/@google/genai';
import { GoogleGenerativeAI } from 'https://esm.run/@google/generative-ai';

// Music genres - default (will be updated from server)
let genres = ['TECHNO', 'ELECTRO', 'JAZZ', 'HIP HOP', 'CLASSICAL', 'HOUSE', 'AMBIENT', 'DRUM & BASS'];

/**
 * LyriaBrowserPlayer - Handles realtime audio playback
 */
class LyriaBrowserPlayer {
    constructor(sampleRate = 48000, channels = 2) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: sampleRate
        });
        this.sampleRate = sampleRate;
        this.channels = channels;
        this.audioQueue = [];
        this.nextChunkTime = 0;
        this.isPlaying = false;

        // Create analyser node for visualization
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

        // Create gain node for volume control
        this.gainNode = this.audioContext.createGain();

        // Connect graph: source -> analyser -> gain -> destination
        // Sources connect to analyser in _schedulePlayback
        this.analyser.connect(this.gainNode);
        this.gainNode.connect(this.audioContext.destination);

        this.gainNode.gain.value = 1.0; // Default full volume

        if (this.audioContext.state === 'suspended') {
            console.warn('AudioContext suspended. User interaction required.');
        }
    }

    getAudioEnergy() {
        if (!this.analyser) return 0;
        this.analyser.getByteFrequencyData(this.dataArray);

        // Calculate average energy
        let sum = 0;
        // Focus on bass/lower mids (first half of bins)
        const bins = this.dataArray.length / 2;
        for (let i = 0; i < bins; i++) {
            sum += this.dataArray[i];
        }
        // Normalize 0-1
        return (sum / bins) / 255;
    }

    playAudioChunk(base64Data) {
        const audioBuffer = this._decodePcm16(base64Data);
        this.audioQueue.push(audioBuffer);

        if (!this.isPlaying) {
            this._schedulePlayback();
        }
    }

    _base64ToArrayBuffer(base64) {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    _decodePcm16(base64Data) {
        const buffer = this._base64ToArrayBuffer(base64Data);
        const pcm16Data = new Int16Array(buffer);
        const numSamples = pcm16Data.length / this.channels;

        const audioBuffer = this.audioContext.createBuffer(
            this.channels,
            numSamples,
            this.sampleRate
        );

        for (let c = 0; c < this.channels; c++) {
            const channelData = audioBuffer.getChannelData(c);
            for (let i = 0; i < numSamples; i++) {
                const sampleIndex = i * this.channels + c;
                const int16Sample = pcm16Data[sampleIndex];
                channelData[i] = int16Sample / 32768.0;
            }
        }
        return audioBuffer;
    }

    _schedulePlayback() {
        if (this.audioQueue.length === 0) {
            this.isPlaying = false;
            return;
        }

        this.isPlaying = true;
        const now = this.audioContext.currentTime;
        const audioBuffer = this.audioQueue.shift();

        if (this.nextChunkTime < now) {
            this.nextChunkTime = now;
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.analyser); // Connect to analyser first
        source.start(this.nextChunkTime);
        this.nextChunkTime += audioBuffer.duration;

        source.onended = () => {
            this._schedulePlayback();
        };
    }

    resume() {
        if (this.audioContext.state === 'suspended') {
            console.log('Resuming AudioContext...');
            this.audioContext.resume();
        }
    }
}

// Global Lyria variables
window.lyriaSession = null;
window.audioPlayer = null;
window.lastGenreWeights = null;
window.geminiModel = null;
window.currentApiKey = null;
window.currentPromptText = 'Waiting for music generation...';

// Playback controls
const connectBtn = document.getElementById('connect-btn');
const refreshPromptBtn = document.getElementById('refresh-prompt-btn');
const playBtn = document.getElementById('play-btn');
const stopBtn = document.getElementById('stop-btn');
const volumeSlider = document.getElementById('volume-slider');
const volumeLabel = document.getElementById('volume-label');
const promptText = document.getElementById('prompt-text');

// Volume control
volumeSlider.addEventListener('input', (e) => {
    const volume = parseInt(e.target.value) / 100;
    volumeLabel.textContent = `${e.target.value}%`;

    if (window.audioPlayer && window.audioPlayer.gainNode) {
        window.audioPlayer.gainNode.gain.value = volume;
    }
});

// Play button
playBtn.addEventListener('click', async () => {
    if (window.lyriaSession) {
        try {
            await window.lyriaSession.play();
            if (window.audioPlayer) {
                window.audioPlayer.resume();
            }
            console.log('Playback resumed');
        } catch (error) {
            console.error('Failed to play:', error);
        }
    }
});

// Stop button
stopBtn.addEventListener('click', async () => {
    if (window.lyriaSession) {
        try {
            await window.lyriaSession.stop();
            console.log('Playback stopped');
        } catch (error) {
            console.error('Failed to stop:', error);
        }
    }
});

// Connect button
connectBtn.addEventListener('click', () => {
    if (!window.lyriaSession) {
        // Show modal
        document.getElementById('api-key-modal').classList.remove('hidden');
    } else {
        // Disconnect
        if (window.lyriaSession) {
            window.lyriaSession.close();
            window.lyriaSession = null;
        }
        connectBtn.textContent = 'Connect';
        connectBtn.classList.remove('connected');
        playBtn.disabled = true;
        stopBtn.disabled = true;
        refreshPromptBtn.disabled = true;
        document.getElementById('music-status').textContent = '🎵 Music: Not Connected';
        console.log('Disconnected from Lyria');
    }
});

// Refresh prompt button - force regeneration
refreshPromptBtn.addEventListener('click', async () => {
    if (!window.lyriaSession) {
        alert('Please connect to Lyria first');
        return;
    }

    console.log('🔄 Forcing prompt refresh...');

    // Clear last weights to force regeneration
    window.lastGenreWeights = null;

    // Immediately update music with current percentages
    if (genrePercentages) {
        await window.updateMusicFromGenres(genrePercentages);
    }

    // Visual feedback
    const originalText = refreshPromptBtn.innerHTML;
    refreshPromptBtn.innerHTML = '✓';
    setTimeout(() => {
        refreshPromptBtn.innerHTML = originalText;
    }, 1000);
});

// Connect to Lyria
window.connectLyria = async function () {
    const apiKey = document.getElementById('api-key-input').value.trim();

    if (!apiKey) {
        alert('Please enter an API key');
        return;
    }

    try {
        const musicStatus = document.getElementById('music-status');
        musicStatus.textContent = '🎵 Music: Connecting...';

        console.log('Connecting to Lyria...');

        const client = new GoogleGenAI({
            apiKey: apiKey,
            apiVersion: 'v1alpha'
        });

        // Initialize audio player
        if (!window.audioPlayer) {
            window.audioPlayer = new LyriaBrowserPlayer(48000, 2);
        }

        // Connect to Lyria
        window.lyriaSession = await client.live.music.connect({
            model: 'models/lyria-realtime-exp',
            callbacks: {
                onmessage: (message) => {
                    if (message.serverContent?.audioChunks) {
                        for (const chunk of message.serverContent.audioChunks) {
                            window.audioPlayer.playAudioChunk(chunk.data);
                        }
                    }
                    if (message.serverContent?.filteredPrompt) {
                        console.warn('Prompt filtered:', message.serverContent.filteredPrompt);
                    }
                },
                onerror: (error) => {
                    console.error('Lyria session error:', error);
                    musicStatus.textContent = '🎵 Music: Error';
                },
                onclose: (event) => {
                    console.warn('Lyria session closed:', event);
                    musicStatus.textContent = '🎵 Music: Disconnected';
                }
            }
        });

        console.log('Connected to Lyria!');

        // Store API key for Gemini Flash
        window.currentApiKey = apiKey;

        // Initialize Gemini Flash for prompt generation (separate client)
        try {
            const geminiClient = new GoogleGenerativeAI(apiKey);
            window.geminiModel = geminiClient.getGenerativeModel({
                model: 'models/gemini-flash-latest'
            });
            console.log('Gemini Flash initialized for prompt generation');
        } catch (flashError) {
            console.warn('Could not initialize Gemini Flash, falling back to simple prompts:', flashError);
        }

        // Set initial config
        await window.lyriaSession.setMusicGenerationConfig({
            musicGenerationConfig: {
                bpm: 120,
                temperature: 1.1,
                guidance: 4.0,
                density: 0.5,
                brightness: 0.5,
                scale: 'SCALE_UNSPECIFIED'
            }
        });

        // Start playback
        await window.lyriaSession.play();
        window.audioPlayer.resume();

        // Hide modal
        document.getElementById('api-key-modal').classList.add('hidden');

        musicStatus.textContent = '🎵 Music: Active - Adapting to Players';

        console.log('Lyria session active!');

        // Enable playback controls
        playBtn.disabled = false;
        stopBtn.disabled = false;
        refreshPromptBtn.disabled = false;

        // Update connect button
        connectBtn.textContent = 'Disconnect';
        connectBtn.classList.add('connected');

    } catch (error) {
        console.error('Failed to connect to Lyria:', error);
        alert('Failed to connect to Lyria: ' + error.message);
    }
};

// Update prompt ticker
function updatePromptTicker(prompts) {
    if (prompts && prompts.length > 0) {
        if (prompts.length === 1) {
            window.currentPromptText = prompts[0].text;
        } else {
            // Multiple weighted prompts - show them with weights
            window.currentPromptText = prompts.map(p =>
                `${p.text} (${Math.round(p.weight * 100)}%)`
            ).join(' + ');
        }
        promptText.textContent = window.currentPromptText;
        // Update all repeated instances
        document.getElementById('prompt-text-repeat').textContent = window.currentPromptText;
        document.getElementById('prompt-text-repeat2').textContent = window.currentPromptText;

        // Trigger color transition if random mode is active
        if (randomModeActive) {
            console.log('🎨 Prompt changed - triggering random color transition');
            generateNewRandomTargets();
            // Increase transition speed temporarily for more dramatic effect
            randomColorTransitionSpeed = 0.015;
            setTimeout(() => {
                randomColorTransitionSpeed = 0.002; // Reset to slow transition
            }, 3000);
        }

        // Broadcast prompt to stats dashboard
        if (socket && socket.connected) {
            socket.emit('promptUpdate', window.currentPromptText);
        }
    }
}

// Generate sophisticated prompt using Gemini Flash
async function generateLyriaPrompt(percentages) {
    // Use the current dynamic genres (convert to lowercase for prompts)
    const genresForPrompt = genres.map(g => g.toLowerCase());

    // Build genre distribution text
    const genreList = genresForPrompt
        .map((genre, i) => percentages[i] > 5 ? `${Math.round(percentages[i])}% ${genre}` : null)
        .filter(x => x)
        .join(', ');

    if (!genreList) {
        return [{
            text: 'minimal ambient music with sparse atmospheric sounds',
            weight: 1.0
        }];
    }

    // Try to use Gemini Flash for sophisticated prompt generation
    if (window.geminiModel) {
        try {
            const prompt = `You are a music prompt expert for Google's Lyria music generation system. Based on these genre percentages: ${genreList}, generate a sophisticated, detailed music prompt.

Follow these Lyria prompt guidelines:
- Be specific about instruments, rhythm, melody, harmony
- Describe the mood, energy level, and atmosphere
- Include tempo indicators and musical style details
- Keep it concise but descriptive (2-3 sentences max)
- Focus on the dominant genres but blend elements

Generate ONE unified prompt that captures the blend. Respond with ONLY the prompt text, no explanations.`;

            const result = await window.geminiModel.generateContent(prompt);
            const response = await result.response;
            const generatedPrompt = response.text().trim();

            console.log('Gemini Flash generated prompt:', generatedPrompt);

            return [{
                text: generatedPrompt,
                weight: 1.0
            }];
        } catch (error) {
            console.warn('Gemini Flash generation failed, using fallback:', error);
        }
    }

    // Fallback: simple weighted prompts
    const weightedPrompts = [];
    for (let i = 0; i < genresForPrompt.length; i++) {
        if (percentages[i] > 5) {
            const weight = percentages[i] / 100;
            weightedPrompts.push({
                text: `${genresForPrompt[i]} with deep rhythmic patterns and atmospheric elements`,
                weight: weight
            });
        }
    }

    return weightedPrompts.length > 0 ? weightedPrompts : [{
        text: 'minimal ambient music with sparse atmospheric sounds',
        weight: 1.0
    }];
}

// Update music based on genre percentages
window.updateMusicFromGenres = async function (percentages) {
    if (!window.lyriaSession) return;

    // Check if weights have changed significantly (>5% change)
    if (window.lastGenreWeights) {
        let maxChange = 0;
        for (let i = 0; i < 8; i++) {
            const change = Math.abs(percentages[i] - window.lastGenreWeights[i]);
            if (change > maxChange) maxChange = change;
        }
        if (maxChange < 5) return; // Don't update if change is too small
    }

    window.lastGenreWeights = [...percentages];

    try {
        // Generate sophisticated prompt using Gemini Flash
        const weightedPrompts = await generateLyriaPrompt(percentages);

        console.log('Updating music with prompts:', weightedPrompts);
        await window.lyriaSession.setWeightedPrompts({
            weightedPrompts: weightedPrompts
        });

        // Update prompt ticker
        updatePromptTicker(weightedPrompts);
    } catch (error) {
        console.error('Failed to update music prompts:', error);
    }
};
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusElement = document.getElementById('connection-status');
const playerCountElement = document.getElementById('player-count');

// Game state
let players = {};

// Drag and drop state (declare early for socket handlers)
let draggedPlayer = null;
let dragOffset = { x: 0, y: 0 };

// Socket.IO connection (viewer only, no interaction)
const socket = io({ query: { viewer: 'true' } });

// Stats state
let statsOpen = false;
let currentPercentages = [0, 0, 0, 0, 0, 0, 0, 0];

// Toggle stats logic


// Calculate genre stats
function updateStats(players) {
    const genreCounts = [0, 0, 0, 0, 0, 0, 0, 0];
    let totalPlayers = 0;

    // Use current (potentially resized) canvas dimensions
    const cols = 4;
    const rows = 2;
    const sectionWidth = canvas.width / cols;
    const sectionHeight = canvas.height / rows;

    for (const id in players) {
        const pos = players[id].position;
        // Simple genre check
        const col = Math.floor(pos.x / sectionWidth);
        const row = Math.floor(pos.y / sectionHeight);

        if (col >= 0 && col < cols && row >= 0 && row < rows) {
            const idx = row * cols + col;
            genreCounts[idx]++;
            totalPlayers++;
        }
    }

    // Update bars UI
    for (let i = 0; i < 8; i++) {
        const percentage = totalPlayers > 0 ? (genreCounts[i] / totalPlayers) * 100 : 0;
        currentPercentages[i] = percentage;

        const bar = document.getElementById(`stat-bar-${i}`);
        const pct = document.getElementById(`stat-pct-${i}`);
        const label = document.getElementById(`stat-name-${i}`);

        if (bar && pct && label) {
            bar.style.width = `${percentage}%`;
            pct.textContent = `${Math.round(percentage)}%`;
            label.textContent = genres[i] || `Genre ${i + 1}`;

            if (percentage < 15) {
                pct.classList.add('outside');
            } else {
                pct.classList.remove('outside');
            }
        }
    }
}

// History Chart Setup
const historyCtx = document.getElementById('history-chart').getContext('2d');
const maxDataPoints = 180; // 3 minutes
const historyData = {
    labels: Array(maxDataPoints).fill(''),
    datasets: genres.map((g, i) => ({
        label: g,
        data: Array(maxDataPoints).fill(0),
        borderColor: ['#ffffff', '#dddddd', '#bbbbbb', '#999999', '#777777', '#555555', '#333333', '#111111'][i],
        backgroundColor: 'transparent',
        borderWidth: 1,
        pointRadius: 0,
        tension: 0.4
    }))
};

const historyChart = new Chart(historyCtx, {
    type: 'line',
    data: historyData,
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
            y: { display: false, max: 100 },
            x: { display: false }
        },
        plugins: { legend: { display: false } }
    }
});

// Update history loop (1s)
setInterval(() => {
    historyData.datasets.forEach((dataset, i) => {
        dataset.label = genres[i];
        dataset.data.shift();
        dataset.data.push(currentPercentages[i]);
    });
    historyChart.update('none');
}, 1000);

// Set canvas size
function resizeCanvas() {
    const sidebarWidth = document.body.classList.contains('stats-open') ? 300 : 0;
    const availWidth = window.innerWidth - sidebarWidth;

    canvas.width = availWidth;
    canvas.height = window.innerHeight;

    // Resize WebGL canvas
    webglCanvas.width = availWidth;
    webglCanvas.height = window.innerHeight;
    if (gl) {
        gl.viewport(0, 0, webglCanvas.width, webglCanvas.height);
    }

    // Send canvas dimensions to server for physics boundaries
    if (socket && socket.connected) {
        socket.emit('updateBounds', {
            width: canvas.width,
            height: canvas.height
        });
    }
}

// =============================================
// WebGL Metaball Shader Setup
// =============================================

const webglCanvas = document.getElementById('webgl-canvas');
const gl = webglCanvas.getContext('webgl') || webglCanvas.getContext('experimental-webgl');

if (!gl) {
    console.error('WebGL not supported');
}

// Vertex shader (simple pass-through)
const vertexShaderSource = `
    attribute vec2 a_position;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

// Fragment shader (converted from ShaderToy)
const fragmentShaderSource = `
    precision highp float;
    
    uniform vec2 iResolution;
    uniform float iTime;
    uniform vec2 iMouse;
    uniform int playerCount;
    uniform vec2 playerPositions[32];  // Max 32 players
    uniform vec3 customColor1;
    uniform vec3 customColor2;
    uniform vec3 customColor3;
    uniform vec3 customColor4;
    uniform vec3 customColor5;
    uniform float u_energy;
    
    float k = 20.0;
    float field = 0.0;
    vec2 coord;
    
    vec2 center(vec2 border, vec2 offset, vec2 vel) {
        vec2 c;
        if (vel.x == 0.0 && vel.y == 0.0) {
            c = vec2(iMouse.x, iMouse.y);	
        } else {
            c = offset + vel * iTime * 0.5;
            c = mod(c, 2.0 - 4.0 * border);
            if (c.x > 1.0 - border.x) c.x = 2.0 - c.x - 2.0 * border.x;
            if (c.x < border.x) c.x = 2.0 * border.x - c.x;
            if (c.y > 1.0 - border.y) c.y = 2.0 - c.y - 2.0 * border.y;
            if (c.y < border.y) c.y = 2.0 * border.y - c.y;
        }
        return c;
    }
    
    void circle(float r, vec3 col, vec2 offset, vec2 vel) {
        vec2 pos = coord.xy / iResolution.y;
        float aspect = iResolution.x / iResolution.y;
        vec2 c = center(vec2(r / aspect, r), offset, vel);
        c.x *= aspect;
        float d = distance(pos, c);
        field += (k * r) / (d * d);
    }
    
    vec3 band(float shade, float low, float high, vec3 col1, vec3 col2) {
        if ((shade >= low) && (shade <= high)) {
            float delta = (shade - low) / (high - low);
            vec3 colDiff = col2 - col1;
            return col1 + (delta * colDiff);
        } else {
            return vec3(0.0, 0.0, 0.0);
        }
    }
    
    vec3 gradient(float shade) {
        // Use custom colors from UI
        vec3 colour = vec3(0.0);
        
        colour += band(shade, 0.0, 0.2, colour, customColor1);
        colour += band(shade, 0.2, 0.4, customColor1, customColor2);
        colour += band(shade, 0.4, 0.6, customColor2, customColor3);
        colour += band(shade, 0.6, 0.8, customColor3, customColor4);
        colour += band(shade, 0.8, 1.0, customColor4, customColor5);
        
        return colour;
    }
    
    void main() {
        coord = gl_FragCoord.xy;
        field = 0.0;
        
        // Draw metaballs for each player
        for (int i = 0; i < 32; i++) {
            if (i >= playerCount) break;
            
            vec2 playerPos = playerPositions[i];
            vec2 normalizedPos = playerPos / iResolution;
            
            // Add wobble effect - each metaball has a unique phase based on its index
            float wobbleSpeed = 1.5;
            float wobbleAmount = 0.015; // Small wobble radius
            float phase = float(i) * 2.3; // Unique phase for each metaball
            
            float wobbleX = sin(iTime * wobbleSpeed + phase) * wobbleAmount;
            float wobbleY = cos(iTime * wobbleSpeed * 1.3 + phase * 1.7) * wobbleAmount;
            
            // Create metaball at player position with wobble
            vec2 pos = coord.xy / iResolution.y;
            float aspect = iResolution.x / iResolution.y;
            vec2 c = normalizedPos;
            c.x *= aspect;
            c.x += wobbleX;
            c.y += wobbleY;
            
            // Pulse size based on audio energy
            // Base size 0.08, add energy influence
            float pulse = u_energy * 0.06 * (0.8 + sin(iTime * 10.0 + phase) * 0.2);
            float r = 0.08 + pulse;
            
            float d = distance(pos, c);
            field += (k * r) / (d * d);
        }
        
        // Add subtle animated background metaballs for ambient effect (reduced visibility)
        circle(0.008, vec3(0.5), vec2(0.3, 0.4), vec2(0.15, 0.10));
        circle(0.010, vec3(0.5), vec2(0.7, 0.3), vec2(0.08, 0.12));
        circle(0.008, vec3(0.5), vec2(0.5, 0.7), vec2(0.12, 0.08));
        circle(0.012, vec3(0.5), vec2(0.2, 0.6), vec2(0.10, 0.15));
        
        float shade = min(1.0, max(field / 256.0, 0.0));
        
        gl_FragColor = vec4(gradient(shade), 1.0);
    }
`;

// Compile shader
function compileShader(source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

// Create shader program
const vertexShader = compileShader(vertexShaderSource, gl.VERTEX_SHADER);
const fragmentShader = compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);

const shaderProgram = gl.createProgram();
gl.attachShader(shaderProgram, vertexShader);
gl.attachShader(shaderProgram, fragmentShader);
gl.linkProgram(shaderProgram);

if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    console.error('Shader program linking error:', gl.getProgramInfoLog(shaderProgram));
}

gl.useProgram(shaderProgram);

// Set up geometry (full-screen quad)
const positions = new Float32Array([
    -1, -1,
    1, -1,
    -1, 1,
    1, 1
]);

const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

const positionLocation = gl.getAttribLocation(shaderProgram, 'a_position');
gl.enableVertexAttribArray(positionLocation);
gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

// Get uniform locations
const iResolutionLocation = gl.getUniformLocation(shaderProgram, 'iResolution');
const iTimeLocation = gl.getUniformLocation(shaderProgram, 'iTime');
const iMouseLocation = gl.getUniformLocation(shaderProgram, 'iMouse');
const playerCountLocation = gl.getUniformLocation(shaderProgram, 'playerCount');
const playerPositionsLocation = gl.getUniformLocation(shaderProgram, 'playerPositions');
const customColor1Location = gl.getUniformLocation(shaderProgram, 'customColor1');
const customColor2Location = gl.getUniformLocation(shaderProgram, 'customColor2');
const customColor3Location = gl.getUniformLocation(shaderProgram, 'customColor3');
const customColor4Location = gl.getUniformLocation(shaderProgram, 'customColor4');
const customColor5Location = gl.getUniformLocation(shaderProgram, 'customColor5');
const uEnergyLocation = gl.getUniformLocation(shaderProgram, 'u_energy');

// Helper function to convert hex to RGB
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255
    } : { r: 1, g: 0, b: 1 };
}

// Store current colors (Standard preset by default)
let metaballColors = {
    color1: hexToRgb('#000000'),
    color2: hexToRgb('#808080'),
    color3: hexToRgb('#ffffff'),
    color4: hexToRgb('#808080'),
    color5: hexToRgb('#000000')
};

let startTime = Date.now();
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;

// Track mouse movement for shader
webglCanvas.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = window.innerHeight - e.clientY;  // Flip Y coordinate
});

// Render WebGL metaballs
function renderMetaballs() {
    if (!gl) return;

    const time = (Date.now() - startTime) / 1000.0;

    // Clear
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Update uniforms
    gl.uniform2f(iResolutionLocation, webglCanvas.width, webglCanvas.height);
    gl.uniform1f(iTimeLocation, time);
    gl.uniform2f(iMouseLocation, mouseX, mouseY);

    // Pass audio energy to shader
    let energy = 0;
    if (window.audioPlayer && window.lyriaSession) {
        energy = window.audioPlayer.getAudioEnergy();
    }
    gl.uniform1f(uEnergyLocation, energy);

    // Update player positions
    const playerArray = Object.values(players);
    const playerCount = Math.min(playerArray.length, 32);
    gl.uniform1i(playerCountLocation, playerCount);

    // Create flat array of player positions
    const positions = new Float32Array(64);  // 32 players * 2 coords
    for (let i = 0; i < playerCount; i++) {
        const player = playerArray[i];
        positions[i * 2] = player.position.x;
        positions[i * 2 + 1] = webglCanvas.height - player.position.y;  // Flip Y
    }
    gl.uniform2fv(playerPositionsLocation, positions);

    // Update color uniforms
    gl.uniform3f(customColor1Location, metaballColors.color1.r, metaballColors.color1.g, metaballColors.color1.b);
    gl.uniform3f(customColor2Location, metaballColors.color2.r, metaballColors.color2.g, metaballColors.color2.b);
    gl.uniform3f(customColor3Location, metaballColors.color3.r, metaballColors.color3.g, metaballColors.color3.b);
    gl.uniform3f(customColor4Location, metaballColors.color4.r, metaballColors.color4.g, metaballColors.color4.b);
    gl.uniform3f(customColor5Location, metaballColors.color5.r, metaballColors.color5.g, metaballColors.color5.b);

    // Draw
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// Color picker event listeners
document.getElementById('color-1').addEventListener('input', (e) => {
    metaballColors.color1 = hexToRgb(e.target.value);
    console.log('Color 1 updated:', e.target.value);
});

document.getElementById('color-2').addEventListener('input', (e) => {
    metaballColors.color2 = hexToRgb(e.target.value);
    console.log('Color 2 updated:', e.target.value);
});

document.getElementById('color-3').addEventListener('input', (e) => {
    metaballColors.color3 = hexToRgb(e.target.value);
    console.log('Color 3 updated:', e.target.value);
});

document.getElementById('color-4').addEventListener('input', (e) => {
    metaballColors.color4 = hexToRgb(e.target.value);
    console.log('Color 4 updated:', e.target.value);
});

document.getElementById('color-5').addEventListener('input', (e) => {
    metaballColors.color5 = hexToRgb(e.target.value);
    console.log('Color 5 updated:', e.target.value);
});

// Color preset definitions - loaded from config.json
let colorPresets = {};
let defaultColorPreset = 'standard';

// Load config from server
fetch('/config.json')
    .then(response => response.json())
    .then(config => {
        // Load color presets
        if (config.colorPresets) {
            colorPresets = config.colorPresets;
            console.log('Loaded color presets from config:', colorPresets);
        }
        if (config.defaultColorPreset) {
            defaultColorPreset = config.defaultColorPreset;
            // Apply default preset
            applyColorPreset(defaultColorPreset);
            console.log('Applied default color preset:', defaultColorPreset);
        }

        // Load visual settings
        if (config.visualSettings) {
            const vs = config.visualSettings;

            if (vs.circleScale !== undefined) {
                circleRadius = vs.circleScale;
                circleScaleInput.value = vs.circleScale;
                circleScaleValue.textContent = vs.circleScale;
            }

            if (vs.pulseEnabled !== undefined) {
                pulseEnabled = vs.pulseEnabled;
                pulseToggle.classList.toggle('active', pulseEnabled);
                pulseToggle.querySelector('.status').textContent = pulseEnabled ? 'ON' : 'OFF';
            }

            if (vs.fillEnabled !== undefined) {
                fillEnabled = vs.fillEnabled;
                fillToggle.classList.toggle('active', fillEnabled);
                fillToggle.querySelector('.status').textContent = fillEnabled ? 'ON' : 'OFF';
            }

            if (vs.solidFillEnabled !== undefined) {
                solidFillEnabled = vs.solidFillEnabled;
                solidFillToggle.classList.toggle('active', solidFillEnabled);
                solidFillToggle.querySelector('.status').textContent = solidFillEnabled ? 'ON' : 'OFF';
            }

            if (vs.namesEnabled !== undefined) {
                namesEnabled = vs.namesEnabled;
                namesToggle.classList.toggle('active', namesEnabled);
                namesToggle.querySelector('.status').textContent = namesEnabled ? 'ON' : 'OFF';
            }

            if (vs.webglEnabled !== undefined) {
                webglEnabled = vs.webglEnabled;
                webglToggle.classList.toggle('active', webglEnabled);
                webglToggle.querySelector('.status').textContent = webglEnabled ? 'ON' : 'OFF';
                webglCanvas.style.display = webglEnabled ? 'block' : 'none';
            }

            if (vs.playerRingsEnabled !== undefined) {
                playerRingsEnabled = vs.playerRingsEnabled;
                playerRingsToggle.classList.toggle('active', playerRingsEnabled);
                playerRingsToggle.querySelector('.status').textContent = playerRingsEnabled ? 'ON' : 'OFF';
            }

            console.log('Loaded visual settings from config');
        }

        // Load Lyria settings
        if (config.lyriaSettings) {
            const ls = config.lyriaSettings;

            if (ls.adaptiveMusicEnabled !== undefined) {
                adaptiveMusicEnabled = ls.adaptiveMusicEnabled;
                adaptiveMusicToggle.classList.toggle('active', adaptiveMusicEnabled);
                adaptiveMusicToggle.querySelector('.status').textContent = adaptiveMusicEnabled ? 'ON' : 'OFF';
            }

            if (ls.bpm !== undefined) {
                lyriaBpmInput.value = ls.bpm;
                lyriaBpmValue.textContent = ls.bpm;
            }

            if (ls.temperature !== undefined) {
                lyriaTemperatureInput.value = ls.temperature;
                lyriaTemperatureValue.textContent = ls.temperature.toFixed(1);
            }

            if (ls.guidance !== undefined) {
                lyriaGuidanceInput.value = ls.guidance;
                lyriaGuidanceValue.textContent = ls.guidance.toFixed(1);
            }

            if (ls.density !== undefined) {
                lyriaDensityInput.value = ls.density;
                lyriaDensityValue.textContent = ls.density.toFixed(2);
            }

            if (ls.brightness !== undefined) {
                lyriaBrightnessInput.value = ls.brightness;
                lyriaBrightnessValue.textContent = ls.brightness.toFixed(2);
            }

            if (ls.scale !== undefined) {
                document.getElementById('lyria-scale').value = ls.scale;
            }

            console.log('Loaded Lyria settings from config');
        }
    })
    .catch(error => {
        console.error('Failed to load config.json, using fallback presets:', error);
        // Fallback presets
        colorPresets = {
            standard: ['#000000', '#808080', '#ffffff', '#808080', '#000000'],
            neon: ['#ff00ff', '#00ffff', '#ff6600', '#00ff00', '#ffffff'],
            fire: ['#000000', '#ff0000', '#ff6600', '#ffff00', '#ffffff'],
            ocean: ['#000033', '#0066ff', '#00ffff', '#66ffff', '#ffffff'],
            purple: ['#000000', '#4b0082', '#9400d3', '#ff00ff', '#ffffff']
        };
    });

// Random color animation state
let randomModeActive = false;
let randomTargetColors = {
    color1: { r: 0, g: 0, b: 0 },
    color2: { r: 0, g: 0, b: 0 },
    color3: { r: 1, g: 1, b: 1 },
    color4: { r: 0, g: 0, b: 0 },
    color5: { r: 0, g: 0, b: 0 }
};
let randomColorTransitionSpeed = 0.002; // Slow transition

// Generate random color
function generateRandomColor() {
    return {
        r: Math.random(),
        g: Math.random(),
        b: Math.random()
    };
}

// Convert RGB object to hex
function rgbToHex(rgb) {
    const r = Math.round(rgb.r * 255).toString(16).padStart(2, '0');
    const g = Math.round(rgb.g * 255).toString(16).padStart(2, '0');
    const b = Math.round(rgb.b * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
}

// Lerp between two colors
function lerpColor(color1, color2, t) {
    return {
        r: color1.r + (color2.r - color1.r) * t,
        g: color1.g + (color2.g - color1.g) * t,
        b: color1.b + (color2.b - color1.b) * t
    };
}

// Generate new random target colors
function generateNewRandomTargets() {
    randomTargetColors.color1 = generateRandomColor();
    randomTargetColors.color2 = generateRandomColor();
    randomTargetColors.color3 = generateRandomColor();
    randomTargetColors.color4 = generateRandomColor();
    randomTargetColors.color5 = generateRandomColor();
}

// Animate random colors
function animateRandomColors() {
    if (!randomModeActive) return;
    
    // Smoothly transition current colors toward targets
    metaballColors.color1 = lerpColor(metaballColors.color1, randomTargetColors.color1, randomColorTransitionSpeed);
    metaballColors.color2 = lerpColor(metaballColors.color2, randomTargetColors.color2, randomColorTransitionSpeed);
    metaballColors.color3 = lerpColor(metaballColors.color3, randomTargetColors.color3, randomColorTransitionSpeed);
    metaballColors.color4 = lerpColor(metaballColors.color4, randomTargetColors.color4, randomColorTransitionSpeed);
    metaballColors.color5 = lerpColor(metaballColors.color5, randomTargetColors.color5, randomColorTransitionSpeed);
    
    // Update color pickers to show current colors
    document.getElementById('color-1').value = rgbToHex(metaballColors.color1);
    document.getElementById('color-2').value = rgbToHex(metaballColors.color2);
    document.getElementById('color-3').value = rgbToHex(metaballColors.color3);
    document.getElementById('color-4').value = rgbToHex(metaballColors.color4);
    document.getElementById('color-5').value = rgbToHex(metaballColors.color5);
    
    // Check if we're close enough to targets, then generate new ones
    const threshold = 0.01;
    const isCloseToTarget = 
        Math.abs(metaballColors.color1.r - randomTargetColors.color1.r) < threshold &&
        Math.abs(metaballColors.color1.g - randomTargetColors.color1.g) < threshold &&
        Math.abs(metaballColors.color1.b - randomTargetColors.color1.b) < threshold;
    
    if (isCloseToTarget) {
        generateNewRandomTargets();
    }
}

// Apply color preset
function applyColorPreset(presetName) {
    if (presetName === 'random') {
        // Enable random mode
        randomModeActive = true;
        generateNewRandomTargets();
        console.log('Random color mode activated');
        return;
    }
    
    // Disable random mode for other presets
    randomModeActive = false;
    
    const colors = colorPresets[presetName];
    if (!colors) return;
    
    // Update color pickers
    document.getElementById('color-1').value = colors[0];
    document.getElementById('color-2').value = colors[1];
    document.getElementById('color-3').value = colors[2];
    document.getElementById('color-4').value = colors[3];
    document.getElementById('color-5').value = colors[4];
    
    // Update metaball colors
    metaballColors.color1 = hexToRgb(colors[0]);
    metaballColors.color2 = hexToRgb(colors[1]);
    metaballColors.color3 = hexToRgb(colors[2]);
    metaballColors.color4 = hexToRgb(colors[3]);
    metaballColors.color5 = hexToRgb(colors[4]);
    
    console.log(`Applied ${presetName} preset`);
}

// Add preset button event listeners
document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const preset = btn.dataset.preset;
        applyColorPreset(preset);
    });
});

// Start random color animation loop
setInterval(animateRandomColors, 16); // ~60fps

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

socket.on('connect', () => {
    statusElement.textContent = 'CONNECTED';
    statusElement.className = 'status connected';
    console.log('Server view connected as viewer');
    
    // Send initial canvas dimensions to server
    socket.emit('updateBounds', {
        width: canvas.width,
        height: canvas.height
    });
});

socket.on('disconnect', () => {
    statusElement.textContent = 'DISCONNECTED';
    statusElement.className = 'status disconnected';
    console.log('Server view disconnected');
});

socket.on('players', (serverPlayers) => {
    // Filter out this viewer connection
    const filteredPlayers = {};
    for (const id in serverPlayers) {
        if (id !== socket.id) {
            filteredPlayers[id] = serverPlayers[id];
        }
    }
    players = filteredPlayers;
    playerCountElement.textContent = Object.keys(players).length;
    // Update stats
    if (typeof updateStats === 'function') updateStats(players);
});

socket.on('physicsUpdate', (serverPlayers) => {
    // Update all player positions from server physics
    const filteredPlayers = {};
    for (const id in serverPlayers) {
        if (id !== socket.id) {
            // Don't override the position of the player being dragged
            if (id === draggedPlayer && draggedPlayer !== null) {
                // Keep current position for dragged player
                filteredPlayers[id] = players[id];
            } else {
                filteredPlayers[id] = serverPlayers[id];
            }
        }
    }
    players = filteredPlayers;
    playerCountElement.textContent = Object.keys(players).length;
    // Update stats
    if (typeof updateStats === 'function') updateStats(players);
});

socket.on('playerDisconnected', (id) => {
    delete players[id];
    playerCountElement.textContent = Object.keys(players).length;
});

// Listen for genre updates from server
socket.on('genresUpdate', (newGenres) => {
    genres = newGenres;
    console.log('Genres updated:', genres);
    
    // Update genre input fields
    for (let i = 0; i < 8; i++) {
        document.getElementById(`genre-${i}`).value = genres[i];
    }
});

// Initialize genre input fields with current genres
for (let i = 0; i < 8; i++) {
    document.getElementById(`genre-${i}`).value = genres[i];
}

// Genre editing functionality
const applyGenresBtn = document.getElementById('apply-genres');
const genreInputs = document.querySelectorAll('.genre-input');

function applyGenres() {
    const newGenres = [];
    let allFilled = true;
    
    genreInputs.forEach((input, index) => {
        const value = input.value.trim().toUpperCase();
        if (value.length === 0) {
            allFilled = false;
        } else {
            newGenres.push(value);
        }
    });
    
    if (!allFilled || newGenres.length !== 8) {
        alert('Please fill all 8 genre fields');
        return;
    }
    
    // Send to server
    socket.emit('updateGenres', newGenres);
    
    // Visual feedback
    applyGenresBtn.textContent = '✓ GENRES APPLIED';
    setTimeout(() => {
        applyGenresBtn.textContent = 'APPLY GENRES';
    }, 2000);
    
    console.log('Applied genres:', newGenres);
}

applyGenresBtn.addEventListener('click', applyGenres);

// Allow Enter key to apply genres
genreInputs.forEach(input => {
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            applyGenres();
        }
    });
});

// Store animated percentages
const genrePercentages = [0, 0, 0, 0, 0, 0, 0, 0];
const targetPercentages = [0, 0, 0, 0, 0, 0, 0, 0];

// Calculate which genre section a player is in
function getPlayerGenre(x, y) {
    const cols = 4;
    const rows = 2;
    const sectionWidth = canvas.width / cols;
    const sectionHeight = canvas.height / rows;
    
    const col = Math.floor(x / sectionWidth);
    const row = Math.floor(y / sectionHeight);
    
    if (col >= 0 && col < cols && row >= 0 && row < rows) {
        return row * cols + col;
    }
    return -1;
}

// Draw genre sections and dot grid background
function drawGrid() {
    const cols = 4;
    const rows = 2;
    const sectionWidth = canvas.width / cols;
    const sectionHeight = canvas.height / rows;
    
    // Count players in each genre
    const genreCounts = [0, 0, 0, 0, 0, 0, 0, 0];
    let totalPlayers = 0;
    
    for (const id in players) {
        const pos = players[id].position;
        const genreIndex = getPlayerGenre(pos.x, pos.y);
        if (genreIndex >= 0) {
            genreCounts[genreIndex]++;
            totalPlayers++;
        }
    }
    
    // Draw genre sections
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const x = col * sectionWidth;
            const y = row * sectionHeight;
            const genreIndex = row * cols + col;
            
            // Draw section border
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, sectionWidth, sectionHeight);
            
            // Calculate target percentage
            targetPercentages[genreIndex] = totalPlayers > 0 ? (genreCounts[genreIndex] / totalPlayers) * 100 : 0;
            
            // Smooth animation toward target
            const lerpSpeed = 0.1;
            genrePercentages[genreIndex] += (targetPercentages[genreIndex] - genrePercentages[genreIndex]) * lerpSpeed;
            
            // Draw vertical percentage bar on left side with more margin
            const barWidth = 8;
            const barHeight = sectionHeight - 40; // More margin top/bottom
            const barX = x + 15; // More margin from left
            const barY = y + 20; // More margin from top
            const fillHeight = (genrePercentages[genreIndex] / 100) * barHeight;
            
            // Background bar
            ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.fillRect(barX, barY, barWidth, barHeight);
            
            // Fill bar (animated)
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(barX, barY + barHeight - fillHeight, barWidth, fillHeight);
            
            // Draw genre label in upper left corner (offset for UI bar if top row)
            const labelY = row === 0 ? y + 70 : y + 20;
            ctx.fillStyle = '#ffffff';
            ctx.font = '24px Helvetica, Arial, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(genres[genreIndex].toLowerCase(), x + 35, labelY); // Offset for bar
            
            // Draw percentage text
            ctx.font = '14px Helvetica, Arial, sans-serif';
            ctx.fillText(`${Math.round(genrePercentages[genreIndex])}%`, x + 35, labelY + 28);
        }
    }
}

// Calculate distance between two points
function distance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

let pulseTime = 0;

// Store random pulse offsets for each player
const playerPulseOffsets = {};

function getPlayerPulseOffset(playerId) {
    if (!playerPulseOffsets[playerId]) {
        playerPulseOffsets[playerId] = {
            offset: Math.random() * Math.PI * 2, // Random starting phase
            speed: 0.8 + Math.random() * 0.4,    // Random speed (0.8-1.2x)
            amplitude: 3 + Math.random() * 4      // Random amplitude (3-7px)
        };
    }
    return playerPulseOffsets[playerId];
}

// Create off-screen canvas for metaball effect (at lower resolution for performance)
const metaballCanvas = document.createElement('canvas');
const metaballCtx = metaballCanvas.getContext('2d', { willReadFrequently: true });
let metaballScale = 0.5; // Render at half resolution
let frameCount = 0;

function resizeMetaballCanvas() {
    metaballCanvas.width = canvas.width * metaballScale;
    metaballCanvas.height = canvas.height * metaballScale;
}
resizeMetaballCanvas();
window.addEventListener('resize', resizeMetaballCanvas);

// Settings (defaults - will be loaded from config.json)
let circleRadius = 60;
let numRings = 1;
let ringWidth = 4;
let pulseEnabled = true;
let fillEnabled = true;
let solidFillEnabled = false;
let namesEnabled = true;
let webglEnabled = true;
let playerRingsEnabled = false;

// Hamburger menu toggle
const hamburger = document.getElementById('hamburger');
const menu = document.getElementById('menu');

hamburger.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
});

// Close menu when clicking outside
document.addEventListener('click', (e) => {
    if (menu.classList.contains('open') && !menu.contains(e.target)) {
        menu.classList.remove('open');
    }
});

// Prevent menu clicks from closing the menu
menu.addEventListener('click', (e) => {
    e.stopPropagation();
});

// Circle scale control
const circleScaleInput = document.getElementById('circle-scale');
const circleScaleValue = document.getElementById('circle-scale-value');

circleScaleInput.addEventListener('input', (e) => {
    circleRadius = parseInt(e.target.value);
    circleScaleValue.textContent = circleRadius;
});

// Ring controls removed - using default values (numRings = 5, ringWidth = 4)

// Pulse toggle
const pulseToggle = document.getElementById('pulse-toggle');
pulseToggle.addEventListener('click', () => {
    pulseEnabled = !pulseEnabled;
    pulseToggle.classList.toggle('active');
    pulseToggle.querySelector('.status').textContent = pulseEnabled ? 'ON' : 'OFF';
});

// Fill toggle
const fillToggle = document.getElementById('fill-toggle');
fillToggle.addEventListener('click', () => {
    fillEnabled = !fillEnabled;
    fillToggle.classList.toggle('active');
    fillToggle.querySelector('.status').textContent = fillEnabled ? 'ON' : 'OFF';
});

// Solid fill toggle
const solidFillToggle = document.getElementById('solid-fill-toggle');
solidFillToggle.addEventListener('click', () => {
    solidFillEnabled = !solidFillEnabled;
    solidFillToggle.classList.toggle('active');
    solidFillToggle.querySelector('.status').textContent = solidFillEnabled ? 'ON' : 'OFF';
});

// Names toggle
const namesToggle = document.getElementById('names-toggle');
namesToggle.addEventListener('click', () => {
    namesEnabled = !namesEnabled;
    namesToggle.classList.toggle('active');
    namesToggle.querySelector('.status').textContent = namesEnabled ? 'ON' : 'OFF';
});


// WebGL toggle
const webglToggle = document.getElementById('webgl-toggle');
webglToggle.addEventListener('click', () => {
    webglEnabled = !webglEnabled;
    webglToggle.classList.toggle('active');
    webglToggle.querySelector('.status').textContent = webglEnabled ? 'ON' : 'OFF';
    
    // Hide/show WebGL canvas
    webglCanvas.style.display = webglEnabled ? 'block' : 'none';
});

// Color picker controls
const primaryColorInput = document.getElementById('primary-color');
const secondaryColorInput = document.getElementById('secondary-color');

// Player rings toggle
const playerRingsToggle = document.getElementById('player-rings-toggle');
playerRingsToggle.addEventListener('click', () => {
    playerRingsEnabled = !playerRingsEnabled;
    playerRingsToggle.classList.toggle('active');
    playerRingsToggle.querySelector('.status').textContent = playerRingsEnabled ? 'ON' : 'OFF';
});

// Lyria controls
let adaptiveMusicEnabled = true;

// Adaptive music toggle
const adaptiveMusicToggle = document.getElementById('adaptive-music-toggle');
adaptiveMusicToggle.addEventListener('click', () => {
    adaptiveMusicEnabled = !adaptiveMusicEnabled;
    adaptiveMusicToggle.classList.toggle('active');
    adaptiveMusicToggle.querySelector('.status').textContent = adaptiveMusicEnabled ? 'ON' : 'OFF';
});

// Lyria BPM control
const lyriaBpmInput = document.getElementById('lyria-bpm');
const lyriaBpmValue = document.getElementById('lyria-bpm-value');
lyriaBpmInput.addEventListener('input', (e) => {
    lyriaBpmValue.textContent = e.target.value;
});

// Lyria Temperature control
const lyriaTemperatureInput = document.getElementById('lyria-temperature');
const lyriaTemperatureValue = document.getElementById('lyria-temperature-value');
lyriaTemperatureInput.addEventListener('input', (e) => {
    lyriaTemperatureValue.textContent = parseFloat(e.target.value).toFixed(1);
});

// Lyria Guidance control
const lyriaGuidanceInput = document.getElementById('lyria-guidance');
const lyriaGuidanceValue = document.getElementById('lyria-guidance-value');
lyriaGuidanceInput.addEventListener('input', (e) => {
    lyriaGuidanceValue.textContent = parseFloat(e.target.value).toFixed(1);
});

// Lyria Density control
const lyriaDensityInput = document.getElementById('lyria-density');
const lyriaDensityValue = document.getElementById('lyria-density-value');
lyriaDensityInput.addEventListener('input', (e) => {
    lyriaDensityValue.textContent = parseFloat(e.target.value).toFixed(2);
});

// Lyria Brightness control
const lyriaBrightnessInput = document.getElementById('lyria-brightness');
const lyriaBrightnessValue = document.getElementById('lyria-brightness-value');
lyriaBrightnessInput.addEventListener('input', (e) => {
    lyriaBrightnessValue.textContent = parseFloat(e.target.value).toFixed(2);
});

// Single player controls
document.getElementById('add-bot-btn').addEventListener('click', () => {
    console.log('Add Bot Clicked');
    if (socket && socket.connected) {
        console.log('Emitting addBot');
        socket.emit('addBot');
    } else {
        console.error('Socket not connected');
    }
});

document.getElementById('remove-bot-btn').addEventListener('click', () => {
    console.log('Remove Bot Clicked');
    if (socket && socket.connected) {
        socket.emit('removeBot');
    }
});

document.getElementById('clear-bots-btn').addEventListener('click', () => {
    console.log('Clear Bots Clicked');
    if (socket && socket.connected) {
        socket.emit('clearBots');
    }
});

// Apply Lyria configuration
const applyLyriaConfigBtn = document.getElementById('apply-lyria-config');
applyLyriaConfigBtn.addEventListener('click', async () => {
    if (!window.lyriaSession) {
        alert('Please connect to Lyria first');
        return;
    }

    try {
        const config = {
            bpm: parseInt(lyriaBpmInput.value),
            temperature: parseFloat(lyriaTemperatureInput.value),
            guidance: parseFloat(lyriaGuidanceInput.value),
            density: parseFloat(lyriaDensityInput.value),
            brightness: parseFloat(lyriaBrightnessInput.value),
            scale: document.getElementById('lyria-scale').value
        };

        console.log('Applying Lyria config:', config);
        
        await window.lyriaSession.setMusicGenerationConfig({
            musicGenerationConfig: config
        });

        console.log('✓ Lyria configuration updated');
        
        // Visual feedback
        applyLyriaConfigBtn.textContent = '✓ APPLIED';
        setTimeout(() => {
            applyLyriaConfigBtn.textContent = 'APPLY CONFIGURATION';
        }, 2000);
        
    } catch (error) {
        console.error('Failed to update Lyria config:', error);
        alert('Failed to update configuration: ' + error.message);
    }
});

// Update music every few seconds based on genre percentages
setInterval(() => {
    if (window.lyriaSession && genrePercentages && adaptiveMusicEnabled) {
        window.updateMusicFromGenres(genrePercentages);
    }
}, 3000); // Update every 3 seconds

// Drag and drop functionality (variables declared at top with other state)

canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Check if clicking on any player
    for (const id in players) {
        const player = players[id];
        const dx = mouseX - player.position.x;
        const dy = mouseY - player.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Check if click is within player radius
        if (dist < circleRadius) {
            draggedPlayer = id;
            dragOffset.x = dx;
            dragOffset.y = dy;
            canvas.style.cursor = 'grabbing';
            break;
        }
    }
});

canvas.addEventListener('mousemove', (e) => {
    if (draggedPlayer) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Update player position
        if (players[draggedPlayer]) {
            players[draggedPlayer].position.x = mouseX - dragOffset.x;
            players[draggedPlayer].position.y = mouseY - dragOffset.y;

            // Clamp to canvas bounds
            players[draggedPlayer].position.x = Math.max(30, Math.min(canvas.width - 30, players[draggedPlayer].position.x));
            players[draggedPlayer].position.y = Math.max(30, Math.min(canvas.height - 30, players[draggedPlayer].position.y));
        }
    } else {
        // Update cursor when hovering over players
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        let overPlayer = false;
        for (const id in players) {
            const player = players[id];
            const dx = mouseX - player.position.x;
            const dy = mouseY - player.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < circleRadius) {
                overPlayer = true;
                break;
            }
        }

        canvas.style.cursor = overPlayer ? 'grab' : 'default';
    }
});

canvas.addEventListener('mouseup', () => {
    if (draggedPlayer && players[draggedPlayer]) {
        // Send updated position to server
        socket.emit('updatePlayerPosition', {
            playerId: draggedPlayer,
            position: players[draggedPlayer].position
        });
    }
    draggedPlayer = null;
    canvas.style.cursor = 'default';
});

canvas.addEventListener('mouseleave', () => {
    draggedPlayer = null;
    canvas.style.cursor = 'default';
});

function draw() {
    // Render WebGL metaballs first (background layer)
    renderMetaballs();
    
    // Clear 2D canvas with transparent background for overlay
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw grid background
    drawGrid();

    // Update pulse animation
    pulseTime += 0.05;
    frameCount++;

    // Draw simple shapes
    if (fillEnabled) {
        for (const id in players) {
            const player = players[id];
            const pulseData = getPlayerPulseOffset(id);
            
            // Use audio energy if available, otherwise fallback to sine wave
            let energyPulse = 0;
            if (window.audioPlayer && window.lyriaSession) {
                const energy = window.audioPlayer.getAudioEnergy();
                // Scale energy to visible pulse (e.g., 0-20px)
                // Combine with individual offset to keep variation
                energyPulse = energy * 15 * (0.8 + Math.sin(pulseData.offset) * 0.2); 
            }
            
            const sinePulse = Math.sin((pulseTime * pulseData.speed) + pulseData.offset) * pulseData.amplitude;
            
            // Mix simulations: mostly audio if active, otherwise sine
            const pulseAmount = pulseEnabled ? 
                (window.audioPlayer && window.lyriaSession ? Math.max(sinePulse * 0.3, energyPulse) : sinePulse) 
                : 0;

            const pulsedSize = circleRadius + pulseAmount;
            const shape = player.shape || 'circle';
            
            if (shape === 'circle') {
                if (solidFillEnabled) {
                    // Draw solid white filled circle
                    ctx.fillStyle = '#ffffff';
                    ctx.beginPath();
                    ctx.arc(player.position.x, player.position.y, pulsedSize, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    // Draw concentric rings getting smaller towards center using dynamic values
                    const ringGap = 8; // Gap between rings
                    
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = ringWidth;
                    
                    for (let ring = 0; ring < numRings; ring++) {
                        const ringRadius = pulsedSize - (ring * (pulsedSize / numRings)) - (ring * ringGap);
                        // Skip rings that are too small to be visible (performance optimization)
                        if (ringRadius > 2) {
                            ctx.beginPath();
                            ctx.arc(player.position.x, player.position.y, ringRadius, 0, Math.PI * 2);
                            ctx.stroke();
                        }
                    }
                }
            } else if (shape === 'square') {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(
                    player.position.x - pulsedSize,
                    player.position.y - pulsedSize,
                    pulsedSize * 2,
                    pulsedSize * 2
                );
            } else if (shape === 'triangle') {
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.moveTo(player.position.x, player.position.y - pulsedSize);
                ctx.lineTo(player.position.x + pulsedSize, player.position.y + pulsedSize);
                ctx.lineTo(player.position.x - pulsedSize, player.position.y + pulsedSize);
                ctx.closePath();
                ctx.fill();
            }
        }
    }
    
    // Draw audio visualization rings around players (if enabled)
    if (playerRingsEnabled) {
        for (const id in players) {
            const player = players[id];
            const pulseData = getPlayerPulseOffset(id);
            
            // Create multiple pulsing rings with different phases
            const numRings = 3;
            for (let i = 0; i < numRings; i++) {
                const ringPhase = (pulseTime * pulseData.speed * 0.8) + (i * Math.PI * 0.66);
                const ringPulse = (Math.sin(ringPhase) + 1) / 2; // 0 to 1
                const ringRadius = circleRadius + 20 + (i * 25) + (ringPulse * 15);
                const ringAlpha = (1 - ringPulse) * 0.4; // Fade out as it expands
                
                ctx.strokeStyle = `rgba(255, 255, 255, ${ringAlpha})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(player.position.x, player.position.y, ringRadius, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }
    
    // Draw player names on top (if enabled)
    if (namesEnabled) {
        for (const id in players) {
            const player = players[id];
            const playerName = player.name || '';
            if (playerName) {
            ctx.font = '300 16px "Roboto Mono"';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // Measure text for background
            const textMetrics = ctx.measureText(playerName);
            const textWidth = textMetrics.width;
            const textHeight = 20;
            const padding = 6;
            
            // Draw white background
            ctx.fillStyle = 'white';
            ctx.fillRect(
                player.position.x - textWidth / 2 - padding,
                player.position.y - textHeight / 2,
                textWidth + padding * 2,
                textHeight
            );
            
                // Draw text
                ctx.fillStyle = 'black';
                ctx.fillText(playerName, player.position.x, player.position.y);
            }
        }
    }

    requestAnimationFrame(draw);
}

draw();
