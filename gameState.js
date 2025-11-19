const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'config.json');

// Load genres from config file or use defaults
function loadGenres() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (config.genres && Array.isArray(config.genres) && config.genres.length === 8) {
                console.log('Loaded genres from config.json');
                return config.genres;
            }
        }
    } catch (error) {
        console.error('Error loading config.json:', error);
    }
    // Return defaults if file doesn't exist or is invalid
    return ['TECHNO', 'ELECTRO', 'JAZZ', 'HIP HOP', 'CLASSICAL', 'HOUSE', 'AMBIENT', 'DRUM & BASS'];
}

// Save genres to config file (preserving other settings)
function saveGenres(genresToSave) {
    try {
        // Load existing config to preserve other settings
        let config = {};
        if (fs.existsSync(CONFIG_FILE)) {
            try {
                config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            } catch (parseError) {
                console.warn('Could not parse existing config, creating new:', parseError);
            }
        }

        // Update only the genres property
        config.genres = genresToSave;

        // Save back to file
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        console.log('Genres saved to config.json (other settings preserved)');
    } catch (error) {
        console.error('Error saving config.json:', error);
    }
}

// All players get white color for minimal design
function getRandomColor() {
    return '#ffffff';
}

module.exports = {
    loadGenres,
    saveGenres,
    getRandomColor
};
