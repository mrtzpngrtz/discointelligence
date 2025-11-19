// Socket.IO connection
const socket = io({ query: { viewer: 'true', stats: 'true' } });

const connectionStatus = document.getElementById('connection-status');
const connectionDot = document.getElementById('connection-dot');
const playerCount = document.getElementById('player-count');
const currentPrompt = document.getElementById('current-prompt');

// Genre names - will be updated from server
let genres = ['techno', 'electro', 'jazz', 'hiphop', 'classical', 'house', 'ambient', 'drumandbass'];
let genreDisplayNames = ['TECHNO', 'ELECTRO', 'JAZZ', 'HIP HOP', 'CLASSICAL', 'HOUSE', 'AMBIENT', 'DRUM & BASS'];

// Listen for genre updates from server
socket.on('genresUpdate', (newGenres) => {
    genreDisplayNames = newGenres;
    genres = newGenres.map(g => g.toLowerCase().replace(/\s+/g, ''));
    console.log('Genres updated:', genreDisplayNames);

    // Update genre labels
    document.querySelectorAll('.genre-name').forEach((el, index) => {
        if (index < genreDisplayNames.length) {
            el.textContent = genreDisplayNames[index];
        }
    });

    // Update chart labels
    historyData.datasets.forEach((dataset, index) => {
        if (index < genreDisplayNames.length) {
            dataset.label = genreDisplayNames[index];
        }
    });
    historyChart.update('none');
});

// Uptime tracking
let startTime = Date.now();

