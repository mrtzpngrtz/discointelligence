# schwarm D.I. – DISCO INTELLIGENCE.

A real-time multiplayer experience where players control shapes on their smartphones, with a server view showing all players with customizable visual effects.

## Features

- **Mobile View** (`/`): Shows only your own ball (red) with grid background
- **Server View** (`/server-view`): Shows all players' balls (white) with connection lines and grid background
- Real-time synchronization using Socket.IO
- Touch and mouse controls

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open in browser:
   - Mobile/Player view: `http://localhost:3000/`
   - Server view: `http://localhost:3000/server-view`

## Deployment to Vercel

⚠️ **Important Note**: Socket.IO applications with persistent WebSocket connections have limitations on Vercel's serverless platform. For production use with real-time multiplayer, consider using platforms like:
- Railway (recommended)
- Render
- Heroku
- DigitalOcean App Platform

### If you still want to deploy to Vercel:

1. Install Vercel CLI:
```bash
npm install -g vercel
```

2. Deploy:
```bash
vercel
```

3. Follow the prompts to deploy your project

**Note**: On Vercel, Socket.IO will work with polling fallback, but the experience may not be as smooth as with a persistent WebSocket connection on other platforms.

## Alternative: Deploy to Railway (Recommended for Socket.IO)

1. Create account at [Railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select this repository
4. Railway will auto-detect Node.js and deploy
5. **Port Configuration**: Railway automatically sets the PORT environment variable - no manual configuration needed! The app uses `process.env.PORT` which Railway provides automatically.
6. Your app will be live with full WebSocket support

**Note**: The server automatically uses Railway's PORT environment variable (defaults to 3000 locally). No additional configuration required!

## Usage

1. Open the server view on a desktop/laptop to monitor all players
2. Open the mobile view on smartphones for each player
3. Drag your ball around on the mobile view
4. Watch the server view update in real-time showing all players

## Project Structure

- `index.html` - Mobile/player view (shows only own ball)
- `server-view.html` - Server view (shows all players)
- `server.js` - Express + Socket.IO server
- `package.json` - Dependencies
- `vercel.json` - Vercel configuration

## Technologies

- Node.js
- Express.js
- Socket.IO
- HTML5 Canvas
- Vanilla JavaScript
