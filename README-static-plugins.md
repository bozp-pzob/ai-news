# Static Build Module for Plugins

This feature provides a mechanism to pre-build a static JSON file containing all available plugin modules and their constructor interfaces during the build process. This enables the frontend to load plugin data without requiring backend API calls, which is useful for:

1. Static hosting scenarios where the frontend is deployed separately from the backend
2. Faster initial loading of the application
3. Fallback mechanism when the backend is temporarily unavailable

## How It Works

The static build module consists of several components:

### 1. Build Script (`scripts/buildStaticPlugins.js`)

This script scans all plugin directories and extracts the plugin information, including:
- Plugin name and type
- Description
- Constructor interface (parameters for configuration)
- Config schema

It outputs this data to a static JSON file at `frontend/public/static/plugins.json`.

### 2. Plugin Registry Enhancement

The `PluginRegistry` class has been enhanced to support loading plugins from the static JSON file:

- On initialization, it first tries to load from the static file
- If the static file is not available or fails to load, it falls back to the API
- A flag indicates whether the static data is being used

### 3. Build Process Integration

New npm scripts have been added to integrate the static build process:

- `npm run build:plugins` - Builds just the static plugins file
- `npm run build:all` - Complete build including TypeScript compilation, static plugins, and frontend build

## Usage

### Development

During development, the application will automatically try to load from the static file but fall back to the API if needed.

### Production Build

For production, include the static plugins build in your CI/CD pipeline:

```bash
# Full build including static plugins
npm run build:all
```

### Customization

If you need to modify how the static plugins are generated:

1. Edit `scripts/buildStaticPlugins.js` to change the scanning or processing logic
2. Edit `frontend/src/services/PluginRegistry.ts` to change how plugins are loaded

## Benefits

- **Offline capability**: Frontend can start with a complete set of available plugins even if the backend is temporarily unavailable
- **Performance**: Eliminates the need for an API call to fetch plugin information on initial load
- **Reduced server load**: Fewer API calls means less load on your backend
- **Static hosting**: Enables deploying the frontend to static hosting services

## Limitations

- Changes to plugins require a rebuild of the static file
- Dynamic plugins added at runtime will only be available through the API, not the static file 