function updateUptime() {
    const elapsed = Date.now() - startTime;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    document.getElementById('uptime').textContent =
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
setInterval(updateUptime, 1000);

// Socket events
socket.on('connect', () => {
    connectionStatus.textContent = 'CONNECTED';
    connectionDot.classList.remove('disconnected');
});

socket.on('disconnect', () => {
    connectionStatus.textContent = 'DISCONNECTED';
    connectionDot.classList.add('disconnected');
});

socket.on('players', (players) => {
    // Count non-viewer players
    let count = 0;
    for (const id in players) {
        if (id !== socket.id) count++;
    }
    playerCount.textContent = count;

    // Calculate genre percentages
    updateGenreStats(players);
});

socket.on('physicsUpdate', (players) => {
    // Count non-viewer players
    let count = 0;
    for (const id in players) {
        if (id !== socket.id) count++;
    }
    playerCount.textContent = count;

    // Calculate genre percentages
    updateGenreStats(players);
});

// Listen for prompt updates (we'll add this to server later)
socket.on('promptUpdate', (prompt) => {
    currentPrompt.textContent = prompt;
});

// Genre percentage calculation
function getPlayerGenre(x, y, canvasWidth, canvasHeight) {
    const cols = 4;
    const rows = 2;
    const sectionWidth = canvasWidth / cols;
    const sectionHeight = canvasHeight / rows;

    const col = Math.floor(x / sectionWidth);
    const row = Math.floor(y / sectionHeight);

    if (col >= 0 && col < cols && row >= 0 && row < rows) {
        return row * cols + col;
    }
    return -1;
}

// Store actual canvas dimensions from server
let canvasWidth = 1920;
let canvasHeight = 1080;

// Listen for canvas dimension updates
socket.on('boundsUpdate', (bounds) => {
    canvasWidth = bounds.width;
    canvasHeight = bounds.height;
    console.log('Canvas dimensions updated:', bounds);
});

function updateGenreStats(players) {
    const genreCounts = [0, 0, 0, 0, 0, 0, 0, 0];
    let totalPlayers = 0;

    for (const id in players) {
        if (id === socket.id) continue; // Skip viewer
        const pos = players[id].position;
        const genreIndex = getPlayerGenre(pos.x, pos.y, canvasWidth, canvasHeight);
        if (genreIndex >= 0) {
            genreCounts[genreIndex]++;
            totalPlayers++;
        }
    }

    // Update bars using numeric IDs
    for (let index = 0; index < 8; index++) {
        const percentage = totalPlayers > 0 ? (genreCounts[index] / totalPlayers) * 100 : 0;
        const bar = document.getElementById(`bar-${index}`);
        const pct = document.getElementById(`pct-${index}`);

        if (bar && pct) {
            bar.style.width = `${percentage}%`;
            pct.textContent = `${Math.round(percentage)}%`;

            // Move percentage outside if bar is too small
            if (percentage < 15) {
                pct.classList.add('outside');
            } else {
                pct.classList.remove('outside');
            }
        }
    }

    // Update history chart
    updateHistoryChart(genreCounts.map((count, i) =>
        totalPlayers > 0 ? (count / totalPlayers) * 100 : 0
    ));
}

// History chart setup
const ctx = document.getElementById('history-chart').getContext('2d');
const maxDataPoints = 180; // 180 seconds (3 minutes) of data

const historyData = {
    labels: Array(maxDataPoints).fill(''),
    datasets: [
        {
            label: 'TECHNO',
            data: Array(maxDataPoints).fill(0),
            borderColor: 'rgba(255, 255, 255, 1)',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 2,
            tension: 0.4
        },
        {
            label: 'ELECTRO',
            data: Array(maxDataPoints).fill(0),
            borderColor: 'rgba(255, 255, 255, 0.8)',
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
            borderWidth: 2,
            tension: 0.4
        },
        {
            label: 'JAZZ',
            data: Array(maxDataPoints).fill(0),
            borderColor: 'rgba(255, 255, 255, 0.6)',
            backgroundColor: 'rgba(255, 255, 255, 0.06)',
            borderWidth: 2,
            tension: 0.4
        },
        {
            label: 'HIP HOP',
            data: Array(maxDataPoints).fill(0),
            borderColor: 'rgba(255, 255, 255, 0.5)',
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            borderWidth: 2,
            tension: 0.4
        },
        {
            label: 'CLASSICAL',
            data: Array(maxDataPoints).fill(0),
            borderColor: 'rgba(255, 255, 255, 0.4)',
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
            borderWidth: 2,
            tension: 0.4
        },
        {
            label: 'HOUSE',
            data: Array(maxDataPoints).fill(0),
            borderColor: 'rgba(255, 255, 255, 0.3)',
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            borderWidth: 2,
            tension: 0.4
        },
        {
            label: 'AMBIENT',
            data: Array(maxDataPoints).fill(0),
            borderColor: 'rgba(255, 255, 255, 0.25)',
            backgroundColor: 'rgba(255, 255, 255, 0.025)',
            borderWidth: 2,
            tension: 0.4
        },
        {
            label: 'DRUM & BASS',
            data: Array(maxDataPoints).fill(0),
            borderColor: 'rgba(255, 255, 255, 0.2)',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            borderWidth: 2,
            tension: 0.4
        }
    ]
};

const historyChart = new Chart(ctx, {
    type: 'line',
    data: historyData,
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            y: {
                beginAtZero: true,
                max: 100,
                ticks: {
                    color: 'rgba(255, 255, 255, 0.7)',
                    font: {
                        family: 'Roboto Mono',
                        size: 10
                    },
                    callback: function (value) {
                        return value + '%';
                    }
                },
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)'
                }
            },
            x: {
                ticks: {
                    color: 'rgba(255, 255, 255, 0.7)',
                    font: {
                        family: 'Roboto Mono',
                        size: 10
                    }
                },
                grid: {
                    color: 'rgba(255, 255, 255, 0.05)'
                }
            }
        },
        plugins: {
            legend: {
                labels: {
                    color: 'rgba(255, 255, 255, 0.9)',
                    font: {
                        family: 'Roboto Mono',
                        size: 11
                    },
                    padding: 15
                }
            }
        }
    }
});

// Update chart every second
function updateHistoryChart(percentages) {
    // Shift data and add new point
    historyData.datasets.forEach((dataset, index) => {
        dataset.data.shift();
        dataset.data.push(percentages[index]);
    });

    historyChart.update('none'); // Update without animation for smooth real-time feel
}

// Update chart every second
setInterval(() => {
    // Chart will be updated by genre stats
}, 1000);
