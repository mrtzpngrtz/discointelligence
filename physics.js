// Physics constants
const BALL_RADIUS = 30;
const FRICTION = 0.95;
const BOUNCE_DAMPING = 0.8;
const COLLISION_ELASTICITY = 0.7;
const MAX_VELOCITY = 15;
const PHYSICS_TICK_RATE = 60; // 60 times per second

// Physics utility functions
function distance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// Check collision between two circles
function checkCollision(p1, p2) {
    const dist = distance(p1.position.x, p1.position.y, p2.position.x, p2.position.y);
    return dist < (BALL_RADIUS * 2);
}

// Resolve collision between two balls
function resolveCollision(p1, p2) {
    const dx = p2.position.x - p1.position.x;
    const dy = p2.position.y - p1.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    // Prevent division by zero
    if (dist === 0) return;
    
    // Calculate collision normal
    const nx = dx / dist;
    const ny = dy / dist;
    
    // Separate overlapping balls
    const overlap = (BALL_RADIUS * 2) - dist;
    if (overlap > 0) {
        const separationX = nx * overlap * 0.5;
        const separationY = ny * overlap * 0.5;
        
        p1.position.x -= separationX;
        p1.position.y -= separationY;
        p2.position.x += separationX;
        p2.position.y += separationY;
    }
    
    // Calculate relative velocity
    const dvx = p2.velocity.x - p1.velocity.x;
    const dvy = p2.velocity.y - p1.velocity.y;
    
    // Calculate relative velocity in collision normal direction
    const relativeVelocity = dvx * nx + dvy * ny;
    
    // Don't resolve if velocities are separating
    if (relativeVelocity > 0) return;
    
    // Calculate impulse scalar
    const impulse = -(1 + COLLISION_ELASTICITY) * relativeVelocity;
    const impulseX = impulse * nx;
    const impulseY = impulse * ny;
    
    // Apply impulse to both balls
    p1.velocity.x -= impulseX * 0.5;
    p1.velocity.y -= impulseY * 0.5;
    p2.velocity.x += impulseX * 0.5;
    p2.velocity.y += impulseY * 0.5;
}

// Physics update loop
function updatePhysics(players, bounds) {
    const playerIds = Object.keys(players);
    
    // Update velocities from input and apply friction
    for (const id of playerIds) {
        const player = players[id];
        
        if (!player.velocity) {
            player.velocity = { x: 0, y: 0 };
        }
        
        // Apply friction
        player.velocity.x *= FRICTION;
        player.velocity.y *= FRICTION;
        
        // Bot AI - Static (no wandering)
        if (player.isBot) {
            // Keep bots relatively stationary, just let them be pushed by collisions
            // Apply stronger friction to make them settle quickly if pushed
            player.velocity.x *= 0.9;
            player.velocity.y *= 0.9;
        }
        
        // Clamp velocity
        const speed = Math.sqrt(player.velocity.x * player.velocity.x + player.velocity.y * player.velocity.y);
        if (speed > MAX_VELOCITY) {
            player.velocity.x = (player.velocity.x / speed) * MAX_VELOCITY;
            player.velocity.y = (player.velocity.y / speed) * MAX_VELOCITY;
        }
        
        // Update position based on velocity
        player.position.x += player.velocity.x;
        player.position.y += player.velocity.y;
        
        // Boundary collision with bounce
        if (player.position.x - BALL_RADIUS < 0) {
            player.position.x = BALL_RADIUS;
            player.velocity.x = Math.abs(player.velocity.x) * BOUNCE_DAMPING;
        }
        if (player.position.x + BALL_RADIUS > bounds.width) {
            player.position.x = bounds.width - BALL_RADIUS;
            player.velocity.x = -Math.abs(player.velocity.x) * BOUNCE_DAMPING;
        }
        if (player.position.y - BALL_RADIUS < 0) {
            player.position.y = BALL_RADIUS;
            player.velocity.y = Math.abs(player.velocity.y) * BOUNCE_DAMPING;
        }
        if (player.position.y + BALL_RADIUS > bounds.height) {
            player.position.y = bounds.height - BALL_RADIUS;
            player.velocity.y = -Math.abs(player.velocity.y) * BOUNCE_DAMPING;
        }
    }
    
    // Check collisions between all pairs of players
    for (let i = 0; i < playerIds.length; i++) {
        for (let j = i + 1; j < playerIds.length; j++) {
            const p1 = players[playerIds[i]];
            const p2 = players[playerIds[j]];
            
            if (checkCollision(p1, p2)) {
                resolveCollision(p1, p2);
            }
        }
    }
}

module.exports = {
    updatePhysics,
    BALL_RADIUS,
    PHYSICS_TICK_RATE
};
